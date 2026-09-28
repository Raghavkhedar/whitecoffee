# Mobile M&T Buy (Phase 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Android's M&T Buy feature (purchase logging with line items and optional
photos) to the Expo/React Native mobile app, available to all four roles, and build this
app's first photo-upload capability as shared, reusable infrastructure.

**Architecture:** A shared `photoUpload.ts` module (camera/gallery picking capped at 6,
Firebase Storage upload) is built once and will be reused by later Phase-3 specs. A Firestore
API module handles the doc-first write (mirroring Android's own ordering: write the purchase
immediately, upload photos after, patch `photoUrls` once done). A single form screen ties
them together, reached from a new, ungated Home card.

**Tech Stack:** Same Expo/TypeScript/Firebase JS SDK v12 stack as every prior phase. One new
dependency: `expo-image-picker` (confirmed Expo Go compatible on SDK 57, no custom dev build
needed).

**Spec:** `docs/superpowers/specs/2026-09-28-mobile-mt-buy-phase3a-design.md`

## Global Constraints

- Available to all four roles — no role gate, unlike Attendance/Regularization.
- No history/My-Submissions view — matches Android's decision #15.
- Validation mirrors Android's actual code exactly: at least one item; each item needs a
  non-blank name and `quantity > 0`. Nothing else is required (site fields, price, notes are
  all optional, despite `android/CLAUDE.md`'s stale claim that site name is required).
- Every Firestore write is offline-safe: mint the doc ref locally, `setDoc(...).catch(...)`
  without awaiting.
- Photo upload is doc-first: the purchase document is written (with `photoUrls: []`) before
  any upload starts; uploads happen after, sequentially (one at a time), and
  `updatePurchasePhotoUrls` patches `photoUrls` once all succeed.
- Photo cap: 6 total per submission (a deliberate, cleaner cap than Android's uncapped
  accumulation quirk).
- No persistent background upload-retry queue — a failed upload shows an inline "Retry"
  banner for as long as the user stays on the screen; this is an accepted, documented
  limitation, not a bug to fix later in this plan.
- Storage path: `requests/{uid}/material_purchases/{docId}/{timestamp}_{index}.jpg`.
- `npx tsc --noEmit` must stay clean project-wide after every task.

---

### Task 1: Photo upload infrastructure

**Files:**
- Modify: `mobile/src/firebase/config.ts`
- Modify: `mobile/app.json`
- Create: `mobile/src/photos/photoUpload.ts`

**Interfaces:**
- Consumes: `app` from `mobile/src/firebase/config.ts` (already exists).
- Produces: `storage` (new export from `mobile/src/firebase/config.ts`); `MAX_PHOTOS`
  (`number`), `remainingPhotoSlots(existingCount: number): number`, `pickPhotos(existingCount:
  number): Promise<string[]>`, `uploadPhoto(uri: string, storagePath: string):
  Promise<string>` — all exported from `mobile/src/photos/photoUpload.ts`. Task 4 imports all
  four.

- [ ] **Step 1: Install the dependency**

```bash
cd mobile
npx expo install expo-image-picker
```

- [ ] **Step 2: Register the config plugin**

Replace the full contents of `mobile/app.json`:

```json
{
  "expo": {
    "name": "WhiteCoffee",
    "slug": "whitecoffee-mobile",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "ios": {
      "supportsTablet": true
    },
    "android": {
      "adaptiveIcon": {
        "backgroundColor": "#E6F4FE",
        "foregroundImage": "./assets/android-icon-foreground.png",
        "backgroundImage": "./assets/android-icon-background.png",
        "monochromeImage": "./assets/android-icon-monochrome.png"
      },
      "predictiveBackGestureEnabled": false
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "plugins": [
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "WhiteCoffee needs your location to record attendance check-ins."
        }
      ],
      "@react-native-community/datetimepicker",
      [
        "expo-image-picker",
        {
          "photosPermission": "WhiteCoffee needs access to your photos to attach them to a purchase, request, or transfer record.",
          "cameraPermission": "WhiteCoffee needs camera access to take a photo for a purchase, request, or transfer record.",
          "microphonePermission": false
        }
      ]
    ]
  }
}
```

Note: this config plugin block only takes effect in a custom dev client / production build —
Expo Go ships its own permission strings and needs no `app.json` change to test image
picking during development. Registering it now keeps the app ready for a future custom
build without needing to revisit this file.

- [ ] **Step 3: Add the Storage export**

Replace the full contents of `mobile/src/firebase/config.ts`:

```ts
import { initializeApp, getApps, getApp } from 'firebase/app';
// @ts-expect-error - getReactNativePersistence is exported by Firebase's React Native
// runtime build (@firebase/auth/dist/rn/index.js, resolved correctly by Metro via the
// react-native main-field since package exports are disabled in metro.config.js), but not
// by the generic type declarations TypeScript resolves for 'firebase/auth' via its exports
// map (the "types" condition there is listed before "react-native", so TS always picks the
// generic, non-RN .d.ts regardless of tsconfig's customConditions).
import { initializeAuth, getReactNativePersistence, getAuth, type Auth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
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
export const storage = getStorage(app);
```

- [ ] **Step 4: Write the photo upload module**

Create `mobile/src/photos/photoUpload.ts`:

```ts
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase/config';

// Matches this app's own attachment cap, not Android's uncapped-accumulation quirk (Android
// allows up to 10 per gallery pick with no total limit — a bug this app deliberately does
// not replicate). Shared by every phase that adds photo attachments.
export const MAX_PHOTOS = 6;

export function remainingPhotoSlots(existingCount: number): number {
  return Math.max(0, MAX_PHOTOS - existingCount);
}

/**
 * Prompts the user to choose camera or gallery, then returns the local URIs picked (an
 * empty array if cancelled, denied, or the cap is already reached). Respects MAX_PHOTOS by
 * limiting how many more the gallery picker allows; the caller combines the result with any
 * already-picked URIs and should re-check remainingPhotoSlots before calling this again.
 */
export function pickPhotos(existingCount: number): Promise<string[]> {
  const remaining = remainingPhotoSlots(existingCount);
  if (remaining <= 0) {
    Alert.alert('Photo limit reached', `You can attach up to ${MAX_PHOTOS} photos.`);
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Camera', onPress: () => pickFromCamera().then(resolve) },
      { text: 'Gallery', onPress: () => pickFromGallery(remaining).then(resolve) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve([]) },
    ]);
  });
}

async function pickFromCamera(): Promise<string[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Camera permission needed', 'Enable camera access to take a photo.');
    return [];
  }
  const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
  if (result.canceled) return [];
  return result.assets.map((asset) => asset.uri);
}

async function pickFromGallery(limit: number): Promise<string[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Photo library permission needed', 'Enable photo access to add pictures.');
    return [];
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 0.6,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => asset.uri);
}

/**
 * Uploads a local file URI to Firebase Storage at the given path and returns its download
 * URL. `fetch` + `.blob()` is Firebase's own documented approach for uploading a local file
 * URI from React Native — the JS SDK has no direct file-path upload API.
 */
export async function uploadPhoto(uri: string, storagePath: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, blob);
  return getDownloadURL(storageRef);
}
```

- [ ] **Step 5: Verify it type-checks**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/firebase/config.ts mobile/app.json mobile/src/photos/photoUpload.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): add photo upload infrastructure (picker + Firebase Storage)"
```

---

### Task 2: Material purchase Firestore API

**Files:**
- Create: `mobile/src/materialBuy/materialBuyApi.ts`

**Interfaces:**
- Consumes: `db` from `mobile/src/firebase/config.ts`; `UserProfile` from
  `mobile/src/attendance/attendanceApi.ts`.
- Produces: `PurchaseItem` (`{ itemName: string; quantity: number; unit: string;
  pricePerUnit: number; totalPrice: number; spec1: string; spec2: string; notes: string }`),
  `SubmitPurchaseInput` (`{ siteId: string; siteName: string; items: PurchaseItem[]; notes:
  string }`), `submitMaterialPurchase(user: UserProfile, input: SubmitPurchaseInput): string`
  (returns the minted `docId` synchronously), `updatePurchasePhotoUrls(uid: string, docId:
  string, urls: string[]): Promise<void>` — all exported from
  `mobile/src/materialBuy/materialBuyApi.ts`. Task 4 imports all four.

- [ ] **Step 1: Write the Firestore read/write functions**

Create `mobile/src/materialBuy/materialBuyApi.ts`:

```ts
import { collection, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { UserProfile } from '../attendance/attendanceApi';

export interface PurchaseItem {
  itemName: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  totalPrice: number;
  spec1: string;
  spec2: string;
  notes: string;
}

export interface SubmitPurchaseInput {
  siteId: string;
  siteName: string;
  items: PurchaseItem[];
  notes: string;
}

// Mints the doc ref locally (a pure, synchronous operation — no network round trip), so the
// docId is available immediately for the caller to build a photo storage path with. The
// actual write below is offline-safe: setDoc(...).catch(...) without awaiting, same pattern
// as every prior phase.
export function submitMaterialPurchase(user: UserProfile, input: SubmitPurchaseInput): string {
  const purchaseRef = collection(db, 'users', user.uid, 'material_purchases');
  const docRef = doc(purchaseRef);
  const grandTotal = input.items.reduce((sum, item) => sum + item.totalPrice, 0);
  setDoc(docRef, {
    userId: user.uid,
    userName: user.name,
    employeeId: user.employeeId,
    siteId: input.siteId,
    siteName: input.siteName,
    items: input.items,
    grandTotal,
    notes: input.notes,
    photoUrls: [],
    submittedAt: Timestamp.now(),
  }).catch((error) => {
    console.error('Failed to sync material purchase to server', error);
  });
  return docRef.id;
}

export async function updatePurchasePhotoUrls(uid: string, docId: string, urls: string[]): Promise<void> {
  const docRef = doc(db, 'users', uid, 'material_purchases', docId);
  await updateDoc(docRef, { photoUrls: urls });
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/materialBuy/materialBuyApi.ts
git commit -m "feat(mobile): add material purchase Firestore API"
```

---

### Task 3: Navigation and Home card

**Files:**
- Modify: `mobile/src/screens/HomeScreen.tsx`
- Modify: `mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `HomeCard` from `mobile/src/components/HomeCard.tsx` (unchanged).
- Produces: `RootStackParamList` extended with `MaterialBuy: undefined`. Task 4's
  `MaterialBuyScreen` is registered into `RootNavigator`'s stack by this task and imported
  from `../screens/MaterialBuyScreen` — that file does not exist yet (created in Task 4).
  This is the same intentional, documented sequencing already used in Phase 1, Phase 2a, and
  Phase 2b: `npx tsc --noEmit` will report exactly one error, "Cannot find module
  '../screens/MaterialBuyScreen'", until Task 4 lands. That is expected; do not work around
  it.

- [ ] **Step 1: Add the M&T Buy card to Home**

Replace the full contents of `mobile/src/screens/HomeScreen.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import HomeCard from '../components/HomeCard';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  // Phase 1 ships the OFFICE attendance flow only. `admin` shares office's attendance
  // event types (see firebase/functions/roleCapabilities.js); operations and sales punch
  // site_in/market_in, so office-shaped punches from this app would be invisible to their
  // payroll scoring. Anything else — including an unknown role — is gated out.
  // Regularization derives its live status from these same office_in/office_out events
  // (see regularizationStatus.ts), so it shares this exact gate.
  const canUseOfficeAttendance = user?.role === 'office' || user?.role === 'admin';

  return (
    <View style={styles.screen}>
      <TopBar />
      <View style={styles.container}>
        <FadeInView style={styles.cards}>
          {canUseOfficeAttendance ? (
            <>
              <HomeCard icon="time-outline" label="Attendance" onPress={() => navigation.navigate('Attendance')} />
              <HomeCard
                icon="alert-circle-outline"
                label="Regularization"
                onPress={() => navigation.navigate('Regularization')}
              />
            </>
          ) : (
            <Text style={styles.unavailable}>
              Attendance isn't available for your role on this app yet.
            </Text>
          )}
          <HomeCard icon="calendar-outline" label="Leave" onPress={() => navigation.navigate('Leave')} />
          <HomeCard icon="cart-outline" label="M&T Buy" onPress={() => navigation.navigate('MaterialBuy')} />
        </FadeInView>
        <AnimatedPressable style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  container: { flex: 1, padding: 24 },
  cards: { gap: 16 },
  unavailable: { fontSize: 15, color: Colors.textMuted, lineHeight: 22 },
  logout: { marginTop: 'auto', padding: 16, alignItems: 'center' },
  logoutText: { color: Colors.textMuted },
});
```

- [ ] **Step 2: Register the MaterialBuy route**

Replace the full contents of `mobile/src/navigation/RootNavigator.tsx`:

```tsx
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import LeaveScreen from '../screens/LeaveScreen';
import RegularizationScreen from '../screens/RegularizationScreen';
import MaterialBuyScreen from '../screens/MaterialBuyScreen';

export type RootStackParamList = {
  Home: undefined;
  Attendance: undefined;
  Leave: undefined;
  Regularization: undefined;
  MaterialBuy: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {user ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Attendance" component={AttendanceScreen} />
          <Stack.Screen name="Leave" component={LeaveScreen} />
          <Stack.Screen name="Regularization" component={RegularizationScreen} />
          <Stack.Screen name="MaterialBuy" component={MaterialBuyScreen} />
        </Stack.Navigator>
      ) : (
        <LoginScreen />
      )}
    </NavigationContainer>
  );
}
```

- [ ] **Step 3: Verify the expected single error**

Run: `cd mobile && npx tsc --noEmit`
Expected: exactly one error — `Cannot find module '../screens/MaterialBuyScreen'` (or
equivalent) in `RootNavigator.tsx`. No other errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/screens/HomeScreen.tsx mobile/src/navigation/RootNavigator.tsx
git commit -m "feat(mobile): add M&T Buy route and Home card"
```

---

### Task 4: Material Buy screen

**Files:**
- Create: `mobile/src/screens/MaterialBuyScreen.tsx`

**Interfaces:**
- Consumes: `useAuth` from `mobile/src/auth/AuthContext.tsx`; `submitMaterialPurchase`,
  `updatePurchasePhotoUrls`, `type PurchaseItem` from
  `mobile/src/materialBuy/materialBuyApi.ts` (Task 2); `pickPhotos`, `uploadPhoto`,
  `remainingPhotoSlots`, `MAX_PHOTOS` from `mobile/src/photos/photoUpload.ts` (Task 1);
  `TopBar` from `mobile/src/components/TopBar.tsx`; `FadeInView`, `AnimatedPressable` from
  `mobile/src/components/`; `DismissKeyboardView` from
  `mobile/src/components/DismissKeyboardView.tsx`; `Colors` from
  `mobile/src/theme/colors.ts`; `RootStackParamList` from
  `mobile/src/navigation/RootNavigator.tsx` (Task 3).
- Produces: default-exported `MaterialBuyScreen`, registered into `RootNavigator`'s stack by
  Task 3.

- [ ] **Step 1: Write the Material Buy screen**

Create `mobile/src/screens/MaterialBuyScreen.tsx`:

```tsx
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Image, Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { submitMaterialPurchase, updatePurchasePhotoUrls, type PurchaseItem } from '../materialBuy/materialBuyApi';
import { pickPhotos, uploadPhoto, remainingPhotoSlots, MAX_PHOTOS } from '../photos/photoUpload';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import DismissKeyboardView from '../components/DismissKeyboardView';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'MaterialBuy'>;

interface ItemDraft {
  itemName: string;
  quantity: string;
  unit: string;
  pricePerUnit: string;
  spec1: string;
  spec2: string;
  notes: string;
}

function blankItem(): ItemDraft {
  return { itemName: '', quantity: '', unit: '', pricePerUnit: '', spec1: '', spec2: '', notes: '' };
}

function itemTotal(item: ItemDraft): number {
  const quantity = parseFloat(item.quantity) || 0;
  const pricePerUnit = parseFloat(item.pricePerUnit) || 0;
  return quantity * pricePerUnit;
}

type UploadState = 'idle' | 'uploading' | 'failed';

export default function MaterialBuyScreen({ navigation }: Props) {
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const [siteId, setSiteId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const [pendingUris, setPendingUris] = useState<string[]>([]);

  const grandTotal = items.reduce((sum, item) => sum + itemTotal(item), 0);

  function addItem() {
    setItems((prev) => [...prev, blankItem()]);
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleAddPhoto() {
    const picked = await pickPhotos(photoUris.length);
    if (picked.length > 0) {
      setPhotoUris((prev) => [...prev, ...picked]);
    }
  }

  function removePhoto(index: number) {
    setPhotoUris((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setSiteId('');
    setSiteName('');
    setItems([]);
    setNotes('');
    setPhotoUris([]);
  }

  async function uploadPendingPhotos(docId: string, uris: string[]) {
    if (!user) return;
    setPendingDocId(docId);
    setPendingUris(uris);
    setUploadState('uploading');
    try {
      const urls: string[] = [];
      for (let i = 0; i < uris.length; i++) {
        const url = await uploadPhoto(uris[i], `requests/${user.uid}/material_purchases/${docId}/${Date.now()}_${i}.jpg`);
        urls.push(url);
      }
      await updatePurchasePhotoUrls(user.uid, docId, urls);
      setUploadState('idle');
      setPendingDocId(null);
      setPendingUris([]);
    } catch (error) {
      console.error('Photo upload failed', error);
      setUploadState('failed');
    }
  }

  function handleRetryUpload() {
    if (!pendingDocId) return;
    uploadPendingPhotos(pendingDocId, pendingUris);
  }

  function handleDismissUploadBanner() {
    setUploadState('idle');
    setPendingDocId(null);
    setPendingUris([]);
  }

  async function handleSubmit() {
    setFormError(null);
    const parsedItems: PurchaseItem[] = items.map((draft) => {
      const quantity = parseFloat(draft.quantity) || 0;
      const pricePerUnit = parseFloat(draft.pricePerUnit) || 0;
      return {
        itemName: draft.itemName.trim(),
        quantity,
        unit: draft.unit.trim(),
        pricePerUnit,
        totalPrice: quantity * pricePerUnit,
        spec1: draft.spec1.trim(),
        spec2: draft.spec2.trim(),
        notes: draft.notes.trim(),
      };
    });
    if (parsedItems.length === 0) {
      setFormError('Please add at least one item.');
      return;
    }
    if (parsedItems.some((item) => !item.itemName || item.quantity <= 0)) {
      setFormError('Please fill in all item names and quantities.');
      return;
    }
    if (!user || submitting) return;
    setSubmitting(true);
    const docId = submitMaterialPurchase(user, {
      siteId: siteId.trim(),
      siteName: siteName.trim(),
      items: parsedItems,
      notes: notes.trim(),
    });
    const uris = photoUris;
    resetForm();
    setSubmitting(false);
    Alert.alert('Submitted', 'Purchase recorded.');
    if (uris.length > 0) {
      uploadPendingPhotos(docId, uris);
    }
  }

  return (
    <View style={styles.screen}>
      <TopBar title="M&T Buy" onBack={() => navigation.goBack()} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
        automaticallyAdjustKeyboardInsets
      >
        <DismissKeyboardView style={styles.dismissFill}>
          {uploadState === 'uploading' && (
            <FadeInView style={styles.banner}>
              <Text style={styles.bannerText}>
                Uploading {pendingUris.length} photo{pendingUris.length === 1 ? '' : 's'}…
              </Text>
            </FadeInView>
          )}
          {uploadState === 'failed' && (
            <FadeInView style={styles.banner}>
              <Text style={styles.bannerText}>Couldn't upload photos for your last purchase.</Text>
              <View style={styles.bannerActions}>
                <AnimatedPressable style={styles.bannerButton} onPress={handleRetryUpload}>
                  <Text style={styles.buttonText}>Retry</Text>
                </AnimatedPressable>
                <AnimatedPressable style={styles.bannerButtonSecondary} onPress={handleDismissUploadBanner}>
                  <Text style={styles.buttonText}>Dismiss</Text>
                </AnimatedPressable>
              </View>
            </FadeInView>
          )}

          <FadeInView style={styles.card}>
            <Text style={styles.label}>Site Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Skyline Tower B"
              placeholderTextColor={Colors.textMuted}
              value={siteName}
              onChangeText={setSiteName}
            />
            <Text style={styles.label}>Site ID (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Site-001"
              placeholderTextColor={Colors.textMuted}
              value={siteId}
              onChangeText={setSiteId}
            />
          </FadeInView>

          <FadeInView style={styles.card}>
            <Text style={styles.label}>Items</Text>
            {items.map((item, index) => (
              <View key={index} style={styles.itemRow}>
                <View style={styles.itemRowHeader}>
                  <Text style={styles.itemRowTitle}>Item {index + 1}</Text>
                  <AnimatedPressable onPress={() => removeItem(index)}>
                    <Text style={styles.removeText}>Remove</Text>
                  </AnimatedPressable>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Item name"
                  placeholderTextColor={Colors.textMuted}
                  value={item.itemName}
                  onChangeText={(text) => updateItem(index, { itemName: text })}
                />
                <View style={styles.itemRowFields}>
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Qty"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                    value={item.quantity}
                    onChangeText={(text) => updateItem(index, { quantity: text })}
                  />
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Unit"
                    placeholderTextColor={Colors.textMuted}
                    value={item.unit}
                    onChangeText={(text) => updateItem(index, { unit: text })}
                  />
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Price/unit"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                    value={item.pricePerUnit}
                    onChangeText={(text) => updateItem(index, { pricePerUnit: text })}
                  />
                </View>
                <View style={styles.itemRowFields}>
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Spec 1 (optional)"
                    placeholderTextColor={Colors.textMuted}
                    value={item.spec1}
                    onChangeText={(text) => updateItem(index, { spec1: text })}
                  />
                  <TextInput
                    style={[styles.input, styles.itemRowField]}
                    placeholder="Spec 2 (optional)"
                    placeholderTextColor={Colors.textMuted}
                    value={item.spec2}
                    onChangeText={(text) => updateItem(index, { spec2: text })}
                  />
                </View>
                <Text style={styles.itemRowTotal}>Total: {itemTotal(item).toFixed(2)}</Text>
              </View>
            ))}
            <AnimatedPressable style={styles.addItemButton} onPress={addItem}>
              <Text style={styles.buttonText}>+ Add Item</Text>
            </AnimatedPressable>
            {items.length > 0 && <Text style={styles.grandTotal}>Grand Total: {grandTotal.toFixed(2)}</Text>}
          </FadeInView>

          <FadeInView style={styles.card}>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Anything else worth noting"
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={3}
              value={notes}
              onChangeText={setNotes}
              onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
            />

            <Text style={styles.label}>Photos (optional, up to {MAX_PHOTOS})</Text>
            <View style={styles.photoStrip}>
              {photoUris.map((uri, index) => (
                <View key={uri} style={styles.photoThumbWrap}>
                  <Image source={{ uri }} style={styles.photoThumb} />
                  <AnimatedPressable style={styles.photoRemoveBadge} onPress={() => removePhoto(index)}>
                    <Text style={styles.photoRemoveText}>×</Text>
                  </AnimatedPressable>
                </View>
              ))}
              {remainingPhotoSlots(photoUris.length) > 0 && (
                <AnimatedPressable style={styles.addPhotoButton} onPress={handleAddPhoto}>
                  <Text style={styles.buttonText}>+ Photo</Text>
                </AnimatedPressable>
              )}
            </View>

            {formError && <Text style={styles.error}>{formError}</Text>}
            <AnimatedPressable style={styles.button} disabled={submitting} onPress={handleSubmit}>
              <Text style={styles.buttonText}>{submitting ? 'Submitting…' : 'Submit Purchase'}</Text>
            </AnimatedPressable>
          </FadeInView>
        </DismissKeyboardView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  content: { flexGrow: 1, padding: 24, paddingBottom: 40, gap: 16 },
  dismissFill: { flex: 1, gap: 16 },
  banner: {
    backgroundColor: Colors.statusPendingBg,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  bannerText: { fontSize: 14, color: Colors.statusPendingFg, fontWeight: '600' },
  bannerActions: { flexDirection: 'row', gap: 10 },
  bannerButton: { backgroundColor: Colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  bannerButtonSecondary: { backgroundColor: Colors.textMuted, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 10,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  label: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.screenBg,
    borderRadius: 10,
    padding: 12,
    color: Colors.textPrimary,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  itemRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  itemRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemRowTitle: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  removeText: { fontSize: 13, color: Colors.statusRejectedFg, fontWeight: '600' },
  itemRowFields: { flexDirection: 'row', gap: 8 },
  itemRowField: { flex: 1 },
  itemRowTotal: { fontSize: 13, color: Colors.primary, fontWeight: '700', textAlign: 'right' },
  addItemButton: { backgroundColor: Colors.accent, padding: 12, borderRadius: 10, alignItems: 'center' },
  grandTotal: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, textAlign: 'right' },
  photoStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumbWrap: { width: 64, height: 64 },
  photoThumb: { width: 64, height: 64, borderRadius: 10 },
  photoRemoveBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.statusRejectedFg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: 'white', fontSize: 13, lineHeight: 14 },
  addPhotoButton: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: Colors.statusRejectedFg, fontSize: 13 },
  button: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: 'white', fontWeight: '600' },
});
```

- [ ] **Step 2: Verify the whole project type-checks**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors. This is the point where `RootNavigator.tsx`'s import of
`MaterialBuyScreen` (Task 3) finally resolves.

- [ ] **Step 3: Run the full test suite**

Run: `cd mobile && npx jest`
Expected: all existing tests still pass (no new test file is added in this task — it's
UI/Firestore/photo-picker code, consistent with `LeaveScreen.tsx`/`leaveApi.ts` and
`RegularizationScreen.tsx`/`regularizationApi.ts` having none either).

- [ ] **Step 4: Manual device walkthrough**

No simulator/device is available in this environment — do full static verification (steps
2-3 above) and note in your report that the live walkthrough could not be performed here.
When it is run on a real device, it should cover:

1. Open M&T Buy from Home — confirm it's reachable regardless of your role (unlike
   Attendance/Regularization).
2. Try submitting with zero items — confirm the "Please add at least one item" error and no
   Firestore write happens.
3. Add an item with a blank name or zero quantity, try to submit — confirm the "Please fill
   in all item names and quantities" error.
4. Add two or three items with real quantities and prices — confirm each row's total and the
   overall grand total compute correctly.
5. Submit without photos — confirm the form resets and a success alert appears, with no
   upload banner.
6. Submit with 2-3 photos — confirm the "Uploading N photos…" banner appears, then confirm
   in the Firebase console that the photos landed at
   `requests/{uid}/material_purchases/{docId}/` and the Firestore doc's `photoUrls` field got
   patched with the download URLs.
7. Try to attach more than 6 photos total — confirm the picker is unavailable/blocked past
   the cap.
8. If possible, force an upload failure (e.g. toggle airplane mode mid-upload) — confirm the
   "Couldn't upload photos" banner appears with working Retry and Dismiss actions.
9. Confirm the admin portal's existing `/submissions` page still reads a mobile-submitted
   purchase correctly (field-shape parity check).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/MaterialBuyScreen.tsx
git commit -m "feat(mobile): add Material Buy screen with item list and photo upload"
```
