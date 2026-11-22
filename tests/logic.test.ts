import { describe, expect, it } from 'vitest';
import { BBOX, LANDMARKS, START } from '../src/config';
import { Game } from '../src/game';
import { angleDiff, bearing, dist, toLngLat, toLocal } from '../src/geo';
import { convertOverpass } from '../src/overpass';
import { canRun, formatTime, readDetector, stepStamina } from '../src/rules';
import { StreetIndex } from '../src/streets';

describe('geo', () => {
  it('round-trips and measures metres', () => {
    const p = toLocal(4.9003, 52.3791);
    const [lng, lat] = toLngLat(p.x, p.y);
    expect(lng).toBeCloseTo(4.9003, 7);
    expect(lat).toBeCloseTo(52.3791, 7);
    const o = toLocal(START.lng, START.lat);
    expect(o.x).toBeCloseTo(0, 6);
    // 0.001 deg of latitude is about 111.2 m
    expect(toLocal(START.lng, START.lat + 0.001).y).toBeGreaterThan(110.5);
    expect(toLocal(START.lng, START.lat + 0.001).y).toBeLessThan(112);
  });
  it('bearings and angle differences', () => {
    expect(bearing({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0);
    expect(bearing({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
    expect(angleDiff(350, 10)).toBeCloseTo(20);
    expect(angleDiff(10, 350)).toBeCloseTo(-20);
  });
});

describe('street index', () => {
  // An L-shaped street: east along y=0, then north along x=100. Plus a square.
  const idx = new StreetIndex(
    [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    ],
    [
      [
        [
          { x: 200, y: 200 },
          { x: 260, y: 200 },
          { x: 260, y: 260 },
          { x: 200, y: 260 },
          { x: 200, y: 200 },
        ],
      ],
    ],
    { min: { x: -500, y: -500 }, max: { x: 500, y: 500 } },
  );

  it('accepts points within 6 m of a street', () => {
    expect(idx.isWalkable(50, 5.9)).toBe(true);
    expect(idx.isWalkable(50, 6.5)).toBe(false);
    expect(idx.constrain(50, 3)).toEqual({ x: 50, y: 3 });
  });
  it('slides along the street edge instead of stopping', () => {
    const p = idx.constrain(53, 9);
    expect(p.x).toBeCloseTo(53); // forward progress kept
    expect(p.y).toBeLessThanOrEqual(6);
    expect(p.y).toBeGreaterThan(5.5);
    expect(idx.isWalkable(p.x, p.y)).toBe(true);
  });
  it('accepts points inside pedestrian polygons', () => {
    expect(idx.isWalkable(230, 230)).toBe(true);
    expect(idx.inPolygon(190, 230)).toBe(false);
  });
  it('snaps to the nearest centreline from far away', () => {
    const p = idx.snap(-300, 40);
    expect(p).toEqual({ x: 0, y: 0 });
    expect(idx.snap(140, 70)).toEqual({ x: 100, y: 70 });
  });
  it('keeps positions inside the bounds', () => {
    expect(idx.constrain(9999, 0).x).toBeLessThanOrEqual(500);
  });
});

describe('overpass conversion', () => {
  it('builds lines, areas and stitched multipolygons', () => {
    const sq = (o: number) => [
      { lat: 52.35 + o, lon: 4.87 },
      { lat: 52.35 + o, lon: 4.871 },
      { lat: 52.351 + o, lon: 4.871 },
      { lat: 52.35 + o, lon: 4.87 },
    ];
    const data = convertOverpass(
      [
        { type: 'way', tags: { highway: 'residential' }, geometry: sq(0).slice(0, 2) },
        { type: 'way', tags: { highway: 'pedestrian' }, geometry: sq(0.01) },
        { type: 'way', tags: { highway: 'primary', tunnel: 'yes' }, geometry: sq(0).slice(0, 2) },
        {
          type: 'relation',
          tags: { type: 'multipolygon', highway: 'pedestrian' },
          members: [
            { type: 'way', role: 'outer', geometry: sq(0.02).slice(0, 3) },
            { type: 'way', role: 'outer', geometry: sq(0.02).slice(2) },
          ],
        },
      ],
      BBOX,
    );
    expect(data.lines).toHaveLength(3);
    expect(data.polys).toHaveLength(2);
    expect(data.lines[0]).toEqual([8000, 2000, 9000, 2000]);
  });
});

describe('stamina', () => {
  it('drains at 10 %/s and locks running until 30 %', () => {
    let s = { value: 100, exhausted: false };
    s = stepStamina(s, 'running', 4);
    expect(s.value).toBeCloseTo(60);
    s = stepStamina(s, 'running', 10);
    expect(s).toEqual({ value: 0, exhausted: true });
    expect(canRun(s)).toBe(false);
    s = stepStamina(s, 'walking', 3); // 8 %/s
    expect(s.value).toBeCloseTo(24);
    expect(canRun(s)).toBe(false);
    s = stepStamina(s, 'standing', 0.5); // 16 %/s
    expect(s.value).toBeCloseTo(32);
    expect(canRun(s)).toBe(true);
    expect(stepStamina(s, 'bent', 1).value).toBeCloseTo(48);
  });
});

describe('detector', () => {
  it('is off while running', () => {
    const r = readDetector('running', 5, 0);
    expect(r.bars).toBe(0);
    expect(r.message).toBe('Running. Slow down to read the detector.');
  });
  it('shows bars but no direction when upright', () => {
    expect(readDetector('walking', 301, 0).bars).toBe(0);
    expect(readDetector('walking', 300, 0)).toMatchObject({ bars: 1, message: 'Faint signal', arrow: null });
    expect(readDetector('standing', 200, 0)).toMatchObject({ bars: 2, message: 'Getting warmer' });
    expect(readDetector('walking', 120, 0)).toMatchObject({ bars: 3, message: 'Hot' });
    expect(readDetector('walking', 60, 45)).toMatchObject({
      bars: 4,
      message: 'Very hot. Bend over to pinpoint it.',
      arrow: null,
    });
  });
  it('pinpoints when bent over', () => {
    expect(readDetector('bent', 91, 10).message).toBe(
      'Nothing within 90 m. Stand up and walk to find a signal.',
    );
    expect(readDetector('bent', 47.4, -30)).toMatchObject({ message: '47 m', arrow: -30, onTarget: false });
    expect(readDetector('bent', 12, 5)).toMatchObject({
      message: 'Right under your feet. Dig!',
      onTarget: true,
    });
  });
  it('formats time', () => {
    expect(formatTime(125.9)).toBe('02:05');
  });
});

describe('game', () => {
  const lm = LANDMARKS.map((l) => toLocal(l.lng, l.lat));
  // One long street through every landmark keeps all caches reachable.
  const idx = new StreetIndex([[{ x: 0, y: 0 }, ...lm]], [], {
    min: toLocal(BBOX.west, BBOX.south),
    max: toLocal(BBOX.east, BBOX.north),
  });
  const still = { forward: 0, turn: 0, run: false };

  it('hides ten caches on streets near their landmarks', () => {
    const g = new Game(idx);
    expect(g.caches).toHaveLength(10);
    for (const c of g.caches) {
      expect(idx.nearestWithin(c.pos.x, c.pos.y, 0.01)).not.toBeNull();
      expect(dist(c.pos, c.centre)).toBeLessThanOrEqual(60);
    }
  });

  it('requires bending, takes 0.7 s, and finds a cache within 12 m', () => {
    const g = new Game(idx);
    g.start();
    const found: string[] = [];
    g.onFound = (c) => found.push(c.landmark.loot);

    g.dig();
    g.update(0.016, still);
    expect(g.reading.message).toBe('Bend over first, then dig.');

    g.pos = { ...g.caches[3].pos };
    g.toggleBend();
    g.update(0.016, still);
    expect(g.mode).toBe('bent');
    expect(g.reading.onTarget).toBe(true);
    g.dig();
    g.update(0.5, still);
    expect(g.mode).toBe('digging');
    expect(found).toHaveLength(0);
    g.update(0.25, still);
    expect(found).toEqual(['a cracked bronze bell']);
    expect(g.foundCount).toBe(1);

    g.dig();
    g.update(0.8, still);
    expect(g.reading.message).toMatch(/Nothing buried here\.|Found/);
  });

  it('adds 30 s per hint and wins after ten finds', () => {
    const g = new Game(idx);
    g.start();
    let won = false;
    g.onWin = () => (won = true);
    g.useHint(0);
    g.useHint(0);
    expect(g.time).toBeCloseTo(30);
    g.toggleBend();
    for (const c of g.caches) {
      g.pos = { ...c.pos };
      g.dig();
      g.update(0.71, still);
    }
    expect(won).toBe(true);
    expect(g.phase).toBe('won');
  });

  it('walks at 22 m/s and runs at 60 m/s until out of breath', () => {
    const g = new Game(idx);
    g.start();
    g.pos = { x: 0, y: 0 };
    g.heading = bearing({ x: 0, y: 0 }, lm[0]);
    g.update(0.05, { forward: 1, turn: 0, run: false });
    expect(dist(g.pos, { x: 0, y: 0 })).toBeCloseTo(1.1, 1);
    g.stamina = { value: 0.1, exhausted: false };
    g.update(0.05, { forward: 1, turn: 0, run: true });
    expect(g.mode).toBe('running');
    g.update(0.05, { forward: 1, turn: 0, run: true });
    expect(g.mode).toBe('walking');
  });
});

import { newlyEarned, type HuntStats } from '../src/achievements';
import * as race from '../src/race';
import { dailySeed, mulberry32 } from '../src/rng';
import { rankFor, scoreFind } from '../src/score';

describe('seeded hunts', () => {
  it('same seed gives the same sequence; daily seed is stable per UTC day', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
    const d = new Date('2026-11-22T10:00:00Z');
    expect(dailySeed(d)).toBe(dailySeed(new Date('2026-11-22T23:59:00Z')));
    expect(dailySeed(d)).not.toBe(dailySeed(new Date('2026-11-23T00:00:01Z')));
  });
  it('lays out identical caches and coins for the same seed', () => {
    const lm = LANDMARKS.map((l) => toLocal(l.lng, l.lat));
    const idx = new StreetIndex([[{ x: 0, y: 0 }, ...lm]], [], {
      min: toLocal(BBOX.west, BBOX.south),
      max: toLocal(BBOX.east, BBOX.north),
    });
    const g1 = new Game(idx);
    const g2 = new Game(idx);
    g1.start({ seed: 7 });
    g2.start({ seed: 7 });
    expect(g1.caches.map((c) => c.pos)).toEqual(g2.caches.map((c) => c.pos));
    expect(g1.coins).toEqual(g2.coins);
    expect(g1.coins).toHaveLength(150);
    g2.start({ seed: 8 });
    expect(g1.caches.map((c) => c.pos)).not.toEqual(g2.caches.map((c) => c.pos));

    // coins: walking over one scores 25 once
    g1.pos = { ...g1.coins[0] };
    g1.update(0.016, { forward: 0, turn: 0, run: false });
    g1.update(0.016, { forward: 0, turn: 0, run: false });
    expect(g1.coinCount).toBeGreaterThanOrEqual(1);
    expect(g1.score).toBe(g1.coinCount * 25);
  });
});

describe('scoring', () => {
  it('rewards speed, no hints and streaks', () => {
    expect(scoreFind(0, false, 0)).toEqual({ points: 1750, streak: 1, multiplier: 1 });
    expect(scoreFind(300, true, 0).points).toBe(1000);
    expect(scoreFind(60, false, 1)).toEqual({ points: Math.round(1630 * 1.5), streak: 2, multiplier: 1.5 });
    expect(scoreFind(91, false, 4).streak).toBe(1);
    expect(scoreFind(10, false, 9).multiplier).toBe(3);
    expect(rankFor(0)).toBe('Deckhand');
    expect(rankFor(22000)).toBe('Captain’s Heir');
  });
});

describe('achievements', () => {
  const base: HuntStats = {
    found: 0,
    total: 10,
    finished: false,
    time: 0,
    hints: 0,
    coins: 0,
    bestStreak: 0,
    everExhausted: false,
    metresRun: 0,
    daily: false,
    multiplayerWin: false,
    pages: 0,
    totalPages: 10,
  };
  const ids = (s: Partial<HuntStats>, have: string[] = []) =>
    newlyEarned({ ...base, ...s }, new Set(have)).map((a) => a.id);
  it('unlocks from stats and never twice', () => {
    expect(ids({})).toEqual([]);
    expect(ids({ found: 1 })).toEqual(['first']);
    expect(ids({ found: 1 }, ['first'])).toEqual([]);
    expect(ids({ found: 10, finished: true, time: 500, daily: true }, ['first'])).toEqual([
      'all',
      'nohints',
      'fast',
      'steady',
      'daily',
    ]);
    expect(ids({ finished: true, time: 900, hints: 1, everExhausted: true })).toEqual(['all']);
    expect(ids({ bestStreak: 5, coins: 80, metresRun: 5200, multiplayerWin: true })).toEqual([
      'streak3',
      'streak5',
      'coins25',
      'coins75',
      'marathon',
      'race',
    ]);
  });
});

describe('race rules', () => {
  const lobby = () => {
    let s = race.newRace(10);
    for (const [id, name] of [
      ['host', 'Anna'],
      ['b', '  Bram  '],
    ]) {
      const r = race.join(s, id, name);
      if (r.ok) s = r.state;
    }
    return s;
  };
  it('assigns distinct colours and cleans names', () => {
    const s = lobby();
    expect(s.players.map((p) => p.name)).toEqual(['Anna', 'Bram']);
    expect(s.players[0].color).not.toBe(s.players[1].color);
    expect(race.cleanName('   ')).toBe('Hunter');
  });
  it('refuses joins after the start or when full', () => {
    let s = lobby();
    for (let i = 0; i < 4; i++) {
      const r = race.join(s, `p${i}`, 'x');
      if (r.ok) s = r.state;
    }
    expect(s.players).toHaveLength(6);
    expect(race.join(s, 'late', 'x').ok).toBe(false);
    expect(race.join({ ...lobby(), started: true }, 'late', 'x').ok).toBe(false);
  });
  it('gives a contested cache to the first claim only', () => {
    let s = { ...lobby(), started: true };
    const first = race.claim(s, 'b', 3);
    expect(first.accepted).toBe(true);
    s = first.state;
    expect(race.claim(s, 'host', 3).accepted).toBe(false);
    expect(race.claim(s, 'nobody', 4).accepted).toBe(false);
    expect(race.claim(s, 'host', 99).accepted).toBe(false);
    expect(race.claim({ ...lobby() }, 'host', 1).accepted).toBe(false); // not started
    expect(s.players.find((p) => p.id === 'b')!.finds).toBe(1);
  });
  it('ranks by caches, then score, and finishes when all are claimed', () => {
    let s = { ...lobby(), started: true };
    for (let i = 0; i < 10; i++) s = race.claim(s, i < 5 ? 'host' : 'b', i).state;
    expect(race.finished(s)).toBe(true);
    s = race.setScore(race.setScore(s, 'host', 5000), 'b', 9000);
    expect(race.standings(s).map((p) => p.id)).toEqual(['b', 'host']);
    expect(race.leave(s, 'b').players).toHaveLength(1);
  });
});

import { logComplete, pageOf, PAGES } from '../src/story';

describe('story', () => {
  it('has one page per landmark, in chronological order', () => {
    expect(PAGES).toHaveLength(LANDMARKS.length);
    expect(new Set(PAGES.map((p) => p.landmark)).size).toBe(LANDMARKS.length);
    const years = PAGES.map((p) => p.year);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
    LANDMARKS.forEach((_, i) => expect(PAGES[pageOf(i)].landmark).toBe(i));
  });
  it('unlocks the epilogue and badges from collected pages', () => {
    expect(logComplete(new Set([0, 1, 2]))).toBe(false);
    expect(logComplete(new Set(PAGES.map((_, i) => i)))).toBe(true);
    const stats = (pages: number): HuntStats => ({
      found: 0, total: 10, finished: false, time: 0, hints: 0, coins: 0, bestStreak: 0,
      everExhausted: false, metresRun: 0, daily: false, multiplayerWin: false, pages, totalPages: 10,
    });
    expect(newlyEarned(stats(1), new Set()).map((a) => a.id)).toEqual(['page1']);
    expect(newlyEarned(stats(10), new Set(['page1'])).map((a) => a.id)).toEqual(['log']);
  });
});
