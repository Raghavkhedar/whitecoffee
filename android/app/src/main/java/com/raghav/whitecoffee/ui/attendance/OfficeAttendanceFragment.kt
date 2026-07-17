package com.raghav.whitecoffee.ui.attendance

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.data.location.LocationProvider
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Office attendance (Home → Office → Home) — Compose host (Material 3 redesign).
 * UI is [OfficeAttendanceScreen]; all phase logic stays in [OfficeAttendanceViewModel].
 */
@AndroidEntryPoint
class OfficeAttendanceFragment : Fragment() {

    private val viewModel: OfficeAttendanceViewModel by viewModels()

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
            val state by viewModel.state.collectAsStateWithLifecycle()
            val events by viewModel.todayEvents.collectAsStateWithLifecycle()
            val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
            var showHomeOutConfirm by remember { mutableStateOf(false) }

            OfficeAttendanceScreen(
                state = state,
                events = events,
                isOnline = isOnline,
                gpsEnabled = gpsEnabled.value,
                onBack = { findNavController().navigateUp() },
                onEnableGps = { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) },
                onHomeIn = viewModel::homeIn,
                onCheckIn = viewModel::checkIn,
                onCheckOut = {
                    (viewModel.state.value as? OfficeAttendanceViewModel.OfficeState.InOffice)?.let {
                        viewModel.checkOut(it.locationName)
                    }
                },
                onHomeOut = { showHomeOutConfirm = true },
            )

            if (showHomeOutConfirm) {
                HomeOutConfirmDialog(
                    onConfirm = {
                        showHomeOutConfirm = false
                        viewModel.homeOut()
                    },
                    onDismiss = { showHomeOutConfirm = false },
                )
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
