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
import com.raghav.whitecoffee.ui.theme.WcDialog
import com.raghav.whitecoffee.ui.theme.WcField
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme
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

            // Inline Compose regularize dialog (replaces the old View AlertDialog).
            var dialogItem by remember { mutableStateOf<RegularizationDayItem?>(null) }
            var reason by remember { mutableStateOf("") }

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
                onRequest = { dialogItem = it; reason = "" },
                onRetry = { viewModel.loadToday() },
            )

            dialogItem?.let { item ->
                val displayDate = try {
                    INPUT_FORMAT.parse(item.date)?.let { DISPLAY_FORMAT.format(it) } ?: item.date
                } catch (e: Exception) { item.date }

                WhiteCoffeeTheme {
                    WcDialog(
                        title = "Regularize $displayDate",
                        subtitle = "Original status: ${item.originalStatus}",
                        confirmText = "Submit",
                        confirmEnabled = reason.isNotBlank(),
                        onConfirm = {
                            viewModel.submitRequest(item.date, item.originalStatus, reason.trim())
                            dialogItem = null
                        },
                        onDismiss = { dialogItem = null },
                    ) {
                        WcField(
                            value = reason,
                            onValueChange = { reason = it },
                            placeholder = "Enter reason",
                            singleLine = false,
                            minLines = 3,
                        )
                    }
                }
            }
        }
    }

    companion object {
        private val INPUT_FORMAT = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        private val DISPLAY_FORMAT = SimpleDateFormat("d MMM yyyy", Locale.getDefault())
    }
}
