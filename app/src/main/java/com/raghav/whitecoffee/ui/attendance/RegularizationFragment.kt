package com.raghav.whitecoffee.ui.attendance

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.raghav.whitecoffee.R
import com.raghav.whitecoffee.core.BaseFragment
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.databinding.FragmentRegularizationBinding
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale

@AndroidEntryPoint
class RegularizationFragment : BaseFragment<FragmentRegularizationBinding>() {

    private val viewModel: RegularizationViewModel by viewModels()
    private val adapter by lazy {
        RegularizationAdapter { item -> showApplyDialog(item) }
    }

    override fun inflateBinding(inflater: LayoutInflater, container: ViewGroup?) =
        FragmentRegularizationBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupRecyclerView()
        binding.btnBack.setOnClickListener { findNavController().navigateUp() }
        binding.tvTodayLabel.text = viewModel.todayLabel
        binding.swipeRefresh.setColorSchemeResources(R.color.primary_blue)
        binding.swipeRefresh.setOnRefreshListener { viewModel.loadToday() }
        binding.btnRetry.setOnClickListener { viewModel.loadToday() }
        observeViewModel()
    }

    private fun setupRecyclerView() {
        binding.rvDays.layoutManager = LinearLayoutManager(requireContext())
        binding.rvDays.adapter = adapter
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.isOnline.collect { online ->
                        binding.offlineBanner.root.visibility =
                            if (online) View.GONE else View.VISIBLE
                    }
                }
                launch {
                    viewModel.daysState.collect { state ->
                        when (state) {
                            is UiState.Loading -> {
                                if (!binding.swipeRefresh.isRefreshing) {
                                    binding.progressBar.visibility = View.VISIBLE
                                }
                                binding.tvEmpty.visibility = View.GONE
                                binding.btnRetry.visibility = View.GONE
                            }
                            is UiState.Success -> {
                                binding.progressBar.visibility = View.GONE
                                binding.swipeRefresh.isRefreshing = false
                                binding.tvEmpty.visibility = View.GONE
                                binding.btnRetry.visibility = View.GONE
                                adapter.submitList(state.data)
                            }
                            is UiState.Empty -> {
                                binding.progressBar.visibility = View.GONE
                                binding.swipeRefresh.isRefreshing = false
                                binding.tvEmpty.visibility = View.VISIBLE
                                binding.tvEmpty.text = "Today's attendance is on track — no action needed."
                                binding.btnRetry.visibility = View.GONE
                                adapter.submitList(emptyList())
                            }
                            is UiState.Error -> {
                                binding.progressBar.visibility = View.GONE
                                binding.swipeRefresh.isRefreshing = false
                                binding.tvEmpty.visibility = View.VISIBLE
                                binding.tvEmpty.text = state.message
                                binding.btnRetry.visibility = View.VISIBLE
                            }
                            is UiState.Offline -> {
                                binding.progressBar.visibility = View.GONE
                                binding.swipeRefresh.isRefreshing = false
                                binding.tvEmpty.visibility = View.VISIBLE
                                binding.tvEmpty.text = "You are offline."
                                binding.btnRetry.visibility = View.VISIBLE
                            }
                        }
                    }
                }
                launch {
                    viewModel.submitState.collect { state ->
                        when (state) {
                            is UiState.Success -> {
                                Toast.makeText(requireContext(), "Request submitted", Toast.LENGTH_SHORT).show()
                                viewModel.resetSubmitState()
                            }
                            is UiState.Error -> {
                                Toast.makeText(requireContext(), state.message, Toast.LENGTH_LONG).show()
                                viewModel.resetSubmitState()
                            }
                            else -> {}
                        }
                    }
                }
            }
        }
    }

    private fun showApplyDialog(item: RegularizationDayItem) {
        val editText = EditText(requireContext()).apply {
            hint = "Enter reason"
            setPadding(48, 32, 48, 16)
        }
        val displayDate = try {
            val parsed = INPUT_FORMAT.parse(item.date)
            parsed?.let { DISPLAY_FORMAT.format(it) } ?: item.date
        } catch (e: Exception) {
            item.date
        }
        AlertDialog.Builder(requireContext())
            .setTitle("Regularize $displayDate")
            .setMessage("Original status: ${item.originalStatus}")
            .setView(editText)
            .setPositiveButton("Submit") { _, _ ->
                val reason = editText.text.toString().trim()
                if (reason.isBlank()) {
                    Toast.makeText(requireContext(), "Please enter a reason.", Toast.LENGTH_SHORT).show()
                } else {
                    viewModel.submitRequest(item.date, item.originalStatus, reason)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    companion object {
        private val INPUT_FORMAT   = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        private val DISPLAY_FORMAT = SimpleDateFormat("d MMM yyyy", Locale.getDefault())
    }
}
