// Date helpers — the business operates entirely in IST (UTC+5:30) and attendance
// `date` fields are stored as IST calendar dates (the Cloud Functions compute
// "today" the same way, see functions/index.js). Computing "today" with the
// browser's UTC date (new Date().toISOString()) is wrong between 00:00 and 05:30
// IST, when the UTC date still reads as the previous day. Always derive the
// portal's notion of "today" in IST so it matches the stored event dates.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's date in IST, formatted as "YYYY-MM-DD". */
export function istTodayStr(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The IST date `n` days inclusive of today (n = 1 → today, n = 7 → 6 days ago).
 * Used for the dashboard's "Last N days" range presets.
 */
export function istDaysAgoStr(n: number): string {
  return new Date(Date.now() + IST_OFFSET_MS - (n - 1) * 86_400_000).toISOString().slice(0, 10);
}
