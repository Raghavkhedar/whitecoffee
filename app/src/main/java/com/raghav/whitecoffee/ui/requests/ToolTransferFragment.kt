package com.raghav.whitecoffee.ui.requests

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.core.UiState
import dagger.hilt.android.AndroidEntryPoint
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** Tool Transfer — Compose host (no photos). Logic stays in [TransferViewModel]. */
@AndroidEntryPoint
class ToolTransferFragment : Fragment() {

    private val viewModel: TransferViewModel by viewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
            val submit by viewModel.submitState.collectAsStateWithLifecycle()
            val today = remember { LocalDate.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy")) }

            LaunchedEffect(submit) { if (submit is UiState.Success) showSuccessAndExit() }

            TransferScreen(
                isTool = true,
                todayDate = today,
                isOnline = isOnline,
                submitting = submit is UiState.Loading,
                error = (submit as? UiState.Error)?.message,
                photos = emptyList(),
                onBack = { findNavController().navigateUp() },
                onAddPhoto = {},
                onRemovePhoto = {},
                onSubmit = { from, to, by, recv, items, notes ->
                    viewModel.submitToolTransfer(from, to, by, recv, items, notes)
                },
            )
        }
    }

    private fun showSuccessAndExit() {
        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Transfer Submitted ✓")
            .setMessage("Tool transfer submitted successfully.")
            .setPositiveButton("OK") { _, _ -> findNavController().navigateUp() }
            .setCancelable(false).show()
    }
}
