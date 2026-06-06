package com.raghav.whitecoffee.ui.attendance

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.databinding.ItemAttendanceEventBinding

class AttendanceTimelineAdapter :
    ListAdapter<AttendanceRecord, AttendanceTimelineAdapter.ViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemAttendanceEventBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position), position == itemCount - 1)
    }

    inner class ViewHolder(
        private val binding: ItemAttendanceEventBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(record: AttendanceRecord, isLast: Boolean) {
            binding.tvEventType.text = record.type.toDisplayLabel()
            binding.tvEventDetail.text = buildDetail(record)
            // Hide the line connector on the last item
            binding.timelineLine.visibility =
                if (isLast) android.view.View.INVISIBLE else android.view.View.VISIBLE
        }

        private fun buildDetail(record: AttendanceRecord): String {
            val time = record.displayTime()
            val location = "(${String.format("%.4f", record.latitude)}, " +
                    "${String.format("%.4f", record.longitude)})"
            val extra = when (record.type) {
                AttendanceType.SITE_IN, AttendanceType.SITE_OUT ->
                    if (record.siteName.isNotEmpty()) " • ${record.siteName}" else ""
                AttendanceType.MARKET_IN, AttendanceType.MARKET_OUT ->
                    if (record.marketName.isNotEmpty()) " • ${record.marketName}" else ""
                AttendanceType.OFFICE_IN, AttendanceType.OFFICE_OUT ->
                    if (record.locationName.isNotEmpty()) " • ${record.locationName}" else ""
                else -> ""
            }
            return "$time$extra\n$location"
        }
    }

    private fun String.toDisplayLabel(): String = when (this) {
        AttendanceType.HOME_IN     -> "🏠 Checked in from Home"
        AttendanceType.HOME_OUT    -> "🏠 Checked out from Home"
        AttendanceType.SITE_IN     -> "🏗️ Arrived at Site"
        AttendanceType.SITE_OUT    -> "🏗️ Left Site"
        AttendanceType.MARKET_IN   -> "🛒 Arrived at Market"
        AttendanceType.MARKET_OUT  -> "🛒 Left Market"
        AttendanceType.OFFICE_IN   -> "🏢 Checked In"
        AttendanceType.OFFICE_OUT  -> "🏢 Checked Out"
        else -> this
    }

    class DiffCallback : DiffUtil.ItemCallback<AttendanceRecord>() {
        override fun areItemsTheSame(a: AttendanceRecord, b: AttendanceRecord) = a.id == b.id
        override fun areContentsTheSame(a: AttendanceRecord, b: AttendanceRecord) = a == b
    }
}