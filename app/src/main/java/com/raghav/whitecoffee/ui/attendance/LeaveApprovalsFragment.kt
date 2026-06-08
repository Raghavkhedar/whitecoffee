package com.raghav.whitecoffee.ui.attendance

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.databinding.FragmentLeaveApprovalsBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class LeaveApprovalsFragment : BaseFragment<FragmentLeaveApprovalsBinding>() {

    private val viewModel: LeaveApprovalsViewModel by viewModels()
    private lateinit var adapter: LeaveApprovalAdapter

    override fun inflateBinding(inflater: LayoutInflater, container: ViewGroup?) =
        FragmentLeaveApprovalsBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView()
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
        observeViewModel()
    }

    private fun setupRecyclerView() {
        adapter = LeaveApprovalAdapter(
            onApprove = { viewModel.approve(it) },
            onReject  = { showRejectDialog(it) }
        )
        binding.rvApprovals.layoutManager = LinearLayoutManager(requireContext())
        binding.rvApprovals.adapter = adapter
    }

    private fun showRejectDialog(request: LeaveRequest) {
        val input = EditText(requireContext()).apply {
            hint = "Reason for rejection (optional)"
            setPadding(48, 32, 48, 32)
        }
        AlertDialog.Builder(requireContext())
            .setTitle("Reject Leave Request")
            .setMessage("${request.userName} — ${request.leaveType}")
            .setView(input)
            .setPositiveButton("Reject") { _, _ ->
                viewModel.reject(request, input.text.toString())
            }
            .setNegativeButton("Cancel") { _, _ ->
                viewModel.resetActionState()
            }
            .show()
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {

                launch {
                    viewModel.approvalsState.collect { state ->
                        when (state) {
                            is UiState.Loading -> {
                                binding.progressBar.visibility = View.VISIBLE
                                binding.tvEmpty.visibility = View.GONE
                                binding.tvError.visibility = View.GONE
                            }
                            is UiState.Success -> {
                                binding.progressBar.visibility = View.GONE
                                binding.tvEmpty.visibility = View.GONE
                                binding.tvError.visibility = View.GONE
                                binding.tvPendingCount.text = "${state.data.size} pending"
                                adapter.submitList(state.data)
                            }
                            is UiState.Empty -> {
                                binding.progressBar.visibility = View.GONE
                                binding.tvEmpty.visibility = View.VISIBLE
                                binding.tvPendingCount.text = "0 pending"
                                adapter.submitList(emptyList())
                            }
                            is UiState.Error -> {
                                binding.progressBar.visibility = View.GONE
                                binding.tvError.visibility = View.VISIBLE
                                binding.tvError.text = state.message
                            }
                            else -> {}
                        }
                    }
                }

                launch {
                    viewModel.actionState.collect { state ->
                        when (state) {
                            is UiState.Error -> {
                                binding.tvError.visibility = View.VISIBLE
                                binding.tvError.text = state.message
                                viewModel.resetActionState()
                            }
                            else -> {}
                        }
                    }
                }
            }
        }
    }
}
