import type { Map as MLMap, GeoJSONSource, ExpressionSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point, Polygon as GJPolygon } from 'geojson';
import { DEPTH_CLASSES, type FloodArea } from '../data/flood';
import { DEM_URL } from '../safety/dem';
import { SOVEREIGNTY_LABELS } from './sovereignty';
import type { LngLat } from '../geo/geo';

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

const depthColor: ExpressionSpecification = [
  'step', ['get', 'depth'],
  DEPTH_CLASSES[0].color,
  0.5, DEPTH_CLASSES[1].color,
  1, DEPTH_CLASSES[2].color,
  2, DEPTH_CLASSES[3].color,
];

/** First symbol layer of the basemap – our overlays go just beneath the labels. */
function firstSymbolId(map: MLMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

export function addOverlayLayers(map: MLMap, opts: { lowEnd: boolean }) {
  const beforeLabels = firstSymbolId(map);

  map.addSource('dem', {
    type: 'raster-dem',
    tiles: [DEM_URL],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: opts.lowEnd ? 13 : 14,
    attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">DEM: AWS Terrain Tiles</a>',
  });
  map.addLayer({
    id: 'hillshade',
    type: 'hillshade',
    source: 'dem',
    layout: { visibility: 'none' },
    paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#3d4a5c', 'hillshade-highlight-color': '#ffffff' },
  }, beforeLabels);
  map.addLayer({
    id: 'flood-sim',
    type: 'color-relief',
    source: 'dem',
    layout: { visibility: 'none' },
    paint: { 'color-relief-opacity': 0.62, 'color-relief-color': simulationColor(5) },
  }, beforeLabels);

  map.addSource('flood', {
    type: 'geojson',
    data: EMPTY,
    // Generous simplification at low zoom keeps tiling fast; detail returns at high zoom.
    tolerance: 0.6,
    buffer: 32,
    maxzoom: 15,
    attribution: 'Vùng ngập: kịch bản mô phỏng từ DEM',
  });
  map.addLayer({
    id: 'flood-fill',
    type: 'fill',
    source: 'flood',
    minzoom: 8,
    layout: { 'fill-sort-key': ['get', 'depth'] },
    paint: {
      'fill-color': depthColor,
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.55, 13, 0.42, 16, 0.32],
      'fill-antialias': !opts.lowEnd,
    },
  }, beforeLabels);
  map.addLayer({
    id: 'flood-edge',
    type: 'line',
    source: 'flood',
    minzoom: 12,
    filter: ['==', ['get', 'depth'], 0],
    paint: { 'line-color': '#1b5fc4', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 16, 1.2], 'line-opacity': 0.7 },
  }, beforeLabels);

  // Overview markers for flood areas (visible when zoomed out).
  map.addSource('flood-areas', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'flood-areas-halo',
    type: 'circle',
    source: 'flood-areas',
    maxzoom: 10,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 9, 22],
      'circle-color': '#1f63d6',
      'circle-opacity': 0.22,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#1f63d6',
    },
  });
  map.addLayer({
    id: 'flood-areas-label',
    type: 'symbol',
    source: 'flood-areas',
    minzoom: 5,
    maxzoom: 10,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-offset': [0, 1.6],
      'text-anchor': 'top',
      'text-max-width': 9,
    },
    paint: { 'text-color': '#0b3d91', 'text-halo-color': '#fff', 'text-halo-width': 1.6 },
  });

  // Route
  map.addSource('route-alt', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'route-alt',
    type: 'line',
    source: 'route-alt',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#7a8699', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7], 'line-opacity': 0.75, 'line-dasharray': [1, 1.6] },
  });
  map.addSource('route', { type: 'geojson', data: EMPTY, lineMetrics: false });
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 14] },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['==', ['get', 'kind'], 'straight'], '#e8590c', '#0a7d4f'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 9],
      'line-dasharray': ['case', ['==', ['get', 'kind'], 'straight'], ['literal', [1.5, 1.5]], ['literal', [1, 0]]],
    },
  });

  // Safe destinations
  map.addSource('safe', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'safe-halo',
    type: 'circle',
    source: 'safe',
    paint: {
      'circle-radius': ['case', ['get', 'best'], 22, 12],
      'circle-color': '#12b886',
      'circle-opacity': ['case', ['get', 'best'], 0.25, 0.18],
      'circle-stroke-width': ['case', ['get', 'best'], 2, 1],
      'circle-stroke-color': '#0a7d4f',
    },
  });
  map.addLayer({
    id: 'safe-dot',
    type: 'circle',
    source: 'safe',
    paint: { 'circle-radius': ['case', ['get', 'best'], 8, 5], 'circle-color': '#0a7d4f', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#fff' },
  });
  map.addLayer({
    id: 'safe-label',
    type: 'symbol',
    source: 'safe',
    filter: ['get', 'best'],
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-allow-overlap': true },
    paint: { 'text-color': '#0a5c3a', 'text-halo-color': '#fff', 'text-halo-width': 2 },
  });

  // Accuracy circle of the user location
  map.addSource('me-accuracy', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'me-accuracy',
    type: 'fill',
    source: 'me-accuracy',
    paint: { 'fill-color': '#1c7ed6', 'fill-opacity': 0.12, 'fill-outline-color': '#1c7ed6' },
  }, 'route-alt');

  // Sovereignty labels (always on top)
  map.addSource('sovereignty', { type: 'geojson', data: SOVEREIGNTY_LABELS });
  map.addLayer({
    id: 'sov-sea',
    type: 'symbol',
    source: 'sovereignty',
    filter: ['in', ['get', 'kind'], ['literal', ['sea', 'gulf']]],
    minzoom: 3,
    maxzoom: 10,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Italic'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, ['case', ['==', ['get', 'kind'], 'sea'], 13, 10], 7, ['case', ['==', ['get', 'kind'], 'sea'], 22, 15]],
      'text-letter-spacing': 0.25,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#3a6fb0', 'text-halo-color': 'rgba(255,255,255,0.6)', 'text-halo-width': 1 },
  });
  map.addLayer({
    id: 'sov-archipelago',
    type: 'symbol',
    source: 'sovereignty',
    filter: ['==', ['get', 'kind'], 'archipelago'],
    minzoom: 3,
    maxzoom: 11,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10.5, 6, 14, 9, 16],
      'text-max-width': 12,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-line-height': 1.25,
    },
    paint: { 'text-color': '#7a1d1d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 },
  });
  map.addLayer({
    id: 'sov-island',
    type: 'symbol',
    source: 'sovereignty',
    filter: ['all', ['==', ['get', 'kind'], 'island'], ['<=', ['get', 'rank'], ['step', ['zoom'], 0, 6, 1, 7.5, 2, 9, 3]]],
    minzoom: 6,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.5],
      'icon-allow-overlap': true,
    },
    paint: { 'text-color': '#5a2a2a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  });
}

