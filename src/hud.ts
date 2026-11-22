import { ACHIEVEMENTS, type Achievement } from './achievements';
import { HINT_PENALTY, type CameraView } from './config';
import type { Cache, Game } from './game';
import type { RacePlayer } from './race';
import { formatTime, MODE_LABEL } from './rules';
import { rankFor } from './score';
import { EPILOGUE, PAGES, pageHeading, PROLOGUE, STORY_TITLE } from './story';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Only touch the DOM when a value actually changes. */
function cached<T>(apply: (v: T) => void): (v: T) => void {
  let last: T | undefined;
  return (v) => {
    if (v === last) return;
    last = v;
    apply(v);
  };
}

function setLabel(id: string, long: string, short: string): void {
  const b = $(id);
  (b.querySelector('.long') as HTMLElement).textContent = long;
  (b.querySelector('.short') as HTMLElement).textContent = short;
}

function playerRow(p: RacePlayer, selfId: string, withScore: boolean): HTMLLIElement {
  const li = document.createElement('li');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = p.color;
  const name = document.createElement('span');
  name.className = p.id === selfId ? 'pname me' : 'pname';
  name.textContent = p.id === selfId ? `${p.name} (you)` : p.name;
  const count = document.createElement('span');
  count.className = 'pcount';
  count.textContent = withScore ? `${p.finds} · ${p.score.toLocaleString('en')}` : String(p.finds);
  li.append(dot, name, count);
  return li;
}

export interface WinInfo {
  time: number;
  score: number;
  hints: number;
  bestLabel: string;
  best: string;
  title: string;
  lead: string;
  /** Story text under the results (epilogue or a teaser). */
  story: string;
}

export class Hud {
  private bars = Array.from($('bars').children) as HTMLElement[];
  private toastTimer = 0;
  private badgeTimer = 0;
  private storyTimer = 0;
  private badgeQueue: Achievement[] = [];
  onHint: (index: number) => void = () => {};

  private setFound = cached<string>((v) => ($('found').textContent = v));
  private setTimer = cached<string>((v) => ($('timer').textContent = v));
  private setScore = cached<number>((v) => ($('score').textContent = v.toLocaleString('en')));
  private setStreak = cached<number>((n) => {
    const el = $('streak');
    el.hidden = n < 2;
    el.textContent = `streak ${n}`;
  });
  private setMode = cached<string>((m) => {
    const el = $('mode');
    el.dataset.mode = m;
    el.textContent = MODE_LABEL[m as keyof typeof MODE_LABEL];
    $('t-bend').classList.toggle('on', m === 'bent' || m === 'digging');
  });
  private setBars = cached<number>((n) => {
    this.bars.forEach((b, i) => b.classList.toggle('on', i < n));
  });
  private setBarsOff = cached<boolean>((off) => $('bars').classList.toggle('off', off));
  private setMessage = cached<string>((v) => ($('message').textContent = v));
  private setHot = cached<boolean>((v) => $('message').classList.toggle('hot', v));
  private setArrowShown = cached<boolean>((v) => ($('arrow').hidden = !v));
  private setArrow = cached<number>((deg) => ($('arrow').style.transform = `rotate(${deg}deg)`));
  private setStamina = cached<number>((pct) => ($('stamina').style.width = `${pct}%`));
  private setOut = cached<boolean>((out) => {
    $('stamina').classList.toggle('out', out);
    const label = $('stamina-label');
    label.classList.toggle('out', out);
    label.textContent = out ? 'Out of breath' : 'Stamina';
  });

