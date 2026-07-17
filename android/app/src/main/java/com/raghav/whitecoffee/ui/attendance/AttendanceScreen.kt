package com.raghav.whitecoffee.ui.attendance

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.ui.attendance.OfficeAttendanceViewModel.OfficeState
import com.raghav.whitecoffee.ui.theme.EmptyState
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.SectionLabel
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcDialog
import com.raghav.whitecoffee.ui.theme.WcField
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

// An action presented inside the teal status card.
private data class AttAction(val label: String, val icon: String, val onClick: () -> Unit)

/**
 * Confirmation for home check-out — shared by the operations and office hosts.
 *
 * home_out is terminal: deriveAttendanceState and deriveOfficeState both close the day for good,
 * and isEventAllowed then rejects every later punch (HOME_IN needs NoRecord, SITE_IN needs
 * HomeCheckedIn). A stray tap therefore costs the employee the rest of their day and can leave
 * them with no scored work events at all, so this is the one attendance action that confirms
 * before it writes.
 */
@Composable
fun HomeOutConfirmDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) = WhiteCoffeeTheme {
    WcDialog(
        title = "End your day?",
        subtitle = "This ends your day. You won't be able to check in again today.",
        confirmText = "End Day",
        onConfirm = onConfirm,
        onDismiss = onDismiss,
    ) {}
}

// ───────────────────────── Operations attendance ─────────────────────────────

