package com.raghav.whitecoffee.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.ui.theme.IconTile
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.StatusBadge
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcTile
import com.raghav.whitecoffee.ui.theme.WcTiles
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private data class ModuleItem(
    val label: String,
    val sub: String,
    val icon: String,
    val tile: WcTile,
    val onClick: () -> Unit,
)

@Composable
fun HomeScreen(
    greeting: String,
    userName: String,
    userRole: String,
    todayStatus: TodayAttendanceStatus,
    isOperations: Boolean,
    isAdmin: Boolean,
    isOnline: Boolean,
    unreadCount: Int,
    isLoggingOut: Boolean,
    onBellClick: () -> Unit,
    onLogout: () -> Unit,
    onAttendanceClick: () -> Unit,
    onMtRequestClick: () -> Unit,
    onMtBuyClick: () -> Unit,
    onMaterialTransferClick: () -> Unit,
    onToolTransferClick: () -> Unit,
    onWorkProgressClick: () -> Unit,
    onLeaveClick: () -> Unit,
    onLeaveApprovalsClick: () -> Unit,
    onRegularizationClick: () -> Unit,
) = WhiteCoffeeTheme {
    val modules = buildList {
        add(ModuleItem("Attendance", "Mark your day", Ms.schedule, WcTiles.Attendance, onAttendanceClick))
        if (isOperations) add(ModuleItem("M&T Request", "Request materials", Ms.build, WcTiles.MtRequest, onMtRequestClick))
        add(ModuleItem("M&T Buy", "Log purchases", Ms.shopping_cart, WcTiles.MtBuy, onMtBuyClick))
        add(ModuleItem("Material Transfer", "Move stock", Ms.inventory_2, WcTiles.MaterialXfer, onMaterialTransferClick))
        add(ModuleItem("Tool Transfer", "Handover tools", Ms.handyman, WcTiles.ToolXfer, onToolTransferClick))
        if (isOperations) add(ModuleItem("Work Progress", "Daily report", Ms.insights, WcTiles.Work, onWorkProgressClick))
        add(ModuleItem("Leave", "Time off", Ms.event_busy, WcTiles.Leave, onLeaveClick))
        if (isAdmin) add(ModuleItem("Leave Approvals", "Review requests", Ms.fact_check, WcTiles.Approvals, onLeaveApprovalsClick))
        add(ModuleItem("Regularization", "Fix attendance", Ms.event_repeat, WcTiles.Regularization, onRegularizationClick))
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(WcColors.ScreenBg)
            .verticalScroll(rememberScrollState()),
    ) {
        if (!isOnline) OfflineBannerBar()

        HomeHeader(greeting, userName, userRole, unreadCount, isLoggingOut, onBellClick, onLogout)

        // Everything after the header is lifted up to overlap it (design's -40 margin).
        Column(modifier = Modifier.offset(y = (-40).dp)) {
            TodayStatusCard(
                todayStatus = todayStatus,
                isOperations = isOperations,
                modifier = Modifier.padding(horizontal = 18.dp),
            )

            // ── Quick actions ──
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ActionButton("Check in", Ms.schedule, WcColors.Primary, Color.White, Modifier.weight(1f), onAttendanceClick)
                ActionButton("Apply leave", Ms.event, WcColors.Accent, WcColors.OnAccent, Modifier.weight(1f), onLeaveClick)
            }

            Text(
                "MODULES",
                color = WcColors.TextMuted,
                fontSize = 11.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 1.4.sp,
                modifier = Modifier.padding(start = 20.dp, top = 8.dp, bottom = 10.dp),
            )

            // ── Module grid (2 columns) ──
            Column(
                modifier = Modifier.padding(horizontal = 18.dp).padding(bottom = 34.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                modules.chunked(2).forEach { rowItems ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        rowItems.forEach { ModuleCard(it, Modifier.weight(1f)) }
                        if (rowItems.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeHeader(
    greeting: String,
    userName: String,
    userRole: String,
    unreadCount: Int,
    isLoggingOut: Boolean,
    onBellClick: () -> Unit,
    onLogout: () -> Unit,
) {
    val initials = userName.split(" ").mapNotNull { it.firstOrNull()?.toString() }.take(2).joinToString("").uppercase()
    val roleLabel = when (userRole.lowercase()) {
        "admin" -> "Administrator"
        "office" -> "Office / Sales"
        else -> "Operations Team"
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(WcColors.HeaderTop, WcColors.HeaderBottom)))
            .padding(start = 20.dp, end = 20.dp, top = 54.dp, bottom = 62.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(46.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) { Text(initials, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold) }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) {
                Text(greeting, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
            }
            // Logout
            Box(
                modifier = Modifier.size(44.dp).clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.12f))
                    .clickable(enabled = !isLoggingOut) { onLogout() },
                contentAlignment = Alignment.Center,
            ) { MsIcon(Ms.logout, 21.sp, Color.White) }
            Spacer(Modifier.width(10.dp))
            // Bell
            Box(
                modifier = Modifier.size(44.dp).clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.12f))
                    .clickable { onBellClick() },
                contentAlignment = Alignment.Center,
            ) {
                MsIcon(Ms.notifications, 22.sp, Color.White)
                if (unreadCount > 0) {
                    Box(
                        modifier = Modifier.align(Alignment.TopEnd).padding(top = 7.dp, end = 8.dp)
                            .size(16.dp).clip(CircleShape).background(Color(0xFFFF5A5F))
                            .border(1.5.dp, WcColors.HeaderTop, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) { Text(if (unreadCount > 9) "9+" else unreadCount.toString(), color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold) }
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(
            modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(Color.White.copy(alpha = 0.12f))
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MsIcon(Ms.verified_user, 14.sp, WcColors.HeaderSub)
            Spacer(Modifier.width(6.dp))
            Text(roleLabel, color = Color(0xFFEAFFFE), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.4.sp)
        }
    }
}

@Composable
private fun TodayStatusCard(
    todayStatus: TodayAttendanceStatus,
    isOperations: Boolean,
    modifier: Modifier = Modifier,
) {
    val now = Date()
    val dayName = SimpleDateFormat("EEEE", Locale.getDefault()).format(now)
    val dateNum = SimpleDateFormat("d", Locale.getDefault()).format(now)
    val monthYear = SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(now)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(WcColors.Surface)
            .border(1.dp, WcColors.BorderSoft, RoundedCornerShape(22.dp))
            .padding(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(dayName, color = WcColors.TextMuted, fontSize = 11.sp)
                Text(dateNum, color = Color(0xFF0B0F0F), fontSize = 33.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 35.sp)
                Text(monthYear, color = WcColors.TextSecondary, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
            }
            Box(Modifier.width(1.dp).height(54.dp).background(WcColors.Divider))
            Spacer(Modifier.width(18.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text("TODAY", color = WcColors.TextMuted, fontSize = 10.sp, letterSpacing = 0.4.sp)
                Spacer(Modifier.height(7.dp))
                AttendanceStatusChip(todayStatus)
                val location = (todayStatus as? TodayAttendanceStatus.Present)?.location
                    ?: (todayStatus as? TodayAttendanceStatus.ShortLeave)?.location
                    ?: (todayStatus as? TodayAttendanceStatus.HalfDay)?.location
                val since = (todayStatus as? TodayAttendanceStatus.Present)?.since
                    ?: (todayStatus as? TodayAttendanceStatus.ShortLeave)?.since
                    ?: (todayStatus as? TodayAttendanceStatus.HalfDay)?.since
                if (location != null) Text(location, color = WcColors.TextSecondary, fontSize = 10.5.sp, modifier = Modifier.padding(top = 6.dp))
                if (since != null) Text("Since $since", color = WcColors.TextMuted, fontSize = 10.5.sp, modifier = Modifier.padding(top = 1.dp))
            }
        }
    }
}

@Composable
private fun AttendanceStatusChip(status: TodayAttendanceStatus) {
    val (bg, fg, label) = when (status) {
        is TodayAttendanceStatus.Present -> Triple(WcColors.SuccessBg, WcColors.SuccessFg, "Present")
        is TodayAttendanceStatus.ShortLeave -> Triple(WcColors.SlBg, WcColors.SlFg, "Short Leave")
        is TodayAttendanceStatus.HalfDay -> Triple(WcColors.WarnBg, WcColors.WarnFg, "Half Day")
        is TodayAttendanceStatus.NotCheckedIn -> Triple(WcColors.DangerBg, WcColors.DangerFg, "Not checked in")
        is TodayAttendanceStatus.Loading -> Triple(WcColors.Border, WcColors.TextMuted, "Loading…")
        is TodayAttendanceStatus.Error -> Triple(WcColors.DangerBg, WcColors.DangerFg, "Error")
    }
    StatusBadge(label, bg, fg)
}

@Composable
private fun ActionButton(text: String, icon: String, bg: Color, fg: Color, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier = modifier.height(48.dp).clip(RoundedCornerShape(14.dp)).background(bg).clickable { onClick() },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MsIcon(icon, 19.sp, fg)
        Spacer(Modifier.width(7.dp))
        Text(text, color = fg, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun ModuleCard(module: ModuleItem, modifier: Modifier) {
    Column(
        modifier = modifier
            .heightIn(min = 118.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(WcColors.Surface)
            .border(1.dp, WcColors.BorderSoft, RoundedCornerShape(20.dp))
            .clickable { module.onClick() }
            .padding(15.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        IconTile(module.icon, module.tile, size = 46, radius = 15, iconSize = 24)
        Column {
            Text(module.label, color = WcColors.TextPrimary, fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 17.sp)
            Text(module.sub, color = WcColors.TextHint, fontSize = 11.5.sp, modifier = Modifier.padding(top = 3.dp))
        }
    }
}

@Composable
private fun OfflineBannerBar() {
    Box(
        modifier = Modifier.fillMaxWidth().background(Color(0xFF78350F)).padding(horizontal = 18.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) { Text("No internet connection", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium) }
}

@Preview(showBackground = true)
@Composable
private fun HomeScreenPreview() {
    HomeScreen(
        greeting = "Good morning", userName = "Raghav Khedar", userRole = "operations",
        todayStatus = TodayAttendanceStatus.Present("At Home", "8:30 AM"),
        isOperations = true, isAdmin = false, isOnline = true, unreadCount = 2, isLoggingOut = false,
        onBellClick = {}, onLogout = {}, onAttendanceClick = {}, onMtRequestClick = {}, onMtBuyClick = {},
        onMaterialTransferClick = {}, onToolTransferClick = {}, onWorkProgressClick = {}, onLeaveClick = {},
        onLeaveApprovalsClick = {}, onRegularizationClick = {},
    )
}
