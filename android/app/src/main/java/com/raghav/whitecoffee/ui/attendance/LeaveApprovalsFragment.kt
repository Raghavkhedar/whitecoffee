package com.raghav.whitecoffee.ui.attendance

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
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
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.ui.theme.WcDialog
import com.raghav.whitecoffee.ui.theme.WcField
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme
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

            // Inline Compose reject dialog (replaces the old View AlertDialog).
            var rejectRequest by remember { mutableStateOf<LeaveRequest?>(null) }
            var reason by remember { mutableStateOf("") }

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
                onReject = { rejectRequest = it; reason = "" },
                onRetry = { viewModel.loadPending() },
            )

            rejectRequest?.let { request ->
                WhiteCoffeeTheme {
                    WcDialog(
                        title = "Reject Leave Request",
                        subtitle = "${request.userName} · ${request.fromDate} → ${request.toDate}",
                        confirmText = "Reject",
                        onConfirm = {
                            viewModel.reject(request, reason.trim())
                            rejectRequest = null
                        },
                        onDismiss = {
                            viewModel.resetActionState()
                            rejectRequest = null
                        },
                    ) {
                        WcField(
                            value = reason,
                            onValueChange = { reason = it },
                            placeholder = "Reason for rejection (optional)",
                            singleLine = false,
                            minLines = 2,
                        )
                    }
                }
            }
        }
    }
}
