import type { LngLat } from '../geo/geo';

export interface SafeSpot {
  lngLat: LngLat;
  elevation: number;
  peak: number;
  area: number;
  distance: number;
}

export type WorkerRequest =
  | { id: number; type: 'init'; floodBase: string }
  | { id: number; type: 'find'; origin: LngLat; waterLevel: number | null }
  | { id: number; type: 'exposure'; coords: LngLat[]; waterLevel: number | null }
  | { id: number; type: 'info'; point: LngLat; waterLevel: number | null };

export interface FindResult {
  userElevation: number;
  userDepth: number | null;
  spots: SafeSpot[];
  radius: number;
  relaxed: boolean;
}

export interface ExposureResult {
  /** metres of the route inside flood zones */
  flooded: number;
  /** metres inside zones deeper than 0.5 m */
  deep: number;
}

export interface InfoResult {
  elevation: number | null;
  depth: number | null;
  simulatedDepth: number | null;
  areaName: string | null;
}

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
