import type { HuntStats } from './achievements';
import {
  BACK_FACTOR,
  CACHE_MAX,
  CACHE_MIN,
  COINS,
  DETECT,
  DIG_TIME,
  HINT_PENALTY,
  LANDMARKS,
  SPEED,
  START,
  TURN_RATE,
  type Landmark,
} from './config';
import { angleDiff, bearing, dist, headingVec, norm360, toLocal, type Vec } from './geo';
import { mulberry32, randomSeed } from './rng';
import { canRun, readDetector, stepStamina, type Mode, type Reading, type StaminaState } from './rules';
import { SCORE, scoreFind } from './score';
import type { StreetIndex } from './streets';

export interface Cache {
  landmark: Landmark;
  centre: Vec; // the landmark itself
  pos: Vec; // where the cache is buried
  found: boolean;
  hinted: boolean;
  /** Multiplayer: name of the rival who dug it up first. */
  takenBy?: string;
}

export interface Controls {
  forward: number;
  turn: number;
  run: boolean;
}

export interface StartOptions {
  seed?: number;
  daily?: boolean;
  /**
   * Multiplayer: instead of deciding a find locally, ask the referee. The
   * answer comes back through `resolveFind`.
   */
  arbiter?: (cacheIndex: number) => void;
}

export type Phase = 'menu' | 'playing' | 'won';

export class Game {
  phase: Phase = 'menu';
  pos: Vec;
  heading = 100; // facing the National Monument across the square
  mode: Mode = 'standing';
  direction = 0;
  stamina: StaminaState = { value: 100, exhausted: false };
  bent = false;
  caches: Cache[] = [];
  coins: Vec[] = [];
  coinTaken: boolean[] = [];
  elapsed = 0;
  hints = 0;
  score = 0;
  streak = 0;
  bestStreak = 0;
  coinCount = 0;
  daily = false;
  multiplayerWin = false;
  reading: Reading = { bars: 0, message: '', arrow: null, onTarget: false };

  onFound: (cache: Cache, mine: boolean, points: number) => void = () => {};
  onCoin: (index: number) => void = () => {};
  onWin: () => void = () => {};

  private digLeft = 0;
  private flash: { msg: string; left: number } | null = null;
  private lastFindAt = 0;
  private everExhausted = false;
  private metresRun = 0;
  private arbiter: ((cacheIndex: number) => void) | null = null;

  constructor(private streets: StreetIndex) {
    this.pos = this.startPos();
    this.layOut(randomSeed());
  }

  private startPos(): Vec {
    const p = toLocal(START.lng, START.lat);
    return this.streets.isWalkable(p.x, p.y) ? p : this.streets.snap(p.x, p.y);
  }

