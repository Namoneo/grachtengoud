// One-off: download the walkable network from Overpass and write public/streets.json.
// Run with: npm run fetch-streets
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertOverpass, overpassQuery } from '../src/overpass.ts';

const BBOX = { south: 52.348, west: 4.862, north: 52.386, east: 4.925 };
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/streets.json');

let json: { elements: never[] } | null = null;
for (const url of ENDPOINTS) {
  try {
    console.log('Querying', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'grachtengoud-build-script',
      },
      body: 'data=' + encodeURIComponent(overpassQuery(BBOX)),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    json = await res.json();
    break;
  } catch (e) {
    console.warn('Failed:', (e as Error).message);
  }
}
if (!json) {
  console.error('All Overpass endpoints failed.');
  process.exit(1);
}

const data = convertOverpass(json.elements, BBOX);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data));
const pts = data.lines.reduce((n, l) => n + l.length / 2, 0);
console.log(`Wrote ${out}: ${data.lines.length} lines, ${data.polys.length} polygons, ${pts} points`);
