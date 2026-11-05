import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap, LngLatBoundsLike } from 'maplibre-gl';
import { bboxIntersects, bearing, angleDiff, compassVi, formatDistance, formatDuration, haversine, pointAlong, sliceFrom, type BBox, type LngLat } from './geo/geo';
import { DEPTH_CLASSES, depthLabel, loadFloodArea, loadFloodIndex, type FloodArea, type FloodFeature } from './data/flood';
import { circlePolygon, EMPTY, lineFeature, pointFeature, setData, setFloodAreas, simulationColor } from './map/layers';
import { safety } from './safety/client';
import { planEvacuation, type EvacuationOption, type EvacuationPlan } from './safety/planner';
import type { InfoResult } from './safety/protocol';
import { route as osrmRoute, type TravelMode } from './routing/osrm';
import { instructionVi, maneuverIcon, spokenVi } from './routing/instructions';
import { RouteNavigator, type Fix, type NavState } from './nav/navigator';
import { LocationService } from './nav/location';
import { hasVietnameseVoice, isVoiceEnabled, setVoiceEnabled, speak, vibrate, voiceSupported } from './nav/voice';
import { $, esc, rafThrottle, setSheet, toast } from './ui/dom';
import { ICON, MANEUVER_SVG } from './ui/icons';

type Phase = 'idle' | 'searching' | 'result' | 'navigating' | 'arrived';

