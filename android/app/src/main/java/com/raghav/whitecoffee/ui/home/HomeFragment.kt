package com.raghav.whitecoffee.ui.home

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.fragment.app.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavOptions
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.MainViewModel
import com.raghav.whitecoffee.R
import com.raghav.whitecoffee.ui.theme.WcDialog
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class HomeFragment : Fragment() {

    private val viewModel: HomeViewModel by viewModels()
    private val mainViewModel: MainViewModel by activityViewModels()

    /**
     * POST_NOTIFICATIONS. Denial is non-fatal by design: the in-app notifications screen and the
     * unread bell keep working untouched, the user just loses the system-tray copies.
     *
     * The battery prompt is chained onto the result so the two dialogs never stack on top of each
     * other on a first launch.
     */
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { promptBatteryOptimization() }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val uiState      by viewModel.uiState.collectAsStateWithLifecycle()
            val isOnline     by viewModel.isOnline.collectAsStateWithLifecycle()
            val isLoggingOut by mainViewModel.logoutInProgress.collectAsStateWithLifecycle()
            var showLogoutConfirm by remember { mutableStateOf(false) }

            // Collect logout-complete event and navigate once it fires.
            LaunchedEffect(Unit) {
                mainViewModel.logoutComplete.collect { navigateToLogin() }
            }

            HomeScreen(
                greeting         = viewModel.greeting,
                userName         = viewModel.userName,
                userRole         = viewModel.userRole,
                todayStatus      = uiState.todayStatus,
                isOperations     = viewModel.isOperations,
                isOffice         = viewModel.isOffice,
                isAdmin          = viewModel.isAdmin,
                isOnline         = isOnline,
                unreadCount      = uiState.unreadCount,
                isLoggingOut     = isLoggingOut,
                onBellClick      = { findNavController().navigate(R.id.action_homeFragment_to_notificationsFragment) },
                // Logging out closes an open day by writing a terminal HOME_OUT, so it costs the
                // rest of the day exactly like an accidental "End Day" tap — confirm it. When no
                // day is open, auto-checkout writes nothing, so don't nag: log straight out.
                onLogout         = {
                    if (uiState.logoutWouldEndDay) showLogoutConfirm = true
                    else mainViewModel.logoutWithAutoCheckout()
                },
                onAttendanceClick = {
                    when {
                        viewModel.isSales ->
                            findNavController().navigate(R.id.action_homeFragment_to_salesAttendanceFragment)
                        viewModel.isOperations ->
                            findNavController().navigate(R.id.action_homeFragment_to_attendanceFragment)
                        else ->
                            findNavController().navigate(R.id.action_homeFragment_to_officeAttendanceFragment)
                    }
                },
                onMtRequestClick        = { findNavController().navigate(R.id.action_homeFragment_to_materialToolRequestFragment) },
                onMtBuyClick            = { findNavController().navigate(R.id.action_homeFragment_to_materialToolBuyFragment) },
                onMaterialTransferClick = { findNavController().navigate(R.id.action_homeFragment_to_materialTransferFragment) },
                onToolTransferClick     = { findNavController().navigate(R.id.action_homeFragment_to_toolTransferFragment) },
                onWorkProgressClick     = { findNavController().navigate(R.id.action_homeFragment_to_workProgressFragment) },
                onLeaveClick            = { findNavController().navigate(R.id.action_homeFragment_to_leaveFragment) },
                onLeaveApprovalsClick   = { findNavController().navigate(R.id.action_homeFragment_to_leaveApprovalsFragment) },
                onRegularizationClick   = { findNavController().navigate(R.id.action_homeFragment_to_regularizationFragment) },
            )

            if (showLogoutConfirm) {
                LogoutEndsDayDialog(
                    onConfirm = {
                        showLogoutConfirm = false
                        mainViewModel.logoutWithAutoCheckout()
                    },
                    onDismiss = { showLogoutConfirm = false },
                )
            }
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        // Home is the one screen every user passes through after login, which is why the ask
        // lives here. If the permission flow runs, the battery prompt follows in its callback.
        if (!requestNotificationPermissionIfNeeded()) promptBatteryOptimization()
    }

    /**
     * Asks for POST_NOTIFICATIONS on Android 13+ (API 33). Returns true if a request was launched.
     *
     * The manifest has declared this permission all along, but nothing ever requested it at
     * runtime — and since API 33 it is a runtime permission that starts **denied**, which turns
     * every `NotificationManager.notify()` into a silent no-op. Both delivery paths died on it:
     * `FcmService` builds a correct notification that was simply dropped, and FCM's own tray
     * notifications for a backgrounded app were dropped too. It is also what the ongoing
     * "you're still checked in" reminder needs, which is the one worth real money.
     *
     * Guarded on SDK_INT: below 33 the permission is granted at install and requesting it is a
     * no-op that would still cost a launcher round-trip. minSdk here is 26.
     */
    private fun requestNotificationPermissionIfNeeded(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        val granted = ContextCompat.checkSelfPermission(
            requireContext(),
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) return false
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        return true
    }

    override fun onResume() {
        super.onResume()
        viewModel.loadTodayAttendance()
    }

    private fun navigateToLogin() {
        val nav = findNavController()
        if (nav.currentDestination?.id == R.id.homeFragment) {
            nav.navigate(
                R.id.loginFragment,
                null,
                NavOptions.Builder().setPopUpTo(R.id.nav_graph, true).build()
            )
        }
    }

    private fun promptBatteryOptimization() {
        val prefs = requireContext().getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("battery_opt_asked", false)) return
        val pm = requireContext().getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(requireContext().packageName)) return
        prefs.edit().putBoolean("battery_opt_asked", true).apply()
        AlertDialog.Builder(requireContext())
            .setTitle("Enable background sync")
            .setMessage(
                "Allow White Coffee to upload photos and sync data in the background, " +
                "even when the app is closed. This ensures offline submissions upload " +
                "automatically when your connection returns."
            )
            .setPositiveButton("Allow") { _, _ ->
                startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${requireContext().packageName}")
                    }
                )
            }
            .setNegativeButton("Not now", null)
            .show()
    }
}

/**
 * Confirmation for a logout that would close an open day.
 *
 * Logging out runs MainViewModel's auto-checkout, which writes a terminal HOME_OUT — so an
 * accidental logout costs the employee the rest of their day exactly like an accidental "End Day"
 * tap does, just through a different door. Only shown when willLogoutCloseDay says a day is
 * actually open; a logout that writes nothing goes straight through.
 */
@Composable
private fun LogoutEndsDayDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) = WhiteCoffeeTheme {
    WcDialog(
        title = "Log out and end your day?",
        subtitle = "You're still checked in. Logging out will check you out for the day, " +
            "and you won't be able to check in again today.",
        confirmText = "Log out",
        onConfirm = onConfirm,
        onDismiss = onDismiss,
    ) {}
}
