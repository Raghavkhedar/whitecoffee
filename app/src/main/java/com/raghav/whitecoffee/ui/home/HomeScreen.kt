package com.raghav.whitecoffee.ui.home

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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ── Palette (mirrors colors.xml) ─────────────────────────────────────────────
private val Midnight    = Color(0xFF05091A)
private val Deep        = Color(0xFF0D1836)
private val Navy        = Color(0xFF1A2F72)
private val ScreenBg    = Color(0xFFF4F6FB)   // slightly warmer neutral, more minimal
private val Surface     = Color(0xFFFFFFFF)
private val TextPrimary = Color(0xFF050B20)
private val TextSecond  = Color(0xFF3A4470)
private val TextHint    = Color(0xFF8591BD)
private val HeaderSub   = Color(0xFFA0BEFF)
private val Border      = Color(0xFFE8EBF6)
private val GreenText   = Color(0xFF059669)
private val GreenBg     = Color(0xFFD1FAE5)
private val AmberText   = Color(0xFFD97706)
private val AmberBg     = Color(0xFFFEF3C7)
private val RedText     = Color(0xFFE11D48)
private val RedBg       = Color(0xFFFFE4E6)

// Each tab is one solid flat color — deep, rich, no gradients.
private data class ModuleItem(
    val label: String,
    val emoji: String,
    val color: Color,
    val onClick: () -> Unit
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
) {
    val modules = buildList {
        add(ModuleItem("Attendance",        "📋", Color(0xFF1E3A8A), onAttendanceClick))
        if (isOperations)
        add(ModuleItem("M&T Request",       "🔧", Color(0xFFC2410C), onMtRequestClick))
        add(ModuleItem("M&T Buy",           "🛒", Color(0xFF065F46), onMtBuyClick))
        add(ModuleItem("Material Transfer", "📦", Color(0xFF5B21B6), onMaterialTransferClick))
        add(ModuleItem("Tool Transfer",     "🔨", Color(0xFF155E75), onToolTransferClick))
        if (isOperations)
        add(ModuleItem("Work Progress",     "📊", Color(0xFF92400E), onWorkProgressClick))
        add(ModuleItem("Leave",             "🗓", Color(0xFF9F1239), onLeaveClick))
        if (isAdmin)
        add(ModuleItem("Leave Approvals",   "✅", Color(0xFF064E3B), onLeaveApprovalsClick))
        add(ModuleItem("Regularization",    "🕐", Color(0xFF3730A3), onRegularizationClick))
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(ScreenBg),
        contentPadding = PaddingValues(bottom = 40.dp)
    ) {
        if (!isOnline) {
            item { OfflineBannerBar() }
        }
        item {
            HomeHeader(
                greeting     = greeting,
                userName     = userName,
                userRole     = userRole,
                unreadCount  = unreadCount,
                isLoggingOut = isLoggingOut,
                onBellClick  = onBellClick,
                onLogout     = onLogout
            )
        }
        item {
            TodayStatusCard(
                todayStatus = todayStatus,
                modifier    = Modifier
                    .padding(horizontal = 18.dp)
                    .padding(top = 20.dp)
            )
        }
        item {
            Text(
                "MODULES",
                color     = TextHint,
                fontSize  = 10.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.2.sp,
                modifier  = Modifier
                    .padding(horizontal = 22.dp)
                    .padding(top = 24.dp, bottom = 10.dp)
            )
        }
        item {
            ModuleList(
                modules  = modules,
                modifier = Modifier.padding(horizontal = 18.dp)
            )
        }
    }
}

// ── Header ────────────────────────────────────────────────────────────────────

@Composable
private fun HomeHeader(
    greeting: String,
    userName: String,
    userRole: String,
    unreadCount: Int,
    isLoggingOut: Boolean,
    onBellClick: () -> Unit,
    onLogout: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Midnight, Deep, Navy)))
            .padding(horizontal = 20.dp)
            .padding(top = 52.dp, bottom = 24.dp)
    ) {
        // Left: greeting + name + role badge
        Column(modifier = Modifier.align(Alignment.TopStart).padding(end = 112.dp)) {
            Text("$greeting,", color = HeaderSub, fontSize = 13.sp)
            Spacer(Modifier.height(3.dp))
            Text(
                userName,
                color      = Color.White,
                fontSize   = 21.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(10.dp))
            Text(
                userRole.replaceFirstChar { it.uppercase() },
                color      = Color.White,
                fontSize   = 10.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.5.sp,
                modifier   = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color.White.copy(alpha = 0.12f))
                    .padding(horizontal = 12.dp, vertical = 5.dp)
            )
        }

        // Right: bell + logout
        Row(
            modifier = Modifier.align(Alignment.TopEnd),
            verticalAlignment = Alignment.CenterVertically
        ) {
            BellButton(unreadCount = unreadCount, onClick = onBellClick)
            Spacer(Modifier.width(2.dp))
            TextButton(onClick = { if (!isLoggingOut) onLogout() }) {
                Text(
                    if (isLoggingOut) "Signing out…" else "Logout",
                    color    = HeaderSub,
                    fontSize = 13.sp
                )
            }
        }
    }
}

@Composable
private fun BellButton(unreadCount: Int, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Text("🔔", fontSize = 20.sp)
        if (unreadCount > 0) {
            Box(
                modifier = Modifier
                    .size(16.dp)
                    .align(Alignment.TopEnd)
                    .clip(CircleShape)
                    .background(RedText),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    if (unreadCount > 9) "9+" else unreadCount.toString(),
                    color    = Color.White,
                    fontSize = 9.sp
                )
            }
        }
    }
}

