package com.raghav.whitecoffee.ui.attendance

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.ui.attendance.AttendanceViewModel.ActionState
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Operations attendance — Compose host (Material 3 redesign).
 *
 * Thin host: owns the ViewModel + GPS permission + the manual site/market entry dialogs;
 * the UI is [OperationsAttendanceScreen]. All check-in/out logic stays in [AttendanceViewModel].
 */
@AndroidEntryPoint
class AttendanceFragment : Fragment() {

    private val viewModel: AttendanceViewModel by viewModels()

    @Inject
    lateinit var locationProvider: LocationProvider

    private val gpsEnabled = mutableStateOf(true)

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* result handled by location flow on next action */ }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val state by viewModel.attendanceState.collectAsStateWithLifecycle()
            val events by viewModel.todayEvents.collectAsStateWithLifecycle()
            val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
            val action by viewModel.actionState.collectAsStateWithLifecycle()

            LaunchedEffect(action) {
                when (val a = action) {
                    is ActionState.SiteInputRequired -> showSiteInputDialog()
                    is ActionState.MarketNameRequired -> showMarketNameDialog(a.currentLat, a.currentLng)
                    is ActionState.Success -> viewModel.resetActionState()
                    else -> {}
                }
            }

            OperationsAttendanceScreen(
                state = state,
                events = events,
                isOnline = isOnline,
                error = (action as? ActionState.Error)?.message,
                gpsEnabled = gpsEnabled.value,
                onBack = { findNavController().navigateUp() },
                onEnableGps = { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) },
                onHomeIn = viewModel::homeCheckIn,
                onSiteIn = viewModel::initiateSiteCheckIn,
                onMarketIn = viewModel::initiateMarketCheckIn,
                onSiteOut = {
                    val s = (viewModel.attendanceState.value as? UiState.Success)?.data
                    (s as? AttendanceState.SiteCheckedIn)?.record?.let { viewModel.siteCheckOut(it.siteId, it.siteName) }
                },
                onMarketOut = {
                    val s = (viewModel.attendanceState.value as? UiState.Success)?.data
                    (s as? AttendanceState.MarketCheckedIn)?.record?.let { viewModel.marketCheckOut(it.marketName) }
                },
                onHomeOut = viewModel::homeCheckOut,
            )
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        locationPermissionLauncher.launch(
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        )
    }

    override fun onResume() {
        super.onResume()
        gpsEnabled.value = locationProvider.isGpsEnabled()
    }

    // Free-text Site Name + Site ID — no geofence, no Firestore lookup.
    private fun showSiteInputDialog() {
        val container = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 8)
        }
        val etSiteName = EditText(requireContext()).apply { hint = "Site Name (e.g. Senken Gurugaon Site)"; setPadding(0, 16, 0, 16) }
        val etSiteId = EditText(requireContext()).apply { hint = "Site ID (e.g. Site-001)"; setPadding(0, 16, 0, 16) }
        container.addView(etSiteName); container.addView(etSiteId)

        AlertDialog.Builder(requireContext())
            .setTitle("Check In at Site")
            .setView(container)
            .setPositiveButton("Check In") { _, _ ->
                val siteName = etSiteName.text.toString().trim()
                val siteId = etSiteId.text.toString().trim()
                if (siteName.isBlank()) viewModel.resetActionState()
                else viewModel.confirmSiteCheckIn(siteId, siteName)
            }
            .setNegativeButton("Cancel") { _, _ -> viewModel.resetActionState() }
            .setOnCancelListener { viewModel.resetActionState() }
            .show()
    }

    private fun showMarketNameDialog(lat: Double, lng: Double) {
        val input = EditText(requireContext()).apply { hint = "Enter market name"; setPadding(48, 32, 48, 32) }
        AlertDialog.Builder(requireContext())
            .setTitle("Market Check In")
            .setMessage("Enter the name of the market you are visiting:")
            .setView(input)
            .setPositiveButton("Check In") { _, _ -> viewModel.confirmMarketCheckIn(input.text.toString(), lat, lng) }
            .setNegativeButton("Cancel") { _, _ -> viewModel.resetActionState() }
            .setOnCancelListener { viewModel.resetActionState() }
            .show()
    }
}