@Composable
fun OperationsAttendanceScreen(
    state: UiState<AttendanceState>,
    events: List<AttendanceRecord>,
    isOnline: Boolean,
    error: String?,
    gpsEnabled: Boolean,
    onBack: () -> Unit,
    onEnableGps: () -> Unit,
    onHomeIn: () -> Unit,
    onSiteIn: () -> Unit,
    onMarketIn: () -> Unit,
    onSiteOut: () -> Unit,
    onMarketOut: () -> Unit,
    onHomeOut: () -> Unit,
) = WhiteCoffeeTheme {
    val att = (state as? UiState.Success)?.data
    val title: String
    val sub: String
    val actions: List<AttAction>
    var done = false
    when (att) {
        is AttendanceState.HomeCheckedIn -> {
            title = "At Home"; sub = "Since ${att.record.displayTime()}"
            actions = listOf(
                AttAction("Check in at Site", Ms.apartment, onSiteIn),
                AttAction("Check in at Market", Ms.storefront, onMarketIn),
                AttAction("Check out for the day", Ms.home, onHomeOut),
            )
        }
        is AttendanceState.SiteCheckedIn -> {
            title = "At Site: ${att.record.siteName}"; sub = "Since ${att.record.displayTime()}"
            actions = listOf(
                AttAction("Check in at Market", Ms.storefront, onMarketIn),
                AttAction("Check out from Site", Ms.logout, onSiteOut),
            )
        }
        is AttendanceState.MarketCheckedIn -> {
            title = "At Market: ${att.record.marketName}"; sub = "Since ${att.record.displayTime()}"
            actions = listOf(AttAction("Check out from Market", Ms.logout, onMarketOut))
        }
        is AttendanceState.DayComplete -> {
            title = "Day complete"; sub = "You have checked out for today"; actions = emptyList(); done = true
        }
        else -> {
            title = "Not started"; sub = "Check in from home to begin your day"
            actions = listOf(AttAction("Check in from Home", Ms.login, onHomeIn))
        }
    }

    AttendanceScaffold(onBack = onBack, isOnline = isOnline, gpsEnabled = gpsEnabled, onEnableGps = onEnableGps, events = events) {
        StatusCard(title = title, sub = sub, error = error, done = done) {
            actions.forEach { a ->
                CardActionButton(a.label, a.icon, a.onClick)
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

// ─────────────────────────── Office attendance ───────────────────────────────

@Composable
fun OfficeAttendanceScreen(
    state: OfficeState,
    events: List<AttendanceRecord>,
    isOnline: Boolean,
    gpsEnabled: Boolean,
    onBack: () -> Unit,
    onEnableGps: () -> Unit,
    onHomeIn: () -> Unit,
    onCheckIn: (String) -> Unit,
    onCheckOut: () -> Unit,
    onHomeOut: () -> Unit,
) = WhiteCoffeeTheme {
    var location by remember { mutableStateOf("") }
    val title: String; val sub: String; val error: String?
    when (state) {
        is OfficeState.NotStarted -> { title = "Day not started"; sub = "Check in from home to begin"; error = null }
        is OfficeState.DayStarted -> { title = "Home checked in"; sub = "Since ${state.homeInTime} · Not in office"; error = null }
        is OfficeState.InOffice -> { title = "Checked in"; sub = "At ${state.locationName} · Since ${state.checkInTime}"; error = null }
        is OfficeState.DayEnded -> { title = "Day complete"; sub = "Home out at ${state.homeOutTime}"; error = null }
        is OfficeState.Error -> { title = "Something went wrong"; sub = ""; error = state.message }
        is OfficeState.Loading -> { title = "Loading…"; sub = ""; error = null }
    }

    AttendanceScaffold(onBack = onBack, isOnline = isOnline, gpsEnabled = gpsEnabled, onEnableGps = onEnableGps, events = events) {
        StatusCard(title = title, sub = sub, error = error, done = state is OfficeState.DayEnded) {
            when (state) {
                is OfficeState.NotStarted -> CardActionButton("Start Day — Home In", Ms.home, onHomeIn)
                is OfficeState.DayStarted -> {
                    OnDarkField(value = location, onValueChange = { location = it }, placeholder = "Where are you? (e.g. Head Office)")
                    Spacer(Modifier.height(12.dp))
                    CardActionButton("Office Check In", Ms.login) { onCheckIn(location) }
                    Spacer(Modifier.height(10.dp))
                    OutlinedDarkButton("End Day — Home Out", Ms.logout, onHomeOut)
                }
                is OfficeState.InOffice -> CardActionButton("Office Check Out", Ms.logout, onCheckOut)
                else -> {}
            }
        }
    }
}

// ─────────────────────────── Shared scaffolding ──────────────────────────────

@Composable
private fun AttendanceScaffold(
    onBack: () -> Unit,
    isOnline: Boolean,
    gpsEnabled: Boolean,
    onEnableGps: () -> Unit,
    events: List<AttendanceRecord>,
    card: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().background(WcColors.ScreenBg).verticalScroll(rememberScrollState()),
    ) {
        if (!isOnline) Banner("No internet connection", Color(0xFF78350F))
        if (!gpsEnabled) {
            Row(
                modifier = Modifier.fillMaxWidth().background(Color(0xFF8A1B1B)).padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("GPS is off — required for attendance", color = Color.White, fontSize = 12.5.sp, modifier = Modifier.weight(1f))
                Text("Enable", color = Color.White, fontSize = 12.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { onEnableGps() })
            }
        }
        // Top bar
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 48.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(42.dp).clip(CircleShape).clickable { onBack() }, contentAlignment = Alignment.Center) {
                MsIcon(Ms.arrow_back, 24.sp, Color(0xFF16201F))
            }
            Spacer(Modifier.width(6.dp))
            Text("Attendance", color = WcColors.TextPrimary, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold)
        }

        Box(Modifier.padding(horizontal = 16.dp)) { card() }

        SectionLabel("TODAY'S TIMELINE", Modifier.padding(start = 20.dp, top = 22.dp, bottom = 8.dp))
        if (events.isEmpty()) {
            EmptyState(
                icon = Ms.pin_drop, title = "No events yet",
                subtitle = "Check in to start tracking your day.",
                modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 30.dp),
            )
        } else {
            Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 30.dp)) {
                events.reversed().forEachIndexed { idx, e -> TimelineRow(e, isLast = idx == events.lastIndex) }
            }
        }
    }
}

@Composable
private fun StatusCard(title: String, sub: String, error: String?, done: Boolean, actions: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp).clip(RoundedCornerShape(22.dp))
            .background(Brush.linearGradient(listOf(Color(0xFF00585E), Color(0xFF00868E)))).padding(20.dp),
    ) {
        Text("CURRENT STATUS", color = WcColors.HeaderSub, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.8.sp)
        Spacer(Modifier.height(7.dp))
        Text(title, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        if (sub.isNotBlank()) {
            Spacer(Modifier.height(3.dp))
            Text(sub, color = Color(0xFFCDEFF1), fontSize = 13.sp)
        }
        if (error != null) {
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0x33FFFFFF)).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MsIcon(Ms.info, 18.sp, Color.White)
                Spacer(Modifier.width(8.dp))
                Text(error, color = Color.White, fontSize = 13.sp)
            }
        }
        if (done) {
            Spacer(Modifier.height(16.dp))
            Row(
                Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(15.dp)).background(Color(0x2EFFFFFF)),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                MsIcon(Ms.task_alt, 21.sp, Color.White); Spacer(Modifier.width(8.dp))
                Text("Day complete", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
            }
        } else {
            Spacer(Modifier.height(16.dp))
            actions()
        }
    }
}

