package com.raghav.whitecoffee.ui.requests

import android.net.Uri
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
import com.raghav.whitecoffee.data.model.Employee
import dagger.hilt.android.AndroidEntryPoint
import java.time.LocalDate

/** Material Transfer — Compose host. Logic stays in [TransferViewModel]. */
@AndroidEntryPoint
class MaterialTransferFragment : Fragment() {

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
            var photos by remember { mutableStateOf<List<Uri>>(emptyList()) }
            var date by remember { mutableStateOf(LocalDate.now()) }
            val employees by viewModel.employees.collectAsStateWithLifecycle()
            var receiver by remember { mutableStateOf<Employee?>(null) }

            val addPhoto = rememberPhotoAdder { uris ->
                photos = (photos + uris).distinct()
                viewModel.onPhotosChanged("material_transfers", photos)
            }

            LaunchedEffect(submit) { if (submit is UiState.Success) showSuccessAndExit() }

            TransferScreen(
                isTool = false,
                dateLabel = date.formLabel(),
                onPickDate = { showPastDatePicker(requireContext(), date) { date = it } },
                isOnline = isOnline,
                submitting = submit is UiState.Loading,
                error = (submit as? UiState.Error)?.message,
                photos = photos,
                receiverName = receiver?.name,
                onPickReceiver = {
                    showReceiverPicker(requireContext(), employees) { receiver = it }
                    if (employees?.isEmpty() == true) viewModel.loadEmployees()
                },
                onBack = { findNavController().navigateUp() },
                onAddPhoto = addPhoto,
                onRemovePhoto = { photos = photos - it; viewModel.onPhotosChanged("material_transfers", photos) },
                onSubmit = { from, to, by, items, notes ->
                    viewModel.submitMaterialTransfer(from, to, by, receiver, items, notes, photos, date)
                },
            )
        }
    }

    private fun showSuccessAndExit() {
        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Transfer Submitted ✓")
            .setMessage("Material transfer submitted successfully.")
            .setPositiveButton("OK") { _, _ -> findNavController().navigateUp() }
            .setCancelable(false).show()
    }
}
