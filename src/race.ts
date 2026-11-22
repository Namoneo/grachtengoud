// Race rules for multiplayer. Pure: the host runs these, clients mirror the results.

export const MAX_PLAYERS = 6;
export const PLAYER_COLORS = ['#ff7a1a', '#35e0ff', '#ff5fa8', '#8dff6a', '#c59bff', '#ffe14a'];

export interface RacePlayer {
  id: string;
  name: string;
  color: string;
  finds: number;
  score: number;
}

export interface RaceState {
  players: RacePlayer[];
  /** Per cache: id of the player who dug it up, or null. */
  claimed: (string | null)[];
  started: boolean;
}

export function newRace(cacheCount: number): RaceState {
  return { players: [], claimed: new Array<string | null>(cacheCount).fill(null), started: false };
}

export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 16);
  return name || 'Hunter';
}

export type JoinResult = { ok: true; state: RaceState } | { ok: false; reason: string };

export function join(state: RaceState, id: string, name: string): JoinResult {
  if (state.started) return { ok: false, reason: 'The race has already started.' };
  if (state.players.length >= MAX_PLAYERS) return { ok: false, reason: 'The room is full.' };
  if (state.players.some((p) => p.id === id)) return { ok: true, state };
  const used = new Set(state.players.map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  return {
    ok: true,
    state: {
      ...state,
      players: [...state.players, { id, name: cleanName(name), color, finds: 0, score: 0 }],
    },
  };
}

export function leave(state: RaceState, id: string): RaceState {
  return { ...state, players: state.players.filter((p) => p.id !== id) };
}

/** First valid claim wins the cache; later ones are refused. */
export function claim(state: RaceState, id: string, index: number): { state: RaceState; accepted: boolean } {
  const valid =
    state.started &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < state.claimed.length &&
    state.claimed[index] === null &&
    state.players.some((p) => p.id === id);
  if (!valid) return { state, accepted: false };
  const claimed = state.claimed.slice();
  claimed[index] = id;
  return {
    accepted: true,
    state: {
      ...state,
      claimed,
      players: state.players.map((p) => (p.id === id ? { ...p, finds: p.finds + 1 } : p)),
    },
  };
}

export function setScore(state: RaceState, id: string, score: number): RaceState {
  const s = Number.isFinite(score) ? Math.max(0, Math.round(score)) : 0;
  return { ...state, players: state.players.map((p) => (p.id === id ? { ...p, score: s } : p)) };
}

export function finished(state: RaceState): boolean {
  return state.started && state.claimed.every((c) => c !== null);
}

/** Most caches first; score breaks ties. */
export function standings(state: RaceState): RacePlayer[] {
  return state.players.slice().sort((a, b) => b.finds - a.finds || b.score - a.score);
}