  constructor() {
    $('riddles').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-hint]') as HTMLElement | null;
      if (btn) this.onHint(Number(btn.dataset.hint));
    });
    const tabs = ['riddles', 'story', 'badges'];
    for (const name of tabs) {
      $(`tab-${name}`).addEventListener('click', () => {
        for (const t of tabs) {
          $(t).hidden = t !== name;
          $(`tab-${t}`).classList.toggle('on', t === name);
        }
      });
    }
    $('prologue-title').textContent = STORY_TITLE;
    $('prologue-text').textContent = PROLOGUE;
    $('story-card').addEventListener('click', () => this.hideStory());
  }

  update(g: Game): void {
    this.setFound(`${g.foundCount}/${g.caches.length}`);
    this.setTimer(formatTime(g.time));
    this.setScore(g.score);
    this.setStreak(g.streak);
    this.setMode(g.mode);
    this.setBars(g.reading.bars);
    this.setBarsOff(g.mode === 'running');
    this.setMessage(g.reading.message);
    this.setHot(g.reading.onTarget);
    this.setArrowShown(g.reading.arrow !== null);
    if (g.reading.arrow !== null) this.setArrow(Math.round(g.reading.arrow));
    this.setStamina(Math.round(g.stamina.value));
    this.setOut(g.stamina.exhausted);
  }

  renderLogbook(caches: Cache[]): void {
    const list = $('riddles');
    list.textContent = '';
    caches.forEach((c, i) => {
      const li = document.createElement('li');
      const riddle = document.createElement('div');
      riddle.className = 'riddle';
      riddle.textContent = c.landmark.riddle;
      li.append(riddle);
      if (c.found || c.hinted) {
        const where = document.createElement('div');
        where.className = 'where';
        where.textContent = c.landmark.name;
        li.append(where);
      }
      if (c.found) {
        li.className = 'found';
        const loot = document.createElement('div');
        loot.className = 'loot';
        loot.textContent = c.takenBy
          ? `Dug up by ${c.takenBy}`
          : `Found: ${c.landmark.loot}`;
        li.append(loot);
      } else if (!c.hinted) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.hint = String(i);
        btn.textContent = `Mark the landmark (+${HINT_PENALTY} s)`;
        li.append(btn);
      }
      list.append(li);
    });
  }

  renderBadges(unlocked: ReadonlySet<string>): void {
    const list = $('badges');
    list.textContent = '';
    for (const a of ACHIEVEMENTS) {
      const li = document.createElement('li');
      if (unlocked.has(a.id)) li.className = 'got';
      const b = document.createElement('b');
      b.textContent = a.title;
      li.append(b, a.text);
      list.append(li);
    }
    $('badge-count').textContent = `${unlocked.size}/${ACHIEVEMENTS.length}`;
  }

  /** The Story tab: prologue, collected pages in order, and the epilogue once earned. */
  renderStory(collected: ReadonlySet<number>): void {
    const root = $('story');
    root.textContent = '';
    const section = (head: string, keeper: string, text: string, missing = false) => {
      const s = document.createElement('section');
      if (missing) s.className = 'missing';
      const h = document.createElement('h3');
      h.textContent = head;
      s.append(h);
      if (keeper) {
        const k = document.createElement('div');
        k.className = 'keeper';
        k.textContent = keeper;
        s.append(k);
      }
      const p = document.createElement('p');
      if (!missing) p.className = 'story-text';
      p.textContent = text;
      s.append(p);
      root.append(s);
    };
    section(STORY_TITLE, '', PROLOGUE);
    PAGES.forEach((page, i) => {
      if (collected.has(i)) section(pageHeading(i), page.keeper, page.text);
      else section(`Page ${i + 1} of ${PAGES.length} · ${page.year}`, '', 'Still buried.', true);
    });
    if (collected.size >= PAGES.length) section('The last page', 'Lotte van der Meer, 1956', EPILOGUE);
    $('story-count').textContent = `${collected.size}/${PAGES.length}`;
  }

  /** Show a recovered page. It does not pause the game. */
  showStory(page: number): void {
    const p = PAGES[page];
    $('story-card-head').textContent = pageHeading(page);
    $('story-card-keeper').textContent = p.keeper;
    $('story-card-text').textContent = p.text;
    $('story-card').hidden = false;
    window.clearTimeout(this.storyTimer);
    this.storyTimer = window.setTimeout(() => this.hideStory(), 14000);
  }

  hideStory(): void {
    window.clearTimeout(this.storyTimer);
    $('story-card').hidden = true;
  }
  get storyOpen(): boolean {
    return !$('story-card').hidden;
  }

  setKeys(open: boolean, touch: boolean): void {
    $('keys').hidden = !open;
    $('btn-keys').classList.toggle('on', open);
    $('keys-keyboard').hidden = touch;
    $('keys-touch').hidden = !touch;
  }
  get keysOpen(): boolean {
    return !$('keys').hidden;
  }

  /** Announce unlocked badges one after another. */
  badgeToast(earned: Achievement[]): void {
    this.badgeQueue.push(...earned);
    if (this.badgeTimer) return;
    const next = () => {
      const a = this.badgeQueue.shift();
      const el = $('badge-toast');
      if (!a) {
        el.hidden = true;
        this.badgeTimer = 0;
        return;
      }
      el.textContent = `★ Badge unlocked: ${a.title}`;
      el.hidden = false;
      this.badgeTimer = window.setTimeout(next, 2600);
    };
    next();
  }

  toast(title: string, detail: string): void {
    const el = $('toast');
    el.textContent = title;
    const small = document.createElement('small');
    small.textContent = detail;
    el.append(small);
    el.hidden = true;
    void el.offsetWidth; // restart the pop animation
    el.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (el.hidden = true), 3800);
  }

  notice(msg: string | null): void {
    const el = $('notice');
    el.textContent = msg ?? '';
    el.hidden = !msg;
  }

  setLoading(msg: string): void {
    $('loading-text').textContent = msg;
  }

  show(screen: 'loading' | 'start' | 'prologue' | 'mp' | 'win' | 'error' | null): void {
    for (const id of ['loading', 'start', 'prologue', 'mp', 'win', 'error']) $(id).hidden = id !== screen;
  }

  showGameUi(on: boolean): void {
    $('topbar').hidden = !on;
    $('panel').hidden = !on;
    if (!on) {
      $('board').hidden = true;
      this.setLogbook(false);
      this.setKeys(false, false);
      this.hideStory();
    }
  }

  error(msg: string): void {
    $('error-text').textContent = msg;
    this.show('error');
  }

  setLogbook(open: boolean): void {
    $('logbook').hidden = !open;
    $('btn-log').classList.toggle('on', open);
  }
  get logbookOpen(): boolean {
    return !$('logbook').hidden;
  }

  setMapButton(on: boolean): void {
    $('btn-map').classList.toggle('on', on);
    setLabel('btn-map', on ? 'Street view' : 'City map', on ? 'Street' : 'Map');
  }

  setCameraButton(view: CameraView): void {
    setLabel('btn-cam', view === 'far' ? 'Camera: wide' : 'Camera: close', view === 'far' ? 'Wide' : 'Close');
  }

  showWin(info: WinInfo, standings: RacePlayer[] | null, selfId: string): void {
    $('win-title').textContent = info.title;
    $('win-lead').textContent = info.lead;
    $('win-time').textContent = formatTime(info.time);
    $('win-score').textContent = info.score.toLocaleString('en');
    $('win-hints').textContent = String(info.hints);
    $('win-best-label').textContent = info.bestLabel;
    $('win-best').textContent = info.best;
    $('win-rank').textContent = rankFor(info.score);
    $('win-story').textContent = info.story;
    this.setStandings(standings, selfId);
    this.show('win');
  }

  setStandings(standings: RacePlayer[] | null, selfId: string): void {
    const list = $('win-standings');
    list.hidden = !standings;
    list.textContent = '';
    for (const p of standings ?? []) list.append(playerRow(p, selfId, true));
  }

  setStartInfo(text: string): void {
    $('best-start').textContent = text;
  }

  setBoard(players: RacePlayer[] | null, selfId: string): void {
    const el = $('board');
    el.hidden = !players;
    el.textContent = '';
    for (const p of players ?? []) el.append(playerRow(p, selfId, false));
  }

  // ----- multiplayer lobby -----

  setLobby(state: { code: string; players: RacePlayer[]; selfId: string; isHost: boolean } | null): void {
    $('mp-setup').hidden = !!state;
    $('mp-room').hidden = !state;
    if (!state) return;
    $('mp-room-code').textContent = state.code;
    const list = $('mp-players');
    list.textContent = '';
    for (const p of state.players) list.append(playerRow(p, state.selfId, false));
    $('mp-go').hidden = !state.isHost;
    $('mp-wait').hidden = state.isHost;
  }

  setLobbyStatus(msg: string): void {
    $('mp-status').textContent = msg;
  }

  setLobbyBusy(busy: boolean): void {
    ($('mp-create') as HTMLButtonElement).disabled = busy;
    ($('mp-join') as HTMLButtonElement).disabled = busy;
  }

  enableTouch(): void {
    $('touch').hidden = false;
  }
}
