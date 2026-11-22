import * as THREE from 'three';
import { LANDMARKS } from './config';
import { toLocal, type Vec } from './geo';
import type { StreetIndex } from './streets';

/**
 * Hand-built models of the ten treasure landmarks, assembled from simple
 * solids so each is recognisable by its silhouette. Sizes are set by hand;
 * each model is turned to match the real walls around it, and the generated
 * buildings underneath are suppressed.
 *
 * Model space: X along the building's long axis, +Z its front, Y up, origin
 * at the centre of the footprint on the ground.
 */

// ---------- materials ----------

const lam = (color: number, emissive = 0.18) =>
  new THREE.MeshLambertMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
    side: THREE.DoubleSide,
  });

const TILE_W = 16; // metres covered by one repeat of the wall texture
const TILE_H = 12;

function wallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 384);
  for (let y = 0; y < 384; y += 6) {
    g.fillStyle = `rgba(60,30,20,${0.1 + ((y * 7) % 5) * 0.02})`;
    g.fillRect(0, y, 512, 1);
  }
  let n = 5;
  const rnd = () => {
    n = (n * 16807) % 2147483647;
    return n / 2147483647;
  };
  // 4 bays x 2 storeys of tall arched windows with stone surrounds
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 4; col++) {
      const x = col * 128 + 40;
      const y = row * 192 + 42;
      g.fillStyle = '#f1e9da';
      g.beginPath();
      g.roundRect(x - 5, y - 5, 58, 126, [29, 29, 2, 2]);
      g.fill();
      g.fillStyle = rnd() < 0.45 ? '#ffd27a' : '#1a2338';
      g.beginPath();
      g.roundRect(x, y, 48, 116, [24, 24, 0, 0]);
      g.fill();
      g.fillStyle = '#f1e9da';
      g.fillRect(x + 22, y, 4, 116);
      g.fillRect(x, y + 50, 48, 4);
    }
  // string course between storeys
  g.fillStyle = 'rgba(240,230,210,0.9)';
  g.fillRect(0, 186, 512, 6);
  g.fillRect(0, 378, 512, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

let sharedWall: THREE.CanvasTexture | null = null;
const walled = (color: number) => {
  sharedWall ??= wallTexture();
  return new THREE.MeshLambertMaterial({
    color,
    map: sharedWall,
    emissive: color,
    emissiveMap: sharedWall,
    emissiveIntensity: 0.3,
    side: THREE.DoubleSide,
  });
};

const M = {
  get brick() {
    return (this._brick ??= walled(0xa8523c));
  },
  get darkBrick() {
    return (this._dark ??= walled(0x7c4a3a));
  },
  get sand() {
    return (this._sand ??= walled(0xc2a37a));
  },
  _brick: null as THREE.Material | null,
  _dark: null as THREE.Material | null,
  _sand: null as THREE.Material | null,
  plainBrick: lam(0x8f4a38),
  stone: lam(0xd9d2c2, 0.3),
  white: lam(0xf4f1ea, 0.45),
  slate: lam(0x39424f, 0.1),
  lead: lam(0x56606e, 0.12),
  tile: lam(0x7a3f33, 0.12),
  blackWood: lam(0x1b1a1c, 0.05),
  green: lam(0x1f4a35, 0.15),
  crown: lam(0x2f66d8, 0.6),
  gold: lam(0xffc93c, 0.8),
  glass: lam(0x5b7da8, 0.35),
  dark: lam(0x0a0d18, 0),
  glow: new THREE.MeshBasicMaterial({ color: 0xffe2a0, side: THREE.DoubleSide }),
};

// ---------- solids ----------

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

/** Box standing on y. */
function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  if ((mat as THREE.MeshLambertMaterial).map) {
    // Tile the wall texture in metres instead of stretching it over each face.
    const uv = g.attributes.uv;
    const scale: [number, number][] = [
      [d / TILE_W, h / TILE_H],
      [d / TILE_W, h / TILE_H],
      [w / TILE_W, d / TILE_W],
      [w / TILE_W, d / TILE_W],
      [w / TILE_W, h / TILE_H],
      [w / TILE_W, h / TILE_H],
    ];
    for (let i = 0; i < uv.count; i++) {
      const [su, sv] = scale[Math.floor(i / 4)];
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  return at(new THREE.Mesh(g, mat), x, y + h / 2, z);
}

/** Cylinder / prism / cone standing on y. */
function cyl(
  rTop: number,
  rBottom: number,
  h: number,
  segments: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat);
  if (segments === 4 || segments === 8) m.rotation.y = Math.PI / segments; // flat sides face out
  return at(m, x, y + h / 2, z);
}

/** Four-sided pyramid roof over a w x d rectangle. */
function pyramid(w: number, d: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4), mat);
  m.rotation.y = Math.PI / 4;
  const holder = new THREE.Group();
  holder.add(m);
  holder.scale.set(w, h, d);
  at(holder, x, y + h / 2, z);
  return holder as unknown as THREE.Mesh;
}

