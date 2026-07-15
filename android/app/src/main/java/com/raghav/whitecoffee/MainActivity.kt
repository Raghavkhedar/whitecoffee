package com.raghav.whitecoffee

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
    }

    override fun onStop() {
        super.onStop()
        locationProvider.stopTracking()
    }
}
