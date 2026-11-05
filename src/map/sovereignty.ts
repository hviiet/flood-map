/**
 * Hiển thị đúng chủ quyền biển đảo Việt Nam trên nền bản đồ OpenStreetMap:
 *  - Ẩn mọi nhãn/ranh giới từ dữ liệu nền nằm trong khu vực quần đảo Hoàng Sa
 *    và Trường Sa (tránh tên gọi, đơn vị hành chính do nước khác đặt).
 *  - Thay bằng nhãn tiếng Việt: "Quần đảo Hoàng Sa (Việt Nam)", "Quần đảo
 *    Trường Sa (Việt Nam)", tên các đảo chính và "Biển Đông".
 *  - Ẩn ranh giới tranh chấp và ranh giới trên biển.
 */
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';

const poly = (coords: [number, number][]): Polygon => ({ type: 'Polygon', coordinates: [[...coords, coords[0]]] });

/** Vùng bao các quần đảo (không chạm đất liền của quốc gia nào khác). */
export const HOANG_SA = poly([[110.9, 15.4], [113.2, 15.4], [113.2, 17.4], [110.9, 17.4]]);
export const TRUONG_SA = poly([[111.3, 6.8], [116.3, 6.8], [116.3, 12.1], [111.3, 12.1]]);

/** Biểu thức lọc MapLibre: true khi đối tượng nằm trong vùng quần đảo. */
export const IN_ARCHIPELAGO = ['any', ['within', HOANG_SA], ['within', TRUONG_SA]] as const;

type LabelKind = 'archipelago' | 'island' | 'sea' | 'gulf';
const pt = (name: string, lng: number, lat: number, kind: LabelKind, rank = 1): Feature<Point> => ({
  type: 'Feature',
  properties: { name, kind, rank },
  geometry: { type: 'Point', coordinates: [lng, lat] },
});

export const SOVEREIGNTY_LABELS: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: [
    pt('Quần đảo Hoàng Sa\n(Việt Nam)', 112.0, 16.45, 'archipelago'),
    pt('Quần đảo Trường Sa\n(Việt Nam)', 114.1, 9.9, 'archipelago'),
    pt('Biển Đông', 113.6, 13.6, 'sea'),
    pt('Vịnh Bắc Bộ', 107.6, 20.2, 'gulf'),
    pt('Vịnh Thái Lan', 102.4, 10.6, 'gulf'),
    // Hoàng Sa
    pt('Đảo Phú Lâm', 112.335, 16.834, 'island', 1),
    pt('Đảo Hoàng Sa', 111.606, 16.531, 'island', 1),
    pt('Đảo Linh Côn', 112.73, 16.668, 'island', 2),
    pt('Đảo Tri Tôn', 111.2, 15.783, 'island', 2),
    pt('Đảo Cây', 112.262, 16.98, 'island', 2),
    pt('Đảo Quang Hòa', 111.705, 16.447, 'island', 2),
    pt('Đảo Duy Mộng', 111.593, 16.456, 'island', 3),
    pt('Đảo Hữu Nhật', 111.578, 16.51, 'island', 3),
    // Trường Sa
    pt('Đảo Trường Sa', 111.918, 8.645, 'island', 1),
    pt('Đảo Song Tử Tây', 114.333, 11.43, 'island', 1),
    pt('Đảo Sinh Tồn', 114.33, 9.885, 'island', 1),
    pt('Đảo Nam Yết', 114.366, 10.182, 'island', 1),
    pt('Đảo Sơn Ca', 114.478, 10.376, 'island', 2),
    pt('Đảo Ba Bình', 114.366, 10.377, 'island', 2),
    pt('Đảo An Bang', 112.917, 7.893, 'island', 2),
    pt('Đảo Phan Vinh', 113.689, 8.966, 'island', 2),
    pt('Đảo Trường Sa Đông', 112.551, 8.828, 'island', 2),
    pt('Đảo Sinh Tồn Đông', 114.67, 9.91, 'island', 3),
    pt('Đảo Song Tử Đông', 114.41, 11.45, 'island', 3),
    pt('Đá Thuyền Chài', 113.304, 8.172, 'island', 3),
  ],
};

/** Tên biển/vịnh trong dữ liệu nền được thay bằng nhãn riêng. */
export const REPLACED_WATER_NAMES = [
  'South China Sea', 'Gulf of Tonkin', 'Gulf of Thailand', 'Biển Đông', 'Vịnh Bắc Bộ', 'Vịnh Thái Lan',
  '南海', '南中国海', '北部湾', '泰国湾',
];