  /** Place caches and coins. The same seed always gives the same hunt. */
  private layOut(seed: number): void {
    const random = mulberry32(seed);
    this.caches = LANDMARKS.map((landmark) => {
      const centre = toLocal(landmark.lng, landmark.lat);
      let pos = centre;
      // Random spot 15-45 m out, snapped to a street. Retry if snapping dragged it far away.
      for (let i = 0; i < 30; i++) {
        const a = random() * Math.PI * 2;
        const r = CACHE_MIN + random() * (CACHE_MAX - CACHE_MIN);
        pos = this.streets.snap(centre.x + Math.cos(a) * r, centre.y + Math.sin(a) * r);
        const d = dist(pos, centre);
        if (d >= CACHE_MIN * 0.6 && d <= CACHE_MAX + 15) break;
      }
      return { landmark, centre, pos, found: false, hinted: false };
    });

    // Coins: scattered over the streets between the landmarks.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of this.caches) {
      minX = Math.min(minX, c.centre.x);
      minY = Math.min(minY, c.centre.y);
      maxX = Math.max(maxX, c.centre.x);
      maxY = Math.max(maxY, c.centre.y);
    }
    const m = COINS.margin;
    this.coins = [];
    for (let i = 0; i < COINS.count; i++) {
      this.coins.push(
        this.streets.snap(
          minX - m + random() * (maxX - minX + 2 * m),
          minY - m + random() * (maxY - minY + 2 * m),
        ),
      );
    }
    this.coinTaken = this.coins.map(() => false);
  }

  start(opts: StartOptions = {}): void {
    this.phase = 'playing';
    this.pos = this.startPos();
    this.heading = 100;
    this.mode = 'standing';
    this.stamina = { value: 100, exhausted: false };
    this.bent = false;
    this.elapsed = 0;
    this.hints = 0;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.coinCount = 0;
    this.lastFindAt = 0;
    this.everExhausted = false;
    this.metresRun = 0;
    this.multiplayerWin = false;
    this.digLeft = 0;
    this.flash = null;
    this.daily = !!opts.daily;
    this.arbiter = opts.arbiter ?? null;
    this.layOut(opts.seed ?? randomSeed());
  }

  /** Leave the hunt without finishing (e.g. the multiplayer room closed). */
  abort(): void {
    this.phase = 'menu';
    this.mode = 'standing';
    this.bent = false;
    this.digLeft = 0;
  }

  get foundCount(): number {
    return this.caches.filter((c) => c.found && !c.takenBy).length;
  }

  /** Clock shown to the player: play time plus hint penalties. */
  get time(): number {
    return this.elapsed + this.hints * HINT_PENALTY;
  }

  get stats(): HuntStats {
    return {
      found: this.foundCount,
      total: this.caches.length,
      // In a race, rivals' finds end the hunt too; only your own full set counts as finishing.
      finished: this.phase === 'won' && this.foundCount === this.caches.length,
      time: this.time,
      hints: this.hints,
      coins: this.coinCount,
      bestStreak: this.bestStreak,
      everExhausted: this.everExhausted,
      metresRun: this.metresRun,
      daily: this.daily,
      multiplayerWin: this.multiplayerWin,
      pages: 0, // filled in by the caller, which owns the story progress
      totalPages: 0,
    };
  }

  private nearest(): { cache: Cache; index: number; d: number } | null {
    let best: { cache: Cache; index: number; d: number } | null = null;
    this.caches.forEach((cache, index) => {
      if (cache.found) return;
      const d = dist(this.pos, cache.pos);
      if (!best || d < best.d) best = { cache, index, d };
    });
    return best;
  }

  toggleBend(): void {
    if (this.phase !== 'playing' || this.digLeft > 0) return;
    this.bent = !this.bent;
  }

  dig(): void {
    if (this.phase !== 'playing' || this.digLeft > 0) return;
    if (!this.bent) {
      this.say('Bend over first, then dig.');
      return;
    }
    this.digLeft = DIG_TIME;
  }

  useHint(index: number): void {
    const cache = this.caches[index];
    if (this.phase !== 'playing' || !cache || cache.found || cache.hinted) return;
    cache.hinted = true;
    this.hints++;
  }

  private say(msg: string, seconds = 2.2): void {
    this.flash = { msg, left: seconds };
  }

  private finishDig(): void {
    const n = this.nearest();
    if (!n || n.d > DETECT.digRange) {
      this.say('Nothing buried here.');
      return;
    }
    if (this.arbiter) {
      this.say('Digging it up…', 1.5);
      this.arbiter(n.index);
    } else this.resolveFind(n.index, true);
  }

  /**
   * Record that a cache was dug up, by this player or (multiplayer) by a rival.
   */
  resolveFind(index: number, mine: boolean, rivalName = ''): void {
    const cache = this.caches[index];
    if (!cache || cache.found) return;
    cache.found = true;
    let points = 0;
    if (mine) {
      const r = scoreFind(this.elapsed - this.lastFindAt, cache.hinted, this.streak);
      this.lastFindAt = this.elapsed;
      this.streak = r.streak;
      this.bestStreak = Math.max(this.bestStreak, r.streak);
      points = r.points;
      this.score += points;
      this.say(`Found ${cache.landmark.loot}!`, 3);
    } else {
      cache.takenBy = rivalName || 'A rival';
    }
    this.onFound(cache, mine, points);
    if (this.phase === 'playing' && this.caches.every((c) => c.found)) {
      this.phase = 'won';
      this.onWin();
    }
  }

  update(dt: number, c: Controls): void {
    const playing = this.phase === 'playing';
    if (playing) this.elapsed += dt;

    let forward = playing ? c.forward : 0;
    const turn = playing ? c.turn : 0;

    if (this.digLeft > 0) {
      forward = 0;
      this.digLeft -= dt;
      if (this.digLeft <= 0) {
        this.digLeft = 0;
        this.finishDig();
      }
    }
    const digging = this.digLeft > 0;
    const moving = Math.abs(forward) > 0.05;

    let mode: Mode;
    if (digging) mode = 'digging';
    else if (this.bent) mode = 'bent';
    else if (moving && forward > 0 && c.run && canRun(this.stamina)) mode = 'running';
    else mode = moving ? 'walking' : 'standing';
    this.mode = mode;
    this.direction = moving ? Math.sign(forward) : 0;
    this.stamina = stepStamina(this.stamina, mode, dt);
    if (this.stamina.exhausted) this.everExhausted = true;

    if (!digging) this.heading = norm360(this.heading + turn * TURN_RATE * dt);

    if (moving) {
      const speed =
        (mode === 'running' ? SPEED.run : mode === 'bent' ? SPEED.bent : SPEED.walk) *
        (forward < 0 ? BACK_FACTOR : 1);
      const dir = headingVec(this.heading);
      const step = speed * forward * dt;
      const next = this.streets.constrain(this.pos.x + dir.x * step, this.pos.y + dir.y * step);
      if (mode === 'running') this.metresRun += dist(this.pos, next);
      this.pos = next;
    }

    if (playing) {
      for (let i = 0; i < this.coins.length; i++) {
        if (this.coinTaken[i]) continue;
        const coin = this.coins[i];
        const dx = coin.x - this.pos.x;
        const dy = coin.y - this.pos.y;
        if (dx * dx + dy * dy <= COINS.reach * COINS.reach) {
          this.coinTaken[i] = true;
          this.coinCount++;
          this.score += SCORE.coin;
          this.onCoin(i);
        }
      }
    }

    const n = this.nearest();
    const rel = n ? angleDiff(this.heading, bearing(this.pos, n.cache.pos)) : 0;
    this.reading = readDetector(mode, n ? n.d : Infinity, rel);
    if (this.flash) {
      this.flash.left -= dt;
      if (this.flash.left <= 0) this.flash = null;
      else this.reading = { ...this.reading, message: this.flash.msg };
    }
  }
}
