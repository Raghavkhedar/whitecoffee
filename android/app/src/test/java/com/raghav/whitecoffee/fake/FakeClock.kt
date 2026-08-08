package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.time.Clock
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A [Clock] the test moves by hand.
 *
 * The whole point of the seam: `LocalDate.now()` cannot be walked over midnight, so the
 * day-rollover bug — an app resumed the next morning authorising a punch against yesterday's
 * events — was untestable in principle. Here it is one assignment.
 */
class FakeClock(var date: String = "2026-07-25") : Clock {

    private val stream = MutableStateFlow(date)

    override fun today(): String = date

    /**
     * Overrides the polling default deliberately. The real one is `while (true) { emit; delay }`,
     * which never lets `advanceUntilIdle()` finish — a ViewModel collecting it would hang the
     * test rather than fail it. A StateFlow gives the same semantics (current value, re-emit on
     * change) with no scheduled work.
     */
    override fun todayStream(pollMillis: Long): Flow<String> = stream.asStateFlow()

    /** Moves the clock to the next day. Only ever used to reproduce a rollover. */
    fun rollOver(to: String) {
        date = to
        stream.value = to
    }
}
