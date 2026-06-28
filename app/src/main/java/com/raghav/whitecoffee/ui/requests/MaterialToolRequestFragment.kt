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

/** M&T Request — Compose host. Logic stays in [MaterialToolRequestViewModel]. */
@AndroidEntryPoint
class MaterialToolRequestFragment : Fragment() {

    private val viewModel: MaterialToolRequestViewModel by viewModels()

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
            var localError by remember { mutableStateOf<String?>(null) }

            val picker = rememberLauncherForActivityResult(
                ActivityResultContracts.PickMultipleVisualMedia(10)
            ) { uris ->
                if (uris.isNotEmpty()) {
                    photos = (photos + uris).distinct()
                    viewModel.onPhotosChanged(photos)
                }
            }

            LaunchedEffect(submit) { if (submit is UiState.Success) showSuccessAndExit() }

            MaterialToolRequestScreen(
                isOnline = isOnline,
                submitting = submit is UiState.Loading,
                error = localError ?: (submit as? UiState.Error)?.message,
                photos = photos,
                onBack = { findNavController().navigateUp() },
                onAddPhoto = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                onRemovePhoto = { photos = photos - it; viewModel.onPhotosChanged(photos) },
                onSubmit = { siteId, siteName, items, notes ->
                    if (siteName.isBlank()) {
                        localError = "Please enter the site name."
                    } else {
                        localError = null
                        viewModel.submitRequest(siteId, siteName, items, notes, photos)
                    }
                },
            )
        }
    }

    private fun showSuccessAndExit() {
        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Request Submitted ✓")
            .setMessage("Your M&T request has been submitted successfully.")
            .setPositiveButton("OK") { _, _ -> findNavController().navigateUp() }
            .setCancelable(false)
            .show()
    }
}
