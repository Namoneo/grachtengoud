import { BBOX, OVERPASS_URL, STREET_RADIUS } from './config';
import { clamp, toLocal, type Vec } from './geo';
import { convertOverpass, overpassQuery, STREET_DATA_VERSION, type StreetData } from './overpass';
import { idbGet, idbSet } from './storage';

const CELL = 30; // metres per grid bucket

interface Poly {
  rings: Float64Array[]; // flat x,y
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Hit extends Vec {
  d: number;
}

/** Grid-bucketed index of street segments and pedestrian polygons, in local metres. */
export class StreetIndex {
  private seg: Float64Array; // ax, ay, bx, by per segment
  private segCount = 0;
  private polys: Poly[] = [];
  private segCells: (number[] | undefined)[];
  private polyCells: (number[] | undefined)[];
  private cols: number;
  private rows: number;
  private ox: number;
  private oy: number;
  readonly min: Vec;
  readonly max: Vec;

  constructor(lines: Vec[][], polygons: Vec[][][] = [], bounds?: { min: Vec; max: Vec }) {
    if (!bounds) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const l of lines)
        for (const p of l) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      bounds = { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
    }
    this.min = bounds.min;
    this.max = bounds.max;
    this.ox = this.min.x - CELL;
    this.oy = this.min.y - CELL;
    this.cols = Math.ceil((this.max.x - this.min.x) / CELL) + 3;
    this.rows = Math.ceil((this.max.y - this.min.y) / CELL) + 3;
    this.segCells = new Array(this.cols * this.rows);
    this.polyCells = new Array(this.cols * this.rows);

    let n = 0;
    for (const l of lines) n += Math.max(0, l.length - 1);
    this.seg = new Float64Array(n * 4);
    for (const l of lines) {
      for (let i = 0; i + 1 < l.length; i++) this.addSegment(l[i], l[i + 1]);
    }
    for (const rings of polygons) this.addPolygon(rings);
  }

  static fromData(data: StreetData): StreetIndex {
    const dec = (flat: number[]): Vec[] => {
      const out: Vec[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        out.push(toLocal(BBOX.west + flat[i] / 1e6, BBOX.south + flat[i + 1] / 1e6));
      }
      return out;
    };
    return new StreetIndex(
      data.lines.map(dec),
      data.polys.map((rings) => rings.map(dec)),
      { min: toLocal(BBOX.west, BBOX.south), max: toLocal(BBOX.east, BBOX.north) },
    );
  }

  get segmentCount(): number {
    return this.segCount;
  }

  private cx(x: number): number {
    return Math.floor((x - this.ox) / CELL);
  }
  private cy(y: number): number {
    return Math.floor((y - this.oy) / CELL);
  }

