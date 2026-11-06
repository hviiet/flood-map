import { describe, expect, it } from 'vitest';
import { RouteNavigator } from '../src/nav/navigator';
import { instructionVi, spokenVi } from '../src/routing/instructions';
import type { OsrmRoute, OsrmStep } from '../src/routing/osrm';
import { haversine, type LngLat } from '../src/geo/geo';

const step = (type: string, modifier: string | undefined, name: string, distance: number, loc: LngLat, extra: Partial<OsrmStep['maneuver']> = {}): OsrmStep => ({
  distance, duration: distance / 1.3, name, mode: 'walking',
  maneuver: { type, modifier, location: loc, bearing_before: 0, bearing_after: 0, ...extra },
  geometry: { type: 'LineString', coordinates: [loc] },
});

describe('instructionVi', () => {
  it('translates common maneuvers', () => {
    expect(instructionVi(step('turn', 'left', 'Lê Lợi', 0, [0, 0]))).toBe('Rẽ trái vào Lê Lợi');
    expect(instructionVi(step('turn', 'slight right', '', 0, [0, 0]))).toBe('Chếch sang phải');
    expect(instructionVi(step('roundabout', 'right', 'Trần Phú', 0, [0, 0], { exit: 2 }))).toBe('Vào vòng xuyến, đi theo lối ra thứ hai vào Trần Phú');
    expect(instructionVi(step('arrive', undefined, '', 0, [0, 0]))).toBe('Đã đến điểm an toàn');
    expect(instructionVi(step('end of road', 'right', 'Hùng Vương', 0, [0, 0]))).toBe('Cuối đường, rẽ phải vào Hùng Vương');
  });
  it('speaks distances', () => {
    expect(spokenVi(step('turn', 'right', 'Bà Triệu', 0, [0, 0]), 148)).toBe('Sau 150 mét, rẽ phải vào Bà Triệu.');
    expect(spokenVi(step('turn', 'left', 'QL.1A', 0, [0, 0]), 430)).toBe('Sau 450 mét, rẽ trái vào Quốc lộ 1 A.');
    expect(spokenVi(step('turn', 'right', '', 0, [0, 0]), 1500)).toBe('Sau 1 phẩy 5 ki lô mét, rẽ phải.');
  });
});

describe('RouteNavigator', () => {
  // L-shaped route: east 500 m, then north 500 m.
  const A: LngLat = [105.8, 21.0];
  const B: LngLat = [105.8048, 21.0];
  const C: LngLat = [105.8048, 21.0045];
  const d1 = haversine(A, B), d2 = haversine(B, C);
  const route: OsrmRoute = {
    distance: d1 + d2, duration: (d1 + d2) / 1.3,
    geometry: { type: 'LineString', coordinates: [A, B, C] },
    legs: [{ distance: d1 + d2, duration: 0, steps: [
      step('depart', undefined, 'Phố A', d1, A),
      step('turn', 'left', 'Phố B', d2, B),
      step('arrive', undefined, '', 0, C),
    ] }],
  };
  const fix = (p: LngLat) => ({ lngLat: p, accuracy: 5, heading: null, speed: null, time: 0 });

  it('tracks progress, announces the turn and detects arrival', () => {
    const nav = new RouteNavigator(route, 'foot');
    const s0 = nav.update(fix(A));
    expect(s0.stepIndex).toBe(0);
    expect(s0.next?.name).toBe('Phố B');
    expect(s0.distanceToNext).toBeCloseTo(d1, -1);
    expect(s0.announce).toBeNull();

    const near = nav.update(fix([105.8045, 21.00002]));
    expect(near.distanceToNext).toBeLessThan(40);
    expect(near.announce?.stage).toBe('near');
    expect(nav.update(fix([105.8045, 21.00002])).announce).toBeNull(); // not repeated

    const after = nav.update(fix([105.8048, 21.002]));
    expect(after.stepIndex).toBe(1);
    expect(after.offRoute).toBe(false);
    expect(after.remaining).toBeLessThan(280);

    expect(nav.update(fix([105.80481, 21.00445])).arrived).toBe(true);
  });

  it('flags off-route only after consecutive bad fixes', () => {
    const nav = new RouteNavigator(route, 'foot');
    const away: LngLat = [105.802, 21.002]; // ~220 m off
    expect(nav.update(fix(away)).offRoute).toBe(false);
    expect(nav.update(fix(away)).offRoute).toBe(true);
  });
});

describe('RouteNavigator – starting away from the road', () => {
  const A: LngLat = [105.8, 21.0];
  const B: LngLat = [105.8048, 21.0];
  const d = haversine(A, B);
  const route: OsrmRoute = {
    distance: d, duration: d,
    geometry: { type: 'LineString', coordinates: [A, B] },
    legs: [{ distance: d, duration: d, steps: [] }],
  };
  const fix = (p: LngLat) => ({ lngLat: p, accuracy: 10, heading: null, speed: null, time: 0 });

  it('does not reroute while the user walks to the route from 120 m away', () => {
    const nav = new RouteNavigator(route, 'foot');
    const start: LngLat = [105.8, 21.00108]; // ~120 m north of A
    for (let i = 0; i < 3; i++) {
      const s = nav.update(fix(start));
      expect(s.offRoute).toBe(false);
      expect(s.joining).toBe(true);
    }
    expect(nav.update(fix([105.8005, 21.00001])).joining).toBe(false);
    // once joined, normal tolerance applies again
    nav.update(fix([105.802, 21.0012]));
    expect(nav.update(fix([105.802, 21.0012])).offRoute).toBe(true);
  });
});
