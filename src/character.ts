import * as THREE from 'three';
import { CHARACTER_SCALE } from './config';
import { ease, type Vec } from './geo';
import type { Mode } from './rules';

const COLORS = {
  jacket: 0xff7a1a,
  trousers: 0xdfe6f5,
  skin: 0xf3c9a2,
  cap: 0x35e0ff,
  shoes: 0xffffff,
  gold: 0xffc93c,
  goldDark: 0xb37a12,
};

const mat = (color: number, emissive = 0.25) =>
  new THREE.MeshLambertMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
    side: THREE.DoubleSide,
  });

/** A limb segment hanging down from its pivot. */
function limb(radius: number, length: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length - radius * 2, 3, 8), material);
  m.position.y = -length / 2;
  return m;
}

interface Pose {
  lean: number; // torso pitch, negative = forward
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  shL: number;
  shR: number;
  elL: number;
  elR: number;
  lift: number; // body height offset
}
const POSE_KEYS: (keyof Pose)[] = [
  'lean',
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'shL',
  'shR',
  'elL',
  'elR',
  'lift',
];

const BEND = (65 * Math.PI) / 180;
const HIP_Y = 0.94;

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Scene-space position for a local-metres point (x east, y north). */
export function place(o: THREE.Object3D, p: Vec): void {
  o.position.x = p.x;
  o.position.z = -p.y;
}

export class Character {
  readonly root = new THREE.Group();
  readonly ring: THREE.Mesh;
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private chest: THREE.Mesh;
  private hip = { L: new THREE.Group(), R: new THREE.Group() };
  private knee = { L: new THREE.Group(), R: new THREE.Group() };
  private shoulder = { L: new THREE.Group(), R: new THREE.Group() };
  private elbow = { L: new THREE.Group(), R: new THREE.Group() };
  private pose: Pose = { lean: 0, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shL: 0, shR: 0, elL: 0, elR: 0, lift: 0 };
  private phase = 0;
  private label: THREE.Mesh | null = null;
  private jacket: THREE.MeshLambertMaterial;
  private time = 0;

