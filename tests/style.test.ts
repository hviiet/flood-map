import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { transformStyle } from '../src/map/style';
import { simulationColor } from '../src/map/layers';
import { SOVEREIGNTY_LABELS, HOANG_SA, TRUONG_SA } from '../src/map/sovereignty';
import { pointInPolygon, type LngLat, type Polygon } from '../src/geo/geo';

const base = {
  version: 8,
  sources: {},
  layers: [
    { id: 'boundary_disputed', type: 'line', source: 'x', 'source-layer': 'boundary' },
    { id: 'boundary_2', type: 'line', source: 'x', 'source-layer': 'boundary', filter: ['==', ['get', 'admin_level'], 2] },
    { id: 'water_name_point_label', type: 'symbol', source: 'x', 'source-layer': 'water_name', layout: { 'text-field': ['get', 'name'] } },
    { id: 'building-3d', type: 'fill-extrusion', source: 'x', 'source-layer': 'building' },
  ],
} as unknown as StyleSpecification;

describe('Vietnam style transform', () => {
  it('removes disputed boundaries, hides labels in the archipelagos, prefers Vietnamese names', () => {
    const s = transformStyle(base, { lowEnd: false });
    const ids = s.layers.map((l) => l.id);
    expect(ids).not.toContain('boundary_disputed');
    const json = JSON.stringify(s.layers);
    expect(json).toContain('"within"');
    expect(json).toContain('name:vi');
    expect(json).toContain('South China Sea');
    expect(transformStyle(base, { lowEnd: true }).layers.map((l) => l.id)).not.toContain('building-3d');
  });

  it('labels Hoàng Sa and Trường Sa as Vietnamese, inside their areas', () => {
    const names = SOVEREIGNTY_LABELS.features.map((f) => f.properties!.name as string);
    expect(names).toContain('Quần đảo Hoàng Sa\n(Việt Nam)');
    expect(names).toContain('Quần đảo Trường Sa\n(Việt Nam)');
    expect(names).toContain('Biển Đông');
    for (const f of SOVEREIGNTY_LABELS.features.filter((f) => f.properties!.kind === 'island')) {
      const p = f.geometry.coordinates as LngLat;
      const inside = pointInPolygon(p, HOANG_SA.coordinates as Polygon) || pointInPolygon(p, TRUONG_SA.coordinates as Polygon);
      expect(inside, f.properties!.name).toBe(true);
    }
  });

  it('builds a strictly increasing color-relief ramp for any level', () => {
    for (const level of [0, 0.5, 1, 3, 12]) {
      const expr = simulationColor(level) as unknown[];
      const stops = expr.slice(3).filter((_, i) => i % 2 === 0) as number[];
      for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    }
  });
});
