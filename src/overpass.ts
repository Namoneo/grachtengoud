// Overpass -> compact street data. No imports: also used by scripts/fetch-streets.ts under plain Node.

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Compact street network. Coordinates are integers: micro-degrees offset from
 * the bbox south-west corner, flattened as [lng, lat, lng, lat, ...].
 */
export interface StreetData {
  v: number;
  lines: number[][];
  /** Each polygon is a list of rings; inside = even-odd over all rings. */
  polys: number[][][];
}

export const STREET_DATA_VERSION = 1;

interface Pt {
  lat: number;
  lon: number;
}
interface OverpassElement {
  type: string;
  tags?: Record<string, string>;
  geometry?: (Pt | null)[];
  members?: { type: string; role?: string; geometry?: (Pt | null)[] }[];
}

const EXCLUDED = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'proposed',
  'construction',
  'razed',
  'abandoned',
]);
// Road tunnels (e.g. under the IJ) would let the player walk across open water.
const ROAD_CLASSES = new Set([
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
]);

export function overpassQuery(b: Bbox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:120];
(
  way["highway"]["highway"!~"^(motorway|motorway_link|trunk|trunk_link)$"](${bb});
  way["place"="square"](${bb});
  relation["type"="multipolygon"]["highway"="pedestrian"](${bb});
  relation["type"="multipolygon"]["place"="square"](${bb});
);
out tags geom;`;
}

function samePt(a: Pt, b: Pt): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

/** Join way fragments of a multipolygon into closed rings. */
function stitchRings(parts: Pt[][]): Pt[][] {
  const rings: Pt[][] = [];
  const open = parts.filter((p) => p.length >= 2).map((p) => p.slice());
  while (open.length) {
    let cur = open.pop()!;
    let grew = true;
    while (!samePt(cur[0], cur[cur.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i];
        const end = cur[cur.length - 1];
        if (samePt(o[0], end)) cur = cur.concat(o.slice(1));
        else if (samePt(o[o.length - 1], end)) cur = cur.concat(o.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4 && samePt(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

export function convertOverpass(elements: OverpassElement[], bbox: Bbox): StreetData {
  const enc = (pts: Pt[]): number[] => {
    const out: number[] = new Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      out[i * 2] = Math.round((pts[i].lon - bbox.west) * 1e6);
      out[i * 2 + 1] = Math.round((pts[i].lat - bbox.south) * 1e6);
    }
    return out;
  };
  const clean = (g?: (Pt | null)[]): Pt[] => (g ?? []).filter((p): p is Pt => !!p);

  const lines: number[][] = [];
  const polys: number[][][] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    if (el.type === 'way') {
      const pts = clean(el.geometry);
      if (pts.length < 2) continue;
      const hw = tags.highway;
      if (hw && EXCLUDED.has(hw)) continue;
      if (hw && tags.tunnel === 'yes' && ROAD_CLASSES.has(hw)) continue;
      const closed = pts.length >= 4 && samePt(pts[0], pts[pts.length - 1]);
      const isArea =
        closed && (hw === 'pedestrian' || tags.place === 'square' || (!!hw && tags.area === 'yes'));
      const flat = enc(pts);
      lines.push(flat); // polygon outlines double as street segments
      if (isArea) polys.push([flat]);
    } else if (el.type === 'relation') {
      const parts = (el.members ?? [])
        .filter((m) => m.type === 'way')
        .map((m) => clean(m.geometry));
      const rings = stitchRings(parts).map(enc);
      if (!rings.length) continue;
      polys.push(rings);
      for (const r of rings) lines.push(r);
    }
  }
  return { v: STREET_DATA_VERSION, lines, polys };
}
