package com.raghav.whitecoffee.ui.attendance

import android.Manifest
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.databinding.FragmentOfficeAttendanceBinding
import com.raghav.whitecoffee.ui.attendance.OfficeAttendanceViewModel.OfficeState
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@AndroidEntryPoint
class OfficeAttendanceFragment : BaseFragment<FragmentOfficeAttendanceBinding>() {

    private val viewModel: OfficeAttendanceViewModel by viewModels()

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions[Manifest.permission.ACCESS_FINE_LOCATION] != true) {
            showError("Location permission is required for attendance.")
        }
    }

    override fun inflateBinding(
        inflater: LayoutInflater,
        container: ViewGroup?
    ): FragmentOfficeAttendanceBinding =
        FragmentOfficeAttendanceBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        locationPermissionLauncher.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        )
        binding.tvDate.text = SimpleDateFormat("EEEE, d MMMM yyyy", Locale.getDefault()).format(Date())
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
        setupActionButton()
        observeViewModel()
    }

    private fun setupActionButton() {
        binding.btnAction.setOnClickListener {
            it.isEnabled = false
            when (viewModel.state.value) {
                is OfficeState.NotCheckedIn -> viewModel.checkIn()
                is OfficeState.CheckedIn    -> viewModel.checkOut()
                else                        -> it.isEnabled = true
            }
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    clearError()
                    when (state) {
                        is OfficeState.Loading -> {
                            binding.progressBar.visibility = View.VISIBLE
                            binding.btnAction.isEnabled = false
                        }
                        is OfficeState.NotCheckedIn -> {
                            hideLoading()
                            binding.tvStatusIcon.text = "⏰"
                            binding.tvStatus.text = "Not checked in"
                            binding.tvStatusDetail.visibility = View.GONE
                            binding.btnAction.visibility = View.VISIBLE
                            binding.btnAction.text = "Check In"
                            binding.btnAction.isEnabled = true
                        }
                        is OfficeState.CheckedIn -> {
                            hideLoading()
                            binding.tvStatusIcon.text = "✅"
                            binding.tvStatus.text = "Checked In"
                            binding.tvStatusDetail.visibility = View.VISIBLE
                            binding.tvStatusDetail.text = "Since ${state.checkInTime}"
                            binding.btnAction.visibility = View.VISIBLE
                            binding.btnAction.text = "Check Out"
                            binding.btnAction.isEnabled = true
                        }
                        is OfficeState.DayComplete -> {
                            hideLoading()
                            binding.tvStatusIcon.text = "🏁"
                            binding.tvStatus.text = "Day Complete ✓"
                            binding.tvStatusDetail.visibility = View.VISIBLE
                            binding.tvStatusDetail.text =
                                "In: ${state.checkInTime}  ·  Out: ${state.checkOutTime}"
                            binding.btnAction.visibility = View.GONE
                        }
                        is OfficeState.Error -> {
                            hideLoading()
                            binding.btnAction.isEnabled = true
                            showError(state.message)
                        }
                    }
                }
            }
        }
    }

    private fun hideLoading() {
        binding.progressBar.visibility = View.GONE
    }

    private fun showError(message: String) {
        binding.tvError.visibility = View.VISIBLE
        binding.tvError.text = message
    }

    private fun clearError() {
        binding.tvError.visibility = View.GONE
        binding.tvError.text = ""
    }
}
