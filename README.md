# Grachtengoud

A third-person treasure hunt through the real streets of central Amsterdam, on a free 3D map.
Ten caches are buried near ten landmarks. Solve the riddles, follow the detector, dig them up,
and recover the pages of the Van der Meer log.

No API keys, no sign-ups, no backend.

## Play

- `W` `A` `S` `D` or arrows to walk and turn, `Shift` to run
- `C` to bend over, `Space` or `E` to dig
- `V` camera, `M` city map, `L` logbook, `K` controls
- Free hunt, a daily hunt (same layout for everyone each day), or a peer-to-peer race for up to six players

## Develop

```bash
npm install
npm run dev
```

`npm test` runs the unit tests and `npm run build` writes the static site to `dist/`.
`npm run fetch-streets` regenerates `public/streets.json` from OpenStreetMap.

## Credits

Map tiles and style: [OpenFreeMap](https://openfreemap.org), [OpenMapTiles](https://openmaptiles.org).
Map and street data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
Built with [MapLibre GL JS](https://maplibre.org), [three.js](https://threejs.org) and [PeerJS](https://peerjs.com).
