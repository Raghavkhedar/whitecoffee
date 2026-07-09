package com.raghav.whitecoffee.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.google.firebase.Timestamp
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.raghav.whitecoffee.MainActivity
import com.raghav.whitecoffee.R
import com.raghav.whitecoffee.data.model.AppNotification
import com.raghav.whitecoffee.data.repository.NotificationRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class FcmService : FirebaseMessagingService() {

    @Inject lateinit var notificationRepository: NotificationRepository
    @Inject lateinit var sessionManager: SessionManager

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: "White Coffee"
        val body  = message.notification?.body  ?: message.data["body"]  ?: ""
        val type  = message.data["type"] ?: "general"

        if (sessionManager.userId.isNotEmpty()) {
            serviceScope.launch {
                notificationRepository.saveNotification(
                    AppNotification(
                        title     = title,
                        body      = body,
                        type      = type,
                        isRead    = false,
                        createdAt = Timestamp.now()
                    )
                )
            }
        }

        showSystemNotification(title, body)
    }

    override fun onNewToken(token: String) {
        serviceScope.launch {
            notificationRepository.saveToken(token)
        }
    }

    private fun showSystemNotification(title: String, body: String) {
        val channelId = "wc_default"
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        manager.createNotificationChannel(
            NotificationChannel(channelId, "White Coffee", NotificationManager.IMPORTANCE_DEFAULT)
        )

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        manager.notify(System.currentTimeMillis().toInt(), notif)
    }
}
