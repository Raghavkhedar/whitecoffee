import { useRef } from 'react';
import { Alert } from 'react-native';
import { useAuth } from './AuthContext';
import { getTodayEventsOnce, writeDayClose } from '../attendance/attendanceApi';
import { describeDayClose, planDayClose, type ClosingPunch } from '../attendance/dayClose';
import { getCurrentCoordinatesWithin, requestLocationPermission } from '../location/useLocation';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function confirm(title: string, message: string, confirmText: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

/**
 * Logout with auto-checkout (decision #34b): if today is still open, close every open session
 * and write home_out before signing out, so a mid-day logout can't score LNF.
 *
 * Deliberate differences from Android: it ASKS first (Android writes home_out with no warning —
 * the doc's known gap), and when it can't close the day (no connection to read today, no GPS
 * fix) it says so and lets the user choose instead of silently leaving the day open. Logout
 * itself always remains possible — nothing here can trap someone in a signed-in session.
 */
export function useLogoutWithCheckout(): () => Promise<void> {
  const { user, logout } = useAuth();
  const busy = useRef(false);

  return async () => {
    if (!user || busy.current) return;
    busy.current = true;
    try {
      let plan: ClosingPunch[];
      try {
        plan = planDayClose(await withTimeout(getTodayEventsOnce(user.uid), 6000));
      } catch {
        const go = await confirm(
          'Log out?',
          "Couldn't check whether your day is still open (no connection?). If you're still checked in, your day will stay open.",
          'Log out anyway',
        );
        if (go) await logout();
        return;
      }

      if (plan.length === 0) {
        await logout();
        return;
      }

      const go = await confirm(
        'Log out and end your day?',
        `You're still checked in. Logging out will record ${describeDayClose(plan)} now. This can't be undone from the app.`,
        'End day & log out',
      );
      if (!go) return;

      let coords;
      try {
        if (await requestLocationPermission()) coords = await getCurrentCoordinatesWithin(15000);
      } catch {
        coords = undefined;
      }
      if (!coords) {
        const anyway = await confirm(
          "Couldn't get your location",
          "Your day wasn't closed, so it will stay open. You can cancel, move somewhere with a better signal, and try again.",
          'Log out anyway',
        );
        if (anyway) await logout();
        return;
      }

      // Wait for the server to confirm the closing punches BEFORE signing out (see
      // writeDayClose). Offline they can't confirm; the user decides, knowing the risk.
      try {
        await withTimeout(writeDayClose(user, plan, coords), 10000);
      } catch (e) {
        const denied = (e as { code?: string }).code === 'permission-denied';
        const anyway = await confirm(
          denied ? "Couldn't close your day" : "Couldn't confirm your check-out",
          denied
            ? 'The server refused the check-out, so your day may still be open. Stay logged in and use the Attendance screen, or contact your administrator.'
            : "Your check-out hasn't reached the server yet (no connection?). If you log out and the app is closed before it syncs, it will be lost and your day will stay open.",
          'Log out anyway',
        );
        if (!anyway) return;
      }
      await logout();
    } finally {
      busy.current = false;
    }
  };
}
