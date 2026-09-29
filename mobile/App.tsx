import React from 'react';
import { Text, TextInput, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { AuthProvider } from './src/auth/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { Fonts } from './src/theme/fonts';
import { Colors } from './src/theme/colors';

// App-wide default: every <Text>/<TextInput> reads Manrope unless a style explicitly
// overrides fontFamily. This is the standard Expo pattern for a global custom font without
// wrapping every Text usage in the app — safe here because rendering is gated behind
// `fontsLoaded` below, so nothing ever paints before the family is actually registered.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Text as any).defaultProps = (Text as any).defaultProps || {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Text as any).defaultProps.style = [{ fontFamily: Fonts.medium }, (Text as any).defaultProps.style];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(TextInput as any).defaultProps = (TextInput as any).defaultProps || {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(TextInput as any).defaultProps.style = [{ fontFamily: Fonts.medium }, (TextInput as any).defaultProps.style];

export default function App() {
  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.screenBg }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      {/* Every screen now opens with a dark-teal gradient header (HeroHeader/TopBar), so
          light status bar icons everywhere — the default dark icons would be invisible. */}
      <StatusBar style="light" />
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
