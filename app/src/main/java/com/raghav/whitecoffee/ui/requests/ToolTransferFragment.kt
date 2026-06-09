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
import com.raghav.whitecoffee.data.model.TransferItem
import com.raghav.whitecoffee.databinding.FragmentToolTransferBinding
import com.raghav.whitecoffee.databinding.ItemTransferRowBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class ToolTransferFragment : BaseFragment<FragmentToolTransferBinding>() {

    private val viewModel: TransferViewModel by viewModels()
    private val itemRows = mutableListOf<ItemTransferRowBinding>()
    private lateinit var photoPickerHelper: PhotoPickerHelper

    override fun inflateBinding(
        inflater: LayoutInflater,
        container: ViewGroup?
    ): FragmentToolTransferBinding =
        FragmentToolTransferBinding.inflate(inflater, container, false)

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
            onPhotosChanged    = { viewModel.onPhotosChanged("tool_transfers", it) }
        )
        binding.btnAddPhoto.setOnClickListener { photoPickerHelper.launch() }
    }

    private fun setupClickListeners() {
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
        binding.btnAddItem.setOnClickListener { addItemRow() }
        binding.btnSubmit.setOnClickListener {
            it.isEnabled = false
            viewModel.submitToolTransfer(
                fromLocation  = binding.etFrom.text?.toString() ?: "",
                toLocation    = binding.etTo.text?.toString() ?: "",
                transferredBy = binding.etTransferredBy.text?.toString() ?: "",
                receivedBy    = binding.etReceivedBy.text?.toString() ?: "",
                items         = collectItems(),
                notes         = binding.etNotes.text?.toString() ?: "",
                photoUris     = photoPickerHelper.getSelectedUris()
            )
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.submitState.collect { state ->
                    when (state) {
                        is UiState.Loading -> showLoading(state.message)
                        is UiState.Success -> { hideLoading(); showSuccessAndExit() }
                        is UiState.Error   -> {
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

    private fun addItemRow() {
        val rowBinding = ItemTransferRowBinding.inflate(
            LayoutInflater.from(requireContext()), binding.containerItems, false)
        rowBinding.tvRowNumber.text = (itemRows.size + 1).toString()
        rowBinding.btnRemove.setOnClickListener {
            binding.containerItems.removeView(rowBinding.root)
            itemRows.remove(rowBinding)
            itemRows.forEachIndexed { i, r -> r.tvRowNumber.text = (i + 1).toString() }
        }
        if (itemRows.isEmpty()) rowBinding.btnRemove.visibility = View.INVISIBLE
        itemRows.add(rowBinding)
        binding.containerItems.addView(rowBinding.root)
    }

    private fun collectItems(): List<TransferItem> = itemRows.mapNotNull { row ->
        val name      = row.etItemName.text?.toString()?.trim() ?: return@mapNotNull null
        val qty       = row.etQuantity.text?.toString()?.toDoubleOrNull() ?: return@mapNotNull null
        val unit      = row.etUnit.text?.toString()?.trim() ?: ""
        val condition = row.etCondition.text?.toString()?.trim() ?: ""
        if (name.isBlank() || qty <= 0) return@mapNotNull null
        TransferItem(name, qty, unit, condition)
    }

    private fun showSuccessAndExit() {
        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Transfer Submitted ✓")
            .setMessage("Tool transfer submitted successfully.")
            .setPositiveButton("OK") { _, _ -> findNavController().navigateUp() }
            .setCancelable(false).show()
    }

    private fun showLoading(message: String = "") { binding.progressBar.visibility = View.VISIBLE; binding.btnSubmit.isEnabled = false; if (message.isNotEmpty()) showError(message) }
    private fun hideLoading() { binding.progressBar.visibility = View.GONE; binding.tvError.visibility = View.GONE }
    private fun showError(msg: String) { binding.tvError.visibility = View.VISIBLE; binding.tvError.text = msg }
}
