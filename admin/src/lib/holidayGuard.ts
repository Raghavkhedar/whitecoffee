// A holiday can only be added or removed for today or a later date. By the time a day has
// passed, the nightly run has already scored it: adding a holiday afterwards would leave every
// Absent (−2) in place, and removing one would leave every employee's Holiday +1 in place.
// Fixing an already-scored day is Regularization's job. Dates are "yyyy-mm-dd", so a string
// compare is chronological.

export const HOLIDAY_PAST_MESSAGE =
  'Holidays can only be added or removed for today or a later date. An already-scored day is fixed through Regularization.';

export function holidayEditError(date: string, todayStr: string): string | null {
  return date < todayStr ? HOLIDAY_PAST_MESSAGE : null;
}
