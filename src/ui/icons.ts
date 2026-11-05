import type { ManeuverIcon } from '../routing/instructions';

const arrow = (d: string) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const MANEUVER_SVG: Record<ManeuverIcon, string> = {
  straight: arrow('<path d="M24 42V8M12 20 24 8l12 12"/>'),
  depart: arrow('<path d="M24 42V8M12 20 24 8l12 12"/>'),
  left: arrow('<path d="M32 42V24a6 6 0 0 0-6-6H10M18 10l-8 8 8 8"/>'),
  right: arrow('<path d="M16 42V24a6 6 0 0 1 6-6h16M30 10l8 8-8 8"/>'),
  'slight-left': arrow('<path d="M30 42V26L14 10M14 22V10h12"/>'),
  'slight-right': arrow('<path d="M18 42V26L34 10M34 22V10H22"/>'),
  'sharp-left': arrow('<path d="M32 8v20L14 40M14 28v12h12"/>'),
  'sharp-right': arrow('<path d="M16 8v20l18 12M34 28v12H22"/>'),
  uturn: arrow('<path d="M30 42V18a8 8 0 0 0-16 0v12M8 24l6 6 6-6"/>'),
  roundabout: arrow('<circle cx="24" cy="20" r="8"/><path d="M24 42V28M30 14l6-6M36 16V8h-8"/>'),
  arrive: `<svg viewBox="0 0 48 48"><path d="M24 4c-7.7 0-14 6.3-14 14 0 10.5 14 26 14 26s14-15.5 14-26c0-7.7-6.3-14-14-14z" fill="currentColor"/><circle cx="24" cy="18" r="5" fill="#0a5c3a"/></svg>`,
};

export const ICON = {
  walk: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="13.5" cy="4" r="2"/><path d="M9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg>',
  moto: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.4 10.1 17.4 4H14v2h2l1 3h-4.4l-.5-1H13V6H8v2h1.9l1.6 3.3A5 5 0 0 0 7 9.9a5 5 0 0 0-1.1.1l.6 2A3 3 0 1 1 4 15H2a5 5 0 1 0 9.4-2.4l.5-1.6h5.5a5 5 0 1 0 1.9-.9zM5 18a3 3 0 0 0 1.6-.5L5.8 16H5zm14 0a3 3 0 0 1-1.6-5.6l1 2.9 1.9-.6-1-2.8A3 3 0 1 1 19 18z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  mountain: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m14 6-3.8 5 2.9 3.8-1.6 1.2L7 10l-6 8h22z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4"/></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5zM19 12c0 .9-.2 1.8-.5 2.6l1.5 1.5A9 9 0 0 0 14 3.2v2.1a7 7 0 0 1 5 6.7zM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3c-.7.5-1.4.9-2.3 1.2v2a9 9 0 0 0 3.7-1.8l2 2 1.3-1.3zM12 4 9.9 6.1 12 8.2z"/></svg>',
  recenter: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};
