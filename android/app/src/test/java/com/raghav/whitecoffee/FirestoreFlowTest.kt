package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.firestore.Cancelable
import com.raghav.whitecoffee.data.firestore.listenerFlow
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FirestoreFlowTest {

    @Test fun `emits values pushed by the subscriber`() = runTest {
        val flow = listenerFlow<Int> { onNext, _ ->
            onNext(1); onNext(2); onNext(3)
            Cancelable { }
        }
        assertEquals(listOf(1, 2, 3), flow.take(3).toList())
    }

    @Test fun `cancels the registration when the collector stops`() = runTest {
        var canceled = false
        val flow = listenerFlow<Int> { onNext, _ ->
            onNext(42)
            Cancelable { canceled = true }
        }
        val job = launch { flow.collect { } }
        // one value is enough to prove it started; cancelling must trigger cleanup.
        // yield() lets the collector coroutine actually start under StandardTestDispatcher
        // (the runTest default) before we cancel it — without this, cancel() can race
        // ahead of the coroutine's first dispatch and the body never runs at all.
        yield()
        job.cancel()
        job.join()
        assertTrue(canceled)
    }
}
