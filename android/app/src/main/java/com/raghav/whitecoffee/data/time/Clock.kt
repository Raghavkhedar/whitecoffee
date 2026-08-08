package com.raghav.whitecoffee.data.time

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow

/**
 * Today's calendar date, as one injectable seam.
 *
 * WHY THIS IS AN INTERFACE: "what day is it" is a *data source*, exactly like GPS or
 * SharedPreferences, and it decides money. Attendance is keyed by a `yyyy-MM-dd` string, and a
 * bare `LocalDate.now()` inside a ViewModel or repository is untestable — you cannot make a JVM
 * test see midnight pass, so the day-rollover bug (an app left open overnight authorising an
 * `office_out` against yesterday's event list, which then landed stamped with the real today and
 * left yesterday unclosed and scored LNF = half pay) could not be pinned by a test at all.
 *
 * The surface is deliberately one method. Nothing in this app needs a wall clock — punches are
 * stamped by `Timestamp.now()` at the Firestore layer, where the server can vouch for them.
 *
 * Implemented by [SystemClock] in production and by FakeClock in tests.
 */
interface Clock {

    /**
     * Today in the device's local zone, formatted `yyyy-MM-dd` — byte-for-byte the form
     * `AttendanceRecord.date` holds and the form the Firestore `date` query filters on.
     */
    fun today(): String

    /**
     * Emits today's date immediately, then re-emits **only when the date actually changes**.
     *
     * A MEMBER WITH A DEFAULT BODY, NOT AN EXTENSION, so a fake can replace it. The default
     * implementation polls forever, and a `while (true) { … delay() }` collected on a test
     * dispatcher means `advanceUntilIdle()` always has another scheduled task and never
     * returns — any test touching a ViewModel that collects this would hang rather than fail.
     * An extension function cannot be overridden, so the seam has to be here.
     */
    fun todayStream(pollMillis: Long = DATE_ROLLOVER_POLL_MS): Flow<String> = flow {
        while (true) {
            emit(today())
            delay(pollMillis)
        }
    }.distinctUntilChanged()
}

/** How often [Clock.todayStream] re-reads the clock. One minute is far finer than a day boundary. */
const val DATE_ROLLOVER_POLL_MS = 60_000L

// Why the stream exists at all: it is what makes a live attendance subscription survive
// midnight. `observeTodayData()` used to read `LocalDate.now()` once, outside the flow builder,
// baking a fixed date into the Firestore query for the lifetime of the flow — an app resumed the
// next morning was still listening to yesterday's documents. Composing the query *inside* a
// `flatMapLatest` over this stream means the rollover tears the old listener down and attaches
// one for the new day.
//
// Polling rather than scheduling an alarm at midnight is deliberate: the flow only runs while a
// screen is collecting it, a `delay` costs nothing while suspended, and a poll is immune to the
// device clock or timezone being changed under us — it compares the *rendered date*, not an
// elapsed duration.