/** Pitched roof: ridge along X, length l, span d, height h. */
function gable(
  l: number,
  d: number,
  h: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  acrossZ = false,
): THREE.Mesh {
  const a = [-l / 2, 0, -d / 2];
  const b = [l / 2, 0, -d / 2];
  const c = [l / 2, 0, d / 2];
  const e = [-l / 2, 0, d / 2];
  const r1 = [-l / 2, h, 0];
  const r2 = [l / 2, h, 0];
  const tris = [a, b, r2, a, r2, r1, e, r1, r2, e, r2, c, a, r1, e, b, c, r2];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  const m = at(new THREE.Mesh(g, mat), x, y, z);
  if (acrossZ) m.rotation.y = Math.PI / 2;
  return m;
}

function sphere(r: number, mat: THREE.Material, x: number, y: number, z: number, squash = 1): THREE.Mesh {
  const m = at(new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat), x, y, z);
  m.scale.y = squash;
  return m;
}

/** Glowing clock faces on the four sides of a square tower of half-width r. */
function clocks(g: THREE.Group, r: number, y: number, size: number, x = 0, z = 0): void {
  for (let i = 0; i < 4; i++) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(size, 20), M.glow);
    const a = (i * Math.PI) / 2;
    face.position.set(x + Math.sin(a) * (r + 0.08), y, z + Math.cos(a) * (r + 0.08));
    face.rotation.y = a;
    g.add(face);
  }
}

// ---------- the ten landmarks ----------

function nationalMonument(): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(9.5, 9.5, 0.45, 32, M.stone), cyl(7.5, 7.5, 0.45, 32, M.stone, 0, 0.45));
  g.add(cyl(1.25, 1.9, 21, 4, M.white, 0, 0.9)); // the pillar
  g.add(cyl(1.5, 1.5, 0.5, 4, M.stone, 0, 21.9), sphere(0.9, M.white, 0, 23, 0));
  g.add(box(2.6, 4, 1.2, M.white, 0, 0.9, 1.6)); // sculpture group at the front
  // Curved memorial wall behind the pillar
  for (let i = -4; i <= 4; i++) {
    const a = (i * Math.PI) / 9;
    const seg = box(3.1, 3.2, 0.7, M.white, Math.sin(a) * 8.6, 0.9, -Math.cos(a) * 8.6);
    seg.rotation.y = -a;
    g.add(seg);
  }
  for (const x of [-5.2, 5.2]) g.add(box(1.2, 1.3, 2.4, M.stone, x, 0.9, 5.4)); // the two lions
  return g;
}