/** color-relief ramp: elevation below `level` is tinted by simulated depth; sea (< −1 m) stays clear. */
export function simulationColor(level: number): ExpressionSpecification {
  const clear = 'rgba(0,0,0,0)';
  const raw: [number, string][] = [
    [-1.01, clear],
    [-1, DEPTH_CLASSES[3].color],
    [level - 2, DEPTH_CLASSES[3].color],
    [level - 1, DEPTH_CLASSES[2].color],
    [level - 0.5, DEPTH_CLASSES[1].color],
    [level - 0.02, DEPTH_CLASSES[0].color],
    [level, clear],
  ];
  const stops: (number | string)[] = [];
  let prev = -Infinity;
  for (const [v, c] of raw) {
    if (v <= prev) continue;
    stops.push(+v.toFixed(3), c);
    prev = v;
  }
  return ['interpolate', ['linear'], ['elevation'], ...stops] as ExpressionSpecification;
}

export function setFloodAreas(map: MLMap, areas: FloodArea[]) {
  (map.getSource('flood-areas') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: areas.map((a) => ({
      type: 'Feature',
      properties: { id: a.id, label: a.name.split(' – ')[0] },
      geometry: { type: 'Point', coordinates: a.center },
    })),
  });
}

export function circlePolygon(center: LngLat, radius: number, steps = 48): Feature<GJPolygon> {
  const coords: LngLat[] = [];
  const kLat = radius / 111320;
  const kLng = kLat / Math.cos((center[1] * Math.PI) / 180);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    coords.push([center[0] + kLng * Math.cos(t), center[1] + kLat * Math.sin(t)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

export const lineFeature = (coords: LngLat[], props: Record<string, unknown> = {}): Feature<LineString> => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: coords },
});

export const pointFeature = (c: LngLat, props: Record<string, unknown> = {}): Feature<Point> => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'Point', coordinates: c },
});

export function setData(map: MLMap, source: string, data: FeatureCollection | Feature) {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}
