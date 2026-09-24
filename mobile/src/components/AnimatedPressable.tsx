import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

// A drop-in Pressable that scales down slightly on touch, giving buttons and cards a
// tactile, premium feel instead of the flat instant-toggle default. The animated
// component IS the Pressable — no extra wrapping View — so a caller's `style` does both
// jobs a plain Pressable's would: arranging `children` (flexDirection/gap/alignItems) AND
// participating in the parent's own layout (e.g. `flex: 1` in a row). Splitting those two
// jobs across a wrapper and an inner View (an earlier version of this file did) breaks
// whichever usage needs the one `style` didn't reach.
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
    <AnimatedPressableBase
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, { transform: [{ scale }] }, disabled ? { opacity: 0.6 } : null]}
      {...rest}
    >
      {children}
    </AnimatedPressableBase>
  );
}
