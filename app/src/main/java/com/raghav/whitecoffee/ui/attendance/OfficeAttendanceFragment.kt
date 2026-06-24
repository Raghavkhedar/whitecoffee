package com.raghav.whitecoffee.ui.attendance

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
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
import com.raghav.whitecoffee.R
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.databinding.FragmentOfficeAttendanceBinding
import com.raghav.whitecoffee.ui.attendance.OfficeAttendanceViewModel.OfficeState
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

@AndroidEntryPoint
class OfficeAttendanceFragment : BaseFragment<FragmentOfficeAttendanceBinding>() {

    private val viewModel: OfficeAttendanceViewModel by viewModels()
    private val timelineAdapter by lazy { AttendanceTimelineAdapter() }

    @Inject
    lateinit var locationProvider: LocationProvider

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
        setupGpsBanner()
        binding.tvDate.text = DATE_FORMAT.format(Date())
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
        setupRecyclerView()
        setupActionButton()
        observeViewModel()
    }

    override fun onResume() {
        super.onResume()
        checkGpsStatus()
    }

    private fun setupGpsBanner() {
        binding.gpsBanner.root.findViewById<View>(R.id.btn_gps_enable)
            .setOnClickListener {
                startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            }
    }

    private fun checkGpsStatus() {
        binding.gpsBanner.root.visibility =
            if (locationProvider.isGpsEnabled()) View.GONE else View.VISIBLE
    }

    private fun setupRecyclerView() {
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
                // Day not started → Home In (GPS only)
                is OfficeState.NotStarted -> viewModel.homeIn()
                // Day started → Office Check In (needs location)
                is OfficeState.DayStarted -> {
                    val location = binding.etLocation.text?.toString()?.trim() ?: ""
                    if (location.isBlank()) {
                        showError("Please enter where you are checking in from.")
                        it.isEnabled = true
                        return@setOnClickListener
                    }
                    viewModel.checkIn(location)
                }
                // In office → Office Check Out (reuse the check-in location)
                is OfficeState.InOffice -> viewModel.checkOut(currentState.locationName)
                else -> it.isEnabled = true
            }
        }

        binding.btnHomeOut.setOnClickListener {
            it.isEnabled = false
            clearError()
            viewModel.homeOut()
        }
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {

                launch {
                    viewModel.isOnline.collect { online ->
                        binding.offlineBanner.root.visibility = if (online) View.GONE else View.VISIBLE
                    }
                }

                launch {
                    viewModel.state.collect { state ->
                        clearError()
                        when (state) {
                            is OfficeState.Loading -> {
                                binding.progressBar.visibility = View.VISIBLE
                                binding.btnAction.isEnabled = false
                                binding.btnHomeOut.isEnabled = false
                            }
                            is OfficeState.NotStarted -> {
                                hideLoading()
                                binding.tvStatusIcon.text = "🏠"
                                binding.tvStatus.text = "Day not started"
                                binding.tvStatusDetail.visibility = View.GONE
                                binding.tilLocation.visibility = View.GONE
                                binding.btnAction.visibility = View.VISIBLE
                                binding.btnAction.text = "🏠 Start Day — Home In"
                                binding.btnAction.isEnabled = true
                                binding.btnHomeOut.visibility = View.GONE
                            }
                            is OfficeState.DayStarted -> {
                                hideLoading()
                                binding.tvStatusIcon.text = "🏠"
                                binding.tvStatus.text = "Home checked in"
                                binding.tvStatusDetail.visibility = View.VISIBLE
                                binding.tvStatusDetail.text = "Since ${state.homeInTime}  ·  Not in office"
                                binding.tilLocation.visibility = View.VISIBLE
                                binding.etLocation.isEnabled = true
                                binding.etLocation.text?.clear()
                                binding.btnAction.visibility = View.VISIBLE
                                binding.btnAction.text = "🏢 Office Check In"
                                binding.btnAction.isEnabled = true
                                binding.btnHomeOut.visibility = View.VISIBLE
                                binding.btnHomeOut.isEnabled = true
                            }
                            is OfficeState.InOffice -> {
                                hideLoading()
                                binding.tvStatusIcon.text = "✅"
                                binding.tvStatus.text = "Checked In"
                                binding.tvStatusDetail.visibility = View.VISIBLE
                                binding.tvStatusDetail.text =
                                    "At ${state.locationName}  ·  Since ${state.checkInTime}"
                                binding.tilLocation.visibility = View.GONE
                                binding.btnAction.visibility = View.VISIBLE
                                binding.btnAction.text = "🏢 Office Check Out"
                                binding.btnAction.isEnabled = true
                                // Hidden mid-office-session — must check out of office before ending the day.
                                binding.btnHomeOut.visibility = View.GONE
                            }
                            is OfficeState.DayEnded -> {
                                hideLoading()
                                binding.tvStatusIcon.text = "🌙"
                                binding.tvStatus.text = "Day complete"
                                binding.tvStatusDetail.visibility = View.VISIBLE
                                binding.tvStatusDetail.text = "Home out at ${state.homeOutTime}"
                                binding.tilLocation.visibility = View.GONE
                                binding.btnAction.visibility = View.GONE
                                binding.btnHomeOut.visibility = View.GONE
                            }
                            is OfficeState.Error -> {
                                hideLoading()
                                binding.btnAction.isEnabled = true
                                binding.btnHomeOut.isEnabled = true
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

    companion object {
        private val DATE_FORMAT = SimpleDateFormat("EEEE, d MMMM yyyy", Locale.getDefault())
    }
}
