package com.raghav.whitecoffee.ui.home

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.R
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.databinding.FragmentHomeBinding
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class HomeFragment : BaseFragment<FragmentHomeBinding>() {

    private val viewModel: HomeViewModel by viewModels()

    override fun inflateBinding(
        inflater: LayoutInflater,
        container: ViewGroup?
    ): FragmentHomeBinding = FragmentHomeBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupHeader()
        setupRoleVisibility()
        setupCardListeners()
    }

    private fun setupHeader() {
        binding.tvGreeting.text = viewModel.getGreeting()
        binding.tvUserName.text = viewModel.userName
        binding.tvRoleBadge.text = viewModel.userRole.replaceFirstChar { it.uppercase() }
    }

    private fun setupRoleVisibility() {
        binding.cardMtRequest.visibility =
            if (viewModel.isOperations) View.VISIBLE else View.GONE
        binding.cardWorkProgress.visibility =
            if (viewModel.isOperations) View.VISIBLE else View.GONE
        binding.cardLeaveApprovals.visibility =
            if (viewModel.isOffice) View.VISIBLE else View.GONE
    }

    private fun setupCardListeners() {
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
            viewModel.logout()
            findNavController().navigate(R.id.action_homeFragment_to_loginFragment)
        }
    }
}