  constructor(jacketColor: number = COLORS.jacket) {
    const jacket = mat(jacketColor, 0.45);
    this.jacket = jacket;
    const trousers = mat(COLORS.trousers);
    const skin = mat(COLORS.skin);

    // Soft round shadow.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 24),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(0,0,0,0.6)', 'rgba(0,0,0,0)'),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.renderOrder = 1;
    this.root.add(shadow);

    // Glowing "dig here" ring.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.35, 48),
      new THREE.MeshBasicMaterial({
        color: COLORS.gold,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    this.root.add(this.ring);

    this.root.scale.setScalar(CHARACTER_SCALE);
    this.body.position.y = HIP_Y;
    this.root.add(this.body);

    // Torso, head and arms pivot together at the hips.
    this.body.add(this.torso);
    this.chest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.25), jacket);
    this.chest.position.y = 0.3;
    this.torso.add(this.chest);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), skin);
    neck.position.y = 0.61;
    this.torso.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12), skin);
    head.position.y = 0.74;
    this.torso.add(head);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.132, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      mat(COLORS.cap, 0.5),
    );
    cap.position.y = 0.755;
    this.torso.add(cap);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.12), mat(COLORS.cap, 0.5));
    peak.position.set(0, 0.765, -0.16);
    this.torso.add(peak);

    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? -1 : 1;

      const sh = this.shoulder[side];
      sh.position.set(sx * 0.275, 0.54, 0);
      sh.add(limb(0.06, 0.32, jacket));
      const el = this.elbow[side];
      el.position.y = -0.3;
      el.add(limb(0.052, 0.3, jacket));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin);
      hand.position.y = -0.32;
      el.add(hand);
      sh.add(el);
      this.torso.add(sh);

      const hp = this.hip[side];
      hp.position.set(sx * 0.11, 0, 0);
      hp.add(limb(0.085, 0.47, trousers));
      const kn = this.knee[side];
      kn.position.y = -0.45;
      kn.add(limb(0.07, 0.47, trousers));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.26), mat(COLORS.shoes));
      foot.position.set(0, -0.455, -0.06);
      kn.add(foot);
      hp.add(kn);
      this.body.add(hp);
    }
  }

  setJacket(color: number): void {
    this.jacket.color.setHex(color);
    this.jacket.emissive.setHex(color);
  }

  /** Floating name above the head (used for other players). */
  setLabel(name: string, color: string): void {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '600 34px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = Math.min(244, g.measureText(name).width + 28);
    g.fillStyle = 'rgba(10,19,48,0.8)';
    g.beginPath();
    g.roundRect(128 - w / 2, 8, w, 48, 12);
    g.fill();
    g.fillStyle = color;
    g.fillText(name, 128, 34, 220);
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.65),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(c),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.label.position.y = 2.5;
    this.label.renderOrder = 5;
    this.root.add(this.label);
  }

  /** Turn the name tag toward the camera. */
  faceLabel(cameraBearing: number): void {
    if (this.label) this.label.rotation.y = (-cameraBearing * Math.PI) / 180 - this.root.rotation.y;
  }

  private target(mode: Mode, moving: boolean): Pose {
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const t = this.time;
    switch (mode) {
      case 'walking': {
        const a = 0.55;
        return {
          lean: -0.06,
          hipL: a * s,
          hipR: -a * s,
          kneeL: -0.1 - 0.7 * Math.max(0, c),
          kneeR: -0.1 - 0.7 * Math.max(0, -c),
          shL: -0.5 * s,
          shR: 0.5 * s,
          elL: 0.3,
          elR: 0.3,
          lift: 0.02 * Math.abs(c),
        };
      }
      case 'running': {
        const a = 1.0;
        return {
          lean: -0.32,
          hipL: 0.15 + a * s,
          hipR: 0.15 - a * s,
          kneeL: -0.3 - 1.3 * Math.max(0, c),
          kneeR: -0.3 - 1.3 * Math.max(0, -c),
          shL: -1.0 * s,
          shR: 1.0 * s,
          elL: 1.5,
          elR: 1.5,
          lift: 0.09 * Math.abs(s) - 0.02,
        };
      }
      case 'bent': {
        const sh = moving ? 0.2 * s : 0;
        return {
          lean: -BEND,
          hipL: 0.55 + sh,
          hipR: 0.55 - sh,
          kneeL: -0.95 - (moving ? 0.15 * Math.max(0, c) : 0),
          kneeR: -0.95 - (moving ? 0.15 * Math.max(0, -c) : 0),
          // Shoulders cancel the torso lean so the arms hang straight down.
          shL: BEND + 0.08 * Math.sin(t * 1.3) - sh * 0.5,
          shR: BEND - 0.08 * Math.sin(t * 1.3) + sh * 0.5,
          elL: 0.08,
          elR: 0.08,
          lift: -0.11,
        };
      }
      case 'digging': {
        const scoop = Math.sin(t * Math.PI * 2 * 3.2);
        return {
          lean: -BEND - 0.08 * scoop,
          hipL: 0.6,
          hipR: 0.6,
          kneeL: -1.05,
          kneeR: -1.05,
          shL: BEND + 0.15 + 0.5 * scoop,
          shR: BEND + 0.15 + 0.5 * Math.sin(t * Math.PI * 2 * 3.2 + 0.6),
          elL: 0.55 - 0.45 * scoop,
          elR: 0.55 - 0.45 * scoop,
          lift: -0.13,
        };
      }
      default: {
        const breath = Math.sin(t * 1.7);
        return {
          lean: -0.02 - 0.012 * breath,
          hipL: 0,
          hipR: 0,
          kneeL: 0,
          kneeR: 0,
          shL: 0.04 + 0.03 * breath,
          shR: 0.04 + 0.03 * breath,
          elL: 0.12,
          elR: 0.12,
          lift: 0.006 * breath,
        };
      }
    }
  }

  /**
   * @param direction +1 moving forward, -1 backward, 0 still
   * @param heading compass degrees
   */
  update(dt: number, mode: Mode, pos: Vec, heading: number, direction: number, ringOn: boolean): void {
    this.time += dt;
    const cadence = mode === 'running' ? 3.1 : mode === 'bent' ? 2.6 : 2.0; // strides per second
    if (direction !== 0) this.phase += dt * cadence * Math.PI * 2 * direction;

    const target = this.target(mode, direction !== 0);
    const k = ease(mode === 'digging' ? 30 : 16, dt);
    for (const key of POSE_KEYS) this.pose[key] += (target[key] - this.pose[key]) * k;
    const p = this.pose;

    place(this.root, pos);
    this.root.rotation.y = (-heading * Math.PI) / 180;
    this.body.position.y = HIP_Y + p.lift;
    this.torso.rotation.x = p.lean;
    this.chest.scale.y = 1 + 0.02 * Math.sin(this.time * 1.7); // breathing
    this.hip.L.rotation.x = p.hipL;
    this.hip.R.rotation.x = p.hipR;
    this.knee.L.rotation.x = p.kneeL;
    this.knee.R.rotation.x = p.kneeR;
    this.shoulder.L.rotation.x = p.shL;
    this.shoulder.R.rotation.x = p.shR;
    this.elbow.L.rotation.x = p.elL;
    this.elbow.R.rotation.x = p.elR;

    this.ring.visible = ringOn;
    if (ringOn) {
      const pulse = 1 + 0.12 * Math.sin(this.time * 6);
      this.ring.scale.set(pulse, pulse, 1);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * Math.sin(this.time * 6);
    }
  }
}

/** A small golden chest left where a cache was dug up. */
export function makeChest(p: Vec): THREE.Group {
  const g = new THREE.Group();
  const gold = mat(COLORS.gold, 0.6);
  const dark = mat(COLORS.goldDark, 0.4);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.6), gold);
  base.position.y = 0.225;
  g.add(base);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12, 1, false, 0, Math.PI), gold);
  lid.rotation.z = Math.PI / 2;
  lid.rotation.y = Math.PI / 2;
  lid.position.y = 0.45;
  g.add(lid);
  for (const x of [-0.3, 0.3]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.64), dark);
    band.position.set(x, 0.25, 0);
    g.add(band);
  }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.06), dark);
  lock.position.set(0, 0.4, -0.32);
  g.add(lock);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 24),
    new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(255,201,60,0.55)', 'rgba(255,201,60,0)'),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.04;
  g.add(glow);
  place(g, p);
  g.rotation.y = Math.random() * Math.PI;
  return g;
}

/** A lit, empty scene. */
export function makeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
  sun.position.set(-40, 80, 30);
  scene.add(sun);
  return scene;
}
