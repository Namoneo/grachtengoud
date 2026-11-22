import {
  AttributionControl,
  Map as MlMap,
  setWorkerUrl,
  type GeoJSONSource,
  type LayerSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Feature, FeatureCollection } from 'geojson';
import { HINT_RADIUS, START, STYLE_URL } from './config';
import { toLngLat, type Vec } from './geo';

setWorkerUrl(workerUrl);

const C = {
  land: '#0a1330',
  landAlt: '#0d1a3a',
  park: '#0e2438',
  water: '#2f7fe0',
  street: '#9ba7ca',
  path: '#7482ab',
  casing: '#141f44',
  rail: '#3a4670',
  dim: '#243056',
  label: '#9aa8cc',
  waterLabel: '#bcd8ff',
  wall: '#26314f',
  roof: '#3b4869',
};

type AnyLayer = LayerSpecification & { 'source-layer'?: string; paint?: Record<string, unknown> };

function pick(paint: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (paint && paint[k] !== undefined) out[k] = paint[k];
  return out;
}

/** Line width in pixels that covers `metres` on the ground at Amsterdam's latitude. */
function groundWidth(metres: number): unknown {
  const pxPerMetre = (zoom: number) => 2 ** zoom / (78271.52 * Math.cos((START.lat * Math.PI) / 180));
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    13,
    Math.max(1, metres * pxPerMetre(13)),
    22,
    metres * pxPerMetre(22),
  ];
}

