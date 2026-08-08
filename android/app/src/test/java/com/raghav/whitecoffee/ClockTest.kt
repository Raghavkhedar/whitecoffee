package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.time.Clock
import com.raghav.whitecoffee.data.time.DATE_ROLLOVER_POLL_MS
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The date stream behind `observeTodayData()`.
 *
 * This is the third leg of the day-rollover fix, and the only one that can be proved on a JVM
 * runner: the repository itself needs a live Firestore. `observeTodayData()` used to read
 * `LocalDate.now()` **outside** its flow builder, freezing the `whereEqualTo("date", …)` filter at
 * whatever day the subscription began — an app left open overnight kept listening to yesterday's
 * documents. Composing the query inside a `flatMapLatest` over this stream is what tears the stale
 * listener down; if this stream never re-emits, that fix is inert.
 *
 * Deliberately NOT FakeClock: that one overrides `todayStream` with a StateFlow so ViewModel tests
 * do not hang on the infinite poll loop. Using it here would test the fake and leave the real
 * polling body — the code that actually ships — unexercised.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ClockTest {

    /** Implements only `today()`, so `todayStream()` runs its real default polling body. */
    private class PollingClock(var date: String) : Clock {
        override fun today(): String = date
    }

    private fun clockAt(date: String) = PollingClock(date)

    @Test
    fun `the stream emits today immediately`() = runTest {
        val clock = clockAt("2026-08-07")
        val seen = mutableListOf<String>()

        val job = launch { clock.todayStream().collect { seen += it } }
        runCurrent()

        assertEquals(listOf("2026-08-07"), seen)
        job.cancel()
    }

    @Test
    fun `the stream re-emits when the date rolls over`() = runTest {
        val clock = clockAt("2026-08-07")
        val seen = mutableListOf<String>()

        val job = launch { clock.todayStream().collect { seen += it } }
        runCurrent()

        // Midnight passes while the screen is still subscribed.
        clock.date = "2026-08-08"
        advanceTimeBy(DATE_ROLLOVER_POLL_MS + 1)

        assertEquals(listOf("2026-08-07", "2026-08-08"), seen)
        job.cancel()
    }

    @Test
    fun `the stream does not re-emit while the date is unchanged`() = runTest {
        val clock = clockAt("2026-08-07")
        val seen = mutableListOf<String>()

        val job = launch { clock.todayStream().collect { seen += it } }
        runCurrent()
        // Many polls, one day. A re-emission per poll would tear down and rebuild the Firestore
        // listener every minute — the flow must only fire on an actual rollover.
        advanceTimeBy(DATE_ROLLOVER_POLL_MS * 10)

        assertEquals(listOf("2026-08-07"), seen)
        job.cancel()
    }
}
