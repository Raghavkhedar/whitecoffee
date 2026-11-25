package com.raghav.whitecoffee.ui.requests

import android.app.AlertDialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.data.model.IncomingTransfer
import dagger.hilt.android.AndroidEntryPoint

/** Incoming Transfers — Compose host. Logic stays in [IncomingTransfersViewModel]. */
@AndroidEntryPoint
class IncomingTransfersFragment : Fragment() {

    private val viewModel: IncomingTransfersViewModel by viewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
            val state by viewModel.state.collectAsStateWithLifecycle()
            IncomingTransfersScreen(
                state = state,
                isOnline = isOnline,
                onBack = { findNavController().navigateUp() },
                onReceived = ::confirmReceived,
                onProblem = ::askProblem,
            )
        }
    }

    // "Received" is final under the rules, so a stray tap must not be enough.
    private fun confirmReceived(item: IncomingTransfer) {
        AlertDialog.Builder(requireContext())
            .setTitle("Confirm receipt")
            .setMessage("Have you received everything on this transfer? This closes it.")
            .setPositiveButton("Yes, received") { _, _ -> viewModel.confirm(item) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun askProblem(item: IncomingTransfer) {
        val input = EditText(requireContext()).apply {
            hint = "What is missing or damaged?"
            filters = arrayOf(android.text.InputFilter.LengthFilter(500))
        }
        AlertDialog.Builder(requireContext())
            .setTitle("Report a problem")
            .setView(input)
            .setPositiveButton("Send") { _, _ ->
                val note = input.text.toString()
                if (note.isBlank()) {
                    Toast.makeText(requireContext(), "Please describe the problem.", Toast.LENGTH_SHORT).show()
                } else {
                    viewModel.reportProblem(item, note)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
