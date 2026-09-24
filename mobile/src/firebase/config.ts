import { initializeApp, getApps, getApp } from 'firebase/app';
// @ts-expect-error - getReactNativePersistence is exported by Firebase's React Native
// runtime build (@firebase/auth/dist/rn/index.js, resolved correctly by Metro via the
// react-native main-field since package exports are disabled in metro.config.js), but not
// by the generic type declarations TypeScript resolves for 'firebase/auth' via its exports
// map (the "types" condition there is listed before "react-native", so TS always picks the
// generic, non-RN .d.ts regardless of tsconfig's customConditions).
import { initializeAuth, getReactNativePersistence, getAuth, type Auth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let authInstance: Auth;
try {
  // initializeAuth throws if called twice on the same app instance,
  // which happens on Fast Refresh during development.
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const db = getFirestore(app);
