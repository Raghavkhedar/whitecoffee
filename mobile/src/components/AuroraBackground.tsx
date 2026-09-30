import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';

interface BlobConfig {
  size: number;
  color: string;
  top: number;
  left: number;
  duration: number;
  driftX: number;
  driftY: number;
}

function Blob({ size, color, top, left, duration, driftX, driftY }: BlobConfig) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    // Runs once per mount — a continuous ambient drift, not state-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * driftX },
      { translateY: progress.value * driftY },
      { scale: 1 + progress.value * 0.12 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.blob, { width: size, height: size, borderRadius: size / 2, backgroundColor: color, top, left }, style]}
    />
  );
}

// Slow-drifting, soft-edged color blobs behind a frosted-glass surface (expo-blur) — the
// blur is what turns flat translucent circles into the "aurora" look; the blobs themselves
// are just plain animated Views. Colors are rgba versions of the existing palette
// (Colors.accent / Colors.primary / Colors.headerGradientEnd) — no new hues invented.
export default function AuroraBackground() {
  const { width, height } = useWindowDimensions();
  return (
    <>
      <Blob
        size={width * 0.95}
        color="rgba(205,231,236,0.35)"
        top={-height * 0.1}
        left={-width * 0.3}
        duration={9000}
        driftX={40}
        driftY={30}
      />
      <Blob
        size={width * 0.75}
        color="rgba(0,106,113,0.35)"
        top={height * 0.32}
        left={width * 0.5}
        duration={11000}
        driftX={-35}
        driftY={45}
      />
      <Blob
        size={width * 0.7}
        color="rgba(0,88,94,0.4)"
        top={height * 0.68}
        left={-width * 0.2}
        duration={10000}
        driftX={30}
        driftY={-35}
      />
    </>
  );
}

const styles = StyleSheet.create({
  blob: { position: 'absolute' },
});
