import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { fetchBaseStyle, transformStyle } from './map/style';
import { addOverlayLayers } from './map/layers';
import { App } from './app';
import { safety } from './safety/client';
import { syncSheetHeight } from './ui/dom';

/** Rough device tier: trims expensive rendering on low-end phones. */
function detectLowEnd(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  return cores <= 4 || mem <= 3 || !!nav.connection?.saveData || new URLSearchParams(location.search).has('lite');
}

/** Lãnh thổ Việt Nam gồm cả Hoàng Sa, Trường Sa. */
const VIETNAM_BOUNDS: [[number, number], [number, number]] = [[102.1, 6.6], [117.4, 23.4]];

async function boot() {
  maplibregl.setWorkerUrl(workerUrl);
  const lowEnd = detectLowEnd();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  syncSheetHeight();

  const base = await fetchBaseStyle();
  const style = transformStyle(base, { lowEnd });

  const map = new maplibregl.Map({
    container: 'map',
    style,
    bounds: VIETNAM_BOUNDS,
    fitBoundsOptions: { padding: matchMedia('(min-width: 768px)').matches ? { top: 40, bottom: 40, left: 400, right: 40 } : { top: 70, bottom: 250, left: 10, right: 10 } },
    minZoom: 3,
    maxZoom: 19,
    maxPitch: 60,
    // Cap device-pixel ratio: 3× DPR quadruples fill-rate cost for little visual gain.
    pixelRatio: Math.min(devicePixelRatio || 1, lowEnd ? 1.5 : 2),
    fadeDuration: lowEnd || reducedMotion ? 0 : 200,
    maxTileCacheSize: lowEnd ? 200 : null,
    renderWorldCopies: false,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: !lowEnd, powerPreference: 'high-performance' },
    cooperativeGestures: false,
    dragRotate: true,
    pitchWithRotate: true,
    localIdeographFontFamily: "'Noto Sans', sans-serif",
  });
  map.touchZoomRotate.enableRotation();
  if (matchMedia('(min-width: 768px) and (pointer: fine)').matches) {
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  }
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 90 }), matchMedia('(min-width: 768px)').matches ? 'bottom-right' : 'bottom-left');

  map.once('load', () => {
    addOverlayLayers(map, { lowEnd });
    new App(map);
    if (import.meta.env.DEV || location.search.includes('debug')) (window as unknown as { __map: typeof map }).__map = map;
    document.getElementById('boot')!.classList.add('done');
    setTimeout(() => document.getElementById('boot')?.remove(), 500);
    // Warm up the analysis worker when the main thread is idle.
    (window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500)))(() => safety.warmup());
  });

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
  }
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('boot');
  if (el) el.innerHTML = '<span>Không tải được bản đồ. Kiểm tra kết nối mạng và thử lại.</span><button onclick="location.reload()" style="margin-top:8px;padding:8px 16px;border-radius:10px;border:0">Thử lại</button>';
});
