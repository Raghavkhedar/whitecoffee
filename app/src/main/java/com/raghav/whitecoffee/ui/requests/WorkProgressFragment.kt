package com.raghav.whitecoffee.ui.requests

import android.app.DatePickerDialog
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Calendar

/** Work Progress — Compose host. Logic stays in [WorkProgressViewModel]. */
@AndroidEntryPoint
class WorkProgressFragment : Fragment() {

    private val viewModel: WorkProgressViewModel by viewModels()
    private val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd")

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
            val submit by viewModel.submitState.collectAsStateWithLifecycle()
            var photos by remember { mutableStateOf<List<Uri>>(emptyList()) }
            var date by remember { mutableStateOf(LocalDate.now().format(fmt)) }

            val picker = rememberLauncherForActivityResult(
                ActivityResultContracts.PickMultipleVisualMedia(10)
            ) { uris ->
                if (uris.isNotEmpty()) {
                    photos = (photos + uris).distinct()
                    viewModel.onPhotosChanged(photos)
                }
            }

            LaunchedEffect(submit) { if (submit is UiState.Success) showSuccessAndExit() }

            WorkProgressScreen(
                date = date,
                isOnline = isOnline,
                submitting = submit is UiState.Loading,
                error = (submit as? UiState.Error)?.message,
                photos = photos,
                onBack = { findNavController().navigateUp() },
                onPickDate = { showDatePicker(date) { date = it } },
                onAddPhoto = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                onRemovePhoto = { photos = photos - it; viewModel.onPhotosChanged(photos) },
                onSubmit = { siteId, siteName, hours, description ->
                    viewModel.submitProgress(siteId, siteName, date, hours, description, photos)
                },
            )
        }
    }

    private fun showDatePicker(current: String, onPicked: (String) -> Unit) {
        val cal = Calendar.getInstance()
        runCatching { LocalDate.parse(current, fmt) }.getOrNull()?.let {
            cal.set(it.year, it.monthValue - 1, it.dayOfMonth)
        }
        DatePickerDialog(
            requireContext(),
            { _, year, month, day -> onPicked(LocalDate.of(year, month + 1, day).format(fmt)) },
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH),
        ).show()
    }

    private fun showSuccessAndExit() {
        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Progress Submitted ✓")
            .setMessage("Your work progress has been recorded successfully.")
            .setPositiveButton("OK") { _, _ -> findNavController().navigateUp() }
            .setCancelable(false)
            .show()
    }
}
