package com.raghav.whitecoffee.ui.notifications

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.databinding.FragmentNotificationsBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch

@AndroidEntryPoint
class NotificationsFragment : BaseFragment<FragmentNotificationsBinding>() {

    private val viewModel: NotificationsViewModel by viewModels()
    private val adapter by lazy {
        NotificationAdapter { notif ->
            if (!notif.isRead) viewModel.markAsRead(notif.id)
        }
    }

    override fun inflateBinding(inflater: LayoutInflater, container: ViewGroup?) =
        FragmentNotificationsBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
        binding.btnMarkAllRead.setOnClickListener { viewModel.markAllAsRead() }
        binding.rvNotifications.layoutManager = LinearLayoutManager(requireContext())
        binding.rvNotifications.adapter = adapter
        observeViewModel()
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.uiState.collect { state ->
                    when (state) {
                        is UiState.Loading -> {
                            binding.progressBar.visibility = View.VISIBLE
                            binding.tvEmpty.visibility = View.GONE
                            binding.btnMarkAllRead.visibility = View.GONE
                        }
                        is UiState.Success -> {
                            binding.progressBar.visibility = View.GONE
                            binding.tvEmpty.visibility = View.GONE
                            binding.btnMarkAllRead.visibility =
                                if (state.data.any { !it.isRead }) View.VISIBLE else View.GONE
                            adapter.submitList(state.data)
                        }
                        is UiState.Empty -> {
                            binding.progressBar.visibility = View.GONE
                            binding.tvEmpty.visibility = View.VISIBLE
                            binding.tvEmpty.text = "No notifications yet"
                            binding.btnMarkAllRead.visibility = View.GONE
                            adapter.submitList(emptyList())
                        }
                        is UiState.Error -> {
                            binding.progressBar.visibility = View.GONE
                            binding.tvEmpty.visibility = View.VISIBLE
                            binding.tvEmpty.text = state.message
                            binding.btnMarkAllRead.visibility = View.GONE
                        }
                        else -> {}
                    }
                }
            }
        }
    }
}
