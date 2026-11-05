# 🌊 Bản đồ ngập lụt Việt Nam

Ứng dụng web (PWA) hiển thị **vùng ngập lụt chi tiết** và **dẫn đường từng bước tới vùng cao an toàn gần nhất** dựa trên vị trí hiện tại của người dùng. Tối ưu cho điện thoại, chạy mượt cả trên máy cấu hình thấp, hiển thị **đầy đủ chủ quyền biển đảo Việt Nam**.

## Tính năng

| | |
|---|---|
| 🗺️ **Bản đồ vector WebGL** | MapLibre GL JS 6 + tile vector OpenFreeMap, nhãn tiếng Việt |
| 🇻🇳 **Chủ quyền biển đảo** | Nhãn "Quần đảo Hoàng Sa (Việt Nam)", "Quần đảo Trường Sa (Việt Nam)", tên các đảo bằng tiếng Việt, "Biển Đông", "Vịnh Bắc Bộ"; ẩn mọi nhãn/ranh giới do nước khác đặt trong khu vực hai quần đảo; ẩn ranh giới tranh chấp & trên biển |
| 🌊 **Vùng ngập chi tiết** | 4 cấp độ sâu (< 0,5 m · 0,5–1 m · 1–2 m · > 2 m), độ phân giải ~18 m, 7 khu vực trọng điểm (Huế, Hội An, Đà Nẵng, Hà Nội, TP.HCM, Cần Thơ, Lệ Thủy) – tải theo khung nhìn |
| 💧 **Mô phỏng mực nước** | Kéo thanh trượt 0–20 m: tô màu mọi vùng thấp hơn mực nước trên toàn quốc, xử lý hoàn toàn trên GPU (lớp `color-relief` từ DEM) |
| 🛟 **Tìm nơi an toàn** | Phân tích địa hình quanh người dùng → tìm vùng đất **cao hơn**, **khô**, đủ rộng → so sánh quãng đường thực tế → chọn tuyến **ngắn nhất & ít lội nước nhất** |
| 🧭 **Dẫn đường** | Chỉ dẫn từng bước bằng tiếng Việt, đọc bằng giọng nói, rung báo rẽ, tự tính lại đường khi đi lệch, camera bám theo hướng đi, giữ màn hình sáng |
| 📴 **Hoạt động khi mạng yếu** | Service worker lưu ứng dụng, tile bản đồ, dữ liệu độ cao; mất mạng định tuyến → tự chuyển sang chỉ hướng đi thẳng (la bàn) |
| 📍 **Chọn vị trí thủ công** | Chạm vào bản đồ → xem độ cao/độ sâu ngập → "Đặt làm vị trí của tôi" / "Tìm nơi an toàn từ đây" (khi GPS kém hoặc tìm giúp người thân) |

## Công nghệ & lý do chọn

Ưu tiên số 1 là **tốc độ và độ mượt**:

- **Vanilla TypeScript + Vite** – không framework UI: mã ứng dụng chỉ **~18 KB gzip**; mọi cập nhật DOM gom theo `requestAnimationFrame`.
- **MapLibre GL JS 6** (WebGL, mã nguồn mở, không cần API key) – render vector tile trên GPU, tách chunk riêng để cache lâu dài.
- **Web Worker** cho mọi tính toán nặng (giải mã DEM, raster hóa vùng ngập, tìm vùng an toàn, đo đoạn lội nước) → luồng giao diện không bao giờ bị chặn.
- **Thuật toán O(n)**: giãn mặt nạ ngập bằng cửa sổ trượt, gán nhãn thành phần liên thông bằng stack, chỉ mục lưới không gian cho tra cứu điểm, chiếu GPS lên tuyến theo cửa sổ cục bộ.
- **Phân hạng thiết bị**: máy yếu (≤ 4 nhân / ≤ 3 GB RAM / Save-Data, hoặc `?lite`) tự tắt nhà 3D, khử răng cưa, hiệu ứng mờ, giới hạn pixel ratio & bộ nhớ tile.
- **Tải sớm**: `preconnect` tới máy chủ tile/DEM, `preload` style bản đồ và chỉ mục dữ liệu song song với JS.
- **PWA** (Workbox): cài lên màn hình chính, chạy offline với vùng đã xem.

Dịch vụ bên ngoài (miễn phí, không cần khóa):

