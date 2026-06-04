package com.raghav.whitecoffee.ui.attendance

import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.databinding.ItemLeaveRequestBinding
import java.text.SimpleDateFormat
import java.util.Locale

class LeaveRequestAdapter : ListAdapter<LeaveRequest, LeaveRequestAdapter.VH>(DIFF) {

    inner class VH(private val binding: ItemLeaveRequestBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: LeaveRequest) {
            binding.tvLeaveType.text = item.leaveType
            binding.tvDates.text     = "${item.fromDate}  →  ${item.toDate}  (${item.totalDays} day${if (item.totalDays != 1) "s" else ""})"
            binding.tvReason.text    = item.reason

            val sdf = SimpleDateFormat("d MMM yyyy", Locale.getDefault())
            binding.tvSubmitted.text = item.submittedAt?.toDate()
                ?.let { "Submitted ${sdf.format(it)}" } ?: ""

            binding.tvStatus.text = item.status.replaceFirstChar { it.uppercase() }
            binding.tvStatus.setTextColor(statusColor(item.status))

            if (item.status == "rejected" && item.approverComment.isNotBlank()) {
                binding.tvApproverComment.visibility = View.VISIBLE
                binding.tvApproverComment.text = "Reason: ${item.approverComment}"
            } else {
                binding.tvApproverComment.visibility = View.GONE
            }
        }

        private fun statusColor(status: String) = when (status) {
            "approved" -> Color.parseColor("#10B981")
            "rejected" -> Color.parseColor("#EF4444")
            else       -> Color.parseColor("#F59E0B")
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = VH(
        ItemLeaveRequestBinding.inflate(LayoutInflater.from(parent.context), parent, false)
    )

    override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(getItem(position))

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<LeaveRequest>() {
            override fun areItemsTheSame(a: LeaveRequest, b: LeaveRequest) = a.id == b.id
            override fun areContentsTheSame(a: LeaveRequest, b: LeaveRequest) = a == b
        }
    }
}
