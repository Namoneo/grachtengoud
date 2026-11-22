import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { loadUnlocked, newlyEarned, saveUnlocked } from './achievements';
import { Buildings } from './buildings';
import { ChaseCamera } from './camera';
import { Character, makeChest, makeScene } from './character';
import { CoinField } from './coins';
import type { CameraView } from './config';
import { Game } from './game';
import { angleDiff, ease, norm360, toLocal, type Vec } from './geo';
import { Hud } from './hud';
import { Input, type Action } from './input';
import { Landmarks } from './landmarks';
import { createSceneLayer } from './layer3d';
import { createMap } from './map';
import { normaliseCode, Session, type PlayerPos, type SessionEvents } from './net';
import { standings as rankPlayers, type RacePlayer } from './race';
import { dailyKey, dailySeed, randomSeed } from './rng';
import { formatTime } from './rules';
import { lsGet, lsSet } from './storage';
import {
  EPILOGUE,
  loadPages,
  logComplete,
  markPrologueSeen,
  PAGES,
  pageOf,
  prologueSeen,
  savePages,
} from './story';
import { loadStreetData, StreetIndex } from './streets';

const BEST_KEY = 'grachtengoud.best';
const DAILY_KEY = 'grachtengoud.daily';
const CAM_KEY = 'grachtengoud.cam2';
const NAME_KEY = 'grachtengoud.name';
const el = (id: string) => document.getElementById(id) as HTMLElement;

type HuntKind = 'free' | 'daily' | 'race';

interface Rival {
  figure: Character;
  color: string;
  pos: Vec;
  heading: number;
  target: PlayerPos;
}

