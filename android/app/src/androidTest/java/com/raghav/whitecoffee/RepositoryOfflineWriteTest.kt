package com.raghav.whitecoffee

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.PersistentCacheSettings
import com.google.firebase.firestore.Source
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.data.repository.FirestoreAttendanceRepository
import com.raghav.whitecoffee.data.repository.FirestoreLeaveRepository
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.platform.app.InstrumentationRegistry

/**
 * Emulator-backed proof that a field write completes **without a server round-trip**.
 *
 * This is the test the JVM suite cannot be: `FirestoreAttendanceRepository` and
 * `FirestoreLeaveRepository` have no fake seam because they *are* the seam, and the Firestore
 * Android SDK will not run on a plain JVM. The companion `OfflineWritePolicyTest` (unit sources)
 * catches the specific regression cheaply; this one proves the actual behaviour.
 *
 * ## Running it
 * ```
 * firebase emulators:start --only firestore     # from the repo root
 * cd android && ./gradlew :app:connectedDebugAndroidTest
 * ```
 * Needs a connected device or running AVD. `EMULATOR_HOST` below is `10.0.2.2` — the loopback
 * alias an Android emulator uses to reach the host machine. On a physical device, change it to
 * the host's LAN address.
 *
 * ## What it asserts
 * Each test disables the network on the Firestore instance, performs the write, and requires it
 * to return **within a timeout**. That timeout is the whole point: with offline persistence a
 * write Task resolves only on server acknowledgement, so a repository that awaits one will hang
 * here rather than fail an assertion — which is precisely what the user experienced as a spinner
 * that never stopped.
 */
@RunWith(AndroidJUnit4::class)
class RepositoryOfflineWriteTest {

    companion object {
        private const val EMULATOR_HOST = "10.0.2.2"
        private const val EMULATOR_PORT = 8080

        /** A write must return well inside this even with no network. */
        private const val OFFLINE_WRITE_TIMEOUT_MS = 3_000L

        private lateinit var firestore: FirebaseFirestore

        @BeforeClass
        @JvmStatic
        fun configureFirestore() {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            FirebaseApp.initializeApp(context)
            firestore = FirebaseFirestore.getInstance().apply {
                useEmulator(EMULATOR_HOST, EMULATOR_PORT)
                firestoreSettings = FirebaseFirestoreSettings.Builder()
                    .setLocalCacheSettings(PersistentCacheSettings.newBuilder().build())
                    .build()
            }
        }
    }

    private lateinit var session: SessionManager
    private lateinit var location: LocationProvider

    @Before
    fun setUp() {
        session = StubSessionManager()
        location = StubLocationProvider()
    }

    private suspend fun offline(block: suspend () -> Unit) {
        firestore.disableNetwork().await()
        try {
            block()
        } finally {
            firestore.enableNetwork().await()
        }
    }

    @Test
    fun anAttendancePunchCompletesWithNoNetwork() = runBlocking {
        val repo = FirestoreAttendanceRepository(firestore, session, location)

        offline {
            val result = withTimeout(OFFLINE_WRITE_TIMEOUT_MS) {
                repo.recordEvent(
                    type = AttendanceType.HOME_IN,
                    latitude = 28.6,
                    longitude = 77.2,
                )
            }
            assertTrue("an offline punch must report success", result.isSuccess)
            assertTrue("the id must be generated locally", result.getOrThrow().id.isNotBlank())
        }
    }

    /** The punch must be readable from cache immediately — that is what "durable" means here. */
    @Test
    fun anOfflinePunchIsImmediatelyReadableFromCache() = runBlocking {
        val repo = FirestoreAttendanceRepository(firestore, session, location)

        offline {
            val written = repo.recordEvent(
                type = AttendanceType.HOME_IN,
                latitude = 28.6,
                longitude = 77.2,
            ).getOrThrow()

            val cached = firestore.collection("users").document(session.userId)
                .collection("attendance").document(written.id)
                .get(Source.CACHE)
                .await()

            assertTrue("the write must be on disk before the call returns", cached.exists())
            assertEquals(AttendanceType.HOME_IN, cached.getString("type"))
        }
    }

    /**
     * The regression that produced duplicate leave requests: `add(...).await()` never resolves
     * offline, so this hung, the user retried, and each retry queued another document.
     */
    @Test
    fun aLeaveSubmissionCompletesWithNoNetwork() = runBlocking {
        val repo = FirestoreLeaveRepository(firestore, session)

        offline {
            val result = withTimeout(OFFLINE_WRITE_TIMEOUT_MS) {
                repo.submitLeaveRequest(
                    LeaveRequest(
                        fromDate = "2026-08-01",
                        toDate = "2026-08-02",
                        totalDays = 2,
                        reason = "Family function",
                    )
                )
            }
            assertTrue("an offline leave submission must report success", result.isSuccess)
            assertNotNull(result.getOrThrow())
            assertTrue(result.getOrThrow().isNotBlank())
        }
    }

    /** Two submissions must not collide on an id — each reserves its own document. */
    @Test
    fun consecutiveOfflineSubmissionsGetDistinctIds() = runBlocking {
        val repo = FirestoreLeaveRepository(firestore, session)
        val request = LeaveRequest(
            fromDate = "2026-08-01", toDate = "2026-08-02", totalDays = 2, reason = "Family function",
        )

        offline {
            val first = repo.submitLeaveRequest(request).getOrThrow()
            val second = repo.submitLeaveRequest(request).getOrThrow()
            assertTrue("ids must be client-generated and distinct", first != second)
        }
    }

    /** Queued writes must reach the server once the connection returns. */
    @Test
    fun anOfflinePunchSyncsOnReconnect() = runBlocking {
        val repo = FirestoreAttendanceRepository(firestore, session, location)

        val written = offlineWrite(repo)
        firestore.enableNetwork().await()

        val fromServer = withTimeout(10_000L) {
            firestore.collection("users").document(session.userId)
                .collection("attendance").document(written)
                .get(Source.SERVER)
                .await()
        }
        assertTrue("the queued write must reach the server on reconnect", fromServer.exists())
    }

    private suspend fun offlineWrite(repo: FirestoreAttendanceRepository): String {
        firestore.disableNetwork().await()
        return repo.recordEvent(
            type = AttendanceType.HOME_IN, latitude = 28.6, longitude = 77.2,
        ).getOrThrow().id
    }

    // ── stubs ─────────────────────────────────────────────────────────────
    // Hand-written, matching the unit-test fakes. No mocking library anywhere in this project.

    private class StubSessionManager : SessionManager {
        override val userId: String = "instrumented-test-user"
        override val employeeId: String = "EMP-TEST"
        override val name: String = "Test User"
        override val email: String = "test@whitecoffee.com"
        override val role: String = "operations"
        override val sessionToken: String = "token"
        override val isLoggedIn: Boolean = true
        override val isOperations: Boolean = true
        override val isOffice: Boolean = false
        override val isSales: Boolean = false
        override val isAdmin: Boolean = false
        override fun saveSession(
            userId: String, employeeId: String, name: String,
            email: String, role: String, sessionToken: String,
        ) = Unit
        override fun tryRestoreFromCache(): Boolean = true
        override fun clearSession() = Unit
    }

    private class StubLocationProvider : LocationProvider {
        override val lastFixWasMock: Boolean = false
        override suspend fun getCurrentLocation(): LocationState =
            LocationState.Success(latitude = 28.6, longitude = 77.2, isMock = false)
        override fun startTracking() = Unit
        override fun stopTracking() = Unit
        override fun isGpsEnabled(): Boolean = true
    }
}
