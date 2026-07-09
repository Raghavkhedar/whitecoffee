package com.raghav.whitecoffee.ui.attendance

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.unit.dp
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.ui.attendance.AttendanceViewModel.ActionState
import com.raghav.whitecoffee.ui.theme.WcDialog
import com.raghav.whitecoffee.ui.theme.WcField
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Operations attendance — Compose host (Material 3 redesign).
 *
 * Thin host: owns the ViewModel + GPS permission + the manual site/market entry dialogs
 * (now Compose [WcDialog]s); the UI is [OperationsAttendanceScreen]. All check-in/out
 * logic stays in [AttendanceViewModel].
 */
@AndroidEntryPoint
class AttendanceFragment : Fragment() {

    private val viewModel: AttendanceViewModel by viewModels()

    @Inject
    lateinit var locationProvider: LocationProvider

    private val gpsEnabled = mutableStateOf(true)

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        // On grant, start warming the location immediately so the first check-in is instant.
        if (grants.values.any { it }) locationProvider.startTracking()
    }

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
                if (action is ActionState.Success) viewModel.resetActionState()
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

            // Manual site / market entry — Compose dialogs (replace the old View AlertDialogs).
            when (val a = action) {
                is ActionState.SiteInputRequired -> SiteCheckInDialog(
                    onConfirm = { siteId, siteName -> viewModel.confirmSiteCheckIn(siteId, siteName) },
                    onDismiss = { viewModel.resetActionState() },
                )
                is ActionState.MarketNameRequired -> MarketCheckInDialog(
                    onConfirm = { name -> viewModel.confirmMarketCheckIn(name, a.currentLat, a.currentLng) },
                    onDismiss = { viewModel.resetActionState() },
                )
                else -> {}
            }
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
}

// ── Site check-in: free-text Site Name (required) + Site ID (optional). No geofence. ─
@Composable
private fun SiteCheckInDialog(
    onConfirm: (siteId: String, siteName: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var siteName by remember { mutableStateOf("") }
    var siteId by remember { mutableStateOf("") }
    WhiteCoffeeTheme {
        WcDialog(
            title = "Check In at Site",
            confirmText = "Check In",
            confirmEnabled = siteName.isNotBlank(),
            onConfirm = { onConfirm(siteId.trim(), siteName.trim()) },
            onDismiss = onDismiss,
        ) {
            WcField(
                value = siteName,
                onValueChange = { siteName = it },
                placeholder = "Site Name (e.g. Senken Gurugaon Site)",
            )
            Spacer(Modifier.height(10.dp))
            WcField(
                value = siteId,
                onValueChange = { siteId = it },
                placeholder = "Site ID (optional, e.g. Site-001)",
            )
        }
    }
}

// ── Market check-in: single free-text market name. ───────────────────────────
@Composable
private fun MarketCheckInDialog(
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var market by remember { mutableStateOf("") }
    WhiteCoffeeTheme {
        WcDialog(
            title = "Market Check In",
            subtitle = "Enter the name of the market you are visiting",
            confirmText = "Check In",
            confirmEnabled = market.isNotBlank(),
            onConfirm = { onConfirm(market.trim()) },
            onDismiss = onDismiss,
        ) {
            WcField(
                value = market,
                onValueChange = { market = it },
                placeholder = "Enter market name",
            )
        }
    }
}