function readBest(): number | null {
  const v = Number(lsGet(BEST_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function readDaily(): { time: number; score: number } | null {
  try {
    const v = JSON.parse(lsGet(DAILY_KEY) ?? 'null') as { date?: string; time?: number; score?: number } | null;
    if (v && v.date === dailyKey() && typeof v.time === 'number' && typeof v.score === 'number') {
      return { time: v.time, score: v.score };
    }
  } catch {
    /* corrupt entry: ignore */
  }
  return null;
}

async function boot(): Promise<void> {
  const hud = new Hud();
  el('btn-reload').addEventListener('click', () => window.location.reload());

  let streets: StreetIndex;
  try {
    hud.setLoading('Loading the streets of Amsterdam…');
    streets = StreetIndex.fromData(await loadStreetData((m) => hud.setLoading(m)));
  } catch (e) {
    hud.error(
      `The street data could not be loaded (${(e as Error).message}). Check your connection and reload.`,
    );
    return;
  }

  hud.setLoading('Lighting the canals…');
  let gm;
  try {
    gm = await createMap(el('map'), (msg) => hud.notice(msg));
  } catch (e) {
    hud.error((e as Error).message);
    return;
  }
  const { map } = gm;

  // World scene (depth-tested against the map) and actors scene (always on top).
  const world = makeScene();
  const actors = makeScene();
  const hunter = new Character();
  actors.add(hunter.root);
  const landmarks = new Landmarks(streets);
  world.add(landmarks.group);
  const buildings = new Buildings(
    map,
    gm.buildingSource,
    (ring) => landmarks.claims(ring),
    () => landmarks.settle(),
  );
  world.add(buildings.group);
  const coinField = new CoinField();
  world.add(coinField.mesh);
  let chests: ReturnType<typeof makeChest>[] = [];
  map.addLayer(createSceneLayer(world, actors, (m, w, h) => buildings.prepare(m, w, h)));

  const game = new Game(streets);
  const camera = new ChaseCamera(map);
  camera.view = lsGet(CAM_KEY) === 'far' ? 'far' : 'close';
  camera.snapTo(game.heading);
  hud.setCameraButton(camera.view);

  const unlocked = loadUnlocked();
  hud.renderBadges(unlocked);
  const pages = loadPages();
  hud.renderStory(pages);
  const touchDevice = () => !el('touch').hidden;

  let kind: HuntKind = 'free';
  let session: Session | null = null;
  const rivals = new Map<string, Rival>();
  let noticeTimer = 0;
  let storyShownAt = 0;

  const refreshMarks = () => {
    gm.setHints(game.caches.filter((c) => c.hinted && !c.found).map((c) => c.centre));
    gm.setChests(game.caches.filter((c) => c.found).map((c) => c.pos));
    hud.renderLogbook(game.caches);
  };

  const setOverview = (on: boolean) => {
    camera.overview = on;
    gm.setOverview(on);
    hud.setMapButton(on);
  };

  const setView = (view: CameraView) => {
    camera.view = view;
    lsSet(CAM_KEY, view);
    hud.setCameraButton(view);
  };

  const checkBadges = () => {
    const earned = newlyEarned(
      { ...game.stats, pages: pages.size, totalPages: PAGES.length },
      unlocked,
    );
    if (!earned.length) return;
    for (const a of earned) unlocked.add(a.id);
    saveUnlocked(unlocked);
    hud.renderBadges(unlocked);
    hud.badgeToast(earned);
  };

  const startInfo = () => {
    const parts: string[] = [];
    const best = readBest();
    if (best !== null) parts.push(`Best free hunt: ${formatTime(best)}`);
    const daily = readDaily();
    if (daily) parts.push(`Today’s daily: ${formatTime(daily.time)}, ${daily.score.toLocaleString('en')} pts`);
    hud.setStartInfo(parts.join(' · '));
  };

  const clearRivals = () => {
    for (const r of rivals.values()) actors.remove(r.figure.root);
    rivals.clear();
    gm.setOthers([]);
  };

  const flashNotice = (msg: string) => {
    hud.notice(msg);
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => hud.notice(null), 6000);
  };

  const toStart = () => {
    session?.close();
    session = null;
    clearRivals();
    game.abort();
    setOverview(false);
    hud.showGameUi(false);
    hud.setBoard(null, '');
    startInfo();
    hud.show('start');
  };

  const startHunt = (k: HuntKind, seed: number) => {
    kind = k;
    for (const c of chests) world.remove(c);
    chests = [];
    const s = session;
    game.start({
      seed,
      daily: k === 'daily',
      arbiter: k === 'race' && s ? (i) => s.claim(i) : undefined,
    });
    const mine = k === 'race' ? s?.players.find((p) => p.id === s.selfId)?.color : undefined;
    hunter.setJacket(mine ? parseInt(mine.slice(1), 16) : 0xff7a1a);
    camera.snapTo(game.heading);
    setOverview(false);
    refreshMarks();
    hud.show(null);
    hud.showGameUi(true);
    hud.setBoard(k === 'race' && s ? s.players : null, s?.selfId ?? '');
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const act = (a: Action) => {
    if (game.phase !== 'playing') return;
    if (a === 'bend') game.toggleBend();
    else if (a === 'dig') game.dig();
    else if (a === 'map') setOverview(!camera.overview);
    else if (a === 'camera') setView(camera.view === 'far' ? 'close' : 'far');
    else if (a === 'keys') hud.setKeys(!hud.keysOpen, touchDevice());
    else if (a === 'close') {
      hud.setKeys(false, false);
      hud.setLogbook(false);
      hud.hideStory();
    } else hud.setLogbook(!hud.logbookOpen);
  };
  const input = new Input(act);

  game.onFound = (cache, mine, points) => {
    const chest = makeChest(cache.pos);
    chests.push(chest);
    world.add(chest);
    if (mine) {
      const streak = game.streak > 1 ? ` · streak ${game.streak}` : '';
      hud.toast(
        `You found ${cache.landmark.loot}!`,
        `${cache.landmark.name} · +${points.toLocaleString('en')} points${streak}`,
      );
      // Every cache holds the page its keeper wrote about it.
      const page = pageOf(game.caches.indexOf(cache));
      if (page >= 0) {
        pages.add(page);
        savePages(pages);
        hud.renderStory(pages);
        hud.showStory(page);
        storyShownAt = performance.now();
      }
    } else {
      hud.toast(`${cache.takenBy} dug up a cache`, cache.landmark.name);
    }
    refreshMarks();
    checkBadges();
  };
  game.onCoin = () => checkBadges();

  game.onWin = () => {
    let title = 'All ten found';
    let lead = 'The canal gold is yours.';
    let bestLabel = 'Best time';
    let best = '';
    let table: RacePlayer[] | null = null;
    const missing = PAGES.length - pages.size;
    const story = logComplete(pages)
      ? EPILOGUE
      : `${missing} page${missing === 1 ? '' : 's'} of the Van der Meer log ${missing === 1 ? 'is' : 'are'} still buried. Hunt again to recover ${missing === 1 ? 'it' : 'them'}.`;

    if (kind === 'race' && session) {
      table = rankPlayers({ players: session.players, claimed: [], started: true });
      const winner = table[0];
      const won = winner?.id === session.selfId;
      game.multiplayerWin = won && table.length > 1;
      title = won ? 'You won the race' : `${winner?.name ?? 'A rival'} won the race`;
      lead = `You dug up ${game.foundCount} of ${game.caches.length} caches.`;
      bestLabel = 'Your caches';
      best = `${game.foundCount}/${game.caches.length}`;
    } else if (kind === 'daily') {
      const prev = readDaily();
      const record =
        !prev || game.time < prev.time ? { time: game.time, score: game.score } : prev;
      lsSet(DAILY_KEY, JSON.stringify({ date: dailyKey(), ...record }));
      title = 'Daily hunt done';
      bestLabel = 'Today’s best';
      best = formatTime(record.time);
    } else {
      const prev = readBest();
      const record = prev === null ? game.time : Math.min(prev, game.time);
      lsSet(BEST_KEY, String(record));
      best = formatTime(record);
    }
    checkBadges();
    hud.setLogbook(false);
    const info = { time: game.time, score: game.score, hints: game.hints, bestLabel, best, title, lead, story };
    // Leave time to read the last page before the results cover it.
    window.setTimeout(() => {
      hud.hideStory();
      hud.showWin(info, table, session?.selfId ?? '');
    }, 6000);
  };

  hud.onHint = (i) => {
    game.useHint(i);
    refreshMarks();
  };

  // ----- multiplayer -----
  const events: SessionEvents = {
    onLobby(players) {
      if (!session) return;
      hud.setLobby({ code: session.code, players, selfId: session.selfId, isHost: session.isHost });
      for (const id of [...rivals.keys()]) {
        if (!players.some((p) => p.id === id)) {
          actors.remove(rivals.get(id)!.figure.root);
          rivals.delete(id);
        }
      }
      if (session.started) {
        const table = rankPlayers({ players, claimed: [], started: true });
        hud.setBoard(table, session.selfId);
        if (game.phase === 'won') hud.setStandings(table, session.selfId);
      }
    },
    onStart(seed) {
      startHunt('race', seed);
      hud.toast('Go!', 'First to dig up a cache keeps it.');
    },
    onPositions(list) {
      if (!session) return;
      for (const p of list) {
        let r = rivals.get(p.id);
        if (!r) {
          const info = session.players.find((pl) => pl.id === p.id);
          if (!info) continue;
          const figure = new Character(parseInt(info.color.slice(1), 16));
          figure.setLabel(info.name, info.color);
          actors.add(figure.root);
          r = { figure, color: info.color, pos: { x: p.x, y: p.y }, heading: p.h, target: p };
          rivals.set(p.id, r);
        }
        r.target = p;
      }
    },
    onFound(index, by) {
      if (!session) return;
      game.resolveFind(index, by === session.selfId, session.nameOf(by));
    },
    onClosed(reason) {
      session = null;
      if (game.phase === 'won') return; // race is over; keep the results on screen
      toStart();
      flashNotice(reason);
    },
  };

  const openLobby = (code = '') => {
    (el('mp-name') as HTMLInputElement).value = lsGet(NAME_KEY) ?? '';
    (el('mp-code') as HTMLInputElement).value = code;
    hud.setLobby(null);
    hud.setLobbyStatus('');
    hud.setLobbyBusy(false);
    hud.show('mp');
  };

  const connect = async (join: boolean) => {
    const name = (el('mp-name') as HTMLInputElement).value;
    const code = normaliseCode((el('mp-code') as HTMLInputElement).value);
    if (join && code.length !== 5) {
      hud.setLobbyStatus('Enter the 5-letter room code.');
      return;
    }
    lsSet(NAME_KEY, name.trim().slice(0, 16));
    hud.setLobbyBusy(true);
    hud.setLobbyStatus(join ? 'Joining…' : 'Creating a room…');
    try {
      const s = await (join ? Session.join(code, name, events) : Session.host(name, events));
      session = s;
      hud.setLobbyStatus('');
      hud.setLobby({ code: s.code, players: s.players, selfId: s.selfId, isHost: s.isHost });
    } catch (e) {
      hud.setLobbyStatus((e as Error).message);
    }
    hud.setLobbyBusy(false);
  };

  // The first hunt opens with the prologue; after that it lives in the logbook's Story tab.
  let pending: () => void = () => {};
  const begin = (start: () => void) => {
    if (prologueSeen()) return start();
    pending = start;
    hud.show('prologue');
  };
  el('btn-begin').addEventListener('click', () => {
    markPrologueSeen();
    pending();
  });
  el('btn-start').addEventListener('click', () => begin(() => startHunt('free', randomSeed())));
  el('btn-daily').addEventListener('click', () => begin(() => startHunt('daily', dailySeed())));
  el('btn-mp').addEventListener('click', () => openLobby());
  el('mp-create').addEventListener('click', () => void connect(false));
  el('mp-join').addEventListener('click', () => void connect(true));
  el('mp-go').addEventListener('click', () => session?.start(randomSeed()));
  el('mp-back').addEventListener('click', toStart);
  el('mp-copy').addEventListener('click', () => {
    if (!session) return;
    const link = `${window.location.origin}${window.location.pathname}?room=${session.code}`;
    const fallback = () => hud.setLobbyStatus(link);
    try {
      navigator.clipboard.writeText(link).then(() => hud.setLobbyStatus('Invite link copied.'), fallback);
    } catch {
      fallback();
    }
  });
  el('btn-again').addEventListener('click', toStart);
  el('btn-cam').addEventListener('click', () => act('camera'));
  el('btn-map').addEventListener('click', () => act('map'));
  el('btn-log').addEventListener('click', () => act('logbook'));
  el('btn-keys').addEventListener('click', () => act('keys'));
  el('keys-close').addEventListener('click', () => hud.setKeys(false, false));
  // Any key puts a story page away (it stays in the logbook).
  window.addEventListener('keydown', (e) => {
    if (hud.storyOpen && !e.repeat && performance.now() - storyShownAt > 1200) hud.hideStory();
  });
  el('log-close').addEventListener('click', () => hud.setLogbook(false));
  // Buttons keep focus after a click; drop it so Space digs instead of re-clicking.
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) b.blur();
  });
  window.addEventListener('pagehide', () => session?.close());

  // Touch controls
  input.bindTouch(el('stick'), el('knob'), el('t-run'));
  const tap = (id: string, a: Action) =>
    el(id).addEventListener('pointerdown', (e) => {
      e.preventDefault();
      act(a);
    });
  tap('t-bend', 'bend');
  tap('t-dig', 'dig');
  if (window.matchMedia('(pointer: coarse)').matches) hud.enableTouch();
  window.addEventListener('touchstart', () => hud.enableTouch(), { once: true, passive: true });
  document.addEventListener('contextmenu', (e) => {
    if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
  });

  const resize = () => map.resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => window.setTimeout(resize, 250));

  startInfo();
  const invited = normaliseCode(new URLSearchParams(window.location.search).get('room') ?? '');
  if (invited.length === 5) openLobby(invited);
  else hud.show('start');

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    game.update(dt, input);
    const playing = game.phase === 'playing';
    hunter.update(dt, game.mode, game.pos, game.heading, game.direction, playing && game.reading.onTarget);
    camera.update(dt, game.pos, game.heading, game.mode);

    // Detailed buildings in street view only (the city map uses plain blocks).
    buildings.group.visible = landmarks.group.visible = !camera.high;
    buildings.update(now, game.pos);
    coinField.mesh.visible = !camera.high;
    coinField.update(dt, game.coins, game.coinTaken, game.pos);

    if (session?.started) {
      session.update(game.pos.x, game.pos.y, game.heading, game.mode, game.direction, game.score);
      const k = ease(12, dt);
      for (const r of rivals.values()) {
        r.pos.x += (r.target.x - r.pos.x) * k;
        r.pos.y += (r.target.y - r.pos.y) * k;
        r.heading = norm360(r.heading + angleDiff(r.heading, r.target.h) * k);
        r.figure.update(dt, r.target.m, r.pos, r.heading, r.target.d, false);
        r.figure.faceLabel(camera.bearing);
      }
      gm.setOthers([...rivals.values()].map((r) => ({ pos: r.pos, color: r.color })));
    }

    gm.setPlayer(game.pos);
    hud.update(game);
    map.triggerRepaint();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // Test hook for development builds only.
    Object.assign(window, {
      __gg: {
        game,
        streets,
        map,
        camera,
        buildings,
        landmarks,
        get session() {
          return session;
        },
        rivals,
        teleport(lat: number, lng: number) {
          game.pos = streets.snap(toLocal(lng, lat).x, toLocal(lng, lat).y);
        },
      },
    });
  }
}

void boot();
