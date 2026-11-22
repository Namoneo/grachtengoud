/** Small deterministic RNG (mulberry32): same seed, same hunt. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** UTC date key, e.g. "2026-11-22": the daily hunt is the same for everyone that day. */
export function dailyKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function dailySeed(date: Date = new Date()): number {
  return seedFromString(`grachtengoud-${dailyKey(date)}`);
}