/** Repaint the Liberty style for night and make sure 3D buildings exist. */
export function nightStyle(style: StyleSpecification): StyleSpecification {
  const layers: AnyLayer[] = [];
  let buildingSource: string | undefined;
  let wallId = 'gg-buildings';

  for (const layer of style.layers as AnyLayer[]) {
    const sl = layer['source-layer'] ?? '';
    const id = layer.id.toLowerCase();
    if (sl === 'building' && 'source' in layer) buildingSource = layer.source as string;

    switch (layer.type) {
      case 'background':
        layers.push({ ...layer, paint: { 'background-color': C.land } } as AnyLayer);
        break;
      case 'fill': {
        if (sl === 'building') break; // replaced by the extrusion below
        let color = C.landAlt;
        let opacity = 0.7;
        if (sl === 'water') {
          color = C.water;
          opacity = 1;
        } else if (sl === 'park' || /wood|grass|park|forest|green/.test(id)) {
          color = C.park;
        } else if (sl === 'transportation') {
          color = id.includes('bridge') || id.includes('pedestrian') ? '#6f7da3' : C.dim;
          opacity = 0.9;
        }
        layers.push({
          ...layer,
          paint: { 'fill-color': color, 'fill-opacity': opacity, 'fill-antialias': true },
        } as AnyLayer);
        break;
      }
      case 'line': {
        const keep = pick(layer.paint, ['line-width', 'line-dasharray', 'line-gap-width', 'line-offset']);
        let color = C.dim;
        let opacity = 0.8;
        if (sl === 'waterway') {
          color = C.water;
          opacity = 1;
        } else if (sl === 'transportation') {
          if (/rail|transit|tram/.test(id)) {
            color = C.rail;
            opacity = 0.6;
          } else if (id.includes('casing')) {
            color = C.casing;
            opacity = 1;
          } else if (/path|pedestrian|steps|track/.test(id)) {
            color = C.path;
            opacity = id.includes('tunnel') ? 0.35 : 1;
          } else {
            color = C.street;
            opacity = id.includes('tunnel') ? 0.35 : 1;
          }
          // Draw streets at real-world width so the walkable strip reads at chase-camera zoom.
          if (!/rail|transit|tram/.test(id)) {
            const metres = /motorway|trunk_primary/.test(id)
              ? 14
              : id.includes('secondary_tertiary')
                ? 12
                : /minor|street/.test(id)
                  ? 9
                  : id.includes('link')
                    ? 8
                    : id.includes('service_track')
                      ? 6
                      : 4;
            keep['line-width'] = groundWidth(metres + (id.includes('casing') ? 1.5 : 0));
            delete keep['line-dasharray'];
            delete keep['line-gap-width'];
          }
        } else if (sl === 'boundary') {
          opacity = 0.3;
        }
        layers.push({
          ...layer,
          paint: { ...keep, 'line-color': color, 'line-opacity': opacity },
        } as AnyLayer);
        break;
      }
      case 'symbol': {
        if (sl === 'poi' || id.includes('shield')) break; // no shop / business icons, no route shields
        const water = sl.startsWith('water');
        layers.push({
          ...layer,
          paint: {
            'text-color': water ? C.waterLabel : C.label,
            'text-halo-color': water ? '#1b4f99' : C.land,
            'text-halo-width': 1.2,
            'text-opacity': water ? 0.7 : 0.55,
            'icon-opacity': 0.3,
          },
        } as AnyLayer);
        break;
      }
      case 'fill-extrusion':
        if (sl === 'building') wallId = layer.id; // restyled below, in place of the stock paint
        break;
      default:
        break; // raster relief is dropped
    }
  }

  const source =
    buildingSource ??
    Object.keys(style.sources).find((k) => style.sources[k].type === 'vector') ??
    'openmaptiles';
  const firstSymbol = layers.findIndex((l) => l.type === 'symbol');
  const at = firstSymbol < 0 ? layers.length : firstSymbol;
  const height = ['coalesce', ['get', 'render_height'], 8];
  const base = ['coalesce', ['get', 'render_min_height'], 0];
  layers.splice(
    at,
    0,
    {
      id: wallId,
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': C.wall,
        'fill-extrusion-height': height,
        'fill-extrusion-base': base,
        'fill-extrusion-opacity': 0.9,
        'fill-extrusion-vertical-gradient': true,
      },
    } as unknown as AnyLayer,
    {
      // A thin cap on every building gives the roofs their lighter tone.
      id: 'gg-roofs',
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': C.roof,
        'fill-extrusion-height': ['+', height, 0.35],
        'fill-extrusion-base': height,
        'fill-extrusion-opacity': 0.9,
        'fill-extrusion-vertical-gradient': false,
      },
    } as unknown as AnyLayer,
  );

  return {
    ...style,
    layers: layers as LayerSpecification[],
    // Dark sky and fog so the far distance fades out instead of ending abruptly.
    sky: {
      'sky-color': '#040818',
      'horizon-color': '#1a2a5c',
      'fog-color': '#0a1330',
      'fog-ground-blend': 0.55,
      'horizon-fog-blend': 0.9,
      'sky-horizon-blend': 0.9,
      'atmosphere-blend': 0,
    },
    metadata: { ...(style.metadata as object), 'gg:buildingSource': source, 'gg:wallId': wallId },
  } as StyleSpecification;
}

export interface Dot {
  pos: Vec;
  color: string;
}

export interface GameMap {
  map: MlMap;
  /** Vector source that carries the `building` layer. */
  buildingSource: string;
  setPlayer(p: Vec): void;
  setOthers(dots: Dot[]): void;
  setOverview(on: boolean): void;
  setHints(centres: Vec[]): void;
  setChests(points: Vec[]): void;
}

