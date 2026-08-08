package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.notification.AttendanceEntry
import com.raghav.whitecoffee.data.notification.AttendanceNotifier

/**
 * Records what the ongoing "still checked in" reminder was asked to do.
 *
 * A fake rather than a mock: it holds real state (what is showing right now), so a test asserts on
 * the reminder the employee would actually be looking at rather than on a call being made.
 */
class FakeAttendanceNotifier : AttendanceNotifier {

    /** The reminder currently on screen, or null if none. */
    var showing: Shown? = null
        private set

    /** Every show, in order — lets a test see a reminder being refreshed rather than replaced. */
    val shown = mutableListOf<Shown>()

    var clearCount: Int = 0
        private set

    data class Shown(val since: String, val entry: AttendanceEntry)

    override fun showCheckedIn(since: String, entry: AttendanceEntry) {
        val s = Shown(since, entry)
        showing = s
        shown += s
    }

    override fun clear() {
        showing = null
        clearCount++
    }
}
