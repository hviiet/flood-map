/**
 * Pure, allocation-light search for "safe ground" candidates on a raster:
 * cells that are dry (outside the dilated flood mask) and sufficiently higher
 * than the user. Runs inside a Web Worker; kept free of DOM/worker APIs so it
 * can be unit-tested in Node.
 */

export interface GridInput {
  elev: Float32Array;
  /** 1 = flooded (observed/scenario polygons) */
  flooded: Uint8Array;
  width: number;
  height: number;
  /** user position in pixel space */
  origin: [number, number];
  /** metres per pixel */
  pixelSize: number;
}

export interface FinderOptions {
  /** required elevation gain over the user's ground (m) */
  minRise: number;
  /** absolute minimum elevation, e.g. simulated water level + freeboard (m) */
  minElevation: number;
  /** keep this far away from flood edges (m) */
  floodBuffer: number;
  /** smallest usable dry area (m²) */
  minArea: number;
  /** maximum straight-line search radius (m) */
  radius: number;
  maxCandidates: number;
}

export interface Candidate {
  px: number;
  py: number;
  elevation: number;
  /** area of the dry connected region (m²) */
  area: number;
  /** straight-line distance from the user (m) */
  distance: number;
  /** highest elevation in the region (m) */
  peak: number;
}

/** Chebyshev dilation of a binary mask by r pixels, via two sliding-window passes. O(n). */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    let count = 0;
    const row = y * w;
    for (let x = 0; x < Math.min(r, w); x++) count += mask[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) count += mask[row + x + r];
      if (x - r - 1 >= 0) count -= mask[row + x - r - 1];
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) count += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) count += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) count -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

export function userElevation(g: GridInput): number {
  // Median of a 3×3 neighbourhood – robust against DEM spikes (buildings, trees).
  const [ox, oy] = g.origin.map(Math.floor);
  const vals: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = ox + dx, y = oy + dy;
      if (x >= 0 && y >= 0 && x < g.width && y < g.height) vals.push(g.elev[y * g.width + x]);
    }
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1] ?? 0;
}

export function findSafeCandidates(g: GridInput, o: FinderOptions): { candidates: Candidate[]; userElev: number } {
  const { width: w, height: h, elev, pixelSize } = g;
  const n = w * h;
  const userElev = userElevation(g);
  const threshold = Math.max(userElev + o.minRise, o.minElevation);
  const buffer = Math.ceil(o.floodBuffer / pixelSize);
  const wet = dilate(g.flooded, w, h, buffer);
  const [ox, oy] = g.origin;
  const rPx = o.radius / pixelSize;
  const r2 = rPx * rPx;

  const safe = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const dy = y + 0.5 - oy;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = x + 0.5 - ox;
      if (dx * dx + dy * dy > r2) continue;
      const e = elev[i];
      // e < -1: open sea in the DEM
      if (!wet[i] && e >= threshold && e > -1) safe[i] = 1;
    }
  }

  // Connected components (4-neighbourhood) with an explicit stack.
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const cellArea = pixelSize * pixelSize;
  const minCells = Math.max(1, Math.ceil(o.minArea / cellArea));
  const found: Candidate[] = [];
  let comp = 0;
  for (let s = 0; s < n; s++) {
    if (!safe[s] || label[s] !== -1) continue;
    let sp = 0, size = 0, peak = -Infinity;
    let bestD = Infinity, bestI = -1;
    stack[sp++] = s;
    label[s] = comp;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % w, y = (i - x) / w;
      if (elev[i] > peak) peak = elev[i];
      // "core" cell: all 4 neighbours are safe → not on a ragged edge
      const core = x > 0 && y > 0 && x < w - 1 && y < h - 1 && safe[i - 1] && safe[i + 1] && safe[i - w] && safe[i + w];
      if (core) {
        const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (x > 0 && safe[i - 1] && label[i - 1] === -1) { label[i - 1] = comp; stack[sp++] = i - 1; }
      if (x < w - 1 && safe[i + 1] && label[i + 1] === -1) { label[i + 1] = comp; stack[sp++] = i + 1; }
      if (y > 0 && safe[i - w] && label[i - w] === -1) { label[i - w] = comp; stack[sp++] = i - w; }
      if (y < h - 1 && safe[i + w] && label[i + w] === -1) { label[i + w] = comp; stack[sp++] = i + w; }
    }
    comp++;
    if (size < minCells || bestI < 0) continue;
    const bx = bestI % w, by = (bestI - bx) / w;
    found.push({
      px: bx + 0.5,
      py: by + 0.5,
      elevation: elev[bestI],
      area: size * cellArea,
      distance: Math.sqrt(bestD) * pixelSize,
      peak,
    });
  }
  found.sort((a, b) => a.distance - b.distance);
  return { candidates: found.slice(0, o.maxCandidates), userElev };
}