// ── Today status card ─────────────────────────────────────────────────────────

@Composable
private fun TodayStatusCard(
    todayStatus: TodayAttendanceStatus,
    modifier: Modifier = Modifier
) {
    val now       = Date()
    val dayName   = SimpleDateFormat("EEEE", Locale.getDefault()).format(now)
    val dateNum   = SimpleDateFormat("d", Locale.getDefault()).format(now)
    val monthYear = SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(now)

    Card(
        modifier  = modifier.fillMaxWidth(),
        shape     = RoundedCornerShape(18.dp),
        colors    = CardDefaults.cardColors(containerColor = Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Date
            Column(modifier = Modifier.weight(1f)) {
                Text(dayName, color = TextHint, fontSize = 11.sp)
                Text(
                    dateNum,
                    color      = TextPrimary,
                    fontSize   = 32.sp,
                    fontWeight = FontWeight.Bold,
                    lineHeight = 36.sp
                )
                Text(
                    monthYear,
                    color    = TextSecond,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 2.dp)
                )
            }

            // Divider
            Box(
                modifier = Modifier
                    .width(1.dp)
                    .height(52.dp)
                    .background(Border)
            )

            Spacer(Modifier.width(18.dp))

            // Status
            Column(horizontalAlignment = Alignment.End) {
                Text("Today", color = TextHint, fontSize = 10.sp, letterSpacing = 0.4.sp)
                Spacer(Modifier.height(7.dp))
                AttendanceStatusChip(todayStatus)

                val location = (todayStatus as? TodayAttendanceStatus.Present)?.location
                    ?: (todayStatus as? TodayAttendanceStatus.HalfDay)?.location
                val since = (todayStatus as? TodayAttendanceStatus.Present)?.since?.let { "Since $it" }
                    ?: (todayStatus as? TodayAttendanceStatus.HalfDay)?.since?.let { "Since $it" }

                if (location != null) {
                    Text(location, color = TextSecond, fontSize = 10.sp,
                        modifier = Modifier.padding(top = 5.dp))
                }
                if (since != null) {
                    Text(since, color = TextHint, fontSize = 10.sp,
                        modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
    }
}

@Composable
private fun AttendanceStatusChip(status: TodayAttendanceStatus) {
    val chipBg: Color; val chipFg: Color; val dotColor: Color; val label: String
    when (status) {
        is TodayAttendanceStatus.Present      -> { chipBg = GreenBg; chipFg = GreenText; dotColor = GreenText; label = "Present" }
        is TodayAttendanceStatus.HalfDay      -> { chipBg = AmberBg; chipFg = AmberText; dotColor = AmberText; label = "Half Day" }
        is TodayAttendanceStatus.NotCheckedIn -> { chipBg = RedBg;   chipFg = RedText;   dotColor = RedText;   label = "Not checked in" }
        is TodayAttendanceStatus.Loading      -> { chipBg = Border;  chipFg = TextHint;  dotColor = TextHint;  label = "Loading…" }
        is TodayAttendanceStatus.Error        -> { chipBg = RedBg;   chipFg = RedText;   dotColor = RedText;   label = "Error" }
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(chipBg)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(dotColor))
        Spacer(Modifier.width(5.dp))
        Text(label, color = chipFg, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

// ── Module list ───────────────────────────────────────────────────────────────

@Composable
private fun ModuleList(modules: List<ModuleItem>, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        modules.forEach { module ->
            ModuleTab(module = module)
        }
    }
}

@Composable
private fun ModuleTab(module: ModuleItem) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(module.color)
            .clickable { module.onClick() }
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(module.emoji, fontSize = 20.sp)
        Spacer(Modifier.width(14.dp))
        Text(
            module.label,
            color      = Color.White,
            fontSize   = 15.sp,
            fontWeight = FontWeight.SemiBold,
            modifier   = Modifier.weight(1f)
        )
        Text(
            "›",
            color    = Color.White.copy(alpha = 0.55f),
            fontSize = 22.sp
        )
    }
}

// ── Offline banner ────────────────────────────────────────────────────────────

@Composable
private fun OfflineBannerBar() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF78350F))
            .padding(horizontal = 18.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            "No internet connection",
            color      = Color.White,
            fontSize   = 13.sp,
            fontWeight = FontWeight.Medium
        )
    }
}

// ── Preview ───────────────────────────────────────────────────────────────────

@Preview(showBackground = true)
@Composable
private fun HomeScreenPreview() {
    HomeScreen(
        greeting              = "Good morning",
        userName              = "Raghav Khedar",
        userRole              = "operations",
        todayStatus           = TodayAttendanceStatus.Present("At Home", "8:30 AM"),
        isOperations          = true,
        isAdmin               = false,
        isOnline              = true,
        unreadCount           = 2,
        isLoggingOut          = false,
        onBellClick           = {},
        onLogout              = {},
        onAttendanceClick     = {},
        onMtRequestClick      = {},
        onMtBuyClick          = {},
        onMaterialTransferClick = {},
        onToolTransferClick   = {},
        onWorkProgressClick   = {},
        onLeaveClick          = {},
        onLeaveApprovalsClick = {},
        onRegularizationClick = {}
    )
}
