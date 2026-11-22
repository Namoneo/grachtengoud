import type { Map as MlMap } from 'maplibre-gl';
import * as THREE from 'three';
import { toLocal, type Vec } from './geo';

/**
 * Street-level buildings. The vector tiles only carry footprints and heights,
 * so the look is procedural: brick walls with rows of windows (some lit), a
 * shop/door level at the ground, flat roofs, and gabled roofs on the narrow
 * four-cornered plots typical of canal houses.
 */

const RADIUS = 480; // metres around the player that get meshes
const REBUILD_DISTANCE = 140;
const BAY = 2.4; // metres per window bay
const FLOOR = 3.0;
const GROUND = 3.4;
const CELLS = 8; // texture holds 8 bays x 8 floors

const BRICKS = [0x8a5a48, 0x74483c, 0x9a6f55, 0x6a5560, 0x85776c, 0xa58868, 0x5f4a44, 0x7d6a5a];
const ROOF_FLAT = new THREE.Color(0x3a4050);
const ROOF_TILES = [new THREE.Color(0x6a4038), new THREE.Color(0x4a4a58), new THREE.Color(0x7a4a3a)];
const NIGHT = 0.62; // overall dimming of daylight colours

function hash(n: number): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** RGBA texture: rgb = facade, alpha = "glows on its own" mask (lit windows). */
function facadeTexture(ground: boolean): THREE.DataTexture {
  const w = 512;
  const h = ground ? 128 : 512;
  const cw = w / CELLS;
  const ch = ground ? h : h / CELLS;
  const colour = document.createElement('canvas');
  const mask = document.createElement('canvas');
  colour.width = mask.width = w;
  colour.height = mask.height = h;
  const c = colour.getContext('2d')!;
  const m = mask.getContext('2d')!;
  let seed = ground ? 77 : 13;
  const rnd = () => (hash(seed++) % 1000) / 1000;

  // Brick: light neutral base (tinted per building in the shader) with courses.
  c.fillStyle = '#c9c1b8';
  c.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) {
    c.fillStyle = `rgba(60,40,30,${0.1 + rnd() * 0.08})`;
    c.fillRect(0, y, w, 1);
  }
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgba(${rnd() > 0.5 ? '255,240,220' : '40,25,20'},${0.04 + rnd() * 0.06})`;
    c.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * (h / 4)) * 4 + 1, 8, 3);
  }
  m.fillStyle = '#000';
  m.fillRect(0, 0, w, h);

  const glow = ['#ffd27a', '#ffe3ad', '#ffc061', '#fff1cf', '#bcd8ff'];
  const pane = (x: number, y: number, pw: number, ph: number, litChance: number, bars: boolean) => {
    c.fillStyle = '#e8e2d6'; // painted frame
    c.fillRect(x - 2, y - 2, pw + 4, ph + 4);
    const lit = rnd() < litChance;
    if (lit) {
      const g = c.createLinearGradient(0, y, 0, y + ph);
      const tone = glow[Math.floor(rnd() * glow.length)];
      g.addColorStop(0, tone);
      g.addColorStop(1, '#f0a850');
      c.fillStyle = g;
      c.fillRect(x, y, pw, ph);
      m.fillStyle = '#fff';
      m.fillRect(x, y, pw, ph);
      if (rnd() < 0.5) {
        // half-drawn curtain
        c.fillStyle = 'rgba(120,60,40,0.55)';
        c.fillRect(x, y, pw * (0.2 + rnd() * 0.25), ph);
        m.fillStyle = '#888';
        m.fillRect(x, y, pw * 0.3, ph);
      }
    } else {
      c.fillStyle = rnd() < 0.5 ? '#141c2e' : '#1b2740';
      c.fillRect(x, y, pw, ph);
      c.fillStyle = 'rgba(140,170,220,0.10)'; // faint sky reflection
      c.fillRect(x, y, pw, ph * 0.35);
    }
    if (bars) {
      c.fillStyle = '#e8e2d6';
      c.fillRect(x + pw / 2 - 1, y, 2, ph);
      c.fillRect(x, y + ph * 0.42, pw, 2);
      m.fillStyle = '#000';
      m.fillRect(x + pw / 2 - 1, y, 2, ph);
      m.fillRect(x, y + ph * 0.42, pw, 2);
    }
  };

  if (!ground) {
    for (let row = 0; row < CELLS; row++)
      for (let col = 0; col < CELLS; col++) {
        const x = col * cw;
        const y = row * ch;
        pane(x + 17, y + 12, 30, 38, 0.32, true);
        c.fillStyle = '#d9d2c4'; // stone sill
        c.fillRect(x + 13, y + 52, 38, 3);
      }
  } else {
    // plinth
    c.fillStyle = 'rgba(30,25,25,0.45)';
    c.fillRect(0, h - 14, w, 14);
    for (let col = 0; col < CELLS; col++) {
      const x = col * cw;
      const kind = rnd();
      if (kind < 0.3) {
        // front door with fanlight
        c.fillStyle = ['#1f3a2c', '#2a1f1a', '#1c2a44', '#4a1f1f'][Math.floor(rnd() * 4)];
        c.fillRect(x + 20, 38, 24, h - 38 - 6);
        pane(x + 22, 22, 20, 12, 0.5, false);
      } else if (kind < 0.65) {
        pane(x + 8, 26, 48, 70, 0.55, false); // shop window
        c.fillStyle = 'rgba(20,20,30,0.8)';
        c.fillRect(x + 6, 12, 52, 9); // signboard
      } else {
        pane(x + 15, 30, 34, 58, 0.3, true);
      }
    }
  }

  const cd = c.getImageData(0, 0, w, h).data;
  const md = m.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4; // flip: texture row 0 is the bottom
    const dst = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      data[dst + x] = cd[src + x];
      data[dst + x + 1] = cd[src + x + 1];
      data[dst + x + 2] = cd[src + x + 2];
      data[dst + x + 3] = md[src + x];
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = ground ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
  attribute vec3 color;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vColor = color;
    vWorld = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform bool useMap;
  uniform vec3 fogColor;
  uniform vec3 eye;
  uniform float fadeStart;
  uniform float fadeEnd;
  uniform vec3 hole; // xy = hunter on screen (buffer px), z = hunter depth
  uniform float holeRadius;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorld;
  void main() {
    // Porthole: walls between the camera and the hunter dissolve (dithered) so the hunter and
    // the street stay visible, while every other building stays solid.
    if (gl_FragCoord.z < hole.z - 0.00002) {
      float r = distance(gl_FragCoord.xy, hole.xy) / holeRadius;
      float cut = 1.0 - smoothstep(0.55, 1.0, r);
      float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
      if (n < cut * 0.9) discard;
    }
    vec3 c = vColor;
    if (useMap) {
      vec4 t = texture2D(map, vUv);
      c = mix(t.rgb * vColor, t.rgb, t.a); // lit windows ignore the wall tint
    }
    float fade = smoothstep(fadeStart, fadeEnd, distance(vWorld.xz, eye.xz));
    gl_FragColor = vec4(mix(c, fogColor, fade), 1.0);
    #include <colorspace_fragment>
  }
`;

