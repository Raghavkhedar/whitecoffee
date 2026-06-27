package com.raghav.whitecoffee.ui.home

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.appcompat.app.AlertDialog
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.fragment.app.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavOptions
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.MainViewModel
import com.raghav.whitecoffee.R
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class HomeFragment : Fragment() {

    private val viewModel: HomeViewModel by viewModels()
    private val mainViewModel: MainViewModel by activityViewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val todayStatus  by viewModel.todayStatus.collectAsStateWithLifecycle()
            val isOnline     by viewModel.isOnline.collectAsStateWithLifecycle()
            val isLoggingOut by mainViewModel.logoutInProgress.collectAsStateWithLifecycle()
            val unreadCount  by viewModel.unreadCount.collectAsStateWithLifecycle()

            // Collect logout-complete event and navigate once it fires.
            LaunchedEffect(Unit) {
                mainViewModel.logoutComplete.collect { navigateToLogin() }
            }

            HomeScreen(
                greeting         = viewModel.greeting,
                userName         = viewModel.userName,
                userRole         = viewModel.userRole,
                todayStatus      = todayStatus,
                isOperations     = viewModel.isOperations,
                isAdmin          = viewModel.isAdmin,
                isOnline         = isOnline,
                unreadCount      = unreadCount,
                isLoggingOut     = isLoggingOut,
                onBellClick      = { findNavController().navigate(R.id.action_homeFragment_to_notificationsFragment) },
                onLogout         = { mainViewModel.logoutWithAutoCheckout() },
                onAttendanceClick = {
                    if (viewModel.isOperations)
                        findNavController().navigate(R.id.action_homeFragment_to_attendanceFragment)
                    else
                        findNavController().navigate(R.id.action_homeFragment_to_officeAttendanceFragment)
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
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        promptBatteryOptimization()
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