const point = (p: Vec) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'Point' as const, coordinates: toLngLat(p.x, p.y) },
});
const collection = (features: Feature[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

function ring(c: Vec, r: number): Feature {
  const coords: [number, number][] = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    coords.push(toLngLat(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
}

/**
 * Create the map. Rejects with a readable message when the style cannot be
 * loaded; `onTileTrouble` fires if tiles keep failing afterwards.
 */
export async function createMap(
  container: HTMLElement,
  onTileTrouble: (msg: string | null) => void,
): Promise<GameMap> {
  let style: StyleSpecification;
  try {
    const res = await fetch(STYLE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    style = nightStyle((await res.json()) as StyleSpecification);
  } catch (e) {
    throw new Error(`The map style could not be loaded from OpenFreeMap (${(e as Error).message}).`);
  }

  const map = new MlMap({
    container,
    style,
    center: [START.lng, START.lat],
    zoom: 19.5,
    pitch: 72,
    bearing: 0,
    maxPitch: 85,
    maxZoom: 23,
    dragPan: false,
    scrollZoom: false,
    dragRotate: false,
    keyboard: false,
    doubleClickZoom: false,
    touchZoomRotate: false,
    boxZoom: false,
    touchPitch: false,
    attributionControl: false,
    fadeDuration: 0,
    canvasContextAttributes: { antialias: true },
  });
  map.addControl(new AttributionControl({ compact: false }), 'top-right');

  await new Promise<void>((resolve, reject) => {
    // A tab opened in the background does not render, so only time out while visible.
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        if (document.hidden) arm();
        else reject(new Error('The map took too long to load. Check your connection and reload.'));
      }, 25000);
    };
    arm();
    map.once('load', () => {
      window.clearTimeout(timer);
      resolve();
    });
    map.once('error', (e) => {
      if (map.loaded()) return;
      window.clearTimeout(timer);
      reject(new Error(`The map could not start (${e.error?.message ?? 'unknown error'}).`));
    });
  });

  // After start-up: individual tile hiccups are normal, a streak of them is not.
  let failures = 0;
  map.on('error', () => {
    if (++failures === 6) onTileTrouble('Map tiles are not loading. Check your connection.');
  });
  map.on('data', (e) => {
    if (e.dataType === 'source' && 'tile' in e && e.tile) {
      if (failures >= 6) onTileTrouble(null);
      failures = 0;
    }
  });

  map.addSource('gg-hints', { type: 'geojson', data: collection([]) });
  map.addSource('gg-chests', { type: 'geojson', data: collection([]) });
  map.addSource('gg-player', { type: 'geojson', data: collection([]) });
  map.addLayer({
    id: 'gg-hints',
    type: 'line',
    source: 'gg-hints',
    paint: { 'line-color': '#ff5fa8', 'line-width': 3, 'line-dasharray': [2, 2], 'line-opacity': 0.95 },
  });
  map.addLayer({
    id: 'gg-chests',
    type: 'circle',
    source: 'gg-chests',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 6,
      'circle-color': '#ffc93c',
      'circle-stroke-color': '#0a1330',
      'circle-stroke-width': 2,
    },
  });
  map.addSource('gg-others', { type: 'geojson', data: collection([]) });
  map.addLayer({
    id: 'gg-others',
    type: 'circle',
    source: 'gg-others',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 7,
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#0a1330',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'gg-player',
    type: 'circle',
    source: 'gg-player',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 8,
      'circle-color': '#ff7a1a',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });

  const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;
  let overview = false;
  const meta = (style.metadata ?? {}) as Record<string, string>;
  const wallId = meta['gg:wallId'];
  // Street view draws its own detailed buildings; the plain blocks are for the city map.
  const flatBlocks = (on: boolean) => {
    for (const id of [wallId, 'gg-roofs']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  };
  flatBlocks(false);

  return {
    map,
    buildingSource: meta['gg:buildingSource'],
    setOthers(dots) {
      if (!overview) return; // the layer is hidden in street view
      src('gg-others')?.setData(
        collection(dots.map((d) => ({ ...point(d.pos), properties: { color: d.color } }))),
      );
    },
    setPlayer(p) {
      if (overview) src('gg-player')?.setData(collection([point(p)]));
    },
    setOverview(on) {
      overview = on;
      const v = on ? 'visible' : 'none';
      for (const id of ['gg-player', 'gg-chests', 'gg-others']) map.setLayoutProperty(id, 'visibility', v);
      flatBlocks(on);
    },
    setHints(centres) {
      src('gg-hints')?.setData(collection(centres.map((c) => ring(c, HINT_RADIUS))));
    },
    setChests(points) {
      src('gg-chests')?.setData(collection(points.map(point)));
    },
  };
}