function church(
  L: number,
  W: number,
  o: { naveH: number; towerH: number; brick: THREE.Material; crown: boolean },
): THREE.Group {
  const g = new THREE.Group();
  const naveL = L - 9;
  const nx = 4.5; // nave sits east of the tower
  const naveW = W * 0.42;
  g.add(box(naveL, o.naveH, naveW, o.brick, nx, 0, 0));
  g.add(gable(naveL, naveW + 0.6, naveW * 0.55, M.slate, nx, o.naveH, 0));
  // Side chapels / transepts: a row of cross gables down each flank.
  const bays = o.crown ? 2 : 5;
  const bayL = (naveL * (o.crown ? 0.5 : 0.86)) / bays;
  const aisleH = o.naveH * (o.crown ? 1 : 0.62);
  for (let i = 0; i < bays; i++) {
    const x = nx + (i - (bays - 1) / 2) * (naveL / bays) * (o.crown ? 0.75 : 0.9);
    g.add(box(bayL, aisleH, W, o.brick, x, 0, 0));
    g.add(gable(W + 0.6, bayL + 0.4, bayL * 0.5, M.slate, x, aisleH, 0, true));
  }
  // Apse
  g.add(cyl(naveW / 2, naveW / 2, o.naveH, 10, o.brick, nx + naveL / 2, 0, 0));
  g.add(cyl(0, naveW / 2 + 0.3, naveW * 0.5, 10, M.slate, nx + naveL / 2, o.naveH, 0));

  // West tower
  const tx = -L / 2 + 4.5;
  const shaft = o.towerH * 0.55;
  g.add(box(9, shaft, 9, o.brick, tx, 0, 0));
  g.add(box(10, 0.9, 10, M.stone, tx, shaft, 0));
  clocks(g, 4.5, shaft - 4, 1.8, tx, 0);
  if (o.crown) {
    // Westerkerk: stacked stone stages, then the blue imperial crown.
    let y = shaft + 0.9;
    for (const [w, h] of [
      [7, o.towerH * 0.12],
      [5.4, o.towerH * 0.1],
      [4, o.towerH * 0.08],
    ]) {
      g.add(box(w, h, w, M.stone, tx, y, 0));
      y += h;
    }
    g.add(sphere(2.7, M.crown, tx, y + 2.2, 0, 1.05));
    g.add(cyl(2.9, 2.9, 0.5, 12, M.gold, tx, y + 0.3, 0));
    g.add(sphere(0.9, M.gold, tx, y + 5.6, 0));
    g.add(box(0.25, 2.4, 0.25, M.gold, tx, y + 6.2, 0), box(1.3, 0.25, 0.25, M.gold, tx, y + 7.4, 0));
  } else {
    // Oude Kerk: octagonal lantern, bulb and needle spire.
    const y = shaft + 0.9;
    g.add(cyl(3.6, 4, o.towerH * 0.14, 8, M.stone, tx, y, 0));
    g.add(sphere(3.5, M.lead, tx, y + o.towerH * 0.14 + 2, 0, 0.9));
    g.add(cyl(1.6, 1.8, o.towerH * 0.08, 8, M.stone, tx, y + o.towerH * 0.14 + 4.6, 0));
    g.add(cyl(0, 1.7, o.towerH * 0.2, 8, M.lead, tx, y + o.towerH * 0.22 + 4.6, 0));
  }
  return g;
}

function waag(L: number, W: number): THREE.Group {
  const g = new THREE.Group();
  const l = L * 0.72;
  const w = W * 0.72;
  g.add(box(l, 11, w, M.plainBrick));
  g.add(pyramid(l + 0.8, w + 0.8, 6, M.slate, 0, 11, 0));
  g.add(cyl(4.2, 4.2, 17, 8, M.plainBrick), cyl(0, 4.6, 7, 8, M.slate, 0, 17, 0)); // central hall
  // Seven turrets: four at the corners, three smaller ones.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      g.add(cyl(3.5, 3.5, 13, 14, M.plainBrick, sx * L * 0.4, 0, sz * W * 0.4));
      g.add(cyl(0, 3.9, 6.5, 14, M.slate, sx * L * 0.4, 13, sz * W * 0.4));
    }
  for (const [x, z] of [
    [0, W * 0.44],
    [0, -W * 0.44],
    [L * 0.46, 0],
  ]) {
    g.add(cyl(2, 2, 15, 12, M.plainBrick, x, 0, z), cyl(0, 2.3, 5, 12, M.slate, x, 15, z));
  }
  g.add(box(3.4, 4.2, 0.6, M.dark, -L * 0.36 - 0.1, 0, 0)); // the old gateway
  return g;
}

