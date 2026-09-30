import * as Location from 'expo-location';

export interface Coordinates {
  latitude: number;
  longitude: number;
  // Whether the fix came from a mock provider. Only Android reports it (expo-location's
  // `mocked`); iOS has no equivalent API, so it is false there. Recorded on the punch for
  // onPunchWritten's integrity flag — NEVER used to refuse a punch.
  isMockLocation: boolean;
}

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentCoordinates(): Promise<Coordinates> {
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    isMockLocation: position.mocked === true,
  };
}

/** getCurrentCoordinates, but rejects after `ms` — a fix can hang indoors, and logout must not. */
export function getCurrentCoordinatesWithin(ms: number): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Location timed out')), ms);
    getCurrentCoordinates().then(
      (c) => {
        clearTimeout(timer);
        resolve(c);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
