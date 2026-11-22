import * as THREE from 'three';
import { COINS } from './config';
import type { Vec } from './geo';

/** All street coins as one instanced mesh; only the ones near the player are drawn. */
export class CoinField {
  readonly mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private time = 0;

  constructor() {
    const geometry = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 20);
    geometry.rotateX(Math.PI / 2); // stand the coin on its edge
    const material = new THREE.MeshLambertMaterial({
      color: 0xffc93c,
      emissive: 0xffa400,
      emissiveIntensity: 0.7,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, COINS.count);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  update(dt: number, coins: Vec[], taken: boolean[], player: Vec): void {
    this.time += dt;
    const r2 = COINS.drawRange * COINS.drawRange;
    let n = 0;
    for (let i = 0; i < coins.length && n < COINS.count; i++) {
      if (taken[i]) continue;
      const c = coins[i];
      const dx = c.x - player.x;
      const dy = c.y - player.y;
      if (dx * dx + dy * dy > r2) continue;
      this.dummy.position.set(c.x, 1.0 + 0.15 * Math.sin(this.time * 3 + i), -c.y);
      this.dummy.rotation.y = this.time * 2.5 + i;
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n++, this.dummy.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