function montelbaanstoren(): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(5.2, 5.9, 22, 8, M.plainBrick));
  g.add(cyl(5.6, 5.6, 0.8, 8, M.stone, 0, 22, 0));
  g.add(cyl(3.9, 3.9, 8, 8, M.white, 0, 22.8, 0));
  clocks(g, 3.6, 27, 1.5);
  g.add(cyl(4.2, 4.2, 0.5, 8, M.white, 0, 30.8, 0));
  g.add(cyl(2.7, 2.7, 6, 8, M.white, 0, 31.3, 0)); // open lantern
  g.add(cyl(0.2, 2.9, 9, 8, M.lead, 0, 37.3, 0));
  g.add(sphere(0.5, M.gold, 0, 47, 0));
  g.add(box(7, 5, 6, M.plainBrick, 7.5, 0, 0), gable(7, 6.4, 2.6, M.tile, 7.5, 5, 0)); // guardhouse
  return g;
}

function centraalStation(L: number, W: number): THREE.Group {
  const g = new THREE.Group();
  const front = W / 2;
  const depth = 28;
  const z = front - depth / 2;
  // Long wings
  g.add(box(L, 15, depth, M.brick, 0, 0, z));
  g.add(gable(L, depth + 0.8, 7, M.slate, 0, 15, z));
  // Pavilions: centre, quarter points and ends
  const pavilion = (x: number, w: number, h: number, d: number) => {
    g.add(box(w, h, d, M.brick, x, 0, front - d / 2 + 2));
    g.add(pyramid(w + 0.8, d + 0.8, h * 0.4, M.slate, x, h, front - d / 2 + 2));
  };
  pavilion(0, 46, 25, 36);
  for (const s of [-1, 1]) {
    pavilion(s * L * 0.27, 26, 19, 32);
    pavilion(s * (L / 2 - 14), 28, 20, 32);
  }
  // The two towers flanking the entrance: clock on one, wind dial on the other.
  for (const s of [-1, 1]) {
    const x = s * 27;
    const tz = front - 2;
    g.add(box(9, 36, 9, M.brick, x, 0, tz), box(10, 1, 10, M.stone, x, 36, tz));
    g.add(box(6.5, 6, 6.5, M.stone, x, 37, tz), pyramid(7.5, 7.5, 11, M.slate, x, 43, tz));
    g.add(sphere(0.6, M.gold, x, 54.5, tz));
    const dial = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), M.glow);
    dial.position.set(x, 31, tz + 4.6);
    g.add(dial);
  }
  g.add(box(14, 9, 1, M.dark, 0, 0, front + 1.6)); // entrance arches
  // Arched train shed behind
  const shedDepth = Math.min(110, Math.max(55, W - depth));
  const shed = new THREE.Mesh(
    new THREE.CylinderGeometry(shedDepth / 2, shedDepth / 2, L * 0.82, 28, 1, false, 0, Math.PI),
    M.glass,
  );
  shed.rotation.z = Math.PI / 2;
  shed.scale.x = 24 / (shedDepth / 2); // local x becomes height after the rotation
  shed.position.set(0, 0, front - depth - shedDepth / 2 + 4);
  g.add(shed);
  return g;
}

function begijnhof(): THREE.Group {
  // Laid out from the map: the English church stands just south of the
  // coordinate, the lawn and the wooden house lie north of it. Here +X is
  // east and +Z is south.
  const g = new THREE.Group();
  // English Reformed Church in the middle of the court
  g.add(box(30, 12, 21, M.darkBrick, 7, 0, 7.5), gable(30, 21.6, 7, M.slate, 7, 12, 7.5));
  g.add(box(5, 21, 5, M.plainBrick, -7, 0, 8.5), cyl(0, 3.2, 8, 8, M.lead, -7, 21, 8.5));
  // Lawn
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 32), M.green);
  lawn.rotation.x = -Math.PI / 2;
  lawn.scale.set(13, 7.5, 1);
  lawn.position.set(5, 0.06, -12);
  g.add(lawn);
  // The black wooden house (Houten Huys), gable end facing the lawn
  const hx = 8;
  const hz = -19.5;
  g.add(box(5.2, 6.5, 5, M.blackWood, hx, 0, hz));
  g.add(gable(5, 5.6, 3.4, M.blackWood, hx, 6.5, hz, true));
  for (const y of [1.2, 4]) for (const x of [-1.3, 1.3]) g.add(box(1.2, 1.6, 0.15, M.white, hx + x, y, hz + 2.55));
  g.add(box(1.1, 2.2, 0.15, M.green, hx, 0, hz + 2.56));
  g.add(box(1.0, 1.0, 0.15, M.white, hx, 7.2, hz + 2.55));
  // Statue and a few trees
  g.add(cyl(0.5, 0.7, 1.2, 8, M.stone, 0, 0, -12), cyl(0.3, 0.45, 1.7, 8, M.white, 0, 1.2, -12));
  for (const [x, z] of [
    [-5, -15],
    [13, -8],
    [15, -16],
  ]) {
    g.add(cyl(0.25, 0.3, 2.5, 6, M.blackWood, x, 0, z), sphere(2.2, M.green, x, 4.2, z, 1.1));
  }
  return g;
}

