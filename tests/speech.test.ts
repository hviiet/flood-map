import { describe, expect, it } from 'vitest';
import { normalizeRoadName, normalizeSpeech, spokenDistance } from '../src/nav/speech-text';
import { scoreVoice } from '../src/nav/voice';

describe('normalizeRoadName', () => {
  it.each([
    ['QL.1A', 'Quốc lộ 1 A'],
    ['QL1', 'Quốc lộ 1'],
    ['ĐT.741', 'Đường tỉnh 741'],
    ['TL 10', 'Tỉnh lộ 10'],
    ['Đ. Lê Lợi', 'Đường Lê Lợi'],
    ['P. Phú Xuân', 'Phố Phú Xuân'],
    ['Đường 3/2', 'Đường 3 tháng 2'],
    ['Đường 30/4', 'Đường 30 tháng 4'],
    ['Hẻm 18/5', 'Hẻm 18 xẹt 5'],
    ['Kiệt 185/12', 'Kiệt 185 xẹt 12'],
    ['Ngõ 102/45', 'Ngõ 102 xẹt 45'],
    ['Hùng Vương', 'Hùng Vương'],
    ['Lý Thường Kiệt', 'Lý Thường Kiệt'],
  ])('%s → %s', (input, out) => {
    expect(normalizeRoadName(input)).toBe(out);
  });

  it('does not touch Vietnamese words that merely start with abbreviation letters', () => {
    expect(normalizeRoadName('Phan Đình Phùng')).toBe('Phan Đình Phùng');
    expect(normalizeRoadName('Đống Đa')).toBe('Đống Đa');
    expect(normalizeRoadName('Trần Hưng Đạo')).toBe('Trần Hưng Đạo');
  });
});

describe('speech text', () => {
  it('spells distances as words', () => {
    expect(spokenDistance(47)).toBe('50 mét');
    expect(spokenDistance(430)).toBe('450 mét');
    expect(spokenDistance(1530)).toBe('1 phẩy 5 ki lô mét');
    expect(spokenDistance(2000)).toBe('2 ki lô mét');
  });
  it('expands units and ends with a full stop', () => {
    expect(normalizeSpeech('Cách 1,5 km')).toBe('Cách 1 phẩy 5 ki lô mét.');
    expect(normalizeSpeech('Còn 200 m')).toBe('Còn 200 mét.');
    expect(normalizeSpeech('Đã đến điểm an toàn.')).toBe('Đã đến điểm an toàn.');
  });
});

describe('scoreVoice', () => {
  const v = (name: string, lang = 'vi-VN', localService = true) => ({ name, lang, localService });
  it('ranks natural/online voices above basic ones', () => {
    const ranked = [
      v('eSpeak Vietnamese', 'vi'),
      v('Google Tiếng Việt', 'vi-VN', false),
      v('Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)', 'vi-VN', false),
      v('Microsoft An - Vietnamese (Vietnam)'),
      v('Linh', 'vi-VN'),
    ].sort((a, b) => scoreVoice(b) - scoreVoice(a)).map((x) => x.name);
    expect(ranked[0]).toContain('HoaiMy');
    expect(ranked[ranked.length - 1]).toContain('eSpeak');
  });
});
