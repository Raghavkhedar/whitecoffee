package com.raghav.whitecoffee.ui.attendance

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.R
import dagger.hilt.android.AndroidEntryPoint

/**
 * Sales attendance entry point — a thin chooser between the two existing attendance flows.
 *
 * Sales is a hybrid role: it can do an office day OR a site-visit day, chosen per day. This host
 * shows [SalesAttendanceScreen] (two options) and routes to the already-wired
 * [OfficeAttendanceFragment] / [AttendanceFragment] destinations, reusing both flows unchanged.
 */
@AndroidEntryPoint
class SalesAttendanceFragment : Fragment() {

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            SalesAttendanceScreen(
                onBack = { findNavController().navigateUp() },
                onOfficeDay = {
                    findNavController().navigate(R.id.action_salesAttendanceFragment_to_officeAttendanceFragment)
                },
                onSiteVisit = {
                    findNavController().navigate(R.id.action_salesAttendanceFragment_to_attendanceFragment)
                },
            )
        }
    }
}
