package com.raghav.whitecoffee.ui.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AppNotification
import com.raghav.whitecoffee.ui.theme.EmptyState
import com.raghav.whitecoffee.ui.theme.IconTile
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcTile
import com.raghav.whitecoffee.ui.theme.WcTiles
import com.raghav.whitecoffee.ui.theme.WcTopBar
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme
import java.text.SimpleDateFormat
import java.util.Locale

private val TimeFmt = SimpleDateFormat("d MMM · h:mm a", Locale.getDefault())

private fun notifMeta(type: String): Pair<String, WcTile> = when (type) {
    "leave_update" -> Ms.event_available to WcTiles.Leave
    "work_reminder" -> Ms.schedule to WcTiles.Attendance
    "urgent" -> Ms.info to WcTile(WcColors.DangerBg, WcColors.DangerFg)
    else -> Ms.notifications to WcTiles.Attendance
}

@Composable
fun NotificationsScreen(
    state: UiState<List<AppNotification>>,
    onBack: () -> Unit,
    onMarkAllRead: () -> Unit,
    onMarkRead: (AppNotification) -> Unit,
    onRetry: () -> Unit,
) = WhiteCoffeeTheme {
    val list = (state as? UiState.Success)?.data.orEmpty()
    val hasUnread = list.any { !it.isRead }

    Column(Modifier.fillMaxSize().background(WcColors.ScreenBg)) {
        WcTopBar("Notifications", onBack, trailing = {
            if (hasUnread) Text(
                "Mark all read", color = WcColors.Primary, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable { onMarkAllRead() }.padding(8.dp),
            )
        })

        when (state) {
            is UiState.Success -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) { items(list) { NotificationRow(it, onMarkRead) } }
            is UiState.Empty -> Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
                EmptyState(Ms.notifications, "No notifications", "You're all caught up.")
            }
            is UiState.Error -> Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(state.message, color = WcColors.DangerFg, fontSize = 13.sp)
                    Spacer(Modifier.size(10.dp))
                    Text("Retry", color = WcColors.Primary, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { onRetry() })
                }
            }
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Loading…", color = WcColors.TextMuted, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun NotificationRow(n: AppNotification, onMarkRead: (AppNotification) -> Unit) {
    val (icon, tile) = notifMeta(n.type)
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
            .background(if (!n.isRead) Color(0xFFE8F4F4) else Color.Transparent)
            .clickable { if (!n.isRead) onMarkRead(n) }.padding(14.dp),
    ) {
        IconTile(icon, tile, size = 42, radius = 13, iconSize = 21)
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(n.title, color = WcColors.TextPrimary, fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold)
                if (!n.isRead) {
                    Spacer(Modifier.width(7.dp))
                    Box(Modifier.size(7.dp).clip(CircleShape).background(WcColors.Primary))
                }
            }
            Text(n.body, color = WcColors.TextSecondary, fontSize = 12.5.sp, lineHeight = 17.sp, modifier = Modifier.padding(top = 3.dp))
            val time = n.createdAt?.toDate()?.let { TimeFmt.format(it) } ?: ""
            if (time.isNotBlank()) Text(time, color = WcColors.TextMuted, fontSize = 11.sp, modifier = Modifier.padding(top = 5.dp))
        }
    }
}
