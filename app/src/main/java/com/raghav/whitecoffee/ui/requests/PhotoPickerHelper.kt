package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import com.bumptech.glide.Glide
import com.raghav.whitecoffee.databinding.ItemPhotoThumbnailBinding

/**
 * Reusable photo picker helper — attach to any Fragment.
 * Handles multi-select image picking + thumbnail display.
 * Call attach() in onViewCreated, before any user interaction.
 */
class PhotoPickerHelper(
    private val fragment: Fragment,
    private val thumbnailContainer: LinearLayout,
    private val scrollView: HorizontalScrollView,
    private val onPhotosChanged: (List<Uri>) -> Unit
) {

    private val selectedUris = mutableListOf<Uri>()

    private val pickMedia: ActivityResultLauncher<PickVisualMediaRequest> =
        fragment.registerForActivityResult(
            ActivityResultContracts.PickMultipleVisualMedia(10)
        ) { uris ->
            if (uris.isNotEmpty()) {
                uris.forEach { addPhoto(it) }
                onPhotosChanged(selectedUris.toList())
            }
        }

    fun getSelectedUris(): List<Uri> = selectedUris.toList()

    fun launch() {
        pickMedia.launch(
            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
        )
    }

    private fun addPhoto(uri: Uri) {
        if (selectedUris.contains(uri)) return
        selectedUris.add(uri)

        val thumbBinding = ItemPhotoThumbnailBinding.inflate(
            LayoutInflater.from(fragment.requireContext()),
            thumbnailContainer,
            false
        )

        // Load thumbnail using Glide
        Glide.with(fragment)
            .load(uri)
            .centerCrop()
            .into(thumbBinding.ivThumbnail)

        thumbBinding.btnRemove.setOnClickListener {
            selectedUris.remove(uri)
            thumbnailContainer.removeView(thumbBinding.root)
            scrollView.visibility = if (selectedUris.isEmpty())
                android.view.View.GONE else android.view.View.VISIBLE
            onPhotosChanged(selectedUris.toList())
        }

        thumbnailContainer.addView(thumbBinding.root)
        scrollView.visibility = android.view.View.VISIBLE
    }
}