function munttoren(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(9, 14, 9, M.plainBrick), box(9.8, 0.9, 9.8, M.stone, 0, 14, 0));
  g.add(box(3.6, 5, 9.4, M.dark, 0, 0, 0)); // the gate passage
  g.add(cyl(3.6, 3.9, 10, 8, M.plainBrick, 0, 14.9, 0));
  clocks(g, 3.5, 21, 1.6);
  g.add(cyl(4.1, 4.1, 0.6, 8, M.stone, 0, 24.9, 0));
  g.add(cyl(2.6, 2.6, 5.5, 8, M.white, 0, 25.5, 0)); // open carillon lantern
  g.add(sphere(2.5, M.lead, 0, 32.4, 0, 0.9));
  g.add(cyl(0.15, 1.2, 6, 8, M.lead, 0, 34, 0), sphere(0.45, M.gold, 0, 40.4, 0));
  g.add(box(12, 8.5, 8, M.plainBrick, 10.4, 0, 0), gable(12, 8.6, 3.6, M.tile, 10.4, 8.5, 0)); // guardhouse
  return g;
}

function magereBrug(): THREE.Group {
  const g = new THREE.Group();
  const len = 78;
  const half = 2.8;
  for (const s of [-1, 1]) {
    g.add(box(len, 0.16, 0.16, M.white, 0, 1.1, s * half), box(len, 0.12, 0.12, M.white, 0, 0.6, s * half));
    for (let x = -len / 2; x <= len / 2; x += 3) g.add(box(0.18, 1.2, 0.18, M.white, x, 0, s * half));
  }
  // Two lifting frames with balance beams over the central span
  for (const s of [-1, 1]) {
    const x = s * 5.2;
    for (const zz of [-half, half]) g.add(box(0.4, 9, 0.4, M.white, x, 0, zz));
    g.add(box(0.4, 0.4, half * 2 + 0.4, M.white, x, 9, 0));
    for (const zz of [-half, half]) {
      const beam = box(11.5, 0.38, 0.38, M.white, x + s * 1.4, 9.3, zz);
      beam.rotation.z = s * 0.1;
      g.add(beam);
      const chain = box(0.08, 8.4, 0.08, M.white, x - s * 4.2, 1, zz);
      g.add(chain);
    }
  }
  // The famous bulbs
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 5), M.glow, 2 * 53 + 2 * 12);
  const d = new THREE.Object3D();
  let n = 0;
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 52; i++) {
      d.position.set(-len / 2 + (i * len) / 52, 1.35, s * half);
      d.updateMatrix();
      bulbs.setMatrixAt(n++, d.matrix);
    }
    for (let i = 0; i < 12; i++) {
      d.position.set(-5.2 + (i * 10.4) / 11, 9.6, s * half);
      d.updateMatrix();
      bulbs.setMatrixAt(n++, d.matrix);
    }
  }
  bulbs.frustumCulled = false;
  g.add(bulbs);
  return g;
}

