import type { LngLat } from '../geo/geo';
import type { ExposureResult, FindResult, InfoResult, WorkerRequest, WorkerResponse } from './protocol';
import SafetyWorker from './safety.worker?worker';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Promise-based façade over the safety Web Worker (keeps heavy raster work off the UI thread). */
class SafetyClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new SafetyWorker();
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result); else p.reject(new Error(ev.data.error));
    };
    this.worker = w;
    const floodBase = new URL(`${import.meta.env.BASE_URL}data/flood/`, location.href).href;
    this.call({ type: 'init', floodBase });
    return w;
  }

  private call<T>(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<T> {
    const w = this.ensure();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ ...req, id });
    });
  }

  find(origin: LngLat, waterLevel: number | null) {
    return this.call<FindResult>({ type: 'find', origin, waterLevel });
  }
  exposure(coords: LngLat[], waterLevel: number | null) {
    return this.call<ExposureResult>({ type: 'exposure', coords, waterLevel });
  }
  info(point: LngLat, waterLevel: number | null) {
    return this.call<InfoResult>({ type: 'info', point, waterLevel });
  }
  /** Spin the worker up early (during idle time) so the first search is instant. */
  warmup() {
    this.ensure();
  }
}

export const safety = new SafetyClient();
