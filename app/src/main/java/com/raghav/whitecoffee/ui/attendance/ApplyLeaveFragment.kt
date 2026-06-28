package com.raghav.whitecoffee.ui.attendance

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
import com.raghav.whitecoffee.data.model.LeaveType
import com.raghav.whitecoffee.databinding.FragmentApplyLeaveBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import java.util.Calendar

@AndroidEntryPoint
class ApplyLeaveFragment : BaseFragment<FragmentApplyLeaveBinding>() {

    private val viewModel: ApplyLeaveViewModel by viewModels()
    private var selectedLeaveType = ""

    override fun inflateBinding(inflater: LayoutInflater, container: ViewGroup?) =
        FragmentApplyLeaveBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupLeaveTypeDropdown()
        setupDatePickers()
        setupClickListeners()
        observeViewModel()
    }

    private fun setupLeaveTypeDropdown() {
        val adapter = ArrayAdapter(
            requireContext(),
            android.R.layout.simple_dropdown_item_1line,
            LeaveType.ALL
        )
        binding.acvLeaveType.setAdapter(adapter)
        binding.acvLeaveType.setOnItemClickListener { _, _, position, _ ->
            selectedLeaveType = LeaveType.ALL[position]
        }
    }

    private fun setupDatePickers() {
        binding.etFromDate.setOnClickListener { showDatePicker { date ->
            binding.etFromDate.setText(date)
            updateTotalDays()
        }}
        binding.tilFromDate.setEndIconOnClickListener { showDatePicker { date ->
            binding.etFromDate.setText(date)
            updateTotalDays()
        }}
        binding.etToDate.setOnClickListener { showDatePicker { date ->
            binding.etToDate.setText(date)
            updateTotalDays()
        }}
        binding.tilToDate.setEndIconOnClickListener { showDatePicker { date ->
            binding.etToDate.setText(date)
            updateTotalDays()
        }}
    }

    private fun showDatePicker(onDate: (String) -> Unit) {
        val cal = Calendar.getInstance()
        DatePickerDialog(
            requireContext(),
            { _, year, month, day ->
                onDate(String.format("%04d-%02d-%02d", year, month + 1, day))
            },
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH),
            cal.get(Calendar.DAY_OF_MONTH)
        ).show()
    }

    private fun updateTotalDays() {
        val from = binding.etFromDate.text?.toString() ?: return
        val to   = binding.etToDate.text?.toString() ?: return
        if (from.isBlank() || to.isBlank()) return
        val days = viewModel.calculateDays(from, to)
        binding.tvTotalDays.text = if (days > 0) "$days day${if (days != 1) "s" else ""}" else ""
    }

    private fun setupClickListeners() {
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
        binding.btnSubmit.setOnClickListener {
            it.isEnabled = false
            binding.tvError.visibility = View.GONE
            viewModel.submit(
                fromDate         = binding.etFromDate.text?.toString() ?: "",
                toDate           = binding.etToDate.text?.toString() ?: "",
                joiningDate      = "",
                emergencyContact = "",
                placeOfVisit     = "",
                reason           = binding.etReason.text?.toString() ?: ""
            )
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.submitState.collect { state ->
                    when (state) {
                        is UiState.Loading -> {
                            binding.progressBar.visibility = View.VISIBLE
                            binding.btnSubmit.isEnabled = false
                        }
                        is UiState.Success -> {
                            binding.progressBar.visibility = View.GONE
                            android.app.AlertDialog.Builder(requireContext())
                                .setTitle("Leave Request Submitted ✓")
                                .setMessage("Your leave request has been submitted and is pending approval.")
                                .setPositiveButton("OK") { _, _ -> findNavController().navigateUp() }
                                .setCancelable(false)
                                .show()
                        }
                        is UiState.Error -> {
                            binding.progressBar.visibility = View.GONE
                            binding.btnSubmit.isEnabled = true
                            binding.tvError.visibility = View.VISIBLE
                            binding.tvError.text = state.message
                            viewModel.resetSubmitState()
                        }
                        else -> {}
                    }
                }
            }
        }
    }
}