function rijksmuseum(L: number, W: number): THREE.Group {
  const g = new THREE.Group();
  const d = 26;
  const h = 18;
  const front = W / 2;
  // Four wings around two courtyards, plus the central wing over the passage
  for (const s of [-1, 1]) {
    g.add(box(L, h, d, M.brick, 0, 0, s * (front - d / 2)));
    g.add(gable(L, d + 0.8, 8, M.slate, 0, h, s * (front - d / 2)));
    g.add(box(d, h, W - 2 * d, M.brick, s * (L / 2 - d / 2), 0, 0));
    g.add(gable(W - 2 * d, d + 0.8, 8, M.slate, s * (L / 2 - d / 2), h, 0, true));
  }
  g.add(box(40, h + 3, W - d, M.brick), gable(W - d, 40.8, 10, M.slate, 0, h + 3, 0, true));
  // Corner pavilions with steep roofs
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (L / 2 - 15);
      const z = sz * (front - 15);
      g.add(box(31, 22, 31, M.brick, x, 0, z), pyramid(32, 32, 13, M.slate, x, 22, z));
    }
  // Gatehouses front and back, each with a pair of towers and the cycle passage between
  for (const s of [-1, 1]) {
    const z = s * (front - 14);
    g.add(box(46, 25, 30, M.brick, 0, 0, z), pyramid(47, 31, 11, M.slate, 0, 25, z));
    for (const sx of [-1, 1]) {
      const tz = s * (front - 5);
      g.add(box(9, 34, 9, M.brick, sx * 17, 0, tz), box(9.8, 0.8, 9.8, M.stone, sx * 17, 34, tz));
      g.add(pyramid(9.6, 9.6, 13, M.slate, sx * 17, 34.8, tz), sphere(0.5, M.gold, sx * 17, 48.2, tz));
    }
    for (const sx of [-1, 0, 1]) g.add(box(6.5, 8, 1.2, M.dark, sx * 8.2, 0, s * (front + 1.2)));
  }
  return g;
}

// ---------- placement ----------

interface Spec {
  /** Approximate compass bearing of the long axis; snapped to the local building grid at run time. */
  bearing: number;
  length: number;
  width: number;
  build: (L: number, W: number) => THREE.Group;
  /** Model origin relative to the landmark coordinate, in model axes [x, z], metres. */
  shift?: [number, number];
  /** Suppress generated buildings inside the model's rectangle. */
  clearRect?: boolean;
  /** Suppress generated buildings whose centre is this close to the model origin. */
  clear?: number;
  /** Which way the model's ends must point. */
  orient?: 'towerWest' | 'frontToCity';
  /** Take the direction from the nearest street instead (bridges). */
  fromStreet?: boolean;
  /** Keep the given bearing as is. */
  fixed?: boolean;
}

// Same order as LANDMARKS in config.ts.
const SPECS: Spec[] = [
  { bearing: 0, length: 20, width: 20, build: nationalMonument, clear: 10, fixed: true },
  {
    bearing: 86,
    length: 70,
    width: 42,
    build: (L, W) => church(L, W, { naveH: 17, towerH: 67, brick: M.darkBrick, crown: false }),
    clearRect: true,
    orient: 'towerWest',
  },
  { bearing: 63, length: 32, width: 28, build: waag, clearRect: true },
  { bearing: 0, length: 14, width: 14, build: montelbaanstoren, clear: 10, fixed: true },
  {
    bearing: 120,
    length: 210,
    width: 100,
    build: centraalStation,
    shift: [0, 37], // the coordinate lies among the platforms; the facade is ~87 m towards the city
    clearRect: true,
    orient: 'frontToCity',
  },
  {
    bearing: 82,
    length: 62,
    width: 30,
    build: (L, W) => church(L, W, { naveH: 22, towerH: 85, brick: M.brick, crown: true }),
    shift: [-6, 0],
    clearRect: true,
    orient: 'towerWest',
  },
  { bearing: 90, length: 44, width: 44, build: begijnhof, clear: 14, fixed: true },
  { bearing: 82, length: 26, width: 12, build: munttoren, clear: 13 },
  { bearing: 65, length: 78, width: 6, build: magereBrug, fromStreet: true },
  { bearing: 122, length: 215, width: 135, build: rijksmuseum, clearRect: true, orient: 'frontToCity' },
];

const bearingToAngle = (deg: number) => ((90 - deg) * Math.PI) / 180;

interface Placed {
  origin: Vec;
  angle: number;
  model: THREE.Group;
}

export class Landmarks {
  readonly group = new THREE.Group();
  private points = LANDMARKS.map((l) => toLocal(l.lng, l.lat));
  private placed: Placed[] = [];
  private snapped: boolean[];
  /** Length-weighted sums of cos/sin(4θ) over nearby wall directions, per landmark. */
  private grid = SPECS.map(() => ({ c: 0, s: 0, n: 0 }));

