/**
 * Terrarium DEM tiles (AWS Open Data "Terrain Tiles"): elevation is packed into
 * RGB as  h = R·256 + G + B/256 − 32768  (metres).
 */
import type { LngLat } from '../geo/geo';

export const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TILE = 256;

export const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
export const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const y2lat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

export function decodeTerrarium(rgba: Uint8ClampedArray | Uint8Array, out = new Float32Array(rgba.length / 4)) {
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768;
  return out;
}

const tileCache = new Map<string, Promise<Float32Array>>();

async function fetchTile(z: number, x: number, y: number): Promise<Float32Array> {
  const key = `${z}/${x}/${y}`;
  let p = tileCache.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(DEM_URL.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`));
      if (!res.ok) throw new Error(`DEM ${res.status}`);
      const bmp = await createImageBitmap(await res.blob());
      const canvas = new OffscreenCanvas(TILE, TILE);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return decodeTerrarium(ctx.getImageData(0, 0, TILE, TILE).data);
    })();
    p.catch(() => tileCache.delete(key));
    tileCache.set(key, p);
    if (tileCache.size > 200) tileCache.delete(tileCache.keys().next().value!);
  }
  return p;
}

/** A mosaic of DEM tiles covering a bbox, addressable in pixel space. */
export class DemGrid {
  constructor(
    readonly z: number,
    readonly x0: number,
    readonly y0: number,
    readonly width: number,
    readonly height: number,
    readonly data: Float32Array,
  ) {}

  static async load(bbox: [number, number, number, number], z: number): Promise<DemGrid> {
    const tx0 = Math.floor(lon2x(bbox[0], z)), tx1 = Math.floor(lon2x(bbox[2], z));
    const ty0 = Math.floor(lat2y(bbox[3], z)), ty1 = Math.floor(lat2y(bbox[1], z));
    const W = (tx1 - tx0 + 1) * TILE, H = (ty1 - ty0 + 1) * TILE;
    const data = new Float32Array(W * H);
    const jobs: Promise<void>[] = [];
    for (let tx = tx0; tx <= tx1; tx++)
      for (let ty = ty0; ty <= ty1; ty++)
        jobs.push(fetchTile(z, tx, ty).then((t) => {
          const ox = (tx - tx0) * TILE, oy = (ty - ty0) * TILE;
          for (let r = 0; r < TILE; r++) data.set(t.subarray(r * TILE, (r + 1) * TILE), (oy + r) * W + ox);
        }));
    await Promise.all(jobs);
    return new DemGrid(z, tx0, ty0, W, H, data);
  }

  toPixel(p: LngLat): [number, number] {
    return [(lon2x(p[0], this.z) - this.x0) * TILE, (lat2y(p[1], this.z) - this.y0) * TILE];
  }

  toLngLat(px: number, py: number): LngLat {
    return [x2lon(this.x0 + (px + 0.5) / TILE, this.z), y2lat(this.y0 + (py + 0.5) / TILE, this.z)];
  }

  /** Bilinear elevation (m). */
  elevationAt(p: LngLat): number {
    const [fx, fy] = this.toPixel(p);
    const x = Math.max(0, Math.min(this.width - 1.001, fx - 0.5));
    const y = Math.max(0, Math.min(this.height - 1.001, fy - 0.5));
    const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
    const d = this.data, W = this.width;
    const a = d[iy * W + ix], b = d[iy * W + ix + 1], c = d[(iy + 1) * W + ix], e = d[(iy + 1) * W + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  }

  /** Ground size of a pixel in metres at the grid's latitude. */
  pixelSize(lat: number): number {
    return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** this.z);
  }
}
