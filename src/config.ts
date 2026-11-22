import type { Bbox } from './overpass';

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export const BBOX: Bbox = { south: 52.348, west: 4.862, north: 52.386, east: 4.925 };
export const START = { lat: 52.3731, lng: 4.8926 };

export const SPEED = { walk: 22, run: 60, bent: 9 }; // m/s, game pace
export const BACK_FACTOR = 0.6;
export const TURN_RATE = 150; // deg/s

export const STAMINA = {
  drain: 10, // % per second while running
  refillWalk: 8,
  refillRest: 16,
  recoverAt: 30,
};

export const STREET_RADIUS = 6; // m from a street centreline that counts as "on the street"

export const DETECT = {
  range: 300,
  bars: [300, 200, 120, 60],
  bentRange: 90,
  digRange: 12,
};
export const DIG_TIME = 0.7;
export const HINT_PENALTY = 30;
export const HINT_RADIUS = 45;
export const CACHE_MIN = 15;
export const CACHE_MAX = 45;

export const COINS = { count: 150, margin: 250, reach: 4, drawRange: 260 };

export interface CameraPose {
  zoom: number;
  pitch: number;
}
export type CameraView = 'far' | 'close';

/** The hunter is drawn larger than life so it reads clearly on screen. */
export const CHARACTER_SCALE = 1.5;

/**
 * Two chase positions, both below roof height: `close` sits right behind the
 * shoulder (about 13 m back, 2 m up), `far` is a wider view (about 35 m back, 7 m up).
 */
export const CAMERA: Record<CameraView, { walk: CameraPose; run: CameraPose; bent: CameraPose }> & {
  overview: CameraPose;
} = {
  far: {
    walk: { zoom: 20.8, pitch: 78 },
    run: { zoom: 20.4, pitch: 78 },
    bent: { zoom: 21.5, pitch: 60 },
  },
  close: {
    walk: { zoom: 22, pitch: 80 },
    run: { zoom: 21.6, pitch: 80 },
    bent: { zoom: 22.4, pitch: 64 },
  },
  overview: { zoom: 14, pitch: 0 },
};

export interface Landmark {
  name: string;
  lat: number;
  lng: number;
  riddle: string;
  loot: string;
}

export const LANDMARKS: Landmark[] = [
  {
    name: 'National Monument, Dam Square',
    lat: 52.3728,
    lng: 4.8936,
    riddle: "A white stone pillar remembers the war, across the square from a king's palace.",
    loot: 'a pouch of silver guilders',
  },
  {
    name: 'Oude Kerk',
    lat: 52.3743,
    lng: 4.8982,
    riddle:
      'The oldest building in the city, ringed by red-lit windows. Sailors prayed under its wooden roof.',
    loot: "a ship's brass compass",
  },
  {
    name: 'De Waag, Nieuwmarkt',
    lat: 52.3727,
    lng: 4.9003,
    riddle:
      'First a city gate, then a weigh house. Seven turrets on a market square, and anatomy lessons upstairs.',
    loot: "a surgeon's silver scales",
  },
  {
    name: 'Montelbaanstoren',
    lat: 52.3722,
    lng: 4.9056,
    riddle:
      'A lookout tower on the Oudeschans. Sailors called it Silly Jack, because its bells rang whenever they pleased.',
    loot: 'a cracked bronze bell',
  },
  {
    name: 'Centraal Station',
    lat: 52.3791,
    lng: 4.9003,
    riddle:
      'Two towers face the city. One tells the time, the other tells the wind. Trains leave from behind them.',
    loot: "a stationmaster's pocket watch",
  },
  {
    name: 'Westerkerk',
    lat: 52.3745,
    lng: 4.884,
    riddle:
      "The tallest church tower in town wears an emperor's crown. A girl in hiding next door wrote about its bells.",
    loot: 'a golden tulip bulb',
  },
  {
    name: 'Begijnhof',
    lat: 52.3694,
    lng: 4.89,
    riddle:
      'Behind a plain door near the Spui lies a silent courtyard, where one black wooden house still stands.',
    loot: 'a string of amber beads',
  },
  {
    name: 'Munttoren',
    lat: 52.3668,
    lng: 4.893,
    riddle:
      'Coins were once struck in this tower. It stands where the floating flower market meets the Amstel.',
    loot: 'a freshly struck ducat',
  },
  {
    name: 'Magere Brug',
    lat: 52.3636,
    lng: 4.9024,
    riddle: 'A skinny white drawbridge over the Amstel, lit by hundreds of bulbs after dark.',
    loot: 'a pearl earring',
  },
  {
    name: 'Rijksmuseum',
    lat: 52.36,
    lng: 4.8852,
    riddle:
      'Cyclists ride straight through this palace of paintings, under the hall of the Night Watch.',
    loot: "a painter's gold-leaf brush",
  },
];
