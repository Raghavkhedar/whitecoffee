import React, { useEffect, useRef } from 'react';
import { Animated, Modal, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

interface AnimatedModalCardProps {
  visible: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// A Modal whose content pops and fades in softly instead of the flat default, used for
// the attendance confirm/prompt dialogs.
export default function AnimatedModalCard({ visible, children, style }: AnimatedModalCardProps) {
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

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(16,20,20,0.5)', justifyContent: 'center', padding: 24 },
});
