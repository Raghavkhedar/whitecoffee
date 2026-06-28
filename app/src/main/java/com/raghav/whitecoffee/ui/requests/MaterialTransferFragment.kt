package com.raghav.whitecoffee.ui.requests

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
            val today = remember { LocalDate.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy")) }

            val picker = rememberLauncherForActivityResult(
                ActivityResultContracts.PickMultipleVisualMedia(10)
            ) { uris ->
                if (uris.isNotEmpty()) {
                    photos = (photos + uris).distinct()
                    viewModel.onPhotosChanged("material_transfers", photos)
                }
            }

            LaunchedEffect(submit) { if (submit is UiState.Success) showSuccessAndExit() }

            TransferScreen(
                isTool = false,
                todayDate = today,
                isOnline = isOnline,
                submitting = submit is UiState.Loading,
                error = (submit as? UiState.Error)?.message,
                photos = photos,
                onBack = { findNavController().navigateUp() },
                onAddPhoto = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                onRemovePhoto = { photos = photos - it; viewModel.onPhotosChanged("material_transfers", photos) },
                onSubmit = { from, to, by, recv, items, notes ->
                    viewModel.submitMaterialTransfer(from, to, by, recv, items, notes, photos)
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
