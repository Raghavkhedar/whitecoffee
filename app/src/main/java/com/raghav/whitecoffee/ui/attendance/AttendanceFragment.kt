package com.raghav.whitecoffee.ui.attendance

import android.Manifest
import android.app.AlertDialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.databinding.FragmentAttendanceBinding
import com.raghav.whitecoffee.ui.attendance.AttendanceViewModel.ActionState
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@AndroidEntryPoint
class AttendanceFragment : BaseFragment<FragmentAttendanceBinding>() {

    private val viewModel: AttendanceViewModel by viewModels()
    private val timelineAdapter by lazy { AttendanceTimelineAdapter() }

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true
        if (!granted) {
            showError("Location permission is required for attendance.")
        }
    }

    override fun inflateBinding(
        inflater: LayoutInflater,
        container: ViewGroup?
    ): FragmentAttendanceBinding =
        FragmentAttendanceBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        requestLocationPermission()
        setupHeader()
        setupRecyclerView()
        setupClickListeners()
        observeViewModel()
    }

    private fun requestLocationPermission() {
        locationPermissionLauncher.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        )
    }

    private fun setupHeader() {
        binding.tvDate.text = DATE_FORMAT.format(Date())
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
    }

    private fun setupRecyclerView() {
        binding.rvTimeline.apply {
            layoutManager = LinearLayoutManager(requireContext())
            adapter = timelineAdapter
        }
    }

    private fun setupClickListeners() {
        binding.btnHomeCheckIn.setOnClickListener {
            it.isEnabled = false
            viewModel.homeCheckIn()
        }
        binding.btnHomeCheckOut.setOnClickListener {
            it.isEnabled = false
            viewModel.homeCheckOut()
        }
        binding.btnSiteCheckIn.setOnClickListener {
            it.isEnabled = false
            viewModel.initiateSiteCheckIn()
        }
        binding.btnSiteCheckOut.setOnClickListener {
            it.isEnabled = false
            val state = (viewModel.attendanceState.value as? UiState.Success)?.data
            val siteRecord = (state as? AttendanceState.SiteCheckedIn)?.record
            if (siteRecord == null) { it.isEnabled = true; return@setOnClickListener }
            viewModel.siteCheckOut(siteId = siteRecord.siteId, siteName = siteRecord.siteName)
        }
        binding.btnMarketCheckIn.setOnClickListener {
            it.isEnabled = false
            viewModel.initiateMarketCheckIn()
        }
        binding.btnMarketCheckOut.setOnClickListener {
            it.isEnabled = false
            val state = (viewModel.attendanceState.value as? UiState.Success)?.data
            val marketRecord = (state as? AttendanceState.MarketCheckedIn)?.record
            if (marketRecord == null) { it.isEnabled = true; return@setOnClickListener }
            viewModel.marketCheckOut(marketRecord.marketName)
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
                    viewModel.attendanceState.collect { uiState ->
                        when (uiState) {
                            is UiState.Loading -> showLoading()
                            is UiState.Success -> renderAttendanceState(uiState.data)
                            is UiState.Error   -> showError(uiState.message)
                            else -> {}
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

                launch {
                    viewModel.actionState.collect { action ->
                        when (action) {
                            is ActionState.Idle    -> {}
                            is ActionState.Loading -> showLoading()
                            is ActionState.Success -> {
                                hideLoading()
                                clearError()
                                viewModel.resetActionState()
                            }
                            is ActionState.Error   -> {
                                hideLoading()
                                showError(action.message)
                                resetAllButtons()
                                viewModel.resetActionState()
                            }
                            // Daily assignment system removed — site is now typed manually
                            is ActionState.SiteInputRequired ->
                                showSiteInputDialog()
                            is ActionState.MarketNameRequired ->
                                showMarketNameDialog(action.currentLat, action.currentLng)
                        }
                    }
                }
            }
        }
    }

    // ── State → UI rendering ──────────────────────────────────────────────

    private fun renderAttendanceState(state: AttendanceState) {
        hideLoading()
        clearError()
        hideAllButtons()

        // Work card removed — daily assignment system not in use.
        // To re-enable, restore showWorkCard(state.record.siteName) in SiteCheckedIn branch.

        when (state) {
            is AttendanceState.NoRecord -> {
                binding.tvStatus.text = "Not checked in"
                binding.tvStatusDetail.visibility = View.GONE
                binding.btnHomeCheckIn.visibility = View.VISIBLE
            }
            is AttendanceState.HomeCheckedIn -> {
                binding.tvStatus.text = "Checked in from Home"
                binding.tvStatusDetail.visibility = View.VISIBLE
                binding.tvStatusDetail.text = "Since ${state.record.displayTime()}"
                binding.btnSiteCheckIn.visibility = View.VISIBLE
                binding.btnMarketCheckIn.visibility = View.VISIBLE
                binding.btnHomeCheckOut.visibility = View.VISIBLE
            }
            is AttendanceState.SiteCheckedIn -> {
                binding.tvStatus.text = "At Site: ${state.record.siteName}"
                binding.tvStatusDetail.visibility = View.VISIBLE
                binding.tvStatusDetail.text = "Since ${state.record.displayTime()}"
                binding.btnMarketCheckIn.visibility = View.VISIBLE
                binding.btnSiteCheckOut.visibility = View.VISIBLE
            }
            is AttendanceState.MarketCheckedIn -> {
                binding.tvStatus.text = "At Market: ${state.record.marketName}"
                binding.tvStatusDetail.visibility = View.VISIBLE
                binding.tvStatusDetail.text = "Since ${state.record.displayTime()}"
                binding.btnMarketCheckOut.visibility = View.VISIBLE
            }
            is AttendanceState.DayComplete -> {
                binding.tvStatus.text = "Day Complete ✓"
                binding.tvStatusDetail.visibility = View.VISIBLE
                binding.tvStatusDetail.text = "You have checked out for today"
            }
        }

        resetAllButtons()
    }

    // ── Dialogs ───────────────────────────────────────────────────────────

    // Replaces the old site-picker dropdown (which loaded from daily_assignments).
    // User types Site Name and Site ID manually — no Firestore lookup, no geofence check.
    private fun showSiteInputDialog() {
        hideLoading()
        val container = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 8)
        }
        val etSiteName = EditText(requireContext()).apply {
            hint = "Site Name (e.g. Senken Gurugaon Site)"
            setPadding(0, 16, 0, 16)
        }
        val etSiteId = EditText(requireContext()).apply {
            hint = "Site ID (e.g. Site-001)"
            setPadding(0, 16, 0, 16)
        }
        container.addView(etSiteName)
        container.addView(etSiteId)

        AlertDialog.Builder(requireContext())
            .setTitle("Check In at Site")
            .setView(container)
            .setPositiveButton("Check In") { _, _ ->
                val siteName = etSiteName.text.toString().trim()
                val siteId   = etSiteId.text.toString().trim()
                if (siteName.isBlank()) {
                    viewModel.resetActionState()
                    resetAllButtons()
                    showError("Please enter a site name.")
                } else {
                    viewModel.confirmSiteCheckIn(siteId, siteName)
                }
            }
            .setNegativeButton("Cancel") { _, _ ->
                viewModel.resetActionState()
                resetAllButtons()
            }
            .show()
    }

    private fun showMarketNameDialog(lat: Double, lng: Double) {
        hideLoading()
        val input = EditText(requireContext()).apply {
            hint = "Enter market name"
            setPadding(48, 32, 48, 32)
        }
        AlertDialog.Builder(requireContext())
            .setTitle("Market Check In")
            .setMessage("Enter the name of the market you are visiting:")
            .setView(input)
            .setPositiveButton("Check In") { _, _ ->
                viewModel.confirmMarketCheckIn(input.text.toString(), lat, lng)
            }
            .setNegativeButton("Cancel") { _, _ ->
                viewModel.resetActionState()
                resetAllButtons()
            }
            .show()
    }

    // ── UI helpers ────────────────────────────────────────────────────────

    private fun showLoading() {
        binding.progressBar.visibility = View.VISIBLE
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

    private fun hideAllButtons() {
        binding.btnHomeCheckIn.visibility = View.GONE
        binding.btnSiteCheckIn.visibility = View.GONE
        binding.btnMarketCheckIn.visibility = View.GONE
        binding.btnSiteCheckOut.visibility = View.GONE
        binding.btnMarketCheckOut.visibility = View.GONE
        binding.btnHomeCheckOut.visibility = View.GONE
    }

    private fun resetAllButtons() {
        binding.btnHomeCheckIn.isEnabled = true
        binding.btnSiteCheckIn.isEnabled = true
        binding.btnMarketCheckIn.isEnabled = true
        binding.btnSiteCheckOut.isEnabled = true
        binding.btnMarketCheckOut.isEnabled = true
        binding.btnHomeCheckOut.isEnabled = true
    }

    companion object {
        private val DATE_FORMAT = SimpleDateFormat("EEEE, d MMMM yyyy", Locale.getDefault())
    }
}
