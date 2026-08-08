package com.raghav.whitecoffee.data.notification

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.raghav.whitecoffee.MainActivity
import com.raghav.whitecoffee.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Platform [AttendanceNotifier]. Bound in [com.raghav.whitecoffee.di.DataSourceModule].
 *
 * Deliberately NOT a foreground service. The reminder only has to survive in the shade while the
 * session is open; a service would need its own manifest permission, its own lifecycle and a
 * second notification anyway.
 *
 * **Its own channel, separate from FcmService's `wc_default`.** Push notifications and this
 * reminder answer to different people: a user who mutes admin broadcasts must not thereby mute
 * the one notification standing between them and a half-day deduction.
 */
@Singleton
class SystemAttendanceNotifier @Inject constructor(
    @ApplicationContext private val context: Context,
) : AttendanceNotifier {

    private val manager: NotificationManager
        get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    override fun showCheckedIn(since: String, entry: AttendanceEntry) {
        if (!canPost()) return
        ensureChannel()

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_ATTENDANCE_ENTRY, entry.name)
        }
        // FLAG_UPDATE_CURRENT so a session that changes kind (site → market) re-targets the same
        // PendingIntent rather than tapping through to the previous screen.
        val pending = PendingIntent.getActivity(
            context,
            PENDING_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("You're still checked in")
            .setContentText("Checked in since $since · tap to check out")
            .setContentIntent(pending)
            // Ongoing: the employee cannot swipe away the one reminder that protects their pay.
            .setOngoing(true)
            .setAutoCancel(false)
            // Silent and low priority — this sits in the shade all day, it must never buzz.
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .build()

        // A denied/revoked permission surfaces as a SecurityException on some OEM builds rather
        // than the silent no-op the docs promise. Either way the punch itself already succeeded —
        // losing the reminder must never fail the check-in.
        try {
            manager.notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
        }
    }

    override fun clear() {
        try {
            manager.cancel(NOTIFICATION_ID)
        } catch (_: SecurityException) {
        }
    }

    /**
     * Whether posting can possibly be seen. Below API 33 POST_NOTIFICATIONS does not exist and is
     * granted by install; from 33 it is a runtime permission that starts DENIED (HomeFragment asks
     * for it after login). `areNotificationsEnabled` additionally covers a user who turned the app's
     * notifications off in Settings.
     */
    private fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** Idempotent — re-creating an existing channel is a no-op and never resets user settings. */
    private fun ensureChannel() {
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Attendance session",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Reminds you that you are still checked in, so you don't forget to check out."
                setShowBadge(false)
            }
        )
    }

    private companion object {
        /** Separate from FcmService's "wc_default" on purpose — see the class comment. */
        const val CHANNEL_ID = "wc_attendance_session"

        /** Fixed id: there is at most one open session, so a re-post replaces rather than stacks. */
        const val NOTIFICATION_ID = 4201
        const val PENDING_REQUEST_CODE = 4201
    }
}
