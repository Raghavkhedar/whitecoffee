package com.raghav.whitecoffee.data.notification

/**
 * Which attendance screen the ongoing notification should open when tapped.
 *
 * Derived from the **open session**, never from the role. Sales is hybrid — the same person may
 * have an `office_in` open today and a `site_in` open tomorrow — so a role-keyed choice would
 * send a site-checked-in sales user to the office screen, which is the same `isOperations` binary
 * that has already cost this app two real payroll bugs.
 */
enum class AttendanceEntry {
    /** `site_in` / `market_in` open — the operations attendance screen. */
    OPERATIONS,

    /** `office_in` open — the office attendance screen. */
    OFFICE,
}

/** Intent extra carrying an [AttendanceEntry] name from the notification to `MainActivity`. */
const val EXTRA_ATTENDANCE_ENTRY = "com.raghav.whitecoffee.extra.ATTENDANCE_ENTRY"

/**
 * The "you are still checked in" reminder that sits in the notification shade while a session
 * is open.
 *
 * WHY THIS EXISTS: an employee who forgets to check out ends the day with a single punch, and the
 * nightly compute scores a day with no closing punch as **LNF — half a day's pay**. A persistent,
 * non-dismissable reminder is the cheapest thing that stops that, and it costs nothing to run
 * (an ongoing notification, not a foreground service).
 *
 * WHY THIS IS AN INTERFACE: the implementation needs an `@ApplicationContext Context` for
 * `NotificationManager`, and it is called from the two attendance ViewModels — which must stay
 * constructible on a JVM test runner. Same rule as `LocationProvider` / `SessionManager`: a
 * ViewModel never takes a Context, it takes a contract from `data/`.
 *
 * Every method must be safe to call when POST_NOTIFICATIONS is denied — the reminder is a
 * courtesy, and losing it must never break a check-in.
 *
 * Implemented by [SystemAttendanceNotifier] in production and by FakeAttendanceNotifier in tests.
 */
interface AttendanceNotifier {

    /**
     * Posts (or refreshes) the ongoing reminder.
     *
     * @param since display time of the check-in that opened the session, e.g. "09:55 AM".
     * @param entry which attendance screen tapping it should open.
     */
    fun showCheckedIn(since: String, entry: AttendanceEntry)

    /**
     * Removes the reminder. Called when the matching check-out or `home_out` lands and whenever
     * the day is otherwise not open. Idempotent — safe when nothing is showing.
     */
    fun clear()
}
