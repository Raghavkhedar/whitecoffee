import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

// A drop-in Pressable that scales down slightly on touch, giving buttons and cards a
// tactile, premium feel instead of the flat instant-toggle default.
export default function AnimatedPressable({
  style,
  children,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: AnimatedPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePressIn(e: Parameters<NonNullable<PressableProps['onPressIn']>>[0]) {
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
    onPressIn?.(e);
  }

  function handlePressOut(e: Parameters<NonNullable<PressableProps['onPressOut']>>[0]) {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
    onPressOut?.(e);
  }

  return (
    <Pressable disabled={disabled} onPressIn={handlePressIn} onPressOut={handlePressOut} {...rest}>
      <Animated.View style={[style, { transform: [{ scale }] }, disabled ? { opacity: 0.6 } : null]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
