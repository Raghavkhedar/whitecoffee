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
  // Warm cream "paper" — a deliberate one-screen departure from the cool teal-tinted
  // screenBg, used only where a specific design direction calls for it (Home's menu-list
  // redesign). Not a brand color and not meant to spread; Primary/PrimaryDark/Accent stay
  // exactly the Android-sourced teal this app never deviates from.
  paper: '#FAF6EF',
  divider: 'rgba(16,20,20,0.12)',
} as const;
