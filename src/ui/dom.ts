export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 3800) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

/** Replace the bottom sheet content and keep the floating buttons above it. */
export function setSheet(html: string) {
  const body = $('sheet-body');
  body.innerHTML = html;
  syncSheetHeight();
}

let ro: ResizeObserver | null = null;
export function syncSheetHeight() {
  const sheet = $('sheet');
  const apply = () => {
    const h = sheet.hidden ? 0 : sheet.getBoundingClientRect().height;
    const desktop = matchMedia('(min-width: 768px)').matches;
    document.documentElement.style.setProperty('--sheet-h', `${Math.round(h)}px`);
    document.documentElement.style.setProperty('--attrib-offset', desktop ? '0px' : `${Math.round(h)}px`);
  };
  if (!ro) {
    ro = new ResizeObserver(apply);
    ro.observe(sheet);
  }
  apply();
}

/** Coalesce frequent DOM writes into one per animation frame. */
export function rafThrottle<A extends unknown[]>(fn: (...a: A) => void) {
  let queued: A | null = null;
  return (...a: A) => {
    if (!queued) requestAnimationFrame(() => { const q = queued!; queued = null; fn(...q); });
    queued = a;
  };
}
