import type { OsrmStep } from './osrm';
import { normalizeRoadName, spokenDistance } from '../nav/speech-text';

const MOD: Record<string, string> = {
  left: 'rẽ trái',
  right: 'rẽ phải',
  'slight left': 'chếch sang trái',
  'slight right': 'chếch sang phải',
  'sharp left': 'rẽ gắt sang trái',
  'sharp right': 'rẽ gắt sang phải',
  straight: 'đi thẳng',
  uturn: 'quay đầu',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function roadName(step: OsrmStep): string {
  const name = step.name?.trim();
  if (name) return name;
  if (step.ref) return step.ref;
  return '';
}

/** Icon key consumed by the UI (maps to an inline SVG arrow). */
export type ManeuverIcon = 'straight' | 'left' | 'right' | 'slight-left' | 'slight-right' | 'sharp-left' | 'sharp-right' | 'uturn' | 'roundabout' | 'arrive' | 'depart';

export function maneuverIcon(step: OsrmStep): ManeuverIcon {
  const { type, modifier } = step.maneuver;
  if (type === 'arrive') return 'arrive';
  if (type === 'depart') return 'depart';
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return 'roundabout';
  switch (modifier) {
    case 'left': return 'left';
    case 'right': return 'right';
    case 'slight left': return 'slight-left';
    case 'slight right': return 'slight-right';
    case 'sharp left': return 'sharp-left';
    case 'sharp right': return 'sharp-right';
    case 'uturn': return 'uturn';
    default: return 'straight';
  }
}

const ORD = ['', 'thứ nhất', 'thứ hai', 'thứ ba', 'thứ tư', 'thứ năm', 'thứ sáu', 'thứ bảy', 'thứ tám'];

/** Vietnamese instruction for an OSRM step. */
export function instructionVi(step: OsrmStep, destName = 'điểm an toàn'): string {
  const { type, modifier, exit } = step.maneuver;
  const name = roadName(step);
  const onto = name ? ` vào ${name}` : '';
  const along = name ? ` theo ${name}` : '';
  const turn = MOD[modifier ?? 'straight'] ?? 'đi tiếp';

  switch (type) {
    case 'depart':
      return `Xuất phát${along}`;
    case 'arrive':
      return `Đã đến ${destName}`;
    case 'continue':
    case 'new name':
      return modifier && modifier !== 'straight' ? `${cap(turn)} để tiếp tục${along}` : `Đi tiếp${along}`;
    case 'merge':
      return `Nhập làn${onto}`;
    case 'on ramp':
      return `${cap(turn)} lên đường dẫn${onto}`;
    case 'off ramp':
      return `${cap(turn)} ra khỏi đường dẫn${onto}`;
    case 'fork':
      return modifier?.includes('left') ? `Đi theo nhánh trái${onto}` : modifier?.includes('right') ? `Đi theo nhánh phải${onto}` : `Đi tiếp ở ngã rẽ${onto}`;
    case 'end of road':
      return `Cuối đường, ${turn}${onto}`;
    case 'roundabout':
    case 'rotary': {
      const ord = exit && exit < ORD.length ? ORD[exit] : exit ? `số ${exit}` : '';
      return ord ? `Vào vòng xuyến, đi theo lối ra ${ord}${onto}` : `Đi qua vòng xuyến${onto}`;
    }
    case 'roundabout turn':
      return `Tại vòng xuyến, ${turn}${onto}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Ra khỏi vòng xuyến${onto}`;
    case 'notification':
      return `Đi tiếp${along}`;
    case 'turn':
    default:
      if (modifier === 'straight') return `Đi thẳng${onto}`;
      if (modifier === 'uturn') return `Quay đầu${along}`;
      return `${cap(turn)}${onto}`;
  }
}

/** Spoken prompt, e.g. "Sau 200 mét, rẽ trái vào Lê Lợi" – with road names expanded for TTS. */
export function spokenVi(step: OsrmStep, distance: number | null, destName?: string): string {
  const spokenStep: OsrmStep = {
    ...step,
    name: step.name ? normalizeRoadName(step.name) : step.name,
    ref: step.ref ? normalizeRoadName(step.ref) : step.ref,
  };
  const text = instructionVi(spokenStep, destName);
  if (distance === null || distance < 25) return `${text}.`;
  return `Sau ${spokenDistance(distance)}, ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}
