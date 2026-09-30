// Manrope — the same type family Android's Compose UI ships (android/CLAUDE.md: "The only
// fonts shipped are manrope_400..800"). Loaded via @expo-google-fonts/manrope so mobile
// reads the identical family without vendoring Android's TTF assets by hand.
export const Fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',
} as const;
