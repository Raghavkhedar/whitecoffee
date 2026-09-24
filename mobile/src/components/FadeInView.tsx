import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

interface FadeInViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Milliseconds to wait before starting — lets sibling FadeInViews stagger in. */
  delay?: number;
}

// Fades and slides content up slightly on mount, for a softer, more considered entrance
// than content just appearing instantly.
export default function FadeInView({ children, style, delay = 0 }: FadeInViewProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 420, delay, useNativeDriver: true }),
    ]).start();
    // Intentionally run once per mount — this is an entrance animation, not a state-driven one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>{children}</Animated.View>;
}
