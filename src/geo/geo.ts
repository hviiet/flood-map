/** Lightweight geo helpers (no turf – keeps the bundle tiny and hot paths fast). */
export type LngLat = [number, number];
export type Ring = LngLat[];
export type Polygon = Ring[];

const R = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a→b in degrees [0, 360). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = a[1] * RAD, φ2 = b[1] * RAD, Δλ = (b[0] - a[0]) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

/** Signed smallest difference b − a in degrees, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Local equirectangular projection to metres around `origin` – accurate at city scale. */
export function makeProjector(origin: LngLat) {
  const kx = Math.cos(origin[1] * RAD) * R * RAD;
  const ky = R * RAD;
  return {
    toXY: (p: LngLat): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    toLngLat: (x: number, y: number): LngLat => [origin[0] + x / kx, origin[1] + y / ky],
  };
}

export interface LineIndex {
  coords: LngLat[];
  /** cumulative distance (m) at each vertex */
  cum: Float64Array;
  length: number;
}

export function indexLine(coords: LngLat[]): LineIndex {
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i]);
  return { coords, cum, length: cum[coords.length - 1] ?? 0 };
}

export interface Projection {
  point: LngLat;
  /** distance from the query point to the line (m) */
  distance: number;
  /** distance along the line from its start (m) */
  along: number;
  segment: number;
}

/**
 * Project `p` onto the line. `fromSegment`/`window` restrict the search to a
 * slice so that live navigation stays O(window) per GPS fix instead of O(n).
 */
export function projectOnLine(line: LineIndex, p: LngLat, fromSegment = 0, window = Infinity): Projection {
  const { coords, cum } = line;
  const proj = makeProjector(p);
  let best: Projection = { point: coords[0], distance: Infinity, along: 0, segment: 0 };
  const end = Math.min(coords.length - 1, fromSegment + window);
  for (let i = Math.max(0, fromSegment); i < end; i++) {
    const [ax, ay] = proj.toXY(coords[i]);
    const [bx, by] = proj.toXY(coords[i + 1]);
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L ? -(ax * dx + ay * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = Math.hypot(qx, qy);
    if (d < best.distance) {
      const segLen = cum[i + 1] - cum[i];
      best = { point: proj.toLngLat(qx, qy), distance: d, along: cum[i] + t * segLen, segment: i };
    }
  }
  return best;
}

/** Point at distance `d` along the line. */
export function pointAlong(line: LineIndex, d: number): LngLat {
  const { coords, cum } = line;
  if (d <= 0) return coords[0];
  if (d >= line.length) return coords[coords.length - 1];
  let lo = 0, hi = coords.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [coords[lo][0] + t * (coords[hi][0] - coords[lo][0]), coords[lo][1] + t * (coords[hi][1] - coords[lo][1])];
}

/** Slice of the line from distance `from` to its end (for drawing "remaining route"). */
export function sliceFrom(line: LineIndex, from: number): LngLat[] {
  const start = pointAlong(line, from);
  const out: LngLat[] = [start];
  for (let i = 0; i < line.coords.length; i++) if (line.cum[i] > from) out.push(line.coords[i]);
  return out;
}

export function pointInRing(p: LngLat, ring: Ring): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: LngLat, poly: Polygon): boolean {
  if (!pointInRing(p, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i])) return false;
  return true;
}

export type BBox = [number, number, number, number];

export function ringBBox(ring: Ring): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

export const bboxContains = (b: BBox, p: LngLat) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
export const bboxIntersects = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** BBox of a circle of `radius` metres around `c`. */
export function bboxAround(c: LngLat, radius: number): BBox {
  const dLat = radius / (R * RAD);
  const dLng = dLat / Math.cos(c[1] * RAD);
  return [c[0] - dLng, c[1] - dLat, c[0] + dLng, c[1] + dLat];
}

const COMPASS = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
export const compassVi = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export function formatDistance(m: number): string {
  if (m < 10) return 'vài mét';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m / 1000)} km`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} phút`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} giờ ${r} phút` : `${h} giờ`;
}
