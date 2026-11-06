/**
 * Giọng đọc tiếng Việt qua Web Speech API.
 *
 * Những điểm làm giọng đọc khó nghe và cách xử lý:
 *  - Chọn nhầm giọng: xếp hạng mọi giọng vi‑VN (giọng "Natural/Online/Neural",
 *    Google, Microsoft HoaiMy/NamMinh, Apple Linh…) và chọn giọng tốt nhất;
 *    người dùng có thể đổi và nghe thử. Nếu máy KHÔNG có giọng tiếng Việt thì
 *    không đọc (giọng tiếng Anh đọc chữ Việt gần như không nghe được), chỉ
 *    rung + hiện chữ, kèm hướng dẫn cài giọng.
 *  - Danh sách giọng nạp bất đồng bộ (Chrome trả mảng rỗng lúc đầu): chờ
 *    sự kiện voiceschanged + thăm dò dự phòng.
 *  - Câu nhắc dồn hàng → đọc trễ, sai thời điểm: tự quản lý hàng đợi, câu mới
 *    thay câu đang chờ; câu khẩn (rẽ ngay, tính lại đường) cắt ngang.
 *  - Giọng online lỗi khi mạng yếu: tự chuyển sang giọng offline.
 *  - Chrome đôi khi kẹt ở trạng thái "paused" sau khi ẩn tab: resume() trước
 *    khi đọc; câu dài được tách theo câu để tránh bị cắt giữa chừng.
 *  - Văn bản: mở rộng viết tắt tên đường, đọc số/đơn vị (speech-text.ts).
 */
import { normalizeSpeech } from './speech-text';

export interface VoiceOption {
  uri: string;
  label: string;
  local: boolean;
}

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

let enabled = true;
let voices: SpeechSynthesisVoice[] = [];
let voice: SpeechSynthesisVoice | null = null;
let preferredUri: string | null = null;
let rate = 0.95;
const listeners = new Set<() => void>();

try { preferredUri = localStorage.getItem('voiceURI'); rate = +(localStorage.getItem('voiceRate') ?? rate) || rate; } catch { /* ignore */ }

const isVi = (v: SpeechSynthesisVoice) => /^vi([-_]|$)/i.test(v.lang ?? '') || /vietnam|tiếng việt/i.test(v.name);

/** Điểm chất lượng ước lượng của một giọng tiếng Việt. */
export function scoreVoice(v: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService'>): number {
  let s = 0;
  if (/^vi[-_]VN$/i.test(v.lang)) s += 10;
  if (/natural|neural|online|premium|enhanced|wavenet/i.test(v.name)) s += 50;
  if (/hoaimy|hoài my|namminh|nam minh|linh/i.test(v.name)) s += 25;
  if (/google/i.test(v.name)) s += 20;
  if (/espeak|compact/i.test(v.name)) s -= 40;
  return s;
}

function refresh() {
  if (!supported) return;
  const all = speechSynthesis.getVoices();
  if (!all.length) return;
  voices = all.filter(isVi).sort((a, b) => scoreVoice(b) - scoreVoice(a));
  voice = voices.find((v) => v.voiceURI === preferredUri) ?? voices[0] ?? null;
  listeners.forEach((l) => l());
}

if (supported) {
  refresh();
  speechSynthesis.addEventListener?.('voiceschanged', refresh);
  // Một số trình duyệt (Safari cũ, WebView) không bắn voiceschanged.
  let tries = 0;
  const poll = setInterval(() => { refresh(); if (voices.length || ++tries > 20) clearInterval(poll); }, 250);
}

export const voiceSupported = () => supported;
export const hasVietnameseVoice = () => !!voice;
export const isVoiceEnabled = () => enabled;
export const onVoicesChanged = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const getVoiceRate = () => rate;

export function listVietnameseVoices(): VoiceOption[] {
  return voices.map((v) => ({
    uri: v.voiceURI,
    label: v.name.replace(/\s*-\s*Vietnamese.*$/i, '').replace(/^Microsoft\s+/i, '') + (v.localService || /online/i.test(v.name) ? '' : ' · online'),
    local: v.localService,
  }));
}
export const currentVoiceUri = () => voice?.voiceURI ?? null;

export function setVoice(uri: string) {
  preferredUri = uri;
  voice = voices.find((v) => v.voiceURI === uri) ?? voice;
  try { localStorage.setItem('voiceURI', uri); } catch { /* ignore */ }
}

export function setVoiceRate(r: number) {
  rate = Math.min(1.3, Math.max(0.7, r));
  try { localStorage.setItem('voiceRate', String(rate)); } catch { /* ignore */ }
}

export function setVoiceEnabled(v: boolean) {
  enabled = v;
  if (!v) stop();
}

/* ─────────── hàng đợi ─────────── */

let speaking = false;
let pending: string[] | null = null;
let lastText = '';
let lastAt = 0;
/** Tăng mỗi lần cắt ngang – bỏ qua onend muộn của utterance cũ. */
let gen = 0;

export function stop() {
  gen++;
  pending = null;
  speaking = false;
  if (supported) speechSynthesis.cancel();
}

/** Tách câu dài để tránh lỗi Chrome cắt ngang utterance dài. */
function chunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && (out[out.length - 1] + ' ' + p).length < 120) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

function utter(text: string, v: SpeechSynthesisVoice, onDone: () => void, retried = false) {
  const u = new SpeechSynthesisUtterance(text);
  u.voice = v;
  u.lang = v.lang || 'vi-VN';
  u.rate = rate;
  u.pitch = 1;
  u.volume = 1;
  u.onend = onDone;
  u.onerror = (e) => {
    // "interrupted"/"canceled" là do chính ta cắt ngang – không phải lỗi.
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    // Giọng online lỗi (mạng yếu) → thử lại bằng giọng offline.
    const local = voices.find((x) => x.localService && x !== v);
    if (!retried && local) utter(text, local, onDone, true);
    else onDone();
  };
  speechSynthesis.speak(u);
}

function next() {
  if (!pending?.length || !voice) { speaking = false; pending = null; return; }
  speaking = true;
  const text = pending.shift()!;
  const g = gen;
  utter(text, voice, () => { if (g === gen) next(); });
}

/**
 * Đọc một câu. `urgent` cắt ngang câu đang đọc; câu thường thay thế câu đang
 * chờ (không xếp chồng), để lời nhắc luôn khớp vị trí hiện tại.
 * Trả về false nếu không thể đọc (tắt tiếng / không có giọng tiếng Việt).
 */
export function speak(text: string, urgent = false): boolean {
  if (!enabled || !supported || !voice) return false;
  const clean = normalizeSpeech(text);
  const now = Date.now();
  if (clean === lastText && now - lastAt < 4000) return true; // chống lặp
  lastText = clean;
  lastAt = now;
  if (speechSynthesis.paused) speechSynthesis.resume();
  if (urgent && (speaking || speechSynthesis.speaking)) {
    gen++;
    speechSynthesis.cancel();
    speaking = false;
  }
  pending = chunks(clean);
  if (!speaking && !speechSynthesis.speaking) next();
  else if (!speaking) {
    // Đang có âm thanh từ nơi khác (lần đọc trước chưa dọn) – dọn rồi đọc.
    gen++;
    speechSynthesis.cancel();
    next();
  }
  return true;
}

/** Đọc thử (gọi trong sự kiện chạm để iOS cho phép phát âm). */
export function testVoice() {
  const was = enabled;
  enabled = true;
  speak('Sau 200 mét, rẽ phải vào Quốc lộ 1 A. Tiếp tục đi thẳng đến vùng cao an toàn.', true);
  enabled = was;
}

export function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}
