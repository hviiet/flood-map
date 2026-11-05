#!/usr/bin/env node
/**
 * Sinh dữ liệu vùng ngập (kịch bản) từ mô hình số độ cao (DEM Terrarium – AWS Open Data).
 *
 * Với mỗi khu vực: tải tile DEM ở zoom 13 (~18 m/pixel), làm mượt, tính
 * độ sâu = mực nước kịch bản − cao độ, rồi vẽ đường đồng mức theo các ngưỡng
 * độ sâu (0 / 0.5 / 1 / 2 m) → MultiPolygon GeoJSON.
 *
 * Dữ liệu này là KỊCH BẢN MÔ PHỎNG phục vụ demo. Khi có dữ liệu ngập thực tế
 * (cơ quan khí tượng thủy văn, ảnh vệ tinh Sentinel‑1, báo cáo hiện trường...),
 * chỉ cần xuất ra cùng schema (properties: area, depth, level) vào
 * public/data/flood-zones.geojson.
 *
 *   node scripts/build-flood-zones.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { contours } from 'd3-contour';

const Z = 13;
const TILE = 256;
const DEPTHS = [0, 0.5, 1, 2];

/** level: mực nước kịch bản (m, so với mực nước biển của DEM). */
const AREAS = [
  { id: 'hue', name: 'TP. Huế – lưu vực sông Hương', bbox: [107.48, 16.38, 107.68, 16.54], level: 4.0 },
  { id: 'hoi-an', name: 'Hội An – hạ lưu sông Thu Bồn', bbox: [108.26, 15.83, 108.40, 15.93], level: 3.0 },
  { id: 'da-nang', name: 'Đà Nẵng – Hòa Vang, Cẩm Lệ', bbox: [108.12, 15.97, 108.26, 16.09], level: 3.5 },
  { id: 'ha-noi', name: 'Hà Nội – nội thành', bbox: [105.76, 20.95, 105.92, 21.08], level: 8.5 },
  { id: 'hcm', name: 'TP. Hồ Chí Minh', bbox: [106.62, 10.70, 106.80, 10.86], level: 2.2 },
  { id: 'can-tho', name: 'Cần Thơ – Ninh Kiều, Cái Răng', bbox: [105.70, 9.98, 105.84, 10.08], level: 1.7 },
  { id: 'le-thuy', name: 'Lệ Thủy, Quảng Trị – sông Kiến Giang', bbox: [106.72, 17.12, 106.88, 17.26], level: 4.0 },
];

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

async function fetchTile(x, y) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

function blur(src, w, h, passes = 2) {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            s += a[yy * w + xx]; n++;
          }
        b[y * w + x] = s / n;
      }
    a = b;
  }
  return a;
}

function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = ring[s], [bx, by] = ring[e];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = ring[i];
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      const d = qx * qx + qy * qy;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > t2) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return ring.filter((_, i) => keep[i]);
}

const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return Math.abs(a / 2);
};

