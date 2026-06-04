package com.raghav.whitecoffee.ui.requests

import android.app.DatePickerDialog
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
import com.raghav.whitecoffee.data.model.Site
import com.raghav.whitecoffee.databinding.FragmentWorkProgressBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Calendar

@AndroidEntryPoint
class WorkProgressFragment : BaseFragment<FragmentWorkProgressBinding>() {

    private val viewModel: WorkProgressViewModel by viewModels()

    private var selectedSite: Site? = null
    private var availableSites: List<Site> = emptyList()
    private lateinit var photoPickerHelper: PhotoPickerHelper

    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

    override fun inflateBinding(
        inflater: LayoutInflater,
        container: ViewGroup?
    ): FragmentWorkProgressBinding =
        FragmentWorkProgressBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        prefillDate()
        setupPhotoHelper()
        setupClickListeners()
        observeViewModel()
    }

    private fun prefillDate() {
        binding.etDate.setText(LocalDate.now().format(dateFormatter))
    }

    private fun setupPhotoHelper() {
        photoPickerHelper = PhotoPickerHelper(
            fragment           = this,
            thumbnailContainer = binding.containerPhotos,
            scrollView         = binding.scrollPhotos,
            onPhotosChanged    = { /* read uris on submit */ }
        )
        binding.btnAddPhoto.setOnClickListener { photoPickerHelper.launch() }
    }

    private fun setupClickListeners() {
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }

        binding.etDate.setOnClickListener { showDatePicker() }
        binding.tilDate.setEndIconOnClickListener { showDatePicker() }

        binding.btnSubmit.setOnClickListener {
            val site = selectedSite
            if (site == null) {
                showError("Please select a site.")
                return@setOnClickListener
            }
            val date = binding.etDate.text?.toString()?.trim() ?: ""
            if (date.isBlank()) {
                showError("Please select a date.")
                return@setOnClickListener
            }
            val hoursStr = binding.etHours.text?.toString()?.trim() ?: ""
            val hours = hoursStr.toDoubleOrNull() ?: 0.0
            val description = binding.etDescription.text?.toString() ?: ""

            it.isEnabled = false
            viewModel.submitProgress(
                site            = site,
                date            = date,
                hoursWorked     = hours,
                workDescription = description,
                photoUris       = photoPickerHelper.getSelectedUris()
            )
        }
    }

    private fun showDatePicker() {
        val cal = Calendar.getInstance()
        DatePickerDialog(
            requireContext(),
            { _, year, month, day ->
                val picked = LocalDate.of(year, month + 1, day).format(dateFormatter)
                binding.etDate.setText(picked)
            },
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH),
            cal.get(Calendar.DAY_OF_MONTH)
        ).show()
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
        val adapter = ArrayAdapter(
            requireContext(),
            android.R.layout.simple_dropdown_item_1line,
            sites.map { it.name }
        )
        binding.acvSite.setAdapter(adapter)
        binding.acvSite.setOnItemClickListener { _, _, position, _ ->
            selectedSite = sites[position]
        }
        if (sites.size == 1) {
            selectedSite = sites[0]
            binding.acvSite.setText(sites[0].name, false)
        }
    }

    private fun showSuccessAndExit() {
        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Progress Submitted ✓")
            .setMessage("Your work progress has been recorded successfully.")
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
