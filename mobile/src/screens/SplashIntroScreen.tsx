import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withRepeat,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';
import AuroraBackground from '../components/AuroraBackground';

interface Props {
  onFinish: () => void;
}

// Shown once, right after fonts finish loading and before the real app tree mounts — the
// same gradient + aurora language the login screen uses, so opening the app and landing on
// Login/Home reads as one continuous entrance rather than a jump cut.
export default function SplashIntroScreen({ onFinish }: Props) {
  const badgeScale = useSharedValue(0.4);
  const badgeOpacity = useSharedValue(0);
  const glowScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.5);
  const wordmarkOpacity = useSharedValue(0);
  const wordmarkTranslateY = useSharedValue(14);
  const screenOpacity = useSharedValue(1);

  useEffect(() => {
    badgeOpacity.value = withTiming(1, { duration: 260 });
    badgeScale.value = withSpring(1, { damping: 9, stiffness: 120 });
    glowScale.value = withDelay(
      120,
      withRepeat(
        withSequence(
          withTiming(1.35, { duration: 900, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 900, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    glowOpacity.value = withDelay(
      120,
      withRepeat(withSequence(withTiming(0.15, { duration: 900 }), withTiming(0.5, { duration: 900 })), -1, false),
    );
    wordmarkOpacity.value = withDelay(220, withTiming(1, { duration: 400 }));
    wordmarkTranslateY.value = withDelay(220, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    // Hold briefly, then fade the whole intro out and hand off to the real app tree.
    screenOpacity.value = withDelay(
      1350,
      withTiming(0, { duration: 380 }, (finished) => {
        if (finished) runOnJS(onFinish)();
      }),
    );
    // Runs once per mount — a one-shot entrance sequence, not state-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badgeOpacity.value,
    transform: [{ scale: badgeScale.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkTranslateY.value }],
  }));
  const screenStyle = useAnimatedStyle(() => ({ opacity: screenOpacity.value }));

  return (
    <Animated.View style={[styles.screen, screenStyle]}>
      <LinearGradient
        colors={[Colors.headerGradientStart, Colors.headerGradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <AuroraBackground />
      <View style={styles.center}>
        <Animated.View style={[styles.glow, glowStyle]} />
        <Animated.View style={[styles.badge, badgeStyle]}>
          <Text style={styles.badgeLetter}>W</Text>
        </Animated.View>
        <Animated.View style={wordmarkStyle}>
          <Text style={styles.wordmark}>
            White<Text style={styles.wordmarkAccent}>Coffee</Text>
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Colors.headerGradientEnd },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  glow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(205,231,236,0.5)',
  },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLetter: { color: 'white', fontSize: 34, fontFamily: Fonts.extraBold },
  wordmark: { fontSize: 24, fontFamily: Fonts.bold, color: 'white', letterSpacing: 0.3, textAlign: 'center' },
  wordmarkAccent: { fontFamily: Fonts.extraBold, color: Colors.accent },
});
