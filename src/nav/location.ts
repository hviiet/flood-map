import { bearing, haversine, type LngLat } from '../geo/geo';
import type { Fix } from './navigator';

type Listener = (fix: Fix) => void;
type ErrorListener = (err: GeolocationPositionError | Error) => void;

/**
 * GPS + compass. Exposes a single stream of fixes; a manually chosen position
 * (long-press on the map) overrides GPS until cleared – useful when GPS is
 * unavailable indoors or to plan for somebody else.
 */
export class LocationService {
  private watchId: number | null = null;
  private listeners = new Set<Listener>();
  private errorListeners = new Set<ErrorListener>();
  private compass: number | null = null;
  private orientationBound = false;
  last: Fix | null = null;
  manual = false;

  get active() {
    return this.watchId !== null || this.manual;
  }

  onFix(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  onError(l: ErrorListener) { this.errorListeners.add(l); return () => this.errorListeners.delete(l); }

  private emit(fix: Fix) {
    this.last = fix;
    for (const l of this.listeners) l(fix);
  }

  start(): Promise<Fix> {
    if (this.watchId !== null && !this.manual && this.last) return Promise.resolve(this.last);
    this.manual = false;
    this.bindCompass();
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        const e = new Error('Thiết bị không hỗ trợ định vị');
        this.errorListeners.forEach((l) => l(e));
        reject(e);
        return;
      }
      let first = true;
      if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (this.manual) return;
          const lngLat: LngLat = [pos.coords.longitude, pos.coords.latitude];
          const prev = this.last;
          let heading = pos.coords.heading;
          const speed = pos.coords.speed;
          // GPS course is only meaningful while moving; otherwise use compass / movement.
          if (heading == null || Number.isNaN(heading) || (speed ?? 0) < 0.8) {
            heading = this.compass;
            if (heading == null && prev && haversine(prev.lngLat, lngLat) > 4) heading = bearing(prev.lngLat, lngLat);
          }
          const fix: Fix = { lngLat, accuracy: pos.coords.accuracy, heading, speed, time: pos.timestamp };
          this.emit(fix);
          if (first) { first = false; resolve(fix); }
        },
        (err) => {
          // Once tracking, transient TIMEOUT / POSITION_UNAVAILABLE (stationary device,
          // tunnels, emulators) are harmless while the last fix is still fresh.
          if (!first && err.code !== err.PERMISSION_DENIED && this.last && Date.now() - this.last.time < 30000) return;
          this.errorListeners.forEach((l) => l(err));
          if (first) { first = false; reject(err); }
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
      );
    });
  }

  setManual(lngLat: LngLat) {
    this.manual = true;
    this.emit({ lngLat, accuracy: 5, heading: null, speed: null, time: Date.now() });
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  /** iOS needs an explicit permission request from a user gesture. */
  private bindCompass() {
    if (this.orientationBound || typeof DeviceOrientationEvent === 'undefined') return;
    this.orientationBound = true;
    const handler = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      if (typeof e.webkitCompassHeading === 'number') this.compass = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) this.compass = (360 - e.alpha) % 360;
    };
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    const bind = () => {
      window.addEventListener('deviceorientationabsolute' as 'deviceorientation', handler as EventListener, { passive: true });
      window.addEventListener('deviceorientation', handler as EventListener, { passive: true });
    };
    if (typeof DOE.requestPermission === 'function') {
      DOE.requestPermission().then((r) => r === 'granted' && bind()).catch(() => {});
    } else bind();
  }
}
