package com.raghav.whitecoffee

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavOptions
import androidx.navigation.findNavController
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.model.AccountStatus
import com.raghav.whitecoffee.data.notification.AttendanceEntry
import com.raghav.whitecoffee.data.notification.EXTRA_ATTENDANCE_ENTRY
import com.raghav.whitecoffee.ui.account.AccountSuspendedBlock
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    private val viewModel: MainViewModel by viewModels()

    // Foreground location tracking lives at the activity level so a warm fix is ready
    // app-wide (started in onStart, torn down in onStop — never runs in the background).
    @Inject
    lateinit var locationProvider: LocationProvider

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<ComposeView>(R.id.account_overlay).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                val status by viewModel.accountStatus.collectAsStateWithLifecycle()
                (status as? AccountStatus.Suspended)?.let { AccountSuspendedBlock(it) }
            }
        }

        viewModel.startMonitorIfLoggedIn()

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.sessionInvalidated.collect {
                    viewModel.logout()
                    Toast.makeText(
                        this@MainActivity,
                        "Signed in on another device. Please log in again.",
                        Toast.LENGTH_LONG
                    ).show()
                    findNavController(R.id.nav_host_fragment).navigate(
                        R.id.loginFragment,
                        null,
                        NavOptions.Builder()
                            .setPopUpTo(R.id.nav_graph, true)
                            .build()
                    )
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Warm up location while the app is foregrounded. No-ops until permission is granted;
        // the attendance screens kick it again on first grant.
        locationProvider.startTracking()
        openAttendanceIfRequested(intent)
    }

    /**
     * The app was already running and the ongoing "still checked in" notification was tapped.
     * CLEAR_TOP|SINGLE_TOP on that PendingIntent routes it here rather than to a second instance.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openAttendanceIfRequested(intent)
    }

    /**
     * Sends a tap on the ongoing check-in reminder to the attendance screen that owns the open
     * session (see [AttendanceEntry] — chosen by the session, never by the role, because sales is
     * hybrid).
     *
     * The extra is consumed on the way through so a configuration change cannot re-navigate. On a
     * cold start the nav graph is still at login and the session may not be restored yet, so this
     * deliberately does nothing beyond bringing the app up — landing someone on an attendance
     * screen before their session is known is worse than one extra tap.
     */
    private fun openAttendanceIfRequested(intent: Intent?) {
        val entry = intent?.getStringExtra(EXTRA_ATTENDANCE_ENTRY) ?: return
        intent.removeExtra(EXTRA_ATTENDANCE_ENTRY)

        val nav = findNavController(R.id.nav_host_fragment)
        if (nav.currentDestination?.id != R.id.homeFragment) return
        when (entry) {
            AttendanceEntry.OFFICE.name ->
                nav.navigate(R.id.action_homeFragment_to_officeAttendanceFragment)
            AttendanceEntry.OPERATIONS.name ->
                nav.navigate(R.id.action_homeFragment_to_attendanceFragment)
        }
    }

    override fun onStop() {
        super.onStop()
        locationProvider.stopTracking()
    }
}
