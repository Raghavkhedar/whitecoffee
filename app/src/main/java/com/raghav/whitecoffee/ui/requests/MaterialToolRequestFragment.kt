package com.raghav.whitecoffee.ui.requests

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.RequestItem
import com.raghav.whitecoffee.databinding.FragmentMaterialToolRequestBinding
import com.raghav.whitecoffee.databinding.ItemRequestRowBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

// SiteTask / dropdown removed — site is now two free-text fields (Site Name + Site ID).
// To re-enable: restore ArrayAdapter dropdown, import SiteTask, restore sitesState observer.

@AndroidEntryPoint
class MaterialToolRequestFragment : BaseFragment<FragmentMaterialToolRequestBinding>() {

    private val viewModel: MaterialToolRequestViewModel by viewModels()

    private val itemRows = mutableListOf<ItemRequestRowBinding>()
    private lateinit var photoPickerHelper: PhotoPickerHelper

    override fun inflateBinding(
        inflater: LayoutInflater,
        container: ViewGroup?
    ): FragmentMaterialToolRequestBinding =
        FragmentMaterialToolRequestBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupPhotoHelper()
        setupClickListeners()
        observeViewModel()
        addItemRow()
    }

    private fun setupPhotoHelper() {
        photoPickerHelper = PhotoPickerHelper(
            fragment           = this,
            thumbnailContainer = binding.containerPhotos,
            scrollView         = binding.scrollPhotos,
            onPhotosChanged    = { }
        )
        binding.btnAddPhoto.setOnClickListener { photoPickerHelper.launch() }
    }

    private fun setupClickListeners() {
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
        binding.btnAddItem.setOnClickListener { addItemRow() }

        binding.btnSubmit.setOnClickListener {
            val siteName = binding.etSiteName.text?.toString()?.trim() ?: ""
            val siteId   = binding.etSiteId.text?.toString()?.trim() ?: ""
            if (siteName.isBlank()) {
                showError("Please enter the site name.")
                return@setOnClickListener
            }
            it.isEnabled = false
            val items = collectItems()
            val notes = binding.etNotes.text?.toString() ?: ""
            viewModel.submitRequest(siteId, siteName, items, notes, photoPickerHelper.getSelectedUris())
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.submitState.collect { state ->
                        when (state) {
                            is UiState.Loading -> showLoading()
                            is UiState.Success -> {
                                hideLoading()
                                showSuccessAndExit()
                            }
                            is UiState.Error -> {
                                hideLoading()
                                showError(state.message)
                                binding.btnSubmit.isEnabled = true
                                viewModel.resetSubmitState()
                            }
                            else -> {}
                        }
                    }
                }
            }
        }
    }

    private fun addItemRow() {
        val rowBinding = ItemRequestRowBinding.inflate(
            LayoutInflater.from(requireContext()),
            binding.containerItems,
            false
        )
        val rowNumber = itemRows.size + 1
        rowBinding.tvRowNumber.text = rowNumber.toString()

        rowBinding.btnRemove.setOnClickListener {
            binding.containerItems.removeView(rowBinding.root)
            itemRows.remove(rowBinding)
            itemRows.forEachIndexed { index, row ->
                row.tvRowNumber.text = (index + 1).toString()
            }
        }

        if (itemRows.isEmpty()) {
            rowBinding.btnRemove.visibility = View.INVISIBLE
        }

        itemRows.add(rowBinding)
        binding.containerItems.addView(rowBinding.root)
    }

    private fun collectItems(): List<RequestItem> {
        return itemRows.mapNotNull { row ->
            val name = row.etItemName.text?.toString()?.trim() ?: return@mapNotNull null
            val qtyStr = row.etQuantity.text?.toString()?.trim() ?: return@mapNotNull null
            val unit = row.etUnit.text?.toString()?.trim() ?: ""
            val notes = row.etNotes.text?.toString()?.trim() ?: ""
            if (name.isBlank() || qtyStr.isBlank()) return@mapNotNull null
            RequestItem(
                itemName = name,
                quantity = qtyStr.toIntOrNull() ?: 0,
                unit     = unit,
                notes    = notes
            )
        }
    }

    private fun showSuccessAndExit() {
        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Request Submitted ✓")
            .setMessage("Your M&T request has been submitted successfully.")
            .setPositiveButton("OK") { _, _ ->
                findNavController().navigateUp()
            }
            .setCancelable(false)
            .show()
    }

    private fun showLoading() {
        binding.progressBar.visibility = View.VISIBLE
        binding.btnSubmit.isEnabled = false
    }

    private fun hideLoading() {
        binding.progressBar.visibility = View.GONE
    }

    private fun showError(message: String) {
        binding.tvError.visibility = View.VISIBLE
        binding.tvError.text = message
    }
}
