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
import androidx.recyclerview.widget.LinearLayoutManager
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
    private lateinit var timelineAdapter: AttendanceTimelineAdapter

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
        setupRecyclerView()
        setupActionButton()
        observeViewModel()
    }

    private fun setupRecyclerView() {
        timelineAdapter = AttendanceTimelineAdapter()
        binding.rvTimeline.apply {
            layoutManager = LinearLayoutManager(requireContext())
            adapter = timelineAdapter
        }
    }

    private fun setupActionButton() {
        binding.btnAction.setOnClickListener {
            it.isEnabled = false
            clearError()
            when (val currentState = viewModel.state.value) {
                is OfficeState.NotCheckedIn -> {
                    val location = binding.etLocation.text?.toString()?.trim() ?: ""
                    if (location.isBlank()) {
                        showError("Please enter where you are checking in from.")
                        it.isEnabled = true
                        return@setOnClickListener
                    }
                    viewModel.checkIn(location)
                }
                is OfficeState.CheckedIn -> {
                    viewModel.checkOut(currentState.locationName)
                }
                else -> it.isEnabled = true
            }
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {

                launch {
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
                                binding.tilLocation.visibility = View.VISIBLE
                                binding.etLocation.isEnabled = true
                                binding.btnAction.text = "Check In"
                                binding.btnAction.isEnabled = true
                                binding.etLocation.text?.clear()
                            }
                            is OfficeState.CheckedIn -> {
                                hideLoading()
                                binding.tvStatusIcon.text = "✅"
                                binding.tvStatus.text = "Checked In"
                                binding.tvStatusDetail.visibility = View.VISIBLE
                                binding.tvStatusDetail.text =
                                    "At ${state.locationName}  ·  Since ${state.checkInTime}"
                                binding.tilLocation.visibility = View.GONE
                                binding.btnAction.text = "Check Out"
                                binding.btnAction.isEnabled = true
                            }
                            is OfficeState.Error -> {
                                hideLoading()
                                binding.btnAction.isEnabled = true
                                showError(state.message)
                            }
                        }
                    }
                }

                launch {
                    viewModel.todayEvents.collect { events ->
                        timelineAdapter.submitList(events)
                        binding.tvTimelineLabel.visibility =
                            if (events.isEmpty()) View.GONE else View.VISIBLE
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
