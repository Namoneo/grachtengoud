import { MercatorCoordinate, type CustomLayerInterface, type Map as MlMap } from 'maplibre-gl';
import * as THREE from 'three';
import { START } from './config';

/**
 * Two three.js scenes drawn inside the map, world first, then actors on top. Scene units are metres with the
 * origin at Dam Square: +x east, +y up, +z south.
 */
export function createSceneLayer(
  world: THREE.Scene,
  actors: THREE.Scene,
  prepare: (projection: THREE.Matrix4, width: number, height: number) => void = () => {},
): CustomLayerInterface {
  const anchor = MercatorCoordinate.fromLngLat([START.lng, START.lat], 0);
  const s = anchor.meterInMercatorCoordinateUnits();
  const model = new THREE.Matrix4()
    .makeTranslation(anchor.x, anchor.y, anchor.z)
    .scale(new THREE.Vector3(s, -s, s))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

  const camera = new THREE.Camera();
  let renderer: THREE.WebGLRenderer | null = null;

  return {
    id: 'gg-scene',
    type: 'custom',
    renderingMode: '3d',
    onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl, args) {
      if (!renderer) return;
      const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as number[]);
      camera.projectionMatrix = m.multiply(model);
      prepare(camera.projectionMatrix, _gl.drawingBufferWidth, _gl.drawingBufferHeight);
      renderer.resetState();
      renderer.render(world, camera); // buildings, coins, chests: depth-tested against the map
      // Then a clean depth buffer, so hunters are never lost behind a gable.
      renderer.clearDepth();
      renderer.render(actors, camera);
      renderer.resetState();
    },
    onRemove() {
      renderer = null;
    },
  };
}
