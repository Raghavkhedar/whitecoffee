package com.raghav.whitecoffee.ui.requests

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
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
import com.raghav.whitecoffee.data.model.PurchaseItem
import com.raghav.whitecoffee.data.model.Site
import com.raghav.whitecoffee.databinding.FragmentMaterialToolBuyBinding
import com.raghav.whitecoffee.databinding.ItemBuyRowBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class MaterialToolBuyFragment : BaseFragment<FragmentMaterialToolBuyBinding>() {

    private val viewModel: MaterialToolBuyViewModel by viewModels()
    private val itemRows = mutableListOf<ItemBuyRowBinding>()
    private var selectedSite: Site? = null

    override fun inflateBinding(
        inflater: LayoutInflater,
        container: ViewGroup?
    ): FragmentMaterialToolBuyBinding =
        FragmentMaterialToolBuyBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupClickListeners()
        observeViewModel()
        addItemRow()
    }

    private fun setupClickListeners() {
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
        binding.btnAddItem.setOnClickListener { addItemRow() }
        binding.btnSubmit.setOnClickListener {
            val site = selectedSite
            if (site == null) { showError("Please select a site."); return@setOnClickListener }
            it.isEnabled = false
            viewModel.submitPurchase(site, collectItems(), binding.etNotes.text?.toString() ?: "")
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
                            else -> {}
                        }
                    }
                }
                launch {
                    viewModel.submitState.collect { state ->
                        when (state) {
                            is UiState.Loading -> showLoading()
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
    }

    private fun setupSiteDropdown(sites: List<Site>) {
        val adapter = ArrayAdapter(requireContext(),
            android.R.layout.simple_dropdown_item_1line, sites.map { it.name })
        binding.acvSite.setAdapter(adapter)
        binding.acvSite.setOnItemClickListener { _, _, i, _ -> selectedSite = sites[i] }
        if (sites.size == 1) { selectedSite = sites[0]; binding.acvSite.setText(sites[0].name, false) }
    }

    private fun addItemRow() {
        val rowBinding = ItemBuyRowBinding.inflate(
            LayoutInflater.from(requireContext()), binding.containerItems, false)
        val rowNumber = itemRows.size + 1
        rowBinding.tvRowNumber.text = rowNumber.toString()

        // Auto-calculate row total when qty or price changes
        val watcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                val qty = rowBinding.etQuantity.text?.toString()?.toDoubleOrNull() ?: 0.0
                val price = rowBinding.etPrice.text?.toString()?.toDoubleOrNull() ?: 0.0
                val rowTotal = qty * price
                rowBinding.tvRowTotal.text = "Total: ₹%.2f".format(rowTotal)
                updateGrandTotal()
            }
        }
        rowBinding.etQuantity.addTextChangedListener(watcher)
        rowBinding.etPrice.addTextChangedListener(watcher)

        rowBinding.btnRemove.setOnClickListener {
            binding.containerItems.removeView(rowBinding.root)
            itemRows.remove(rowBinding)
            itemRows.forEachIndexed { i, r -> r.tvRowNumber.text = (i + 1).toString() }
            updateGrandTotal()
        }

        if (itemRows.isEmpty()) rowBinding.btnRemove.visibility = View.INVISIBLE
        itemRows.add(rowBinding)
        binding.containerItems.addView(rowBinding.root)
    }

    private fun updateGrandTotal() {
        val total = itemRows.sumOf { row ->
            val qty = row.etQuantity.text?.toString()?.toDoubleOrNull() ?: 0.0
            val price = row.etPrice.text?.toString()?.toDoubleOrNull() ?: 0.0
            qty * price
        }
        binding.tvGrandTotal.text = "₹%.2f".format(total)
    }

    private fun collectItems(): List<PurchaseItem> = itemRows.mapNotNull { row ->
        val name  = row.etItemName.text?.toString()?.trim() ?: return@mapNotNull null
        val qty   = row.etQuantity.text?.toString()?.toDoubleOrNull() ?: return@mapNotNull null
        val unit  = row.etUnit.text?.toString()?.trim() ?: ""
        val price = row.etPrice.text?.toString()?.toDoubleOrNull() ?: 0.0
        if (name.isBlank() || qty <= 0) return@mapNotNull null
        PurchaseItem(name, qty.toInt(), unit, price, qty * price)
    }

    private fun showSuccessAndExit() {
        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Purchase Submitted ✓")
            .setMessage("Your M&T purchase has been submitted successfully.")
            .setPositiveButton("OK") { _, _ -> findNavController().navigateUp() }
            .setCancelable(false).show()
    }

    private fun showLoading() { binding.progressBar.visibility = View.VISIBLE; binding.btnSubmit.isEnabled = false }
    private fun hideLoading() { binding.progressBar.visibility = View.GONE }
    private fun showError(message: String) { binding.tvError.visibility = View.VISIBLE; binding.tvError.text = message }
}