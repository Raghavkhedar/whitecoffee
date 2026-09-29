import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, runOnJS, Easing } from 'react-native-reanimated';
import { useAuth } from '../auth/AuthContext';
import { Colors } from '../theme/colors';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import LeaveScreen from '../screens/LeaveScreen';
import RegularizationScreen from '../screens/RegularizationScreen';
import MaterialBuyScreen from '../screens/MaterialBuyScreen';
import MaterialRequestScreen from '../screens/MaterialRequestScreen';
import MaterialTransferScreen from '../screens/MaterialTransferScreen';
import ToolTransferScreen from '../screens/ToolTransferScreen';
import OperationsAttendanceScreen from '../screens/OperationsAttendanceScreen';
import SalesAttendanceScreen from '../screens/SalesAttendanceScreen';

export type RootStackParamList = {
  Home: undefined;
  Attendance: undefined;
  Leave: undefined;
  Regularization: undefined;
  MaterialBuy: undefined;
  MaterialRequest: undefined;
  MaterialTransfer: undefined;
  ToolTransfer: undefined;
  OperationsAttendance: undefined;
  SalesAttendance: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

interface LoginSuccessWipeProps {
  /** Fired the instant the circle has fully covered the screen — safe to swap content. */
  onCovered: () => void;
  /** Fired once the circle has finished fading back out — safe to unmount the overlay. */
  onDone: () => void;
}

// A growing-then-fading circle rather than a true clip-path reveal (React Native has no
// cheap masking primitive for that) — expands to fully cover the screen, the parent swaps
// Login for the real app underneath while hidden, then it fades away to reveal Home. Reads
// as a wipe transition without needing SVG/Skia masking.
function LoginSuccessWipe({ onCovered, onDone }: LoginSuccessWipeProps) {
  const { width, height } = useWindowDimensions();
  const diameter = Math.hypot(width, height) * 2.2;
  const scale = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) {
        runOnJS(onCovered)();
        opacity.value = withDelay(
          120,
          withTiming(0, { duration: 420 }, (fadedOut) => {
            if (fadedOut) runOnJS(onDone)();
          }),
        );
      }
    });
    // One-shot: plays exactly once per mount, triggered by the parent mounting this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          styles.wipeCircle,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            top: height / 2 - diameter / 2,
            left: width / 2 - diameter / 2,
          },
          style,
        ]}
      />
    </View>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();
  const [renderAuthed, setRenderAuthed] = useState(!!user);
  const [wiping, setWiping] = useState(false);
  const wasUserRef = useRef(!!user);
  // Tracks whether LoginScreen was ever actually shown to the user this app session — true
  // only once auth has resolved with no user. A RESTORED session (already logged in when the
  // app opens) resolves `loading` with `user` already populated, so this stays false and the
  // two cases are distinguishable below.
  const hasShownLoginRef = useRef(false);
  const homeOpacity = useSharedValue(!!user ? 1 : 0);
  const homeRevealStyle = useAnimatedStyle(() => ({ opacity: homeOpacity.value }));

  useEffect(() => {
    if (!loading && !user) {
      hasShownLoginRef.current = true;
    }
  }, [loading, user]);

  useEffect(() => {
    const isUser = !!user;
    if (isUser && !wasUserRef.current) {
      if (hasShownLoginRef.current) {
        // A genuine interactive login (LoginScreen was showing, the user submitted) — the
        // radial wipe, anchored to that moment, is the right transition.
        homeOpacity.value = 1;
        setWiping(true);
      } else {
        // App launch with an already-persisted session — LoginScreen was never shown, so
        // reusing its wipe would be answering an action that didn't happen. A plain crossfade
        // instead: no circle, no anchor point, just Home settling in.
        homeOpacity.value = 0;
        homeOpacity.value = withTiming(1, { duration: 550, easing: Easing.out(Easing.cubic) });
        setRenderAuthed(true);
      }
    } else if (!isUser) {
      // Logged out — no transition needed, just fall back to LoginScreen immediately.
      setRenderAuthed(false);
      setWiping(false);
    }
    wasUserRef.current = isUser;
  }, [user]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Animated.View style={[styles.flex, homeRevealStyle]}>
        <NavigationContainer>
          {renderAuthed ? (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Home" component={HomeScreen} />
              <Stack.Screen name="Attendance" component={AttendanceScreen} />
              <Stack.Screen name="Leave" component={LeaveScreen} />
              <Stack.Screen name="Regularization" component={RegularizationScreen} />
              <Stack.Screen name="MaterialBuy" component={MaterialBuyScreen} />
              <Stack.Screen name="MaterialRequest" component={MaterialRequestScreen} />
              <Stack.Screen name="MaterialTransfer" component={MaterialTransferScreen} />
              <Stack.Screen name="ToolTransfer" component={ToolTransferScreen} />
              <Stack.Screen name="OperationsAttendance" component={OperationsAttendanceScreen} />
              <Stack.Screen name="SalesAttendance" component={SalesAttendanceScreen} />
            </Stack.Navigator>
          ) : (
            <LoginScreen />
          )}
        </NavigationContainer>
      </Animated.View>
      {wiping && <LoginSuccessWipe onCovered={() => setRenderAuthed(true)} onDone={() => setWiping(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wipeCircle: { position: 'absolute', backgroundColor: Colors.headerGradientEnd },
});
