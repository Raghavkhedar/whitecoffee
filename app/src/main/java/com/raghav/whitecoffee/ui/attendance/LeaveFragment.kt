package com.raghav.whitecoffee.ui.attendance

import android.app.DatePickerDialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.LaunchedEffect
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
import com.raghav.whitecoffee.core.UiState
import dagger.hilt.android.AndroidEntryPoint
import java.util.Calendar

/** Leave — Compose host with Apply/History tabs. Uses both [LeaveViewModel] and [ApplyLeaveViewModel]. */
@AndroidEntryPoint
class LeaveFragment : Fragment() {

    private val leaveViewModel: LeaveViewModel by viewModels()
    private val applyViewModel: ApplyLeaveViewModel by viewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val leavesState by leaveViewModel.leavesState.collectAsStateWithLifecycle()
            val applyState by applyViewModel.submitState.collectAsStateWithLifecycle()

            var fromDate by remember { mutableStateOf("") }
            var toDate by remember { mutableStateOf("") }
            var joiningDate by remember { mutableStateOf("") }
            var emergencyContact by remember { mutableStateOf("") }
            var placeOfVisit by remember { mutableStateOf("") }

            val totalDays = if (fromDate.isNotBlank() && toDate.isNotBlank())
                applyViewModel.calculateDays(fromDate, toDate) else 0

            LaunchedEffect(applyState) {
                if (applyState is UiState.Success) {
                    leaveViewModel.loadLeaves()
                    fromDate = ""
                    toDate = ""
                    joiningDate = ""
                    emergencyContact = ""
                    placeOfVisit = ""
                }
            }

            LeaveScreen(
                leavesState = leavesState,
                applyState = applyState,
                applicantName = applyViewModel.userName,
                fromDate = fromDate,
                toDate = toDate,
                joiningDate = joiningDate,
                emergencyContact = emergencyContact,
                placeOfVisit = placeOfVisit,
                totalDays = totalDays,
                error = (applyState as? UiState.Error)?.message,
                onBack = { findNavController().navigateUp() },
                onPickFrom = { showDatePicker { fromDate = it } },
                onPickTo = { showDatePicker { toDate = it } },
                onPickJoiningDate = { showDatePicker { joiningDate = it } },
                onEmergencyContactChange = { emergencyContact = it },
                onPlaceOfVisitChange = { placeOfVisit = it },
                onSubmit = { reason ->
                    applyViewModel.submit(
                        fromDate = fromDate,
                        toDate = toDate,
                        joiningDate = joiningDate,
                        emergencyContact = emergencyContact,
                        placeOfVisit = placeOfVisit,
                        reason = reason,
                    )
                },
            )
        }
    }

    private fun showDatePicker(onDate: (String) -> Unit) {
        val cal = Calendar.getInstance()
        DatePickerDialog(
            requireContext(),
            { _, year, month, day -> onDate(String.format("%04d-%02d-%02d", year, month + 1, day)) },
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH),
        ).show()
    }
}
