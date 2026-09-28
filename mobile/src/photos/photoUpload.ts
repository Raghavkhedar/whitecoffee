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
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(storageRef);
}
