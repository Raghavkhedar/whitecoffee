package com.raghav.whitecoffee.ui.attendance

import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.raghav.whitecoffee.databinding.ItemRegularizationDayBinding
import java.text.SimpleDateFormat
import java.util.Locale

class RegularizationAdapter(
    private val onApply: (RegularizationDayItem) -> Unit
) : ListAdapter<RegularizationDayItem, RegularizationAdapter.VH>(DIFF) {

    inner class VH(private val binding: ItemRegularizationDayBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: RegularizationDayItem) {
            val displayDate = try {
                val parsed = INPUT_FORMAT.parse(item.date)
                parsed?.let { "${DISPLAY_FORMAT.format(it)}, ${item.dayOfWeek}" } ?: item.date
            } catch (e: Exception) {
                item.date
            }
            binding.tvDate.text = displayDate

            binding.tvOriginalStatus.text = item.originalStatus
            binding.tvOriginalStatus.setTextColor(
                if (item.originalStatus == "Absent") Color.parseColor("#EF4444")
                else Color.parseColor("#F59E0B")
            )

            val req = item.request
            if (req != null) {
                binding.tvReason.text = req.reason
                binding.tvReason.visibility = View.VISIBLE

                binding.tvRequestStatus.text = req.status.replaceFirstChar { it.uppercase() }
                binding.tvRequestStatus.setTextColor(statusColor(req.status))
                binding.tvRequestStatus.visibility = View.VISIBLE

                binding.btnApply.visibility = View.GONE

                if (req.status == "rejected" && req.approverComment.isNotBlank()) {
                    binding.tvApproverComment.text = "Reason: ${req.approverComment}"
                    binding.tvApproverComment.visibility = View.VISIBLE
                } else {
                    binding.tvApproverComment.visibility = View.GONE
                }
            } else {
                binding.tvReason.visibility = View.GONE
                binding.tvRequestStatus.visibility = View.GONE
                binding.tvApproverComment.visibility = View.GONE
                binding.btnApply.visibility = View.VISIBLE
                binding.btnApply.setOnClickListener { onApply(item) }
            }
        }

        private fun statusColor(status: String) = when (status) {
            "approved" -> Color.parseColor("#10B981")
            "rejected" -> Color.parseColor("#EF4444")
            else       -> Color.parseColor("#F59E0B")
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = VH(
        ItemRegularizationDayBinding.inflate(LayoutInflater.from(parent.context), parent, false)
    )

    override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(getItem(position))

    companion object {
        private val INPUT_FORMAT   = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        private val DISPLAY_FORMAT = SimpleDateFormat("d MMM yyyy", Locale.getDefault())

        private val DIFF = object : DiffUtil.ItemCallback<RegularizationDayItem>() {
            override fun areItemsTheSame(a: RegularizationDayItem, b: RegularizationDayItem) =
                a.date == b.date
            override fun areContentsTheSame(a: RegularizationDayItem, b: RegularizationDayItem) =
                a == b
        }
    }
}