const fmt1 = (n: number) => n.toFixed(1).replace('.', ',');
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export class App {
  private phase: Phase = 'idle';
  private mode: TravelMode = (store.get('mode') as TravelMode) || 'foot';
  private loc = new LocationService();
  private meMarker: maplibregl.Marker | null = null;
  private meEl = document.createElement('div');
  private info: InfoResult | null = null;
  private infoAt: LngLat | null = null;
  private plan: EvacuationPlan | null = null;
  private optionIdx = 0;
  private nav: RouteNavigator | null = null;
  private navState: NavState | null = null;
  private follow = true;
  private rerouting = false;
  private lastReroute = 0;
  private abort: AbortController | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private simLevel: number | null = null;
  private popup: maplibregl.Popup | null = null;
  private floodFeatures: FloodFeature[] = [];
  private loadedAreas = new Set<string>();
  private areas: FloodArea[] = [];

  constructor(private map: MLMap) {
    this.meEl.className = 'me';
    this.meEl.innerHTML = '<div class="cone"></div>';
    this.bindUI();
    this.bindMap();
    this.loc.onFix((f) => this.onFix(f));
    this.loc.onError((e) => this.onLocError(e));
    this.renderIdle();
    this.initFloodData();
  }

  /* ───────────────────────── flood data ───────────────────────── */

  private async initFloodData() {
    try {
      const idx = await loadFloodIndex();
      this.areas = idx.areas;
      setFloodAreas(this.map, idx.areas);
      $('scenario-chip').textContent = idx.kind === 'scenario' ? 'Kịch bản mô phỏng' : `Cập nhật ${idx.generated}`;
      this.loadVisibleAreas();
    } catch {
      toast('Không tải được dữ liệu vùng ngập. Kiểm tra kết nối mạng.');
    }
  }

  private loadVisibleAreas = () => {
    if (!this.areas.length || this.map.getZoom() < 7.5) return;
    const b = this.map.getBounds();
    const view: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    for (const a of this.areas) if (bboxIntersects(a.bbox, view)) this.loadArea(a);
  };

  private async loadArea(a: FloodArea) {
    if (this.loadedAreas.has(a.id)) return;
    this.loadedAreas.add(a.id);
    try {
      const fc = await loadFloodArea(a);
      this.floodFeatures.push(...fc.features);
      setData(this.map, 'flood', { type: 'FeatureCollection', features: this.floodFeatures } as GeoJSON.FeatureCollection);
    } catch {
      this.loadedAreas.delete(a.id);
    }
  }

  /* ───────────────────────── UI wiring ───────────────────────── */

  private bindUI() {
    const panel = $('layers-panel');
    const btnLayers = $('btn-layers');
    const togglePanel = (open = panel.hidden) => {
      panel.hidden = !open;
      btnLayers.setAttribute('aria-expanded', String(open));
      btnLayers.classList.toggle('active', open);
    };
    btnLayers.onclick = () => togglePanel();
    panel.querySelector('[data-close]')!.addEventListener('click', () => togglePanel(false));

    $('legend').innerHTML = DEPTH_CLASSES.map((c) => `<span><i style="background:${c.color}"></i>${c.short}</span>`).join('');

    const vis = (id: string, on: boolean) => this.map.getLayer(id) && this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    $<HTMLInputElement>('tg-flood').onchange = (e) => {
      const on = (e.target as HTMLInputElement).checked;
      ['flood-fill', 'flood-edge', 'flood-areas-halo', 'flood-areas-label'].forEach((id) => vis(id, on));
    };
    $<HTMLInputElement>('tg-hill').onchange = (e) => vis('hillshade', (e.target as HTMLInputElement).checked);

    const simBox = $('sim-box');
    const slider = $<HTMLInputElement>('sim-level');
    const applySim = rafThrottle((v: number) => {
      this.map.setPaintProperty('flood-sim', 'color-relief-color', simulationColor(v));
      $('sim-out').textContent = `${fmt1(v)} m`;
    });
    $<HTMLInputElement>('tg-sim').onchange = (e) => {
      const on = (e.target as HTMLInputElement).checked;
      simBox.hidden = !on;
      vis('flood-sim', on);
      this.simLevel = on ? +slider.value : null;
      if (on) {
        applySim(+slider.value);
        if (this.map.getZoom() < 9) toast('Phóng to bản đồ để xem chi tiết vùng thấp hơn mực nước.');
      }
      this.refreshInfo(true);
    };
    slider.oninput = () => {
      this.simLevel = +slider.value;
      applySim(+slider.value);
    };
    slider.onchange = () => this.refreshInfo(true);

    const voice = $<HTMLInputElement>('tg-voice');
    voice.checked = store.get('voice') !== '0';
    setVoiceEnabled(voice.checked);
    if (!voiceSupported()) { voice.disabled = true; $('voice-note').textContent = 'Trình duyệt không hỗ trợ'; }
    else setTimeout(() => { if (!hasVietnameseVoice()) $('voice-note').textContent = 'Thiết bị chưa có giọng tiếng Việt – sẽ dùng giọng mặc định'; }, 1500);
    voice.onchange = () => { setVoiceEnabled(voice.checked); store.set('voice', voice.checked ? '1' : '0'); };

    $('btn-locate').onclick = () => this.locate(true);
    $('btn-compass').onclick = () => this.map.easeTo({ bearing: 0, pitch: 0, duration: 400 });

    // Event delegation for the sheet.
    $('sheet-body').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn) return;
      e.preventDefault();
      const act = btn.dataset.act!;
      switch (act) {
        case 'find': this.findSafe(); break;
        case 'mode': this.setMode(btn.dataset.mode as TravelMode); break;
        case 'start': this.startNav(); break;
        case 'next-option': this.cycleOption(); break;
        case 'cancel': this.reset(); break;
        case 'stop': this.stopNav(); break;
        case 'recenter': this.follow = true; this.renderNavSheet(); if (this.loc.last) this.onFix(this.loc.last); break;
        case 'voice': setVoiceEnabled(!isVoiceEnabled()); $<HTMLInputElement>('tg-voice').checked = isVoiceEnabled(); this.renderNavSheet(); break;
        case 'locate': this.locate(true); break;
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.phase === 'navigating') this.requestWakeLock();
    });
  }

  private bindMap() {
    const map = this.map;
    map.on('moveend', this.loadVisibleAreas);
    map.on('rotate', rafThrottle(() => {
      const b = map.getBearing();
      $('btn-compass').hidden = Math.abs(b) < 1 && map.getPitch() < 1;
      $('compass-needle').style.transform = `rotate(${-b}deg)`;
    }));
    // User panning while navigating suspends camera follow.
    map.on('dragstart', () => {
      if (this.phase === 'navigating' && this.follow) { this.follow = false; this.renderNavSheet(); }
    });

    map.on('click', 'flood-areas-halo', (e) => {
      const id = e.features?.[0]?.properties?.id;
      const a = this.areas.find((x) => x.id === id);
      if (a) map.fitBounds(a.bbox as LngLatBoundsLike, { padding: 40, duration: 900 });
    });
    map.on('mouseenter', 'flood-areas-halo', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'flood-areas-halo', () => (map.getCanvas().style.cursor = ''));

    map.on('click', (e) => {
      if (this.phase === 'navigating' || this.phase === 'searching') return;
      if (map.queryRenderedFeatures(e.point, { layers: ['flood-areas-halo'] }).length) return;
      this.showPointInfo([e.lngLat.lng, e.lngLat.lat]);
    });
  }

  /* ───────────────────────── location ───────────────────────── */

  private async locate(fly: boolean) {
    const btn = $('btn-locate');
    btn.classList.add('busy');
    try {
      const fix = await this.loc.start();
      btn.classList.add('active');
      if (fly) this.map.flyTo({ center: fix.lngLat, zoom: Math.max(this.map.getZoom(), 15), duration: 1200, essential: true });
      return fix;
    } catch {
      return null;
    } finally {
      btn.classList.remove('busy');
    }
  }

  private onLocError(e: GeolocationPositionError | Error) {
    const denied = 'code' in e && e.code === 1;
    toast(denied
      ? 'Bạn đã chặn quyền vị trí. Hãy cho phép trong cài đặt trình duyệt, hoặc chạm vào bản đồ để chọn vị trí thủ công.'
      : 'Không lấy được vị trí GPS. Chạm vào bản đồ để chọn vị trí thủ công.', 6000);
    $('btn-locate').classList.remove('active');
  }

  private markerTween: { from: LngLat; to: LngLat; t0: number; dur: number } | null = null;

  private onFix(fix: Fix) {
    // Marker: smooth tween between fixes instead of jumping.
    if (!this.meMarker) {
      this.meMarker = new maplibregl.Marker({ element: this.meEl, rotationAlignment: 'map' }).setLngLat(fix.lngLat).addTo(this.map);
    } else {
      const cur = this.meMarker.getLngLat();
      this.markerTween = { from: [cur.lng, cur.lat], to: fix.lngLat, t0: performance.now(), dur: 700 };
      this.animateMarker();
    }
    this.meEl.classList.toggle('manual', this.loc.manual);
    this.meEl.classList.toggle('has-heading', fix.heading != null);
    if (fix.heading != null) (this.meEl.firstElementChild as HTMLElement).style.transform = `rotate(${fix.heading}deg)`;
    setData(this.map, 'me-accuracy', fix.accuracy > 15 ? circlePolygon(fix.lngLat, fix.accuracy) : EMPTY);

    if (this.phase === 'navigating') this.onNavFix(fix);
    else this.refreshInfo();
  }

  private animateMarker = () => {
    const tw = this.markerTween;
    if (!tw || !this.meMarker) return;
    const k = Math.min(1, (performance.now() - tw.t0) / tw.dur);
    const e = 1 - (1 - k) ** 3;
    this.meMarker.setLngLat([tw.from[0] + (tw.to[0] - tw.from[0]) * e, tw.from[1] + (tw.to[1] - tw.from[1]) * e]);
    if (k < 1) requestAnimationFrame(this.animateMarker);
    else this.markerTween = null;
  };

  /** Look up depth/elevation at the user position (debounced by distance). */
  private async refreshInfo(force = false) {
    const fix = this.loc.last;
    if (!fix) return;
    if (!force && this.infoAt && haversine(this.infoAt, fix.lngLat) < 25) return;
    this.infoAt = fix.lngLat;
    try {
      this.info = await safety.info(fix.lngLat, this.simLevel);
      if (this.phase === 'idle') this.renderIdle();
    } catch { /* offline DEM – keep previous */ }
  }

  /* ───────────────────────── sheet: idle ───────────────────────── */

  private statusHtml(): string {
    const fix = this.loc.last;
    if (!fix) {
      return `<div class="status"><span class="dot"></span><div><b>Chưa xác định vị trí</b><small>Bật định vị hoặc chạm vào bản đồ để chọn vị trí</small></div></div>`;
    }
    const i = this.info;
    const manual = this.loc.manual ? ' (chọn thủ công)' : '';
    if (!i) return `<div class="status"><span class="dot"></span><div><b>Đang phân tích vị trí${manual}…</b><small>Độ chính xác ±${Math.round(fix.accuracy)} m</small></div></div>`;
    const elev = i.elevation !== null ? `Độ cao mặt đất ~${fmt1(i.elevation)} m` : '';
    const sim = i.simulatedDepth !== null ? ` · Mô phỏng ngập ${fmt1(i.simulatedDepth)} m` : '';
    if (i.depth !== null || i.simulatedDepth !== null) {
      const label = i.depth !== null ? depthLabel(i.depth) : `Ngập mô phỏng ${fmt1(i.simulatedDepth!)} m`;
      return `<div class="status bad"><span class="dot"></span><div><b>Bạn đang ở vùng ngập${manual}</b><small>${esc(label)} · ${elev}${sim}</small></div></div>`;
    }
    if (i.areaName) return `<div class="status ok"><span class="dot"></span><div><b>Vị trí hiện tại không ngập${manual}</b><small>${elev} · ${esc(i.areaName)}</small></div></div>`;
    return `<div class="status warn"><span class="dot"></span><div><b>Ngoài khu vực có dữ liệu ngập${manual}</b><small>${elev}. Vẫn có thể tìm vùng cao hơn theo địa hình.</small></div></div>`;
  }

  private modeHtml() {
    const b = (m: TravelMode, icon: string, label: string) =>
      `<button data-act="mode" data-mode="${m}" aria-pressed="${this.mode === m}">${icon}${label}</button>`;
    return `<div class="seg" role="group" aria-label="Phương tiện">${b('foot', ICON.walk, 'Đi bộ')}${b('motorbike', ICON.moto, 'Xe máy')}</div>`;
  }

  private renderIdle() {
    this.phase = 'idle';
    setSheet(`
      ${this.statusHtml()}
      ${this.modeHtml()}
      <button class="cta" data-act="find">${ICON.shield}Tìm đường đến nơi an toàn</button>
      <p class="hint">Tìm vùng đất cao hơn, không ngập, gần bạn nhất theo đường đi thực tế.</p>
    `);
  }

  private setMode(m: TravelMode) {
    if (m === this.mode) return;
    this.mode = m;
    store.set('mode', m);
    if (this.phase === 'result' && this.plan) this.findSafe();
    else this.renderIdle();
  }

  /* ───────────────────────── search ───────────────────────── */

  private async findSafe(origin?: LngLat) {
    this.popup?.remove();
    let from = origin ?? this.loc.last?.lngLat;
    if (!from) {
      this.renderSearching('locate');
      const fix = await this.locate(false);
      if (!fix) { this.renderIdle(); return; }
      from = fix.lngLat;
    }
    this.abort?.abort();
    const ctrl = (this.abort = new AbortController());
    this.phase = 'searching';
    this.renderSearching('terrain');
    this.map.easeTo({ center: from, zoom: Math.max(this.map.getZoom(), 14), duration: 700 });
    try {
      const plan = await planEvacuation(from, this.mode, this.simLevel, (s) => this.renderSearching(s), ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.plan = plan;
      this.optionIdx = 0;
      this.showPlan();
    } catch (e) {
      if (ctrl.signal.aborted) return;
      console.error(e);
      toast('Không thể phân tích địa hình (cần mạng để tải dữ liệu độ cao lần đầu). Thử lại sau.');
      this.renderIdle();
    }
  }

  private renderSearching(stage: 'locate' | 'terrain' | 'network' | 'routes') {
    const order = ['locate', 'terrain', 'network', 'routes'];
    const cur = order.indexOf(stage);
    const li = (s: string, label: string) => {
      const i = order.indexOf(s);
      const cls = i < cur ? 'done' : i === cur ? 'active' : '';
      return `<li class="${cls}"><span class="sp"></span>${label}</li>`;
    };
    setSheet(`
      <ul class="steps">
        ${li('locate', 'Xác định vị trí của bạn')}
        ${li('terrain', 'Phân tích địa hình & vùng ngập xung quanh')}
        ${li('network', 'Đo khoảng cách theo mạng đường')}
        ${li('routes', 'Chọn tuyến ngắn nhất, ít đi qua nước nhất')}
      </ul>
      <button class="cta secondary" data-act="cancel" style="margin-top:10px">Hủy</button>
    `);
  }

  private get option(): EvacuationOption | null {
    if (!this.plan?.best) return null;
    const all = [this.plan.best, ...this.plan.alternatives];
    return all[this.optionIdx % all.length];
  }

  private showPlan() {
    const plan = this.plan!;
    const opt = this.option;
    this.phase = 'result';
    if (!opt) {
      setData(this.map, 'route', EMPTY);
      setData(this.map, 'safe', EMPTY);
      setSheet(`
        <div class="status bad"><span class="dot"></span><div><b>Không tìm thấy vùng cao an toàn gần đây</b><small>Đã tìm trong bán kính ${formatDistance(plan.find.radius)}</small></div></div>
        <div class="alert bad">Hãy di chuyển lên <b>tầng cao</b> của công trình kiên cố gần nhất, mang theo đèn pin, điện thoại, nước uống. Gọi <b>112</b> (cứu nạn) hoặc <b>114</b> nếu cần hỗ trợ khẩn cấp.</div>
        <button class="cta secondary" data-act="cancel" style="margin-top:12px">Quay lại</button>
      `);
      return;
    }
    const all = [plan.best!, ...plan.alternatives];
    // Draw chosen route + alternatives
    const routeCoords: LngLat[] = opt.route ? opt.route.geometry.coordinates : [plan.origin, opt.spot.lngLat];
    setData(this.map, 'route', lineFeature(routeCoords, { kind: opt.route ? 'road' : 'straight' }));
    setData(this.map, 'route-alt', {
      type: 'FeatureCollection',
      features: all.filter((o) => o !== opt && o.route).map((o) => lineFeature(o.route!.geometry.coordinates)),
    });
    setData(this.map, 'safe', {
      type: 'FeatureCollection',
      features: [
        ...plan.find.spots.filter((s) => s !== opt.spot).map((s) => pointFeature(s.lngLat, { best: false })),
        pointFeature(opt.spot.lngLat, { best: true, label: `Điểm an toàn · ${Math.round(opt.spot.elevation)} m` }),
      ],
    });
    this.fitTo(routeCoords);

    const rise = opt.spot.elevation - plan.find.userElevation;
    const dist = opt.route ? opt.route.distance : opt.spot.distance;
    const time = opt.route ? opt.route.duration : opt.spot.distance / (this.mode === 'foot' ? 1.2 : 6);
    const exp = opt.exposure;
    let alert = '';
    if (plan.offline) {
      const dir = compassVi(bearing(plan.origin, opt.spot.lngLat));
      alert = `<div class="alert warn">Không kết nối được dịch vụ chỉ đường – hiển thị <b>hướng đi thẳng</b>: đi về phía <b>${dir}</b> khoảng ${formatDistance(opt.spot.distance)}. Ưu tiên đường lớn, tránh chỗ nước chảy xiết.</div>`;
    } else if (exp.deep > 0) {
      alert = `<div class="alert bad">Tuyến có ~${formatDistance(exp.deep)} đi qua chỗ ngập sâu &gt; 0,5 m. Cẩn thận dòng chảy, hố ga; không đi khi nước chảy xiết.</div>`;
    } else if (exp.flooded > 0) {
      alert = `<div class="alert warn">Tuyến có ~${formatDistance(exp.flooded)} đi qua vùng ngập nông. Đi chậm, dò đường bằng gậy.</div>`;
    } else {
      alert = `<div class="alert ok">Tuyến không đi qua vùng ngập đã biết.</div>`;
    }
    const relaxed = plan.find.relaxed ? '<p class="hint">Không có điểm cao rõ rệt gần bạn – đã nới tiêu chí độ cao.</p>' : '';
    setSheet(`
      ${this.modeHtml()}
      <div class="dest">
        <div class="badge">${ICON.mountain}</div>
        <div>
          <h3>Vùng cao an toàn gần nhất</h3>
          <p>Cao ~${Math.round(opt.spot.elevation)} m${rise > 0.5 ? ` · cao hơn bạn ${fmt1(rise)} m` : ''} · diện tích khô ${opt.spot.area > 1e4 ? `${fmt1(opt.spot.area / 1e4)} ha` : `${Math.round(opt.spot.area / 100) * 100} m²`}</p>
        </div>
      </div>
      <div class="stats">
        <div><b>${formatDistance(dist)}</b><small>${plan.offline ? 'đường chim bay' : 'quãng đường'}</small></div>
        <div><b>${formatDuration(time)}</b><small>${this.mode === 'foot' ? 'đi bộ' : 'xe máy'}</small></div>
        <div><b>${new Date(Date.now() + time * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</b><small>dự kiến đến</small></div>
      </div>
      ${alert}
      <div class="btn-row">
        <button class="cta" data-act="start">${ICON.play}Bắt đầu dẫn đường</button>
        ${all.length > 1 ? `<button class="cta secondary" data-act="next-option" aria-label="Tuyến khác" title="Tuyến khác (${this.optionIdx % all.length + 1}/${all.length})">${ICON.swap}</button>` : `<button class="cta secondary" data-act="cancel" aria-label="Đóng">${ICON.close}</button>`}
      </div>
      ${all.length > 1 ? `<p class="hint">Phương án ${this.optionIdx % all.length + 1}/${all.length} · <a href="#" data-act="cancel">Hủy</a></p>` : ''}
      ${relaxed}
    `);
  }

  private cycleOption() {
    this.optionIdx++;
    this.showPlan();
  }

  private fitTo(coords: LngLat[]) {
    const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    for (const c of coords) b.extend(c);
    const desktop = matchMedia('(min-width: 768px)').matches;
    const sheetH = $('sheet').getBoundingClientRect().height;
    this.map.fitBounds(b, {
      padding: desktop ? { top: 80, bottom: 60, left: 420, right: 80 } : { top: 90, bottom: Math.min(sheetH + 30, innerHeight * 0.6), left: 40, right: 70 },
      maxZoom: 17,
      duration: 900,
    });
  }

  private reset() {
    this.abort?.abort();
    this.plan = null;
    this.nav = null;
    setData(this.map, 'route', EMPTY);
    setData(this.map, 'route-alt', EMPTY);
    setData(this.map, 'safe', EMPTY);
    this.renderIdle();
  }

  /* ───────────────────────── point info popup ───────────────────────── */

  private async showPointInfo(p: LngLat) {
    this.popup?.remove();
    const el = document.createElement('div');
    el.innerHTML = `<div class="pi-title">Đang tra cứu…</div>`;
    const popup = (this.popup = new maplibregl.Popup({ maxWidth: '280px', offset: 8 }).setLngLat(p).setDOMContent(el).addTo(this.map));
    let i: InfoResult | null = null;
    try { i = await safety.info(p, this.simLevel); } catch { /* offline */ }
    if (this.popup !== popup) return;
    const depth = i ? (i.depth !== null ? depthLabel(i.depth) : 'Không ngập') : '—';
    el.innerHTML = `
      <div class="pi-title">${esc(i?.areaName ?? 'Thông tin vị trí')}</div>
      <div class="pi-grid">
        <span>Độ cao</span><b>${i?.elevation != null ? `${fmt1(i.elevation)} m` : '—'}</b>
        <span>Vùng ngập</span><b>${depth}</b>
        ${i?.simulatedDepth != null ? `<span>Mô phỏng</span><b>ngập ${fmt1(i.simulatedDepth)} m</b>` : ''}
      </div>
      <div class="pi-actions">
        <button data-pa="here">📍 Đặt làm vị trí của tôi</button>
        <button data-pa="find">🛟 Tìm nơi an toàn từ đây</button>
      </div>`;
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-pa]')?.dataset.pa;
      if (!a) return;
      popup.remove();
      this.loc.stop();
      $('btn-locate').classList.remove('active');
      this.infoAt = null;
      this.loc.setManual(p);
      if (a === 'find') this.findSafe(p);
    });
  }

  /* ───────────────────────── navigation ───────────────────────── */

  private async requestWakeLock() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      this.wakeLock = (await wl?.request('screen')) ?? null;
    } catch { /* not supported / denied */ }
  }

  private startNav() {
    const opt = this.option;
    if (!opt) return;
    this.phase = 'navigating';
    this.follow = true;
    this.nav = opt.route ? new RouteNavigator(opt.route, this.mode) : null;
    document.body.classList.add('navigating');
    $('nav-banner').hidden = false;
    setData(this.map, 'route-alt', EMPTY);
    this.requestWakeLock();
    // Live GPS is required for guidance unless the user picked a manual start point.
    if (!this.loc.manual) this.loc.start().catch(() => {});
    const first = opt.route ? this.nav!.steps[1] : null;
    speak(`Bắt đầu dẫn đường đến vùng cao an toàn, cách ${formatDistance(opt.route?.distance ?? opt.spot.distance)}.${first ? ' ' + instructionVi(first) : ''}`, true);
    this.renderNavSheet();
    if (this.loc.last) this.onNavFix(this.loc.last);
  }

  private renderNavSheet() {
    if (this.phase !== 'navigating') return;
    const s = this.navState;
    const opt = this.option!;
    const remaining = s ? s.remaining : opt.spot.distance;
    const time = s ? s.remainingTime : remaining / (this.mode === 'foot' ? 1.2 : 6);
    setSheet(`
      <div class="nav-bar">
        <button class="round stop" data-act="stop" aria-label="Dừng dẫn đường">${ICON.close}</button>
        <div class="eta"><b>${formatDuration(time)}</b><small>${formatDistance(remaining)} · đến lúc ${new Date(Date.now() + time * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small></div>
        <button class="round" data-act="voice" aria-label="Bật/tắt giọng nói">${isVoiceEnabled() ? ICON.volume : ICON.mute}</button>
        ${this.follow ? '' : `<button class="round" data-act="recenter" aria-label="Về vị trí của tôi">${ICON.recenter}</button>`}
      </div>
    `);
  }

  private renderBanner = rafThrottle((s: NavState | null, fix: Fix) => {
    const banner = $('nav-banner');
    const opt = this.option!;
    banner.classList.toggle('off', !!s?.offRoute || this.rerouting);
    if (this.rerouting) {
      $('nav-icon').innerHTML = MANEUVER_SVG.uturn;
      $('nav-dist').textContent = 'Đang tìm lại đường…';
      $('nav-instr').textContent = 'Bạn đã đi lệch khỏi tuyến';
      return;
    }
    if (!s) {
      // Straight-line guidance (offline): arrow relative to heading.
      const d = haversine(fix.lngLat, opt.spot.lngLat);
      const brg = bearing(fix.lngLat, opt.spot.lngLat);
      const rel = fix.heading != null ? angleDiff(fix.heading, brg) : brg - this.map.getBearing();
      $('nav-icon').innerHTML = `<div style="transform:rotate(${rel}deg);transition:transform .4s">${MANEUVER_SVG.straight}</div>`;
      $('nav-dist').textContent = formatDistance(d);
      $('nav-instr').textContent = `Đi về hướng ${compassVi(brg)} tới vùng cao`;
      return;
    }
    if (s.joining && s.offset > 25) {
      const brg = bearing(fix.lngLat, s.snapped);
      const rel = fix.heading != null ? angleDiff(fix.heading, brg) : brg - this.map.getBearing();
      $('nav-icon').innerHTML = `<div style="transform:rotate(${rel}deg);transition:transform .4s">${MANEUVER_SVG.straight}</div>`;
      $('nav-dist').textContent = formatDistance(s.offset);
      $('nav-instr').textContent = `Đi về hướng ${compassVi(brg)} để ra đường gần nhất`;
      return;
    }
    const next = s.next;
    $('nav-icon').innerHTML = MANEUVER_SVG[next ? maneuverIcon(next) : 'arrive'];
    $('nav-dist').textContent = formatDistance(s.distanceToNext);
    $('nav-instr').textContent = next ? instructionVi(next) : 'Đến điểm an toàn';
  });

  private onNavFix(fix: Fix) {
    const opt = this.option;
    if (!opt) return;
    let state: NavState | null = null;
    let camCenter = fix.lngLat;
    if (this.nav) {
      state = this.nav.update(fix);
      this.navState = state;
      camCenter = state.offRoute ? fix.lngLat : state.snapped;
      setData(this.map, 'route', lineFeature(sliceFrom(this.nav.line, state.along), { kind: 'road' }));
      if (state.announce) {
        const a = state.announce;
        speak(spokenVi(a.step, a.distance), a.stage === 'now');
        if (a.stage !== 'far') vibrate(a.stage === 'now' ? [80, 60, 80] : 60);
      }
      if (state.arrived) return this.arrive();
      if (state.offRoute) this.reroute(fix);
    } else {
      setData(this.map, 'route', lineFeature([fix.lngLat, opt.spot.lngLat], { kind: 'straight' }));
      if (haversine(fix.lngLat, opt.spot.lngLat) < 25) return this.arrive();
    }
    this.renderBanner(state, fix);
    this.renderNavSheetThrottled();

    if (this.follow) {
      const banner = $('nav-banner').getBoundingClientRect();
      const sheetH = $('sheet').getBoundingClientRect().height;
      const desktop = matchMedia('(min-width: 768px)').matches;
      this.map.easeTo({
        center: camCenter,
        zoom: this.mode === 'foot' ? 17.2 : 16.3,
        pitch: 50,
        // No compass/GPS course (e.g. standing still)? Face along the route instead.
        bearing: fix.heading ?? (this.nav && state && !state.offRoute
          ? bearing(state.snapped, pointAlong(this.nav.line, state.along + 25))
          : this.map.getBearing()),
        padding: { top: banner.bottom + 10, bottom: desktop ? 40 : sheetH + innerHeight * 0.18, left: desktop ? 400 : 0, right: 0 },
        duration: this.loc.manual ? 600 : 950,
        easing: (t) => t,
        essential: true,
      });
    }
  }

  private navSheetAt = 0;
  private renderNavSheetThrottled() {
    const now = performance.now();
    if (now - this.navSheetAt < 3000) return;
    this.navSheetAt = now;
    this.renderNavSheet();
  }

  private async reroute(fix: Fix) {
    const opt = this.option;
    if (!opt || this.rerouting || Date.now() - this.lastReroute < 8000) return;
    this.rerouting = true;
    this.lastReroute = Date.now();
    speak('Đang tìm lại đường', true);
    try {
      const r = await osrmRoute(this.mode, fix.lngLat, opt.spot.lngLat, undefined, fix.heading);
      if (this.phase !== 'navigating') return;
      opt.route = r;
      this.nav = new RouteNavigator(r, this.mode);
      const first = this.nav.steps[1];
      if (first) speak(instructionVi(first));
    } catch {
      toast('Mất kết nối – tạm chỉ hướng đi thẳng tới điểm an toàn.');
      this.nav = null;
    } finally {
      this.rerouting = false;
    }
  }

  private arrive() {
    this.phase = 'arrived';
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    $('nav-banner').hidden = true;
    document.body.classList.remove('navigating');
    speak('Bạn đã đến vùng cao an toàn. Hãy ở lại và theo dõi thông báo của chính quyền địa phương.', true);
    vibrate([120, 80, 120, 80, 200]);
    this.map.easeTo({ pitch: 0, bearing: 0, zoom: 16.5, duration: 800 });
    setSheet(`
      <div class="dest"><div class="badge">${ICON.check}</div><div><h3>Bạn đã đến nơi an toàn</h3><p>Ở lại vùng cao, giữ điện thoại có pin, theo dõi bản tin thời tiết và hướng dẫn của chính quyền. Khẩn cấp gọi <b>112</b>.</p></div></div>
      <button class="cta secondary" data-act="cancel" style="margin-top:14px">Xong</button>
    `);
  }

  private stopNav() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    $('nav-banner').hidden = true;
    document.body.classList.remove('navigating');
    this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    this.navState = null;
    if (this.plan) this.showPlan(); else this.reset();
  }
}

