import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, compassVi, formatDistance, haversine, indexLine, pointAlong, pointInPolygon, projectOnLine, sliceFrom, type LngLat } from '../src/geo/geo';

describe('geo', () => {
  it('haversine ≈ known distance (Hồ Gươm → Lăng Bác ≈ 2.2 km)', () => {
    const d = haversine([105.8522, 21.0287], [105.8346, 21.0368]);
    expect(d).toBeGreaterThan(1900);
    expect(d).toBeLessThan(2200);
  });

  it('bearing & compass', () => {
    expect(Math.round(bearing([105, 21], [105, 22]))).toBe(0);
    expect(Math.round(bearing([105, 21], [106, 21]))).toBe(90);
    expect(compassVi(44)).toBe('Đông Bắc');
    expect(compassVi(359)).toBe('Bắc');
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });

  it('projects onto a polyline', () => {
    const line = indexLine([[105.8, 21.0], [105.81, 21.0], [105.81, 21.01]]);
    const p = projectOnLine(line, [105.805, 21.0005]);
    expect(p.distance).toBeGreaterThan(40);
    expect(p.distance).toBeLessThan(70);
    expect(p.segment).toBe(0);
    expect(p.along).toBeCloseTo(haversine([105.8, 21.0], [105.805, 21.0]), -1);
    const end = pointAlong(line, line.length + 100);
    expect(end).toEqual([105.81, 21.01]);
    const rest = sliceFrom(line, line.cum[1] + 10);
    expect(rest.length).toBe(2);
  });

  it('point in polygon with hole', () => {
    const outer: LngLat[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole: LngLat[] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
    expect(pointInPolygon([1, 1], [outer, hole])).toBe(true);
    expect(pointInPolygon([5, 5], [outer, hole])).toBe(false);
    expect(pointInPolygon([11, 5], [outer, hole])).toBe(false);
  });

  it('formats Vietnamese distances', () => {
    expect(formatDistance(123)).toBe('120 m');
    expect(formatDistance(1530)).toBe('1,5 km');
  });
});
