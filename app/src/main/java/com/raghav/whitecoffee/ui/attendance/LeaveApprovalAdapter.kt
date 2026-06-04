package com.raghav.whitecoffee.ui.attendance

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.databinding.ItemLeaveApprovalBinding

class LeaveApprovalAdapter(
    private val onApprove: (LeaveRequest) -> Unit,
    private val onReject:  (LeaveRequest) -> Unit
) : ListAdapter<LeaveRequest, LeaveApprovalAdapter.VH>(DIFF) {

    inner class VH(private val binding: ItemLeaveApprovalBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: LeaveRequest) {
            binding.tvEmployeeName.text = item.userName
            binding.tvEmployeeId.text   = item.employeeId
            binding.tvLeaveType.text    = item.leaveType
            binding.tvDates.text        = "${item.fromDate}  →  ${item.toDate}  (${item.totalDays} day${if (item.totalDays != 1) "s" else ""})"
            binding.tvReason.text       = item.reason

            binding.btnApprove.setOnClickListener {
                binding.btnApprove.isEnabled = false
                binding.btnReject.isEnabled  = false
                onApprove(item)
            }
            binding.btnReject.setOnClickListener {
                binding.btnApprove.isEnabled = false
                binding.btnReject.isEnabled  = false
                onReject(item)
            }
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = VH(
        ItemLeaveApprovalBinding.inflate(LayoutInflater.from(parent.context), parent, false)
    )

    override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(getItem(position))

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<LeaveRequest>() {
            override fun areItemsTheSame(a: LeaveRequest, b: LeaveRequest) = a.id == b.id
            override fun areContentsTheSame(a: LeaveRequest, b: LeaveRequest) = a == b
        }
    }
}