| Dịch vụ | Dùng cho |
|---|---|
| [OpenFreeMap](https://openfreemap.org) | Bản đồ nền vector (dữ liệu OpenStreetMap) |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Mô hình số độ cao (DEM, mã hóa Terrarium) |
| [FOSSGIS OSRM](https://routing.openstreetmap.de) | Định tuyến đi bộ / xe máy (bảng khoảng cách + tuyến chi tiết) |

> Với lưu lượng lớn nên tự host OSRM (Docker) và/hoặc tile (PMTiles) – chỉ cần đổi URL trong `src/routing/osrm.ts`, `src/map/style.ts`, `src/safety/dem.ts`.

## Thuật toán tìm nơi an toàn

1. **Địa hình** – tải DEM quanh người dùng (bán kính 2,5 km, zoom 13 ≈ 18 m/pixel) trong Web Worker.
2. **Mặt nạ ngập** – raster hóa các polygon vùng ngập lên cùng lưới, **giãn thêm 40 m** để tránh mép nước.
3. **Ô an toàn** = khô **và** cao hơn vị trí người dùng ≥ 3 m **và** cao hơn mực nước kịch bản/mô phỏng (+0,5–1 m).
4. Gom ô thành **vùng liên thông**, bỏ vùng < 2.500 m²; với mỗi vùng lấy điểm "lõi" (không nằm trên mép) gần người dùng nhất.
5. Không có kết quả → nới tiêu chí theo bậc (1,5 m → bán kính 6 km → 12 km).
6. **OSRM Table**: đo quãng đường thực tế tới 8 ứng viên, loại điểm cách đường > 250 m.
7. Lấy tuyến chi tiết cho 3 ứng viên tốt nhất, đo số mét **lội qua vùng ngập** trên mỗi tuyến; chi phí = quãng đường + 3×(đoạn ngập nông) + 14×(đoạn ngập > 0,5 m). Chọn chi phí nhỏ nhất, các tuyến còn lại là phương án thay thế.

## Dữ liệu vùng ngập

`public/data/flood/` gồm `index.json` (danh sách khu vực, bbox, mực nước) và một file GeoJSON cho mỗi khu vực:

```jsonc
{ "type": "Feature",
  "properties": { "area": "hue", "name": "…", "depth": 0.5, "level": 4 },  // depth: ngưỡng độ sâu tối thiểu (m)
  "geometry": { "type": "MultiPolygon", "coordinates": [...] } }
```

⚠️ **Dữ liệu đi kèm là KỊCH BẢN MÔ PHỎNG** sinh bằng `npm run data:flood` (`scripts/build-flood-zones.mjs`): lấy DEM, tính độ sâu = mực nước kịch bản − cao độ, vẽ đường đồng mức theo các ngưỡng 0 / 0,5 / 1 / 2 m. Để dùng dữ liệu thật (Tổng cục KTTV, ảnh vệ tinh Sentinel‑1, báo cáo hiện trường…), xuất ra **cùng schema** và thay file – ứng dụng không cần sửa mã. Đổi `"kind": "scenario"` thành `"observed"` trong `index.json` để bỏ nhãn "Kịch bản mô phỏng".

## Chạy dự án

```bash
npm install
npm run dev          # http://localhost:5173  (định vị cần HTTPS hoặc localhost)
npm test             # unit test (geo, tìm vùng an toàn, dẫn đường, style chủ quyền)
npm run build        # bản production → dist/
npm run preview
npm run data:flood   # sinh lại dữ liệu kịch bản ngập
```

Triển khai: `dist/` là trang tĩnh, đặt lên bất kỳ hosting nào có HTTPS (GitHub Pages, Cloudflare Pages, Netlify…). Workflow `.github/workflows/deploy.yml` tự kiểm thử, build và đăng lên GitHub Pages khi push vào `main` (bật Pages → Source: GitHub Actions).

## Cấu trúc

```
src/
  main.ts              khởi động bản đồ, phân hạng thiết bị, service worker
  app.ts               điều khiển giao diện: tìm kiếm → kết quả → dẫn đường → đến nơi
  map/style.ts         chuyển style nền sang tiếng Việt + lọc chủ quyền
  map/sovereignty.ts   vùng & nhãn Hoàng Sa, Trường Sa, Biển Đông
  map/layers.ts        lớp ngập, mô phỏng mực nước, tuyến đường, điểm an toàn
  data/flood.ts        tải dữ liệu ngập theo khu vực, chỉ mục không gian
  safety/              Web Worker: DEM, tìm vùng an toàn, lập kế hoạch sơ tán
  routing/             OSRM + chỉ dẫn tiếng Việt
  nav/                 theo dõi tiến trình, GPS/la bàn, giọng nói
scripts/build-flood-zones.mjs   sinh dữ liệu kịch bản ngập từ DEM
tests/                 vitest
```

## Lưu ý an toàn

Ứng dụng là công cụ hỗ trợ. Luôn tuân theo hướng dẫn của chính quyền địa phương. Không đi qua dòng nước chảy xiết. Khẩn cấp gọi **112** (cứu nạn), **114** (cứu hộ).