async function buildArea(area) {
  const [w0, s0, e0, n0] = area.bbox;
  const x0 = Math.floor(lon2x(w0, Z)), x1 = Math.floor(lon2x(e0, Z));
  const y0 = Math.floor(lat2y(n0, Z)), y1 = Math.floor(lat2y(s0, Z));
  const W = (x1 - x0 + 1) * TILE, H = (y1 - y0 + 1) * TILE;
  const elev = new Float32Array(W * H);
  const jobs = [];
  for (let tx = x0; tx <= x1; tx++)
    for (let ty = y0; ty <= y1; ty++)
      jobs.push(fetchTile(tx, ty).then((png) => {
        for (let py = 0; py < TILE; py++)
          for (let px = 0; px < TILE; px++) {
            const i = (py * TILE + px) * 4;
            const v = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
            elev[((ty - y0) * TILE + py) * W + (tx - x0) * TILE + px] = v;
          }
      }));
  await Promise.all(jobs);
  const smooth = blur(elev, W, H, 2);

  // Crop to bbox (pixel coords in the mosaic)
  const cx0 = Math.max(0, Math.floor((lon2x(w0, Z) - x0) * TILE));
  const cx1 = Math.min(W, Math.ceil((lon2x(e0, Z) - x0) * TILE));
  const cy0 = Math.max(0, Math.floor((lat2y(n0, Z) - y0) * TILE));
  const cy1 = Math.min(H, Math.ceil((lat2y(s0, Z) - y0) * TILE));
  const cw = cx1 - cx0, ch = cy1 - cy0;
  const depth = new Float64Array(cw * ch);
  let flooded = 0, land = 0;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const e = smooth[(y + cy0) * W + x + cx0];
      // Biển (cao độ âm sâu) → không tính là vùng ngập trên đất liền.
      const d = e < -1.5 ? -99 : area.level - e;
      // Viền khung = khô để đường đồng mức khép kín.
      depth[y * cw + x] = x === 0 || y === 0 || x === cw - 1 || y === ch - 1 ? -99 : d;
      if (e >= -1.5) { land++; if (d > 0) flooded++; }
    }

  const toLngLat = ([px, py]) => [
    +x2lon(x0 + (px + cx0) / TILE, Z).toFixed(4),
    +y2lat(y0 + (py + cy0) / TILE, Z).toFixed(4),
  ];
  const features = [];
  const gen = contours().size([cw, ch]).thresholds(DEPTHS.map((d) => d + 1e-3));
  for (const c of gen(depth)) {
    const minDepth = DEPTHS.find((d) => Math.abs(d + 1e-3 - c.value) < 1e-6);
    const polys = [];
    for (const poly of c.coordinates) {
      const outer = simplify(poly[0], 1.1);
      if (outer.length < 4 || ringArea(outer) < 30) continue; // bỏ đốm < ~1 ha
      const holes = poly.slice(1).map((r) => simplify(r, 1.1)).filter((r) => r.length >= 4 && ringArea(r) >= 30);
      polys.push([outer, ...holes].map((r) => r.map(toLngLat)));
    }
    if (!polys.length) continue;
    features.push({
      type: 'Feature',
      properties: { area: area.id, name: area.name, depth: minDepth, level: area.level },
      geometry: { type: 'MultiPolygon', coordinates: polys },
    });
  }
  const ratio = flooded / land;
  console.log(`${area.id.padEnd(8)} ${W}x${H}px  ngập ${(ratio * 100).toFixed(1)}% diện tích đất  (${features.length} lớp)`);
  return { features, ratio };
}

const outDir = new URL('../public/data/flood/', import.meta.url);
await mkdir(outDir, { recursive: true });
const index = {
  generated: new Date().toISOString().slice(0, 10),
  kind: 'scenario',
  source: 'Mô phỏng từ DEM Terrarium (AWS Terrain Tiles – SRTM/GMTED), không phải số liệu quan trắc',
  depths: DEPTHS,
  areas: [],
};
let total = 0;
for (const a of AREAS) {
  const { features, ratio } = await buildArea(a);
  const json = JSON.stringify({ type: 'FeatureCollection', features });
  await writeFile(new URL(`${a.id}.geojson`, outDir), json);
  total += json.length;
  const [w, s, e, n] = a.bbox;
  index.areas.push({
    id: a.id, name: a.name, bbox: a.bbox, level: a.level,
    center: [+((w + e) / 2).toFixed(4), +((s + n) / 2).toFixed(4)],
    floodedRatio: +ratio.toFixed(3),
    file: `${a.id}.geojson`, bytes: json.length,
  });
}
await writeFile(new URL('index.json', outDir), JSON.stringify(index, null, 2));
console.log(`→ public/data/flood/  ${(total / 1024).toFixed(0)} KB tổng, ${AREAS.length} khu vực`);
