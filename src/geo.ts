import { START } from './config';

/**
 * Local metric frame: x east, y north, origin at Dam Square. It is the Web
 * Mercator plane scaled to metres at the origin, so it lines up exactly with
 * the three.js scene anchored there (scale error across the play area < 0.1 %).
 */
export interface Vec {
  x: number;
  y: number;
}

const EARTH_RADIUS = 6371008.8; // same constant MapLibre uses
const DEG = Math.PI / 180;

const mercX = (lng: number) => (180 + lng) / 360;
const mercY = (lat: number) =>
  (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;

const X0 = mercX(START.lng);
const Y0 = mercY(START.lat);
/** Mercator units per metre at the origin. */
const S0 = 1 / (2 * Math.PI * EARTH_RADIUS * Math.cos(START.lat * DEG));

export function toLocal(lng: number, lat: number): Vec {
  return { x: (mercX(lng) - X0) / S0, y: -(mercY(lat) - Y0) / S0 };
}

export function toLngLat(x: number, y: number): [number, number] {
  const lng = (X0 + x * S0) * 360 - 180;
  const my = 180 - (Y0 - y * S0) * 360;
  const lat = (360 / Math.PI) * Math.atan(Math.exp(my * DEG)) - 90;
  return [lng, lat];
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Compass bearing in degrees (0 = north, 90 = east) from a to b. */
export function bearing(a: Vec, b: Vec): number {
  return norm360(Math.atan2(b.x - a.x, b.y - a.y) / DEG);
}

export function norm360(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Signed shortest difference b - a in degrees, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = norm360(b - a);
  if (d > 180) d -= 360;
  return d;
}

/** Unit forward vector for a compass heading. */
export function headingVec(deg: number): Vec {
  return { x: Math.sin(deg * DEG), y: Math.cos(deg * DEG) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Frame-rate independent smoothing factor. */
export function ease(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
