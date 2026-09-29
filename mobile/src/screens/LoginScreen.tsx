import React, { useEffect, useState } from 'react';
import { View, TextInput, Text, StyleSheet, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { useAuth } from '../auth/AuthContext';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';
import AuroraBackground from '../components/AuroraBackground';
import DismissKeyboardView from '../components/DismissKeyboardView';
import AnimatedPressable from '../components/AnimatedPressable';

// A fade-up entrance with a start delay — used to stagger the brand mark in before the card.
function useEntrance(delay: number) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 480, easing: Easing.out(Easing.cubic) }));
    // One-shot mount animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));
}

interface AnimatedFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
}

// A field whose border glows teal and lifts very slightly on focus — a small Reanimated
// touch that a plain TextInput can't do on its own.
function AnimatedField({ value, onChangeText, placeholder, secureTextEntry, autoCapitalize }: AnimatedFieldProps) {
  const focus = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    borderColor: focus.value > 0.5 ? Colors.primary : Colors.border,
    transform: [{ scale: 1 + focus.value * 0.015 }],
  }));
  return (
    <Animated.View style={[styles.input, style]}>
      <TextInput
        style={styles.inputText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          focus.value = withTiming(1, { duration: 160 });
        }}
        onBlur={() => {
          focus.value = withTiming(0, { duration: 160 });
        }}
      />
    </Animated.View>
  );
}

export default function LoginScreen() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const brandAnim = useEntrance(0);
  const cardAnim = useEntrance(180);

  // A slow breathing pulse on the button while the sign-in request is in flight, instead of
  // just swapping its label for a spinner.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (submitting) {
      pulse.value = withRepeat(withSequence(withTiming(0.97, { duration: 420 }), withTiming(1, { duration: 420 })), -1, true);
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [submitting, pulse]);
  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      // error is already surfaced via useAuth().error
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[Colors.headerGradientStart, Colors.headerGradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <AuroraBackground />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          // 'always', not 'handled' — see RegularizationScreen.tsx for why: 'always' is what
          // the docs guarantee lets DismissKeyboardView's Pressable reliably catch a
          // background tap to dismiss the keyboard.
          keyboardShouldPersistTaps="always"
        >
          <DismissKeyboardView style={styles.container}>
            <Animated.View style={[styles.brand, brandAnim]}>
              <View style={styles.badge}>
                <Text style={styles.badgeLetter}>W</Text>
              </View>
              <Text style={styles.wordmark}>
                White<Text style={styles.wordmarkAccent}>Coffee</Text>
              </Text>
              <Text style={styles.subtitle}>Field Operations</Text>
            </Animated.View>

            <Animated.View style={cardAnim}>
              <BlurView intensity={40} tint="light" style={styles.card}>
                <AnimatedField value={email} onChangeText={setEmail} placeholder="Email or Employee ID" autoCapitalize="none" />
                <AnimatedField value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
                {error && <Text style={styles.error}>{error}</Text>}
                <AnimatedPressable disabled={submitting} onPress={handleSubmit}>
                  <Animated.View style={[styles.button, buttonStyle]}>
                    <Text style={styles.buttonText}>{submitting ? 'Signing in…' : 'Log In'}</Text>
                  </Animated.View>
                </AnimatedPressable>
              </BlurView>
            </Animated.View>
          </DismissKeyboardView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.headerGradientEnd },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 28 },
  brand: { alignItems: 'center', gap: 4 },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  badgeLetter: { color: 'white', fontSize: 26, fontFamily: Fonts.extraBold },
  wordmark: { fontSize: 24, fontFamily: Fonts.bold, color: 'white', letterSpacing: 0.2 },
  wordmarkAccent: { fontFamily: Fonts.extraBold, color: Colors.accent },
  subtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontFamily: Fonts.semiBold,
    marginTop: 2,
  },
  card: {
    borderRadius: 24,
    padding: 24,
    gap: 14,
    overflow: 'hidden', // required for borderRadius to clip the blur on iOS/Android
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 12,
  },
  inputText: { padding: 14, fontSize: 15, color: Colors.textPrimary, fontFamily: Fonts.medium },
  button: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: 'white', fontFamily: Fonts.semiBold, fontSize: 15 },
  error: { color: Colors.statusRejectedFg, textAlign: 'center', fontSize: 13, fontFamily: Fonts.medium },
});
