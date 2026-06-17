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
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.fragment.app.activityViewModels
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
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
        promptBatteryOptimization()
    }

    private fun setupHeader() {
        binding.tvGreeting.text = viewModel.greeting
        binding.tvUserName.text = viewModel.userName
        binding.tvRoleBadge.text = viewModel.userRole.replaceFirstChar { it.uppercase() }
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
        // Operations-only cards
        binding.cardMtRequest.visibility =
            if (viewModel.isOperations) View.VISIBLE else View.GONE
        binding.cardWorkProgress.visibility =
            if (viewModel.isOperations) View.VISIBLE else View.GONE
        // Leave Approvals: admin only (office role does NOT approve leaves in the app)
        binding.cardLeaveApprovals.visibility =
            if (viewModel.isAdmin) View.VISIBLE else View.GONE

        // For non-operations users, expand lone cards to full width
        // (their partner card is GONE so they'd otherwise sit at half-width)
        if (!viewModel.isOperations) {
            expandToFullWidth(binding.cardAttendance)   // M&T Request is gone
            expandToFullWidth(binding.cardToolTransfer) // Work Progress is gone
        }
        if (!viewModel.isAdmin) {
            expandToFullWidth(binding.cardLeave)        // Leave Approvals is gone
        }
    }

    private fun expandToFullWidth(card: View) {
        val params = card.layoutParams as ConstraintLayout.LayoutParams
        if (params.endToEnd == ConstraintLayout.LayoutParams.PARENT_ID) return
        params.endToEnd = ConstraintLayout.LayoutParams.PARENT_ID
        params.marginEnd = (20 * resources.displayMetrics.density).toInt()
        card.layoutParams = params
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
        binding.btnLogout.setOnClickListener {
            mainViewModel.logout()
            findNavController().navigate(R.id.action_homeFragment_to_loginFragment)
        }
    }
}