interface Buffers {
  pos: number[];
  uv: number[];
  col: number[];
}
const buffers = (): Buffers => ({ pos: [], uv: [], col: [] });

function toGeometry(b: Buffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  return g;
}

/** Scene coordinates: x east, y up, z = -north. */
function vert(b: Buffers, p: Vec, z: number, u: number, v: number, c: THREE.Color, k = 1): void {
  b.pos.push(p.x, z, -p.y);
  b.uv.push(u, v);
  b.col.push(c.r * k, c.g * k, c.b * k);
}

function quad(
  b: Buffers,
  a: Vec,
  d: Vec,
  z0: number,
  z1: number,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  c: THREE.Color,
  k: number,
): void {
  vert(b, a, z0, u0, v0, c, k);
  vert(b, d, z0, u1, v0, c, k);
  vert(b, d, z1, u1, v1, c, k);
  vert(b, a, z0, u0, v0, c, k);
  vert(b, d, z1, u1, v1, c, k);
  vert(b, a, z1, u0, v1, c, k);
}

function tri(b: Buffers, p: [Vec, number][], c: THREE.Color, k: number): void {
  for (const [v, z] of p) vert(b, v, z, 0, 0, c, k);
}

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const len = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);

function addBuilding(
  out: { upper: Buffers; ground: Buffers; roof: Buffers },
  rings: Vec[][],
  height: number,
  base: number,
  tint: THREE.Color,
  seed: number,
): void {
  const outer = rings[0];
  const simple = rings.length === 1 && outer.length === 4;
  const e0 = simple ? len(outer[0], outer[1]) : 0;
  const e1 = simple ? len(outer[1], outer[2]) : 0;
  const short = Math.min(e0, e1);
  const gabled =
    simple && short >= 3 && short <= 11 && Math.max(e0, e1) <= 40 && height - base >= 6 && base === 0;
  const ridge = gabled ? Math.min(4, short * 0.5) : 0;
  const top = height - ridge;
  const gTop = base === 0 ? Math.min(top, GROUND) : base;

  // Walls
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const d = ring[(i + 1) % ring.length];
      const l = len(a, d);
      if (l < 0.3) continue;
      // Cheap directional shading so corners read.
      const k = 0.74 + 0.26 * Math.abs(Math.cos(Math.atan2(d.y - a.y, d.x - a.x) - 0.7));
      const bays = Math.max(1, Math.round(l / BAY));
      const hsh = hash(seed + i * 31 + Math.round(a.x * 3) + Math.round(a.y * 7));
      const u0 = (hsh % CELLS) / CELLS;
      const u1 = u0 + bays / CELLS;
      if (base === 0 && gTop > 0) quad(out.ground, a, d, 0, gTop, u0, u1, 0, gTop / GROUND, tint, k);
      if (top > gTop + 0.3) {
        const floors = Math.max(1, Math.round((top - gTop) / FLOOR));
        const v0 = ((hsh >>> 8) % CELLS) / CELLS;
        quad(out.upper, a, d, gTop, top, u0, u1, v0, v0 + floors / CELLS, tint, k);
      }
    }
  }

  // Roof
  if (gabled) {
    const p = e0 < e1 ? outer : [outer[1], outer[2], outer[3], outer[0]];
    const r1 = mid(p[0], p[1]);
    const r2 = mid(p[2], p[3]);
    const tile = ROOF_TILES[seed % ROOF_TILES.length];
    tri(out.roof, [[p[1], top], [p[2], top], [r2, height]], tile, NIGHT * 0.9);
    tri(out.roof, [[p[1], top], [r2, height], [r1, height]], tile, NIGHT * 0.9);
    tri(out.roof, [[p[3], top], [p[0], top], [r1, height]], tile, NIGHT * 0.65);
    tri(out.roof, [[p[3], top], [r1, height], [r2, height]], tile, NIGHT * 0.65);
    tri(out.roof, [[p[0], top], [p[1], top], [r1, height]], tint, 0.9); // gable ends
    tri(out.roof, [[p[2], top], [p[3], top], [r2, height]], tint, 0.9);
  } else {
    const contour = outer.map((v) => new THREE.Vector2(v.x, v.y));
    const holes = rings.slice(1).map((r) => r.map((v) => new THREE.Vector2(v.x, v.y)));
    const all = [outer, ...rings.slice(1)].flat();
    const k = NIGHT * (0.85 + (seed % 5) * 0.05);
    for (const f of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      tri(out.roof, [[all[f[0]], top], [all[f[1]], top], [all[f[2]], top]], ROOF_FLAT, k);
    }
  }
}

