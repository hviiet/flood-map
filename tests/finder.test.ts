import { describe, expect, it } from 'vitest';
import { dilate, findSafeCandidates, type FinderOptions } from '../src/safety/finder';

const opts: FinderOptions = { minRise: 2, minElevation: -Infinity, floodBuffer: 0, minArea: 0, radius: 1e9, maxCandidates: 5 };

/** Bowl-shaped valley: low (2 m) in the middle-left, a hill (10 m) on the right edge. */
function terrain(w = 60, h = 40) {
  const elev = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) elev[y * w + x] = x > 45 ? 10 : 2 + x * 0.02;
  return { elev, w, h };
}

describe('findSafeCandidates', () => {
  it('finds the hill and reports rise & distance', () => {
    const { elev, w, h } = terrain();
    const flooded = new Uint8Array(w * h);
    const r = findSafeCandidates({ elev, flooded, width: w, height: h, origin: [10.5, 20.5], pixelSize: 10 }, opts);
    expect(r.userElev).toBeCloseTo(2.2, 1);
    expect(r.candidates.length).toBe(1);
    const c = r.candidates[0];
    expect(c.elevation).toBe(10);
    expect(c.px).toBeGreaterThan(45);
    // nearest *core* cell is one column inside the hill edge
    expect(c.distance).toBeGreaterThan(350);
    expect(c.distance).toBeLessThan(400);
  });

  it('excludes flooded ground even when high', () => {
    const { elev, w, h } = terrain();
    const flooded = new Uint8Array(w * h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 40; x < w; x++) flooded[y * w + x] = 1;
    const r = findSafeCandidates({ elev, flooded, width: w, height: h, origin: [10.5, 20.5], pixelSize: 10 }, opts);
    expect(r.candidates).toHaveLength(0);
  });

  it('respects the absolute minimum elevation (simulated water level)', () => {
    const { elev, w, h } = terrain();
    const r = findSafeCandidates(
      { elev, flooded: new Uint8Array(w * h), width: w, height: h, origin: [10.5, 20.5], pixelSize: 10 },
      { ...opts, minElevation: 12 },
    );
    expect(r.candidates).toHaveLength(0);
  });

  it('drops regions smaller than minArea and outside radius', () => {
    const { elev, w, h } = terrain();
    const base = { elev, flooded: new Uint8Array(w * h), width: w, height: h, origin: [10.5, 20.5] as [number, number], pixelSize: 10 };
    expect(findSafeCandidates(base, { ...opts, minArea: 1e6 }).candidates).toHaveLength(0);
    expect(findSafeCandidates(base, { ...opts, radius: 200 }).candidates).toHaveLength(0);
  });

  it('dilate grows a mask by r (chebyshev)', () => {
    const w = 7, h = 7;
    const m = new Uint8Array(w * h);
    m[3 * w + 3] = 1;
    const d = dilate(m, w, h, 2);
    let count = 0;
    for (const v of d) count += v;
    expect(count).toBe(25);
    expect(d[1 * w + 1]).toBe(1);
    expect(d[0]).toBe(0);
  });
});
