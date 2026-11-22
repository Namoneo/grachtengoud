import { lsGet, lsSet } from './storage';

/** Running totals for one hunt; achievements are judged from these alone. */
export interface HuntStats {
  found: number;
  total: number;
  finished: boolean;
  time: number; // seconds, including hint penalties
  hints: number;
  coins: number;
  bestStreak: number;
  everExhausted: boolean;
  metresRun: number;
  daily: boolean;
  multiplayerWin: boolean;
  /** Pages of the family log collected so far, across all hunts. */
  pages: number;
  totalPages: number;
}

export interface Achievement {
  id: string;
  title: string;
  text: string;
  test: (s: HuntStats) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', title: 'First guilder', text: 'Dig up your first cache.', test: (s) => s.found >= 1 },
  { id: 'all', title: 'Grachtengoud', text: 'Finish a hunt.', test: (s) => s.finished },
  {
    id: 'nohints',
    title: 'Riddle master',
    text: 'Finish a hunt without marking a landmark.',
    test: (s) => s.finished && s.hints === 0,
  },
  {
    id: 'fast',
    title: 'Flying Dutchman',
    text: 'Finish a hunt in under 10 minutes.',
    test: (s) => s.finished && s.time < 600,
  },
  {
    id: 'steady',
    title: 'Steady pace',
    text: 'Finish a hunt without ever running out of breath.',
    test: (s) => s.finished && !s.everExhausted,
  },
  { id: 'streak3', title: 'On a roll', text: 'Reach a 3-find streak.', test: (s) => s.bestStreak >= 3 },
  { id: 'streak5', title: 'Gold rush', text: 'Reach a 5-find streak.', test: (s) => s.bestStreak >= 5 },
  { id: 'coins25', title: 'Loose change', text: 'Collect 25 coins in one hunt.', test: (s) => s.coins >= 25 },
  { id: 'coins75', title: 'Penny pincher', text: 'Collect 75 coins in one hunt.', test: (s) => s.coins >= 75 },
  {
    id: 'marathon',
    title: 'Marathon of Amsterdam',
    text: 'Run 5 km in one hunt.',
    test: (s) => s.metresRun >= 5000,
  },
  {
    id: 'daily',
    title: 'Daily digger',
    text: 'Finish a daily hunt.',
    test: (s) => s.finished && s.daily,
  },
  { id: 'page1', title: 'First page', text: 'Recover a page of the Van der Meer log.', test: (s) => s.pages >= 1 },
  {
    id: 'log',
    title: 'The whole log',
    text: 'Recover every page of the Van der Meer log.',
    test: (s) => s.totalPages > 0 && s.pages >= s.totalPages,
  },
  {
    id: 'race',
    title: 'First to the gold',
    text: 'Win a multiplayer race.',
    test: (s) => s.multiplayerWin,
  },
];

/** Ids of achievements these stats earn that are not unlocked yet. */
export function newlyEarned(stats: HuntStats, unlocked: ReadonlySet<string>): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !unlocked.has(a.id) && a.test(stats));
}

const KEY = 'grachtengoud.badges';

export function loadUnlocked(): Set<string> {
  try {
    const v: unknown = JSON.parse(lsGet(KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveUnlocked(ids: ReadonlySet<string>): void {
  lsSet(KEY, JSON.stringify([...ids]));
}
