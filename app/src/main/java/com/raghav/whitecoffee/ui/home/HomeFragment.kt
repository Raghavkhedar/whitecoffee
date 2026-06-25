package com.raghav.whitecoffee.ui.home

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.fragment.app.activityViewModels
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavOptions
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.MainViewModel
import com.raghav.whitecoffee.R
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.databinding.FragmentHomeBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class HomeFragment : BaseFragment<FragmentHomeBinding>() {

    private val viewModel: HomeViewModel by viewModels()
    private val mainViewModel: MainViewModel by activityViewModels()

    override fun inflateBinding(
        inflater: LayoutInflater,
        container: ViewGroup?
    ): FragmentHomeBinding = FragmentHomeBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupHeader()
        setupRoleVisibility()
        setupCardListeners()
        loadBellBadge()
        observeNetwork()
        observeTodayStatus()
        observeLogout()
        promptBatteryOptimization()
    }

    private fun setupHeader() {
        binding.tvGreeting.text = viewModel.greeting
        binding.tvRoleBadge.text = viewModel.userRole.replaceFirstChar { it.uppercase() }
        setupTodayCard()
    }

    private fun setupTodayCard() {
        val now = java.util.Calendar.getInstance()
        binding.tvTodayDay.text = java.text.SimpleDateFormat("EEEE", java.util.Locale.getDefault()).format(now.time)
        binding.tvTodayDateNum.text = now.get(java.util.Calendar.DAY_OF_MONTH).toString()
        binding.tvTodayMonth.text = java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale.getDefault()).format(now.time)
    }

    private fun loadBellBadge() {
        viewLifecycleOwner.lifecycleScope.launch {
            val count = viewModel.getUnreadCount()
            if (count > 0) {
                binding.tvBellBadge.text = if (count > 9) "9+" else count.toString()
                binding.tvBellBadge.visibility = View.VISIBLE
            } else {
                binding.tvBellBadge.visibility = View.GONE
            }
        }
    }

    private fun setupRoleVisibility() {
        binding.cardMtRequest.visibility =
            if (viewModel.isOperations) View.VISIBLE else View.GONE
        binding.cardWorkProgress.visibility =
            if (viewModel.isOperations) View.VISIBLE else View.GONE
        binding.cardLeaveApprovals.visibility =
            if (viewModel.isAdmin) View.VISIBLE else View.GONE
    }

    private fun observeNetwork() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.isOnline.collect { online ->
                    binding.offlineBanner.root.visibility = if (online) View.GONE else View.VISIBLE
                }
            }
        }
    }

    private fun observeTodayStatus() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.todayStatus.collect { status ->
                    when (status) {
                        is TodayAttendanceStatus.Loading -> {
                            binding.tvTodayAttStatus.text = "Loading…"
                            binding.tvTodayAttStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.text_hint))
                            binding.layoutTodayStatus.setBackgroundResource(R.drawable.bg_today_status_not_in)
                            binding.dotTodayStatus.setBackgroundResource(R.drawable.badge_red_bg)
                            binding.tvTodayLocation.visibility = View.GONE
                            binding.tvTodaySince.visibility = View.GONE
                        }
                        is TodayAttendanceStatus.NotCheckedIn -> {
                            binding.tvTodayAttStatus.text = "Not checked in"
                            binding.tvTodayAttStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.status_rejected))
                            binding.layoutTodayStatus.setBackgroundResource(R.drawable.bg_today_status_not_in)
                            binding.dotTodayStatus.setBackgroundResource(R.drawable.badge_red_bg)
                            binding.tvTodayLocation.visibility = View.GONE
                            binding.tvTodaySince.visibility = View.GONE
                        }
                        is TodayAttendanceStatus.Present -> {
                            binding.tvTodayAttStatus.text = "Present"
                            binding.tvTodayAttStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.status_approved))
                            binding.layoutTodayStatus.setBackgroundResource(R.drawable.bg_today_status_checked_in)
                            binding.dotTodayStatus.setBackgroundResource(R.drawable.badge_green_bg)
                            binding.tvTodayLocation.text = status.location
                            binding.tvTodayLocation.visibility = View.VISIBLE
                            binding.tvTodaySince.text = "Since ${status.since}"
                            binding.tvTodaySince.visibility = View.VISIBLE
                        }
                        is TodayAttendanceStatus.HalfDay -> {
                            binding.tvTodayAttStatus.text = "Half Day"
                            binding.tvTodayAttStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.status_pending))
                            binding.layoutTodayStatus.setBackgroundResource(R.drawable.bg_today_status_halfday)
                            binding.dotTodayStatus.setBackgroundResource(R.drawable.badge_amber_bg)
                            binding.tvTodayLocation.text = status.location
                            binding.tvTodayLocation.visibility = View.VISIBLE
                            binding.tvTodaySince.text = "Since ${status.since}"
                            binding.tvTodaySince.visibility = View.VISIBLE
                        }
                        is TodayAttendanceStatus.Error -> {
                            binding.tvTodayAttStatus.text = "Could not load"
                            binding.tvTodayAttStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.text_hint))
                            binding.layoutTodayStatus.setBackgroundResource(R.drawable.bg_today_status_not_in)
                            binding.dotTodayStatus.setBackgroundResource(R.drawable.badge_red_bg)
                            binding.tvTodayLocation.visibility = View.GONE
                            binding.tvTodaySince.visibility = View.GONE
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.loadTodayAttendance()
        loadBellBadge()
    }

    private fun observeLogout() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                mainViewModel.logoutComplete.collect {
                    findNavController().navigate(
                        R.id.loginFragment,
                        null,
                        NavOptions.Builder()
                            .setPopUpTo(R.id.nav_graph, true)
                            .build()
                    )
                }
            }
        }
    }

    private fun promptBatteryOptimization() {
        val prefs = requireContext().getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("battery_opt_asked", false)) return
        val pm = requireContext().getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(requireContext().packageName)) return
        prefs.edit().putBoolean("battery_opt_asked", true).apply()
        AlertDialog.Builder(requireContext())
            .setTitle("Enable background sync")
            .setMessage("Allow White Coffee to upload photos and sync data in the background, even when the app is closed. This ensures offline submissions upload automatically when your connection returns.")
            .setPositiveButton("Allow") { _, _ ->
                startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${requireContext().packageName}")
                    }
                )
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    private fun setupCardListeners() {
        binding.btnBell.setOnClickListener {
            findNavController().navigate(R.id.action_homeFragment_to_notificationsFragment)
        }
        binding.cardAttendance.setOnClickListener {
            if (viewModel.isOperations) {
                findNavController().navigate(R.id.action_homeFragment_to_attendanceFragment)
            } else {
                findNavController().navigate(R.id.action_homeFragment_to_officeAttendanceFragment)
            }
        }
        binding.cardMtRequest.setOnClickListener {
            findNavController().navigate(R.id.action_homeFragment_to_materialToolRequestFragment)
        }
        binding.cardMtBuy.setOnClickListener {
            findNavController().navigate(R.id.action_homeFragment_to_materialToolBuyFragment)
        }
        binding.cardMaterialTransfer.setOnClickListener {
            findNavController().navigate(R.id.action_homeFragment_to_materialTransferFragment)
        }
        binding.cardToolTransfer.setOnClickListener {
            findNavController().navigate(R.id.action_homeFragment_to_toolTransferFragment)
        }
        binding.cardWorkProgress.setOnClickListener {
            findNavController().navigate(R.id.action_homeFragment_to_workProgressFragment)
        }
        binding.cardLeave.setOnClickListener {
            findNavController().navigate(R.id.action_homeFragment_to_leaveFragment)
        }
        binding.cardLeaveApprovals.setOnClickListener {
            findNavController().navigate(R.id.action_homeFragment_to_leaveApprovalsFragment)
        }
        binding.cardRegularization.setOnClickListener {
            findNavController().navigate(R.id.action_homeFragment_to_regularizationFragment)
        }
        binding.btnLogout.setOnClickListener {
            binding.btnLogout.isEnabled = false
            binding.btnLogout.text = "Signing out…"
            mainViewModel.logoutWithAutoCheckout()
        }
    }
}