// White action button on the teal card.
@Composable
private fun CardActionButton(label: String, icon: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(15.dp)).background(Color.White).clickable { onClick() },
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        MsIcon(icon, 22.sp, Color(0xFF00565C)); Spacer(Modifier.width(9.dp))
        Text(label, color = Color(0xFF00565C), fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun OutlinedDarkButton(label: String, icon: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(15.dp)).background(Color(0x22FFFFFF)).clickable { onClick() },
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        MsIcon(icon, 21.sp, Color.White); Spacer(Modifier.width(8.dp))
        Text(label, color = Color.White, fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold)
    }
}

// A text field that reads well on the teal card.
@Composable
private fun OnDarkField(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    Box(Modifier.clip(RoundedCornerShape(13.dp)).background(Color(0x24FFFFFF)).fillMaxWidth()) {
        WcField(
            value = value, onValueChange = onValueChange, placeholder = placeholder,
        )
    }
}

@Composable
private fun TimelineRow(e: AttendanceRecord, isLast: Boolean) {
    val (icon, tileBg, tileFg, title) = timelineDisplay(e)
    Row {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(38.dp).clip(CircleShape).background(tileBg), contentAlignment = Alignment.Center) {
                MsIcon(icon, 20.sp, tileFg)
            }
            if (!isLast) Spacer(Modifier.width(2.dp).height(24.dp).background(Color(0xFFDDE6E6)))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f).padding(bottom = 18.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Text(title, color = WcColors.TextPrimary, fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                Text(e.displayTime(), color = WcColors.TextHint, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
            val detail = timelineSub(e)
            if (detail.isNotBlank()) Text(detail, color = WcColors.TextHint, fontSize = 12.5.sp, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

private data class TimelineDisplay(val icon: String, val bg: Color, val fg: Color, val title: String)

private fun timelineDisplay(e: AttendanceRecord): TimelineDisplay {
    val green = Color(0xFFC7F0D2) to Color(0xFF0A5132)
    val grey = Color(0xFFE6EDED) to Color(0xFF41494A)
    return when (e.type) {
        AttendanceType.HOME_IN -> TimelineDisplay(Ms.home, green.first, green.second, "Checked in — Home")
        AttendanceType.HOME_OUT -> TimelineDisplay(Ms.home, Color(0xFFA7EEF3), Color(0xFF00474C), "Checked out — Home")
        AttendanceType.SITE_IN -> TimelineDisplay(Ms.apartment, green.first, green.second, if (e.siteName.isNotBlank()) "Arrived — ${e.siteName}" else "Arrived at Site")
        AttendanceType.SITE_OUT -> TimelineDisplay(Ms.logout, grey.first, grey.second, if (e.siteName.isNotBlank()) "Left — ${e.siteName}" else "Left Site")
        AttendanceType.MARKET_IN -> TimelineDisplay(Ms.storefront, green.first, green.second, if (e.marketName.isNotBlank()) "Arrived — ${e.marketName}" else "Arrived at Market")
        AttendanceType.MARKET_OUT -> TimelineDisplay(Ms.logout, grey.first, grey.second, if (e.marketName.isNotBlank()) "Left — ${e.marketName}" else "Left Market")
        AttendanceType.OFFICE_IN -> TimelineDisplay(Ms.login, green.first, green.second, "Checked In")
        AttendanceType.OFFICE_OUT -> TimelineDisplay(Ms.logout, grey.first, grey.second, "Checked Out")
        else -> TimelineDisplay(Ms.schedule, grey.first, grey.second, e.type)
    }
}

private fun timelineSub(e: AttendanceRecord): String = when (e.type) {
    AttendanceType.OFFICE_IN, AttendanceType.OFFICE_OUT -> if (e.locationName.isNotBlank()) e.locationName else "GPS recorded"
    else -> "GPS recorded"
}

@Composable
private fun Banner(text: String, bg: Color) {
    Box(Modifier.fillMaxWidth().background(bg).padding(horizontal = 18.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
        Text(text, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}
