/**
 * Chuẩn hoá văn bản trước khi đưa vào bộ đọc (TTS): mở rộng chữ viết tắt
 * thường gặp trong tên đường OSM, đọc số/đơn vị thành chữ để giọng đọc
 * không đánh vần từng ký tự.
 */

/** Viết tắt trong tên đường → cách đọc đầy đủ. Áp dụng khi đứng trước số/tên. */
const B = String.raw`(?<![\p{L}\p{N}])`; // đầu từ (hỗ trợ chữ có dấu, khác \b)
const abbr = (src: string, rep: string, flags = 'gu'): [RegExp, string] => [new RegExp(B + src, flags), rep];
const ABBR: [RegExp, string][] = [
  abbr(String.raw`QL\.?\s*(?=\d)`, 'Quốc lộ ', 'giu'),
  abbr(String.raw`ĐT\.?\s*(?=\d)`, 'Đường tỉnh '),
  abbr(String.raw`TL\.?\s*(?=\d)`, 'Tỉnh lộ '),
  abbr(String.raw`ĐH\.?\s*(?=\d)`, 'Đường huyện '),
  abbr(String.raw`HL\.?\s*(?=\d)`, 'Hương lộ '),
  abbr(String.raw`AH\.?\s*(?=\d)`, 'Xa lộ châu Á '),
  abbr(String.raw`CT\.?\s*(?=\d)`, 'Cao tốc '),
  abbr(String.raw`KP\.?\s*(?=\d)`, 'Khu phố ', 'giu'),
  abbr(String.raw`Đ\.\s*`, 'Đường '),
  abbr(String.raw`P\.\s*`, 'Phố '),
  abbr(String.raw`Ng\.\s*`, 'Ngõ '),
  abbr(String.raw`H\.\s*(?=\d)`, 'Hẻm '),
  abbr(String.raw`K\.\s*(?=\d)`, 'Kiệt '),
  abbr(String.raw`TT\.\s*`, 'Thị trấn '),
  abbr(String.raw`TP\.\s*`, 'Thành phố '),
  abbr(String.raw`Q\.\s*(?=\d)`, 'Quận '),
];

/**
 * "Đường 3/2", "30/4" → "3 tháng 2" (tên đường theo ngày lễ);
 * "Hẻm 18/5" → "18 xẹt 5" (số hẻm).
 */
function slashes(s: string): string {
  return s.replace(/(^|\s)((?:hẻm|kiệt|ngõ|ngách|số)\s+)?(\d{1,4})\/(\d{1,4})/giu, (_m, pre: string, alley: string | undefined, a: string, b: string) => {
    const isDate = +a >= 1 && +a <= 31 && +b >= 1 && +b <= 12;
    return !alley && isDate ? `${pre}${a} tháng ${b}` : `${pre}${alley ?? ''}${a} xẹt ${b}`;
  });
}

export function normalizeRoadName(name: string): string {
  let s = name.trim();
  for (const [re, rep] of ABBR) s = s.replace(re, rep);
  s = slashes(s);
  // "1A" → "1 A" để đọc rõ chữ cái sau số
  s = s.replace(/(\d)([A-ZĐ])(?![\p{L}])/gu, '$1 $2');
  // Gạch nối / dấu chấm thừa giữa các phần tên → ngắt nghỉ nhẹ
  s = s.replace(/\s*[–—-]\s*/g, ', ').replace(/\s{2,}/g, ' ');
  return s;
}

/** Khoảng cách dạng lời nói: "150 mét", "1,5 ki lô mét", "2 ki lô mét". */
export function spokenDistance(m: number): string {
  if (m < 1000) {
    const r = m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50;
    return `${r} mét`;
  }
  const km = Math.round(m / 100) / 10;
  // "1 phẩy 5" đọc rõ hơn "1,5" trên nhiều giọng (một số giọng đọc dấu phẩy thành khoảng nghỉ).
  return `${Number.isInteger(km) ? km : km.toString().replace('.', ' phẩy ')} ki lô mét`;
}

/** Thời gian dạng lời nói. */
export function spokenDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} phút`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} giờ ${r} phút` : `${h} giờ`;
}

/** Chuẩn hoá cả câu: tên đường, ký hiệu, và các đơn vị còn sót lại. */
export function normalizeSpeech(text: string): string {
  let s = normalizeRoadName(text);
  s = s
    .replace(/(\d),(\d)\s*km(?![\p{L}])/gu, '$1 phẩy $2 ki lô mét')
    .replace(/(\d)\s*km(?![\p{L}])/gu, '$1 ki lô mét')
    .replace(/(\d)\s*m(?![\p{L}])/gu, '$1 mét')
    .replace(/>/g, ' trên ')
    .replace(/</g, ' dưới ')
    .replace(/&/g, ' và ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Kết câu bằng dấu chấm giúp giọng đọc hạ giọng tự nhiên.
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}
