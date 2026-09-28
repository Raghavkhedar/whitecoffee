import React from 'react';
import { Keyboard, Pressable, type StyleProp, type ViewStyle } from 'react-native';

interface DismissKeyboardViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// Wraps a screen's (or a modal's) content so tapping anywhere that isn't itself a focused
// input or another touchable dismisses the keyboard. A tap that lands on a nested
// touchable (a button, an input) never reaches this — RN's responder system resolves that
// touch to the child first — so this only fires for genuinely "blank space" taps.
//
// Pressable, not TouchableWithoutFeedback: every other touchable in this app already goes
// through Pressable (AnimatedPressable), so this is the primitive already proven to
// negotiate nested touch responders correctly on this exact RN/Expo setup.
export default function DismissKeyboardView({ children, style }: DismissKeyboardViewProps) {
  return (
    <Pressable style={style} onPress={Keyboard.dismiss}>
      {children}
    </Pressable>
  );
}