type Ring = [number, number][];

export class Buildings {
  readonly group = new THREE.Group();
  private centre: Vec | null = null;
  private dirty = true;
  private lastBuild = 0;
  private materials: THREE.ShaderMaterial[] = [];
  private hole = new THREE.Vector3(-9999, -9999, 0);
  private holeRadius = 1;
  private eye = new THREE.Vector4();
  private textures = { upper: facadeTexture(false), ground: facadeTexture(true) };

  /**
   * @param skip returns true for footprints that must not be generated
   */
  constructor(
    private map: MlMap,
    private source: string,
    private skip: (outerRing: Vec[]) => boolean = () => false,
    /** Called after each batch; returning true asks for another pass. */
    private settle: () => boolean = () => false,
  ) {
    map.on('sourcedata', (e) => {
      if (e.sourceId === source && 'tile' in e && e.tile) this.dirty = true;
    });
  }

  private material(map: THREE.Texture | null): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        map: { value: map },
        useMap: { value: !!map },
        fogColor: { value: new THREE.Color(0x0a1330) },
        eye: { value: new THREE.Vector3() },
        fadeStart: { value: RADIUS * 0.6 },
        fadeEnd: { value: RADIUS * 0.97 },
        hole: { value: this.hole },
        holeRadius: { value: 1 },
      },
      side: THREE.DoubleSide,
    });
    this.materials.push(mat);
    return mat;
  }

  private rebuild(pos: Vec): void {
    const features = this.map.querySourceFeatures(this.source, { sourceLayer: 'building' });
    const out = { upper: buffers(), ground: buffers(), roof: buffers() };
    const seen = new Set<string>();
    const r2 = RADIUS * RADIUS;

    for (const f of features) {
      const props = f.properties ?? {};
      if (props.hide_3d) continue;
      const height = Number(props.render_height) || 0;
      const base = Number(props.render_min_height) || 0;
      if (height - base < 1) continue;
      const g = f.geometry;
      const polys: Ring[][] =
        g.type === 'Polygon'
          ? [g.coordinates as Ring[]]
          : g.type === 'MultiPolygon'
            ? (g.coordinates as Ring[][])
            : [];
      const tint = new THREE.Color(
        typeof props.colour === 'string' && /^#[0-9a-f]{6}$/i.test(props.colour)
          ? props.colour
          : BRICKS[hash(Math.round(height * 10)) % BRICKS.length],
      );
      tint.multiplyScalar(NIGHT);

      for (const poly of polys) {
        const first = poly[0]?.[0];
        if (!first || poly[0].length < 4) continue;
        const p0 = toLocal(first[0], first[1]);
        const dx = p0.x - pos.x;
        const dy = p0.y - pos.y;
        if (dx * dx + dy * dy > r2) continue;
        // Tiles overlap at their edges: skip pieces already built.
        const key = `${Math.round(p0.x * 10)},${Math.round(p0.y * 10)},${poly[0].length},${height}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rings = poly
          .map((ring) => ring.slice(0, -1).map(([lng, lat]) => toLocal(lng, lat)))
          .filter((ring) => ring.length >= 3);
        if (!rings.length) continue;
        if (this.skip(rings[0])) continue; // a hand-built landmark stands here
        addBuilding(out, rings, height, base, tint, hash(Math.round(p0.x) * 73 + Math.round(p0.y)));
      }
    }

    // Swap in the new meshes.
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.materials = [];
    const add = (b: Buffers, map: THREE.Texture | null) => {
      if (!b.pos.length) return;
      const mesh = new THREE.Mesh(toGeometry(b), this.material(map));
      mesh.frustumCulled = false;
      this.group.add(mesh);
    };
    add(out.upper, this.textures.upper);
    add(out.ground, this.textures.ground);
    add(out.roof, null);
    this.centre = { ...pos };
    this.dirty = this.settle();
  }

  update(now: number, pos: Vec): void {
    if (!this.group.visible) return;
    const moved = this.centre ? Math.hypot(pos.x - this.centre.x, pos.y - this.centre.y) : Infinity;
    const due = moved > REBUILD_DISTANCE || (this.dirty && now - this.lastBuild > 700);
    if (due && now - this.lastBuild > 250) {
      this.lastBuild = now;
      this.rebuild(pos);
    }
    this.eye.set(pos.x, 1.4, -pos.y, 1);
    for (const m of this.materials) {
      m.uniforms.eye.value.set(pos.x, 0, -pos.y);
      m.uniforms.holeRadius.value = this.holeRadius;
    }
  }

  /** Called just before drawing, with the matrix that maps scene metres to clip space. */
  prepare(projection: THREE.Matrix4, width: number, height: number): void {
    const v = this.eye.clone().applyMatrix4(projection);
    if (v.w <= 0) {
      this.hole.set(-9999, -9999, 0);
      return;
    }
    this.hole.set(((v.x / v.w) * 0.5 + 0.5) * width, ((v.y / v.w) * 0.5 + 0.5) * height, (v.z / v.w) * 0.5 + 0.5);
    this.holeRadius = height * 0.1;
  }
}
