import { LANDMARKS } from './config';
import { lsGet, lsSet } from './storage';

/**
 * The Van der Meer Log: a family tradition spanning three centuries. Each
 * keeper hid one treasure in the city and wrote one page. Digging up a cache
 * reveals its page; all ten reveal the epilogue.
 */

export interface Page {
  /** Index into LANDMARKS (config.ts). */
  landmark: number;
  year: number;
  keeper: string;
  text: string;
}

export const STORY_TITLE = 'The Van der Meer Log';

export const PROLOGUE =
  'In a crate of unsold books on the Oudemanhuispoort you find a ship’s logbook with a broken clasp. ' +
  'It is not about any voyage. For more than three hundred years one Amsterdam family kept it by a single rule: ' +
  'every keeper hides one treasure somewhere in the city, writes one page about it, and passes the book on. ' +
  'Nobody ever dug anything up. The riddles are in the front, in ten different hands. The pages that explain them have been torn out and buried with the treasures.';

export const EPILOGUE =
  'The last page is in Lotte van der Meer’s neat post-war handwriting. “I am the end of our line, and I have decided the log should not end with me. ' +
  'We kept these things from a city that we thought might be lost: to fire, to water, to armies. It never was. ' +
  'So I leave the book where a stranger will find it. If you are reading this with all ten pages in your hands, you have walked where we walked, and you are the next keeper. ' +
  'The rule has not changed. Hide one thing. Write one page.”';

// In chronological order: this is the order of the pages in the book.
export const PAGES: Page[] = [
  {
    landmark: 5,
    year: 1637,
    keeper: 'Pieter van der Meer, merchant',
    text:
      'In February a single bulb bought a house on this canal; by March it bought a bag of onions. I sold my last one the week before the fall, and I am not proud of who bought it. ' +
      'I have had its likeness cast in gold and buried it by the new church while the masons are still raising the tower. Let whoever comes after me remember what a flower is worth.',
  },
  {
    landmark: 1,
    year: 1672,
    keeper: 'Joris van der Meer, ship’s captain',
    text:
      'The French are at Utrecht and the polders are being flooded to stop them. I have sailed to Batavia and back by this compass and it never once lied to me. ' +
      'I leave it under the eyes of the old church, where every sailor in this city has prayed before a voyage. If the water comes, it will know the way out.',
  },
  {
    landmark: 7,
    year: 1672,
    keeper: 'Griet van der Meer, the captain’s sister',
    text:
      'There is no silver to pay the soldiers, so this summer they strike coin in the tower by the Regulierspoort, day and night. A mint boy let me hold a ducat still warm from the die. ' +
      'I paid him two for it. My brother hides brass; I hide gold, because someone in this family ought to be practical.',
  },
  {
    landmark: 6,
    year: 1688,
    keeper: 'Sister Aleid, beguine',
    text:
      'I gave up the name Van der Meer when I came through the plain door off the Spui, but the book found me anyway. My mother’s amber beads are the only worldly thing I kept. ' +
      'They lie in the quiet of the court now, near the old wooden house. I do not think it is a sin to hide a thing so that it may one day be found.',
  },
  {
    landmark: 8,
    year: 1691,
    keeper: 'Machteld van der Meer',
    text:
      'My sister lives across the Amstel and I on this side, and for thirty years we have shouted our news over the water. Now there is to be a bridge, so narrow that two can barely pass. ' +
      'We each wore one of our grandmother’s pearls. Mine goes into the bank by the bridge, so that something of us always meets in the middle.',
  },
  {
    landmark: 2,
    year: 1731,
    keeper: 'Hendrik van der Meer, surgeon',
    text:
      'In the weigh house the guilds have their rooms, and in ours, upstairs, we open the dead to learn how to mend the living. I weighed powders on these scales for twenty years. ' +
      'They were never wrong by a grain. I bury them by the building that taught me that everything, even a heart, has a weight.',
  },
  {
    landmark: 3,
    year: 1795,
    keeper: 'Jacob van der Meer, clockmaker',
    text:
      'They call the tower on the Oudeschans Silly Jack, because its bells ring when they please. I was paid to cure it and I failed. ' +
      'The cracked bell they threw out I have kept, and now I return it to the foot of the tower. A thing that will not keep time is at least honest about it.',
  },
  {
    landmark: 9,
    year: 1885,
    keeper: 'Willem van der Meer, decorative painter',
    text:
      'For three years I have laid gold leaf on the walls of the new museum, a palace for pictures with a road running straight through its belly. ' +
      'Nobody will know my name, only Rembrandt’s. So I leave my best brush in the ground beside it. Let it be said that one Van der Meer hangs near the Night Watch.',
  },
  {
    landmark: 4,
    year: 1889,
    keeper: 'Cornelis van der Meer, stationmaster',
    text:
      'They have built the station on islands in the IJ, and half the city curses it for stealing the view of the water. One tower has a clock. The other only shows the wind, which the old sailors still check first. ' +
      'I ran my trains by this watch from the first morning. It stays here, where the harbour used to begin.',
  },
  {
    landmark: 0,
    year: 1956,
    keeper: 'Lotte van der Meer',
    text:
      'They unveiled the white pillar on the Dam in May. I stood in the crowd with the guilders my father pressed into my hand in 1942, the last time I saw him, and I could not spend them and could not keep them. ' +
      'They are under the square now, across from the palace. This is the last page in the book. I am the last of us.',
  },
];

/** Page number (0-based, chronological) for a landmark index. */
export function pageOf(landmark: number): number {
  return PAGES.findIndex((p) => p.landmark === landmark);
}

export function pageHeading(page: number): string {
  const p = PAGES[page];
  return `Page ${page + 1} of ${PAGES.length} · ${p.year} · ${LANDMARKS[p.landmark].name}`;
}

export function logComplete(collected: ReadonlySet<number>): boolean {
  return PAGES.every((_, i) => collected.has(i));
}

const KEY = 'grachtengoud.pages';
const SEEN_KEY = 'grachtengoud.prologue';

export function loadPages(): Set<number> {
  try {
    const v: unknown = JSON.parse(lsGet(KEY) ?? '[]');
    return new Set(
      Array.isArray(v)
        ? v.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < PAGES.length)
        : [],
    );
  } catch {
    return new Set();
  }
}

export function savePages(pages: ReadonlySet<number>): void {
  lsSet(KEY, JSON.stringify([...pages].sort((a, b) => a - b)));
}

export function prologueSeen(): boolean {
  return lsGet(SEEN_KEY) === '1';
}

export function markPrologueSeen(): void {
  lsSet(SEEN_KEY, '1');
}
