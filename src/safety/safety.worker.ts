/// <reference lib="webworker" />
import { bboxAround, bboxContains, bboxIntersects, haversine, indexLine, pointAlong, ringBBox, type BBox, type LngLat } from '../geo/geo';
import { FloodLookup, loadFloodArea, loadFloodIndex, type FloodArea } from '../data/flood';
import { DemGrid } from './dem';
import { findSafeCandidates } from './finder';
import type { ExposureResult, FindResult, InfoResult, SafeSpot, WorkerRequest, WorkerResponse } from './protocol';

let floodBase = '';
const lookup = new FloodLookup();
const loadedAreas = new Set<string>();

async function areasFor(b: BBox): Promise<FloodArea[]> {
  const idx = await loadFloodIndex(floodBase);
  const hits = idx.areas.filter((a) => bboxIntersects(a.bbox, b));
  await Promise.all(
    hits.filter((a) => !loadedAreas.has(a.id)).map(async (a) => {
      const fc = await loadFloodArea(a, floodBase);
      if (!loadedAreas.has(a.id)) { lookup.add(fc); loadedAreas.add(a.id); }
    }),
  );
  return hits;
}

function rasterizeFlood(grid: DemGrid, bbox: BBox): Uint8Array {
  const { width: W, height: H } = grid;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  for (const ip of lookup.query(bbox)) {
    if (ip.depth !== 0) continue; // depth-0 polygons are the full extent
    for (const ring of ip.poly) {
      ring.forEach((p, i) => {
        const [x, y] = grid.toPixel(p);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
  }
  ctx.fill('evenodd');
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3] > 64 ? 1 : 0;
  return mask;
}

const PLANS = [
  { radius: 2500, z: 13, minRise: 3 },
  { radius: 2500, z: 13, minRise: 1.5 },
  { radius: 6000, z: 12, minRise: 1 },
  { radius: 12000, z: 11, minRise: 0.5 },
];

let lastGrid: DemGrid | null = null;

async function find(origin: LngLat, waterLevel: number | null): Promise<FindResult> {
  let userElevation = 0;
  for (let i = 0; i < PLANS.length; i++) {
    const plan = PLANS[i];
    const bbox = bboxAround(origin, plan.radius * 1.05);
    const [grid, areas] = await Promise.all([DemGrid.load(bbox, plan.z), areasFor(bbox)]);
    lastGrid = grid;
    const flooded = rasterizeFlood(grid, bbox);
    // Scenario water surface of the area the user is in → safe ground must be above it.
    const here = areas.filter((a) => bboxContains(a.bbox, origin));
    let minElevation = -Infinity;
    for (const a of here) minElevation = Math.max(minElevation, a.level + 0.5);
    if (waterLevel !== null) minElevation = Math.max(minElevation, waterLevel + 1);

    const { candidates, userElev } = findSafeCandidates(
      { elev: grid.data, flooded, width: grid.width, height: grid.height, origin: grid.toPixel(origin), pixelSize: grid.pixelSize(origin[1]) },
      { minRise: plan.minRise, minElevation, floodBuffer: 40, minArea: 2500, radius: plan.radius, maxCandidates: 8 },
    );
    userElevation = userElev;
    if (candidates.length) {
      const spots: SafeSpot[] = candidates.map((c) => {
        const lngLat = grid.toLngLat(c.px - 0.5, c.py - 0.5);
        return { lngLat, elevation: c.elevation, peak: c.peak, area: c.area, distance: haversine(origin, lngLat) };
      });
      return { userElevation, userDepth: lookup.depthAt(origin), spots, radius: plan.radius, relaxed: i > 0 };
    }
  }
  return { userElevation, userDepth: lookup.depthAt(origin), spots: [], radius: PLANS[PLANS.length - 1].radius, relaxed: true };
}

async function exposure(coords: LngLat[], waterLevel: number | null): Promise<ExposureResult> {
  if (coords.length < 2) return { flooded: 0, deep: 0 };
  await areasFor(ringBBox(coords));
  const line = indexLine(coords);
  const STEP = 10;
  let flooded = 0, deep = 0;
  const grid = lastGrid;
  for (let d = STEP / 2; d < line.length; d += STEP) {
    const p = pointAlong(line, d);
    let depth = lookup.depthAt(p);
    if (waterLevel !== null && grid) {
      const [x, y] = grid.toPixel(p);
      if (x >= 0 && y >= 0 && x < grid.width && y < grid.height) {
        const sim = waterLevel - grid.elevationAt(p);
        if (sim > 0) depth = Math.max(depth ?? 0, sim >= 0.5 ? 0.5 : 0);
      }
    }
    if (depth !== null) { flooded += STEP; if (depth >= 0.5) deep += STEP; }
  }
  return { flooded, deep };
}

async function info(p: LngLat, waterLevel: number | null): Promise<InfoResult> {
  const [grid, areas] = await Promise.all([
    DemGrid.load(bboxAround(p, 10), 13).catch(() => null),
    areasFor(bboxAround(p, 10)),
  ]);
  const elevation = grid ? grid.elevationAt(p) : null;
  const area = areas.find((a) => bboxContains(a.bbox, p));
  const sim = waterLevel !== null && elevation !== null ? waterLevel - elevation : null;
  return {
    elevation,
    depth: lookup.depthAt(p),
    simulatedDepth: sim !== null && sim > 0 ? sim : null,
    areaName: area?.name ?? null,
  };
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  let res: WorkerResponse;
  try {
    let result: unknown;
    switch (msg.type) {
      case 'init': floodBase = msg.floodBase; result = true; break;
      case 'find': result = await find(msg.origin, msg.waterLevel); break;
      case 'exposure': result = await exposure(msg.coords, msg.waterLevel); break;
      case 'info': result = await info(msg.point, msg.waterLevel); break;
    }
    res = { id: msg.id, ok: true, result };
  } catch (e) {
    res = { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res);
};
