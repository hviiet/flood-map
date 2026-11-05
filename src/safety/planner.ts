import type { LngLat } from '../geo/geo';
import { route as osrmRoute, table, type OsrmRoute, type TravelMode } from '../routing/osrm';
import { safety } from './client';
import type { ExposureResult, FindResult, SafeSpot } from './protocol';

export interface EvacuationOption {
  spot: SafeSpot;
  route: OsrmRoute | null;
  exposure: ExposureResult;
  /** effective cost in metres (distance + penalties for wading through water) */
  cost: number;
}

export interface EvacuationPlan {
  origin: LngLat;
  mode: TravelMode;
  find: FindResult;
  best: EvacuationOption | null;
  alternatives: EvacuationOption[];
  /** true when routing was unavailable and we only show a straight-line bearing */
  offline: boolean;
}

/** Wading 1 m of shallow water "costs" like walking 4 m; deep water 15 m. */
const SHALLOW_PENALTY = 3;
const DEEP_PENALTY = 14;

export const scoreOption = (distance: number, e: ExposureResult) =>
  distance + SHALLOW_PENALTY * (e.flooded - e.deep) + DEEP_PENALTY * e.deep;

export async function planEvacuation(
  origin: LngLat,
  mode: TravelMode,
  waterLevel: number | null,
  onStage: (stage: 'terrain' | 'network' | 'routes') => void,
  signal?: AbortSignal,
): Promise<EvacuationPlan> {
  onStage('terrain');
  const find = await safety.find(origin, waterLevel);
  signal?.throwIfAborted();
  if (!find.spots.length) return { origin, mode, find, best: null, alternatives: [], offline: false };

  onStage('network');
  let ranked: { spot: SafeSpot; dist: number }[];
  try {
    const t = await table(mode, origin, find.spots.map((s) => s.lngLat), signal);
    ranked = find.spots
      .map((spot, i) => ({ spot, dist: t.distances[i] ?? Infinity, snap: t.snap[i] }))
      // A spot whose nearest road is > 250 m away is not practically reachable.
      .filter((r) => Number.isFinite(r.dist) && r.snap < 250)
      .sort((a, b) => a.dist - b.dist);
  } catch (e) {
    if (signal?.aborted) throw e;
    // Offline / routing down: fall back to straight-line guidance to the nearest spot.
    const spot = find.spots[0];
    const opt: EvacuationOption = { spot, route: null, exposure: { flooded: 0, deep: 0 }, cost: spot.distance };
    return { origin, mode, find, best: opt, alternatives: [], offline: true };
  }
  if (!ranked.length) {
    const spot = find.spots[0];
    return { origin, mode, find, best: { spot, route: null, exposure: { flooded: 0, deep: 0 }, cost: spot.distance }, alternatives: [], offline: true };
  }

  onStage('routes');
  const top = ranked.slice(0, 3);
  const settled = await Promise.allSettled(
    top.map(async ({ spot }): Promise<EvacuationOption> => {
      const r = await osrmRoute(mode, origin, spot.lngLat, signal);
      const exposure = await safety.exposure(r.geometry.coordinates, waterLevel);
      return { spot, route: r, exposure, cost: scoreOption(r.distance, exposure) };
    }),
  );
  signal?.throwIfAborted();
  const options = settled
    .filter((s): s is PromiseFulfilledResult<EvacuationOption> => s.status === 'fulfilled')
    .map((s) => s.value)
    .sort((a, b) => a.cost - b.cost);
  if (!options.length) {
    const spot = top[0].spot;
    return { origin, mode, find, best: { spot, route: null, exposure: { flooded: 0, deep: 0 }, cost: spot.distance }, alternatives: [], offline: true };
  }
  return { origin, mode, find, best: options[0], alternatives: options.slice(1), offline: false };
}
