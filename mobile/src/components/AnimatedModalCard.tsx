import React, { useEffect, useRef } from 'react';
import { Animated, Keyboard, Modal, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

interface AnimatedModalCardProps {
  visible: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Tapping the dimmed background outside the card dismisses the keyboard first, if it's
   * up — and only closes the modal on a second tap once the keyboard is already down. Omit
   * this to keep the background inert (e.g. an irreversible-action confirm dialog that
   * should only ever close via its explicit buttons).
   */
  onDismiss?: () => void;
}

const AnimatedCard = Animated.createAnimatedComponent(Pressable);

// A Modal whose content pops and fades in softly instead of the flat default, used for the
// attendance confirm/prompt dialogs and the Regularization correction dialog.
//
// Tapping anywhere ON THE CARD that isn't itself a button/input only ever dismisses the
// keyboard, never the modal (so a mis-tap inside can't discard a half-filled form).
// Tapping the background OUTSIDE the card dismisses the keyboard on the first tap and,
// once the keyboard is already down, closes the modal on the next tap via `onDismiss` —
// see that prop's doc for how to opt out. `AnimatedCard` is a single Pressable carrying
// `style` directly (not a separate wrapper inside it), the same fix AnimatedPressable
// needed: splitting a style like this across two nesting levels loses whatever `style`
// uses to arrange its children (gap, flexDirection), not just its own box.
export default function AnimatedModalCard({ visible, children, style, onDismiss }: AnimatedModalCardProps) {
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scale.setValue(0.9);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 8, tension: 60 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, scale, opacity]);

  function handleBackgroundPress() {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
    } else {
      onDismiss?.();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackgroundPress} />
        <AnimatedCard style={[style, { transform: [{ scale }] }]} onPress={Keyboard.dismiss}>
          {children}
        </AnimatedCard>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(16,20,20,0.5)', justifyContent: 'center', padding: 24 },
});
