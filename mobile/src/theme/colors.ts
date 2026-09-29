// Ports the Android app's Material 3 "teal" palette (android/CLAUDE.md — "never deviate").
// Single source of truth for color in this app; screens import from here instead of
// hardcoding hex values.
export const Colors = {
  primary: '#006A71',
  primaryDark: '#00474C',
  screenBg: '#F4F9F9',
  surface: '#FFFFFF',
  border: '#E2E9E9',
  borderSoft: '#EAF1F0',
  textPrimary: '#101414',
  textSecondary: '#5A6566',
  textMuted: '#8591A0',
  textHint: '#8FA0A0',
  accent: '#CDE7EC',
  headerGradientStart: '#00363B',
  headerGradientEnd: '#00585E',
  statusPresentBg: '#C7F0D2',
  statusPresentFg: '#0A5132',
  statusPendingBg: '#FCEFC7',
  statusPendingFg: '#8A6700',
  statusSlBg: '#FFE1C2',
  statusSlFg: '#8A4B00',
  statusRejectedBg: '#FFDAD6',
  statusRejectedFg: '#BA1A1A',
} as const;

// Per-module tile colors — ported verbatim from Android's `LightWcTiles`
// (android/.../ui/theme/Color.kt), which mobile has never used until now. Each Home card
// gets its own bg/fg pair instead of the uniform accent/primary badge every card shared
// before.
export const Tiles = {
  attendance: { bg: '#C6EEF1', fg: '#00474C' },
  regularization: { bg: '#DDDFFF', fg: '#2A2A8A' },
  leave: { bg: '#FFD7E0', fg: '#8A1B43' },
  mtBuy: { bg: '#C7F0D2', fg: '#0A5132' },
  mtRequest: { bg: '#D7E2FF', fg: '#0A3A86' },
  materialTransfer: { bg: '#E7DDFF', fg: '#3A1D8A' },
  toolTransfer: { bg: '#BFE8FF', fg: '#064A6E' },
} as const;
