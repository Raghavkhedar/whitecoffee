package com.raghav.whitecoffee.ui.attendance

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.LeaveRequest
import dagger.hilt.android.AndroidEntryPoint

/** Leave Approvals (admin) — Compose host. Logic stays in [LeaveApprovalsViewModel]. */
@AndroidEntryPoint
class LeaveApprovalsFragment : Fragment() {

    private val viewModel: LeaveApprovalsViewModel by viewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val state by viewModel.approvalsState.collectAsStateWithLifecycle()
            val action by viewModel.actionState.collectAsStateWithLifecycle()

            LaunchedEffect(action) {
                if (action is UiState.Error) {
                    Toast.makeText(requireContext(), (action as UiState.Error).message, Toast.LENGTH_LONG).show()
                    viewModel.resetActionState()
                }
            }

            LeaveApprovalsScreen(
                state = state,
                onBack = { findNavController().navigateUp() },
                onApprove = { viewModel.approve(it) },
                onReject = { showRejectDialog(it) },
                onRetry = { viewModel.loadPending() },
            )
        }
    }

    private fun showRejectDialog(request: LeaveRequest) {
        val input = EditText(requireContext()).apply {
            hint = "Reason for rejection (optional)"
            setPadding(48, 32, 48, 32)
        }
        AlertDialog.Builder(requireContext())
            .setTitle("Reject Leave Request")
            .setMessage("${request.userName} — ${request.leaveType}")
            .setView(input)
            .setPositiveButton("Reject") { _, _ -> viewModel.reject(request, input.text.toString()) }
            .setNegativeButton("Cancel") { _, _ -> viewModel.resetActionState() }
            .show()
    }
}
