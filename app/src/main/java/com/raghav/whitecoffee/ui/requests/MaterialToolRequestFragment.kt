package com.raghav.whitecoffee.ui.requests

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.RequestItem
import com.raghav.whitecoffee.data.model.Site
import com.raghav.whitecoffee.databinding.FragmentMaterialToolRequestBinding
import com.raghav.whitecoffee.databinding.ItemRequestRowBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class MaterialToolRequestFragment : BaseFragment<FragmentMaterialToolRequestBinding>() {

    private val viewModel: MaterialToolRequestViewModel by viewModels()

    // Keeps track of all item row bindings for reading values on submit
    private val itemRows = mutableListOf<ItemRequestRowBinding>()
    private var selectedSite: Site? = null
    private var availableSites: List<Site> = emptyList()

    override fun inflateBinding(
        inflater: LayoutInflater,
        container: ViewGroup?
    ): FragmentMaterialToolRequestBinding =
        FragmentMaterialToolRequestBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupClickListeners()
        observeViewModel()
        // Add first item row by default
        addItemRow()
    }

    private fun setupClickListeners() {
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }

        binding.btnAddItem.setOnClickListener {
            addItemRow()
        }

        binding.btnSubmit.setOnClickListener {
            val site = selectedSite
            if (site == null) {
                showError("Please select a site.")
                return@setOnClickListener
            }
            it.isEnabled = false
            val items = collectItems()
            val notes = binding.etNotes.text?.toString() ?: ""
            viewModel.submitRequest(site, items, notes)
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {

                launch {
                    viewModel.sitesState.collect { state ->
                        when (state) {
                            is UiState.Success -> setupSiteDropdown(state.data)
                            is UiState.Error   -> showError(state.message)
                            is UiState.Empty   -> showError("No sites assigned.")
                            else -> {}
                        }
                    }
                }

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

    private fun setupSiteDropdown(sites: List<Site>) {
        availableSites = sites
        val siteNames = sites.map { it.name }
        val adapter = ArrayAdapter(
            requireContext(),
            android.R.layout.simple_dropdown_item_1line,
            siteNames
        )
        binding.acvSite.setAdapter(adapter)
        binding.acvSite.setOnItemClickListener { _, _, position, _ ->
            selectedSite = sites[position]
        }
        // Auto-select if only one site
        if (sites.size == 1) {
            selectedSite = sites[0]
            binding.acvSite.setText(sites[0].name, false)
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
            // Re-number remaining rows
            itemRows.forEachIndexed { index, row ->
                row.tvRowNumber.text = (index + 1).toString()
            }
        }

        // Hide remove button on first row
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