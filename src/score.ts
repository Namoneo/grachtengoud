export const SCORE = {
  find: 1000,
  noHint: 250,
  timeBonusMax: 500, // fades by 2 points per second since the previous find
  streakWindow: 90, // seconds between finds to keep a streak going
  streakStep: 0.5,
  maxMultiplier: 3,
  coin: 25,
};

export interface FindResult {
  points: number;
  streak: number;
  multiplier: number;
}

/**
 * Points for digging up a cache.
 * @param sinceLast seconds since the previous find (or since the start)
 * @param prevStreak streak before this find (0 if none yet)
 */
export function scoreFind(sinceLast: number, hinted: boolean, prevStreak: number): FindResult {
  const streak = prevStreak > 0 && sinceLast <= SCORE.streakWindow ? prevStreak + 1 : 1;
  const multiplier = Math.min(SCORE.maxMultiplier, 1 + SCORE.streakStep * (streak - 1));
  const timeBonus = Math.max(0, Math.round(SCORE.timeBonusMax - 2 * sinceLast));
  const base = SCORE.find + timeBonus + (hinted ? 0 : SCORE.noHint);
  return { points: Math.round(base * multiplier), streak, multiplier };
}

const RANKS: [number, string][] = [
  [22000, 'Captain’s Heir'],
  [15000, 'First Mate'],
  [10000, 'Navigator'],
  [6000, 'Bosun'],
  [0, 'Deckhand'],
];

export function rankFor(score: number): string {
  return (RANKS.find(([min]) => score >= min) ?? RANKS[RANKS.length - 1])[1];
}
