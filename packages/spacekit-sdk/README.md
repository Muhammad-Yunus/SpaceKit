# `@spacekit/sdk`

Official lightweight JavaScript / TypeScript SDK for integrating **SpaceKit** 3D floor plans, GeoJSON building footprints, and spatial IoT entities into web apps and Node.js services.

## Installation

### Option 1 — Install downloaded `.tgz` package (npm / pnpm / yarn)
Download `spacekit-sdk-1.0.0.tgz` from your SpaceKit **Developers** dashboard (or `/sdk/spacekit-sdk-1.0.0.tgz`), then run:

```bash
npm install ./spacekit-sdk-1.0.0.tgz
```

### Option 2 — Direct ES Module import in browser or Deno
```js
import { SpaceKit } from 'https://<YOUR_SPACEKIT_URL>/sdk/spacekit-sdk.js';
```

## Quick Start

```ts
import { SpaceKit } from '@spacekit/sdk';

const space = new SpaceKit.Space({
  spaceId: 'spc_your_space_id',
  apiKey: 'sk_live_your_api_key',
  endpoint: 'https://<YOUR_SPACEKIT_URL>/api/v1',
});

// 1. Mount interactive 3D/2D viewer
const viewer = await space.startViewer({
  containerId: 'spacekit-viewport',
  mode: '3d',
  showAnnotations: true,
});

// Control viewer programmatically
viewer.onEntitySelect((entityId) => console.log('Selected:', entityId));
// viewer.setMode('2d');
// viewer.setAnnotations(false);

// 2. Query structured levels, walls, doors & GeoJSON
const details = await space.getSpace();
const geojson = await space.getGeoJSON();

// 3. Read / create / update live IoT & Asset entities
const { entities } = await space.listEntities();
await space.createEntity({
  name: 'Temp Sensor A-12',
  entityType: 'sensor',
  status: 'online',
  x: 1.5,
  z: -0.8,
  elevation: 1.4,
});
```
