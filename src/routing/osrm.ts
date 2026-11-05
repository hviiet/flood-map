import type { LngLat } from '../geo/geo';

export type TravelMode = 'foot' | 'motorbike';

const ENDPOINT: Record<TravelMode, { base: string; profile: string }> = {
  foot: { base: 'https://routing.openstreetmap.de/routed-foot', profile: 'foot' },
  // Không có hồ sơ xe máy công khai → dùng hồ sơ ô tô (cùng mạng đường chính).
  motorbike: { base: 'https://routing.openstreetmap.de/routed-car', profile: 'driving' },
};

export interface OsrmManeuver {
  type: string;
  modifier?: string;
  location: LngLat;
  bearing_before: number;
  bearing_after: number;
  exit?: number;
}

export interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  ref?: string;
  mode: string;
  maneuver: OsrmManeuver;
  geometry: { type: 'LineString'; coordinates: LngLat[] };
  rotary_name?: string;
}

export interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { type: 'LineString'; coordinates: LngLat[] };
  legs: { steps: OsrmStep[]; distance: number; duration: number }[];
}

const coordStr = (c: LngLat) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;

async function get<T>(url: string, signal?: AbortSignal, timeout = 10000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeout);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.json();
    if (!res.ok || body.code !== 'Ok') throw new Error(body.message || body.code || `HTTP ${res.status}`);
    return body as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface TableResult {
  durations: (number | null)[];
  distances: (number | null)[];
  /** how far OSRM had to move each destination to reach the road network (m) */
  snap: number[];
}

/** One-to-many travel cost from `origin` to each destination. */
export async function table(mode: TravelMode, origin: LngLat, dests: LngLat[], signal?: AbortSignal): Promise<TableResult> {
  const { base, profile } = ENDPOINT[mode];
  const coords = [origin, ...dests].map(coordStr).join(';');
  const destIdx = dests.map((_, i) => i + 1).join(';');
  const body = await get<{
    durations: (number | null)[][];
    distances: (number | null)[][];
    destinations: { distance: number }[];
  }>(`${base}/table/v1/${profile}/${coords}?sources=0&destinations=${destIdx}&annotations=duration,distance`, signal);
  return { durations: body.durations[0], distances: body.distances[0], snap: body.destinations.map((d) => d.distance) };
}

export async function route(mode: TravelMode, from: LngLat, to: LngLat, signal?: AbortSignal, heading?: number | null): Promise<OsrmRoute> {
  const { base, profile } = ENDPOINT[mode];
  let q = 'overview=full&geometries=geojson&steps=true&continue_straight=false';
  // Ưu tiên hướng đang di chuyển khi tính lại tuyến (tránh bắt quay đầu không cần thiết).
  if (heading != null && Number.isFinite(heading)) q += `&bearings=${Math.round(heading)},60;`;
  const body = await get<{ routes: OsrmRoute[] }>(`${base}/route/v1/${profile}/${coordStr(from)};${coordStr(to)}?${q}`, signal);
  return body.routes[0];
}
