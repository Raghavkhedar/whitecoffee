package com.raghav.whitecoffee.ui.notifications

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.raghav.whitecoffee.R
import com.raghav.whitecoffee.data.model.AppNotification
import java.text.SimpleDateFormat
import java.util.Locale

class NotificationAdapter(
    private val onItemClick: (AppNotification) -> Unit
) : ListAdapter<AppNotification, NotificationAdapter.ViewHolder>(DiffCallback) {

    class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val tvTitle: TextView = itemView.findViewById(R.id.tv_notif_title)
        val tvBody: TextView  = itemView.findViewById(R.id.tv_notif_body)
        val tvTime: TextView  = itemView.findViewById(R.id.tv_notif_time)
        val dotUnread: View   = itemView.findViewById(R.id.dot_unread)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_notification, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val notif = getItem(position)
        holder.tvTitle.text = notif.title
        holder.tvBody.text  = notif.body
        holder.tvTime.text  = notif.createdAt?.let { TIME_FORMAT.format(it.toDate()) } ?: ""
        holder.dotUnread.visibility = if (notif.isRead) View.INVISIBLE else View.VISIBLE
        holder.itemView.setBackgroundResource(
            if (notif.isRead) R.color.surface else R.color.accent_light
        )
        holder.itemView.setOnClickListener { onItemClick(notif) }
    }

    companion object {
        private val TIME_FORMAT = SimpleDateFormat("d MMM, hh:mm a", Locale.getDefault())

        private val DiffCallback = object : DiffUtil.ItemCallback<AppNotification>() {
            override fun areItemsTheSame(a: AppNotification, b: AppNotification) = a.id == b.id
            override fun areContentsTheSame(a: AppNotification, b: AppNotification) = a == b
        }
    }
}
