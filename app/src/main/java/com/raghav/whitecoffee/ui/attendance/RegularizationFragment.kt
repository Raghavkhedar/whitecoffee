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
import dagger.hilt.android.AndroidEntryPoint
import java.text.SimpleDateFormat
import java.util.Locale

/** Regularization — Compose host. Logic stays in [RegularizationViewModel]. */
@AndroidEntryPoint
class RegularizationFragment : Fragment() {

    private val viewModel: RegularizationViewModel by viewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val state by viewModel.daysState.collectAsStateWithLifecycle()
            val submit by viewModel.submitState.collectAsStateWithLifecycle()

            LaunchedEffect(submit) {
                when (val s = submit) {
                    is UiState.Success -> { Toast.makeText(requireContext(), "Request submitted", Toast.LENGTH_SHORT).show(); viewModel.resetSubmitState() }
                    is UiState.Error -> { Toast.makeText(requireContext(), s.message, Toast.LENGTH_LONG).show(); viewModel.resetSubmitState() }
                    else -> {}
                }
            }

            RegularizationScreen(
                state = state,
                todayLabel = viewModel.todayLabel,
                onBack = { findNavController().navigateUp() },
                onRequest = { showApplyDialog(it) },
                onRetry = { viewModel.loadToday() },
            )
        }
    }

    private fun showApplyDialog(item: RegularizationDayItem) {
        val editText = EditText(requireContext()).apply {
            hint = "Enter reason"
            setPadding(48, 32, 48, 16)
        }
        val displayDate = try {
            INPUT_FORMAT.parse(item.date)?.let { DISPLAY_FORMAT.format(it) } ?: item.date
        } catch (e: Exception) { item.date }

        AlertDialog.Builder(requireContext())
            .setTitle("Regularize $displayDate")
            .setMessage("Original status: ${item.originalStatus}")
            .setView(editText)
            .setPositiveButton("Submit") { _, _ ->
                val reason = editText.text.toString().trim()
                if (reason.isBlank()) Toast.makeText(requireContext(), "Please enter a reason.", Toast.LENGTH_SHORT).show()
                else viewModel.submitRequest(item.date, item.originalStatus, reason)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    companion object {
        private val INPUT_FORMAT = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        private val DISPLAY_FORMAT = SimpleDateFormat("d MMM yyyy", Locale.getDefault())
    }
}