  private bucket(
    cells: (number[] | undefined)[],
    id: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): boolean {
    const x0 = Math.max(0, this.cx(minX));
    const x1 = Math.min(this.cols - 1, this.cx(maxX));
    const y0 = Math.max(0, this.cy(minY));
    const y1 = Math.min(this.rows - 1, this.cy(maxY));
    if (x0 > x1 || y0 > y1) return false;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = y * this.cols + x;
        (cells[k] ??= []).push(id);
      }
    return true;
  }

  private addSegment(a: Vec, b: Vec): void {
    if (a.x === b.x && a.y === b.y) return;
    const id = this.segCount;
    const ok = this.bucket(
      this.segCells,
      id,
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.max(a.x, b.x),
      Math.max(a.y, b.y),
    );
    if (!ok) return; // entirely outside the play area
    this.seg.set([a.x, a.y, b.x, b.y], id * 4);
    this.segCount++;
  }

  private addPolygon(rings: Vec[][]): void {
    const p: Poly = { rings: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const r of rings) {
      if (r.length < 3) continue;
      const flat = new Float64Array(r.length * 2);
      r.forEach((v, i) => {
        flat[i * 2] = v.x;
        flat[i * 2 + 1] = v.y;
        p.minX = Math.min(p.minX, v.x);
        p.minY = Math.min(p.minY, v.y);
        p.maxX = Math.max(p.maxX, v.x);
        p.maxY = Math.max(p.maxY, v.y);
      });
      p.rings.push(flat);
    }
    if (!p.rings.length) return;
    if (this.bucket(this.polyCells, this.polys.length, p.minX, p.minY, p.maxX, p.maxY)) {
      this.polys.push(p);
    }
  }

  /** Closest point on any segment within radius r, or null. */
  nearestWithin(x: number, y: number, r: number): Hit | null {
    const x0 = Math.max(0, this.cx(x - r));
    const x1 = Math.min(this.cols - 1, this.cx(x + r));
    const y0 = Math.max(0, this.cy(y - r));
    const y1 = Math.min(this.rows - 1, this.cy(y + r));
    const s = this.seg;
    let best = r * r;
    let bx = 0;
    let by = 0;
    let found = false;
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) {
        const ids = this.segCells[gy * this.cols + gx];
        if (!ids) continue;
        for (let i = 0; i < ids.length; i++) {
          const o = ids[i] * 4;
          const ax = s[o];
          const ay = s[o + 1];
          const dx = s[o + 2] - ax;
          const dy = s[o + 3] - ay;
          const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
          const px = ax + dx * t;
          const py = ay + dy * t;
          const d2 = (x - px) * (x - px) + (y - py) * (y - py);
          if (d2 <= best) {
            best = d2;
            bx = px;
            by = py;
            found = true;
          }
        }
      }
    return found ? { x: bx, y: by, d: Math.sqrt(best) } : null;
  }

  /** Direction (radians from east) of the street segment closest to a point, or null. */
  directionNear(x: number, y: number, radius = 40): number | null {
    const s = this.seg;
    let best = radius * radius;
    let angle: number | null = null;
    for (let i = 0; i < this.segCount; i++) {
      const o = i * 4;
      const ax = s[o];
      const ay = s[o + 1];
      const dx = s[o + 2] - ax;
      const dy = s[o + 3] - ay;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      const d2 = (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2;
      if (d2 < best) {
        best = d2;
        angle = Math.atan2(dy, dx);
      }
    }
    return angle;
  }

  /** Closest point on any segment, searching outward. */
  nearest(x: number, y: number): Hit | null {
    const limit = Math.max(this.cols, this.rows) * CELL * 2;
    for (let r = CELL; r <= limit; r *= 2) {
      const hit = this.nearestWithin(x, y, r);
      if (hit) return hit;
    }
    return null;
  }

  inPolygon(x: number, y: number): boolean {
    const gx = this.cx(x);
    const gy = this.cy(y);
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return false;
    const ids = this.polyCells[gy * this.cols + gx];
    if (!ids) return false;
    for (const id of ids) {
      const p = this.polys[id];
      if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
      let inside = false;
      for (const r of p.rings) {
        for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
          const xi = r[i];
          const yi = r[i + 1];
          const xj = r[j];
          const yj = r[j + 1];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  isWalkable(x: number, y: number): boolean {
    return this.nearestWithin(x, y, STREET_RADIUS) !== null || this.inPolygon(x, y);
  }

  /**
   * Turn a wanted position into an allowed one. On-street positions pass
   * through; anything else is pulled back to the edge of the nearest street
   * corridor, so the character glides along the kerb instead of stopping.
   */
  constrain(x: number, y: number): Vec {
    x = clamp(x, this.min.x, this.max.x);
    y = clamp(y, this.min.y, this.max.y);
    if (this.isWalkable(x, y)) return { x, y };
    const hit = this.nearest(x, y);
    if (!hit) return { x, y };
    const k = hit.d > 0 ? (STREET_RADIUS - 0.05) / hit.d : 0;
    return {
      x: clamp(hit.x + (x - hit.x) * k, this.min.x, this.max.x),
      y: clamp(hit.y + (y - hit.y) * k, this.min.y, this.max.y),
    };
  }

  /** Project onto the nearest street centreline. */
  snap(x: number, y: number): Vec {
    const hit = this.nearest(x, y);
    return hit ? { x: hit.x, y: hit.y } : { x, y };
  }
}

const CACHE_KEY = `streets-v${STREET_DATA_VERSION}`;

function valid(d: unknown): d is StreetData {
  const s = d as StreetData | null;
  return !!s && s.v === STREET_DATA_VERSION && Array.isArray(s.lines) && s.lines.length > 100;
}

/**
 * Street network, cheapest source first: IndexedDB cache, then the JSON
 * shipped with the game, then a live Overpass query.
 */
export async function loadStreetData(status: (msg: string) => void): Promise<StreetData> {
  const cached = await idbGet<StreetData>(CACHE_KEY);
  if (valid(cached)) return cached;

  status('Unrolling the street map…');
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}streets.json`);
    if (res.ok) {
      const data: unknown = await res.json();
      if (valid(data)) {
        void idbSet(CACHE_KEY, data);
        return data;
      }
    }
  } catch {
    /* fall through to Overpass */
  }

  status('Downloading Amsterdam’s streets from OpenStreetMap…');
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(overpassQuery(BBOX)),
  });
  if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
  const json = (await res.json()) as { elements: Parameters<typeof convertOverpass>[0] };
  const data = convertOverpass(json.elements, BBOX);
  if (!valid(data)) throw new Error('Street data came back empty');
  void idbSet(CACHE_KEY, data);
  return data;
}