  constructor(streets: StreetIndex) {
    this.snapped = SPECS.map((spec) => !!spec.fixed || !!spec.fromStreet);
    SPECS.forEach((spec, i) => {
      let angle = bearingToAngle(spec.bearing);
      if (spec.fromStreet) angle = streets.directionNear(this.points[i].x, this.points[i].y) ?? angle;
      this.place(i, angle);
    });
  }

  private place(i: number, rawAngle: number): void {
    const spec = SPECS[i];
    const p = this.points[i];
    let angle = rawAngle;
    if (spec.orient === 'towerWest' && Math.cos(angle) < 0) angle += Math.PI; // tower sits at -X
    if (spec.orient === 'frontToCity') {
      // +Z of the model, in map terms, is (sin a, -cos a); it should face Dam Square (the origin).
      if (-p.x * Math.sin(angle) + p.y * Math.cos(angle) < 0) angle += Math.PI;
    }
    const [sx, sz] = spec.shift ?? [0, 0];
    const origin = {
      x: p.x + sx * Math.cos(angle) + sz * Math.sin(angle),
      y: p.y + sx * Math.sin(angle) - sz * Math.cos(angle),
    };
    const old = this.placed[i];
    if (old) this.group.remove(old.model);
    const model = old?.model ?? spec.build(spec.length, spec.width);
    model.position.set(origin.x, 0, -origin.y);
    model.rotation.y = angle;
    this.group.add(model);
    this.placed[i] = { origin, angle, model };
  }

  /**
   * Called for every generated building near the player. Returns true if the
   * building stands where a landmark model goes and must not be generated.
   */
  claims(ring: Vec[]): boolean {
    let cx = 0;
    let cy = 0;
    for (const v of ring) {
      cx += v.x;
      cy += v.y;
    }
    cx /= ring.length;
    cy /= ring.length;

    for (let i = 0; i < SPECS.length; i++) {
      const spec = SPECS[i];
      const { origin, angle } = this.placed[i];
      const dx = cx - origin.x;
      const dy = cy - origin.y;
      const d = Math.hypot(dx, dy);
      const reach = Math.max(spec.length, spec.width) / 2 + 25;
      if (d > reach) continue;

      if (!this.snapped[i]) {
        // Learn the direction of the walls around here (mod 90 degrees).
        const acc = this.grid[i];
        for (let k = 0; k < ring.length; k++) {
          const a = ring[k];
          const b = ring[(k + 1) % ring.length];
          const l = Math.hypot(b.x - a.x, b.y - a.y);
          if (l < 2) continue;
          const t = 4 * Math.atan2(b.y - a.y, b.x - a.x);
          acc.c += l * Math.cos(t);
          acc.s += l * Math.sin(t);
          acc.n += l;
        }
      }

      if (spec.clear && d < spec.clear) return true;
      if (spec.clearRect) {
        const u = dx * Math.cos(angle) + dy * Math.sin(angle);
        const v = dx * Math.sin(angle) - dy * Math.cos(angle);
        if (Math.abs(u) <= spec.length / 2 + 2 && Math.abs(v) <= spec.width / 2 + 2) return true;
      }
    }
    return false;
  }

  /**
   * After a batch of buildings: turn each model to match the real walls around
   * it. Returns true if a model moved, so the buildings can be regenerated.
   */
  settle(): boolean {
    let moved = false;
    for (let i = 0; i < SPECS.length; i++) {
      const acc = this.grid[i];
      if (this.snapped[i] || acc.n < 150) continue;
      this.snapped[i] = true;
      if (Math.hypot(acc.c, acc.s) < acc.n * 0.25) continue; // no clear grid here: keep the default
      const base = Math.atan2(acc.s, acc.c) / 4;
      const want = bearingToAngle(SPECS[i].bearing);
      // Nearest of the four grid directions to the hand-set bearing.
      const snappedAngle = base + Math.round((want - base) / (Math.PI / 2)) * (Math.PI / 2);
      this.place(i, snappedAngle);
      moved = true;
    }
    return moved;
  }
}
