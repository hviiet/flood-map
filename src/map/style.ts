import type { StyleSpecification, LayerSpecification, ExpressionSpecification, FilterSpecification } from 'maplibre-gl';
import { IN_ARCHIPELAGO, REPLACED_WATER_NAMES } from './sovereignty';

export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Ưu tiên tên tiếng Việt, rồi tên Latin, rồi tên gốc. */
const NAME_VI: ExpressionSpecification = ['coalesce', ['get', 'name:vi'], ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']];

const and = (a: unknown, b: unknown): FilterSpecification => (a ? (['all', a, b] as unknown as FilterSpecification) : (b as FilterSpecification));

export interface StyleOptions {
  lowEnd: boolean;
}

/**
 * Biến đổi style OpenFreeMap "liberty" cho Việt Nam:
 * - nhãn tiếng Việt, bỏ ghép tên chữ tượng hình;
 * - chủ quyền Hoàng Sa, Trường Sa (xem sovereignty.ts);
 * - thiết bị yếu: bỏ nhà 3D, nhãn POI hạng thấp.
 */
export function transformStyle(style: StyleSpecification, opts: StyleOptions): StyleSpecification {
  const layers: LayerSpecification[] = [];
  for (const layer of style.layers) {
    const l = structuredClone(layer) as LayerSpecification & { filter?: unknown; layout?: Record<string, unknown> };
    if (l.id === 'boundary_disputed') continue;
    if (opts.lowEnd && (l.id === 'building-3d' || l.id === 'poi_r20' || l.id === 'poi_r7')) continue;

    if (l.type === 'line' && 'source-layer' in l && l['source-layer'] === 'boundary') {
      // Không vẽ ranh giới trên biển & ranh giới nằm trong vùng quần đảo.
      l.filter = and(l.filter, ['all', ['!=', ['get', 'maritime'], 1], ['!', IN_ARCHIPELAGO]]);
    }

    if (l.type === 'symbol') {
      l.filter = and(l.filter, ['!', IN_ARCHIPELAGO]);
      const tf = l.layout?.['text-field'];
      if (tf && JSON.stringify(tf).includes('name')) {
        l.layout = { ...l.layout, 'text-field': NAME_VI };
      }
      if ('source-layer' in l && l['source-layer'] === 'water_name') {
        l.filter = and(l.filter, [
          'all',
          ['!', ['in', ['coalesce', ['get', 'name'], ''], ['literal', REPLACED_WATER_NAMES]]],
          ['!', ['in', ['coalesce', ['get', 'name_en'], ''], ['literal', REPLACED_WATER_NAMES]]],
        ]);
      }
    }
    layers.push(l);
  }
  return { ...style, layers };
}

let cached: Promise<StyleSpecification> | null = null;
export function fetchBaseStyle(): Promise<StyleSpecification> {
  cached ??= fetch(BASE_STYLE_URL).then((r) => {
    if (!r.ok) throw new Error(`style ${r.status}`);
    return r.json();
  });
  return cached;
}
