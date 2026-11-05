import { haversine, indexLine, projectOnLine, type LineIndex, type LngLat } from '../geo/geo';
import type { OsrmRoute, OsrmStep, TravelMode } from '../routing/osrm';

export interface Fix {
  lngLat: LngLat;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  time: number;
}

export interface NavState {
  snapped: LngLat;
  along: number;
  offset: number;
  remaining: number;
  remainingTime: number;
  stepIndex: number;
  /** the upcoming maneuver (step after the current one) */
  next: OsrmStep | null;
  distanceToNext: number;
  offRoute: boolean;
  /** user has not reached the road network yet (started away from any road) */
  joining: boolean;
  arrived: boolean;
  /** an announcement to speak/show now, if any */
  announce: { step: OsrmStep; distance: number | null; stage: 'far' | 'near' | 'now' } | null;
}

const CFG: Record<TravelMode, { offRoute: number; arrive: number; far: number; near: number; now: number }> = {
  foot: { offRoute: 30, arrive: 20, far: 150, near: 40, now: 12 },
  motorbike: { offRoute: 50, arrive: 30, far: 400, near: 120, now: 30 },
};

/** Tracks progress along a route from a stream of GPS fixes. Pure logic – no DOM. */
export class RouteNavigator {
  readonly line: LineIndex;
  readonly steps: OsrmStep[];
  /** distance along the line where each step starts */
  readonly stepStart: number[];
  private segHint = 0;
  private offCount = 0;
  private announced = new Set<string>();
  /** distance to the route at the first fix – the user may start off-road */
  private approach: number | null = null;
  private joined = false;
  private cfg;

  constructor(readonly route: OsrmRoute, readonly mode: TravelMode) {
    this.line = indexLine(route.geometry.coordinates);
    this.steps = route.legs.flatMap((l) => l.steps);
    this.cfg = CFG[mode];
    const scale = route.distance > 0 ? this.line.length / route.distance : 1;
    let acc = 0;
    this.stepStart = this.steps.map((s) => {
      const v = acc * scale;
      acc += s.distance;
      return v;
    });
  }

  get destination(): LngLat {
    return this.line.coords[this.line.coords.length - 1];
  }

  update(fix: Fix): NavState {
    const { line, cfg } = this;
    // Search a local window first (O(1) per fix); fall back to a full scan if lost.
    let p = projectOnLine(line, fix.lngLat, Math.max(0, this.segHint - 3), 60);
    if (p.distance > cfg.offRoute) {
      const full = projectOnLine(line, fix.lngLat);
      if (full.distance < p.distance) p = full;
    }
    this.segHint = p.segment;

    let tolerance = cfg.offRoute + Math.min(fix.accuracy, 40) * 0.5;
    this.approach ??= p.distance;
    if (!this.joined && (p.distance <= tolerance * 0.6 || p.along > 50)) this.joined = true;
    // Until the user reaches the route, allow the initial gap (plus slack) instead of rerouting.
    if (!this.joined) tolerance = Math.max(tolerance, this.approach + 25);
    this.offCount = p.distance > tolerance ? this.offCount + 1 : 0;
    const offRoute = this.offCount >= 2;

    const remaining = Math.max(0, line.length - p.along);
    const arrived = remaining < cfg.arrive || haversine(fix.lngLat, this.destination) < cfg.arrive;
    const ratio = line.length > 0 ? remaining / line.length : 0;

    let stepIndex = 0;
    for (let i = 0; i < this.stepStart.length; i++) if (this.stepStart[i] <= p.along + 1) stepIndex = i;
    const next = this.steps[stepIndex + 1] ?? null;
    const distanceToNext = next ? Math.max(0, this.stepStart[stepIndex + 1] - p.along) : remaining;

    let announce: NavState['announce'] = null;
    if (!offRoute && next && !arrived) {
      const key = (s: string) => `${stepIndex + 1}:${s}`;
      if (distanceToNext <= cfg.now && !this.announced.has(key('now'))) {
        announce = { step: next, distance: null, stage: 'now' };
      } else if (distanceToNext <= cfg.near && distanceToNext > cfg.now && !this.announced.has(key('near'))) {
        announce = { step: next, distance: distanceToNext, stage: 'near' };
      } else if (distanceToNext <= cfg.far && distanceToNext > cfg.near * 1.5 && !this.announced.has(key('far'))) {
        announce = { step: next, distance: distanceToNext, stage: 'far' };
      }
      if (announce) {
        // Mark this and any earlier stage as done so we never repeat a prompt.
        const order = ['far', 'near', 'now'];
        for (const s of order.slice(0, order.indexOf(announce.stage) + 1)) this.announced.add(key(s));
      }
    }

    return {
      snapped: p.point,
      along: p.along,
      offset: p.distance,
      remaining,
      remainingTime: this.route.duration * ratio,
      stepIndex,
      next,
      distanceToNext,
      offRoute,
      joining: !this.joined,
      arrived,
      announce,
    };
  }
}
