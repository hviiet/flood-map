import { bboxContains, bboxIntersects, pointInPolygon, ringBBox, type BBox, type LngLat, type Polygon } from '../geo/geo';

export interface FloodArea {
  id: string;
  name: string;
  bbox: BBox;
  level: number;
  center: LngLat;
  floodedRatio: number;
  file: string;
  bytes: number;
}

export interface FloodIndexFile {
  generated: string;
  kind: 'scenario' | 'observed';
  source: string;
  depths: number[];
  areas: FloodArea[];
}

export interface FloodFeature {
  type: 'Feature';
  properties: { area: string; name: string; depth: number; level: number };
  geometry: { type: 'MultiPolygon'; coordinates: Polygon[] };
}

export interface FloodCollection {
  type: 'FeatureCollection';
  features: FloodFeature[];
}

const BASE = `${import.meta.env?.BASE_URL ?? './'}data/flood/`;

let indexPromise: Promise<FloodIndexFile> | null = null;
const areaCache = new Map<string, Promise<FloodCollection>>();

export function loadFloodIndex(base = BASE): Promise<FloodIndexFile> {
  indexPromise ??= fetch(new URL(`${base}index.json`, self.location.href)).then((r) => {
    if (!r.ok) throw new Error(`flood index ${r.status}`);
    return r.json();
  });
  return indexPromise;
}

export function loadFloodArea(area: FloodArea, base = BASE): Promise<FloodCollection> {
  let p = areaCache.get(area.id);
  if (!p) {
    p = fetch(new URL(`${base}${area.file}`, self.location.href)).then((r) => {
      if (!r.ok) throw new Error(`flood area ${area.id} ${r.status}`);
      return r.json();
    });
    p.catch(() => areaCache.delete(area.id));
    areaCache.set(area.id, p);
  }
  return p;
}

interface IndexedPoly {
  poly: Polygon;
  bbox: BBox;
  depth: number;
  area: string;
}

/**
 * Spatial lookup of flood depth at a point. Polygons are bucketed into a
 * coarse grid so that a query touches only a handful of candidates.
 */
export class FloodLookup {
  private cells = new Map<string, IndexedPoly[]>();
  private static CELL = 0.01; // ~1.1 km
  readonly polys: IndexedPoly[] = [];

  add(fc: FloodCollection) {
    for (const f of fc.features) {
      for (const poly of f.geometry.coordinates) {
        const ip: IndexedPoly = { poly, bbox: ringBBox(poly[0]), depth: f.properties.depth, area: f.properties.area };
        this.polys.push(ip);
        const C = FloodLookup.CELL;
        for (let x = Math.floor(ip.bbox[0] / C); x <= Math.floor(ip.bbox[2] / C); x++)
          for (let y = Math.floor(ip.bbox[1] / C); y <= Math.floor(ip.bbox[3] / C); y++) {
            const k = `${x}:${y}`;
            let arr = this.cells.get(k);
            if (!arr) this.cells.set(k, (arr = []));
            arr.push(ip);
          }
      }
    }
  }

  /** Minimum flood depth class at the point (m), or null when dry / no data. */
  depthAt(p: LngLat): number | null {
    const C = FloodLookup.CELL;
    const arr = this.cells.get(`${Math.floor(p[0] / C)}:${Math.floor(p[1] / C)}`);
    if (!arr) return null;
    let best: number | null = null;
    for (const ip of arr) {
      if (best !== null && ip.depth <= best) continue;
      if (bboxContains(ip.bbox, p) && pointInPolygon(p, ip.poly)) best = ip.depth;
    }
    return best;
  }

  /** Polygons overlapping a bbox (for rasterising into a mask). */
  query(b: BBox): IndexedPoly[] {
    return this.polys.filter((ip) => bboxIntersects(ip.bbox, b));
  }
}

export const DEPTH_CLASSES = [
  { min: 0, label: 'Dưới 0,5 m', short: '< 0,5 m', color: '#9fd3ff' },
  { min: 0.5, label: '0,5 – 1 m', short: '0,5–1 m', color: '#4ea4f5' },
  { min: 1, label: '1 – 2 m', short: '1–2 m', color: '#1f63d6' },
  { min: 2, label: 'Trên 2 m', short: '> 2 m', color: '#5b2bb5' },
] as const;

export function depthLabel(depth: number | null): string {
  if (depth === null) return 'Không ngập';
  const c = [...DEPTH_CLASSES].reverse().find((c) => depth >= c.min)!;
  return `Ngập ${c.short}`;
}
