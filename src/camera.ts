import type { Map as MlMap } from 'maplibre-gl';
import { CAMERA, type CameraView } from './config';
import { angleDiff, ease, norm360, toLngLat, type Vec } from './geo';
import type { Mode } from './rules';

/**
 * Chase camera with two positions (far: high and back; close: over the
 * shoulder), plus the top-down city overview.
 */
export class ChaseCamera {
  overview = false;
  view: CameraView = 'close';
  bearing = 0;
  private zoom = CAMERA.close.walk.zoom;
  private pitch = CAMERA.close.walk.pitch;
  private pad = 1 / 3;

  constructor(private map: MlMap) {}

  snapTo(heading: number): void {
    this.bearing = heading;
    this.zoom = CAMERA[this.view].walk.zoom;
    this.pitch = CAMERA[this.view].walk.pitch;
  }

  update(dt: number, pos: Vec, heading: number, mode: Mode): void {
    const set = CAMERA[this.view];
    const t = this.overview
      ? CAMERA.overview
      : mode === 'running'
        ? set.run
        : mode === 'bent' || mode === 'digging'
          ? set.bent
          : set.walk;
    const k = ease(this.overview ? 7 : 4, dt);
    this.zoom += (t.zoom - this.zoom) * k;
    this.pitch += (t.pitch - this.pitch) * k;
    this.bearing = norm360(
      this.bearing + angleDiff(this.bearing, this.overview ? 0 : heading) * ease(6, dt),
    );
    // Top padding pushes the map centre (the character) into the lower third.
    this.pad += ((this.overview ? 0 : 1 / 3) - this.pad) * k;
    const h = this.map.getContainer().clientHeight;
    this.map.jumpTo({
      center: toLngLat(pos.x, pos.y),
      zoom: this.zoom,
      pitch: this.pitch,
      bearing: this.bearing,
      padding: { top: h * this.pad, bottom: 0, left: 0, right: 0 },
    });
  }

  /** True once the camera has pulled far enough out that only the flat city map makes sense. */
  get high(): boolean {
    return this.zoom < 17;
  }
}
