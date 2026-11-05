/** Vietnamese text-to-speech via the Web Speech API (silently no-ops where unsupported). */
let enabled = true;
let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  voice = voices.find((v) => v.lang?.toLowerCase().startsWith('vi')) ?? null;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const hasVietnameseVoice = () => !!voice;
export const isVoiceEnabled = () => enabled;
export function setVoiceEnabled(v: boolean) {
  enabled = v;
  if (!v && voiceSupported()) speechSynthesis.cancel();
}

export function speak(text: string, interrupt = false) {
  if (!enabled || !voiceSupported()) return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'vi-VN';
  if (voice) u.voice = voice;
  u.rate = 1.02;
  speechSynthesis.speak(u);
}

export function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}
