package com.raghav.whitecoffee.ui.attendance

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.LeaveCoverage
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.data.model.approvalCoverage
import com.raghav.whitecoffee.data.model.formatGrantedDates
import com.raghav.whitecoffee.ui.theme.EmptyState
import com.raghav.whitecoffee.ui.theme.FieldLabel
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.ReadOnlyFieldBox
import com.raghav.whitecoffee.ui.theme.StatusBadge
import com.raghav.whitecoffee.ui.theme.WcCard
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcField
import com.raghav.whitecoffee.ui.theme.WcPrimaryButton
import com.raghav.whitecoffee.ui.theme.WcTopBar
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

internal fun leaveStatusColors(status: String): Triple<Color, Color, String> = when (status.lowercase()) {
    "approved" -> Triple(WcColors.SuccessBg, WcColors.SuccessFg, "Approved")
    "rejected" -> Triple(WcColors.DangerBg, WcColors.DangerFg, "Rejected")
    else -> Triple(WcColors.WarnBg, WcColors.WarnFg, "Pending")
}

/**
 * Status badge for a leave request, with the partial case split out. Still an approval, so
 * it keeps the approved colours — only the label and the granted-dates line differ.
 */
internal fun leaveStatusBadge(l: LeaveRequest): Triple<Color, Color, String> =
    if (l.approvalCoverage().isPartial) {
        Triple(WcColors.SuccessBg, WcColors.SuccessFg, "Partially Approved")
    } else {
        leaveStatusColors(l.status)
    }

/** "3 of 5 days granted · 21, 22, 24 Jul" — only rendered for a partial approval. */
@Composable
private fun GrantedDatesRow(coverage: LeaveCoverage) {
    Spacer(Modifier.height(6.dp))
    Row(verticalAlignment = Alignment.Top) {
        MsIcon(Ms.task_alt, 15.sp, WcColors.SuccessFg)
        Spacer(Modifier.width(6.dp))
        Text(
            "${coverage.grantedDays} of ${coverage.requestedDays} days granted" +
                formatGrantedDates(coverage.grantedDates).let { if (it.isBlank()) "" else " · $it" },
            color = WcColors.SuccessFg,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.SemiBold,
            lineHeight = 17.sp,
        )
    }
}

@Composable
fun LeaveScreen(
    leavesState: UiState<List<LeaveRequest>>,
    applyState: UiState<String>,
    applicantName: String,
    fromDate: String,
    toDate: String,
    joiningDate: String,
    emergencyContact: String,
    placeOfVisit: String,
    totalDays: Int,
    error: String?,
    onBack: () -> Unit,
    onPickFrom: () -> Unit,
    onPickTo: () -> Unit,
    onPickJoiningDate: () -> Unit,
    onEmergencyContactChange: (String) -> Unit,
    onPlaceOfVisitChange: (String) -> Unit,
    onSubmit: (reason: String) -> Unit,
) = WhiteCoffeeTheme {
    var tab by remember { mutableIntStateOf(0) }
    var reason by remember { mutableStateOf("") }

    LaunchedEffect(applyState) { if (applyState is UiState.Success) { tab = 1; reason = "" } }

    Column(Modifier.fillMaxSize().background(WcColors.ScreenBg)) {
        WcTopBar("Leave", onBack)
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                .clip(RoundedCornerShape(13.dp)).background(Color(0xFFE6EEEE)).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            TabPill("Apply", tab == 0, Modifier.weight(1f)) { tab = 0 }
            TabPill("History", tab == 1, Modifier.weight(1f)) { tab = 1 }
        }

        if (tab == 0) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 18.dp)
                    .padding(top = 8.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column {
                    FieldLabel("Applicant Name")
                    Spacer(Modifier.height(7.dp))
                    ReadOnlyFieldBox(
                        text = applicantName.ifBlank { "—" },
                        leadingIcon = Ms.verified_user,
                    )
                }

                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                    Column(Modifier.weight(1f)) {
                        FieldLabel("Leave Start Date")
                        Spacer(Modifier.height(7.dp))
                        DateBox(fromDate.ifBlank { "Select" }, onPickFrom)
                    }
                    Column(Modifier.weight(1f)) {
                        FieldLabel("Leave End Date")
                        Spacer(Modifier.height(7.dp))
                        DateBox(toDate.ifBlank { "Select" }, onPickTo)
                    }
                }

                if (totalDays > 0) {
                    Row(
                        modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(Color(0xFFFFD7E0)).padding(horizontal = 13.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        MsIcon(Ms.schedule, 16.sp, Color(0xFF8A1B43))
                        Spacer(Modifier.width(7.dp))
                        Text(
                            "$totalDays day${if (totalDays != 1) "s" else ""} total",
                            color = Color(0xFF8A1B43),
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.ExtraBold,
                        )
                    }
                }

                Column {
                    FieldLabel("Joining Date")
                    Spacer(Modifier.height(7.dp))
                    DateBox(joiningDate.ifBlank { "Select" }, onPickJoiningDate)
                }

                Column {
                    FieldLabel("Emergency Contact No.")
                    Spacer(Modifier.height(7.dp))
                    WcField(
                        value = emergencyContact,
                        onValueChange = onEmergencyContactChange,
                        placeholder = "Contact number",
                        keyboardType = KeyboardType.Phone,
                    )
                }

                Column {
                    FieldLabel("Place of Visit")
                    Spacer(Modifier.height(7.dp))
                    WcField(
                        value = placeOfVisit,
                        onValueChange = onPlaceOfVisitChange,
                        placeholder = "Where will you be?",
                        leadingIcon = Ms.location_on,
                    )
                }

                Column {
                    FieldLabel("Reason for Leave")
                    Spacer(Modifier.height(7.dp))
                    WcField(
                        value = reason,
                        onValueChange = { reason = it },
                        placeholder = "Describe your reason…",
                        singleLine = false,
                        minLines = 3,
                    )
                }

                if (error != null) {
                    Text(error, color = WcColors.DangerFg, fontSize = 13.sp)
                }

                WcPrimaryButton(
                    text = "Apply for Leave",
                    icon = Ms.send,
                    loading = applyState is UiState.Loading,
                    enabled = applyState !is UiState.Loading,
                    onClick = { onSubmit(reason) },
                )
            }
        } else {
            LeaveHistoryList(leavesState)
        }
    }
}

@Composable
private fun LeaveHistoryList(state: UiState<List<LeaveRequest>>) {
    when (state) {
        is UiState.Success -> LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            items(state.data) { LeaveHistoryCard(it) }
        }
        is UiState.Empty -> Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
            EmptyState(Ms.event_busy, "No leave yet", "Your leave requests will appear here.")
        }
        is UiState.Error -> Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
            Text(state.message, color = WcColors.DangerFg, fontSize = 13.sp)
        }
        else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Loading…", color = WcColors.TextMuted, fontSize = 13.sp)
        }
    }
}

@Composable
private fun LeaveHistoryCard(l: LeaveRequest) {
    val (bg, fg, label) = leaveStatusBadge(l)
    val coverage = l.approvalCoverage()
    WcCard(Modifier.fillMaxWidth(), radius = 18) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    l.leaveType.ifBlank { "Leave Application" },
                    color = WcColors.TextPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.weight(1f),
                )
                StatusBadge(label, bg, fg)
            }
            Spacer(Modifier.height(9.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                MsIcon(Ms.date_range, 17.sp, WcColors.TextMuted)
                Spacer(Modifier.width(8.dp))
                Text(
                    "${l.fromDate} → ${l.toDate} · ${l.totalDays} day${if (l.totalDays != 1) "s" else ""}",
                    color = WcColors.TextSecondary,
                    fontSize = 13.sp,
                )
            }
            if (coverage.isPartial) GrantedDatesRow(coverage)
            if (l.placeOfVisit.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MsIcon(Ms.location_on, 15.sp, WcColors.TextMuted)
                    Spacer(Modifier.width(6.dp))
                    Text(l.placeOfVisit, color = WcColors.TextSecondary, fontSize = 12.5.sp)
                }
            }
        }
    }
}

@Composable
fun LeaveApprovalsScreen(
    state: UiState<List<LeaveRequest>>,
    onBack: () -> Unit,
    onApprove: (LeaveRequest) -> Unit,
    onReject: (LeaveRequest) -> Unit,
    onRetry: () -> Unit,
) = WhiteCoffeeTheme {
    Column(Modifier.fillMaxSize().background(WcColors.ScreenBg)) {
        WcTopBar("Leave Approvals", onBack)
        val list = (state as? UiState.Success)?.data.orEmpty()
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 18.dp, end = 18.dp, top = 4.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(13.dp),
        ) {
            item {
                val count = list.size
                val suffix = if (count != 1) "s" else ""
                Text(
                    "$count pending request$suffix",
                    color = WcColors.TextSecondary,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(bottom = 2.dp),
                )
            }
            items(list) { ApprovalCard(it, onApprove, onReject) }
            if (state is UiState.Empty) item {
                EmptyState(Ms.task_alt, "All caught up", "No pending leave requests.", iconTint = WcColors.SuccessFg)
            }
            if (state is UiState.Error) item {
                Column(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(state.message, color = WcColors.DangerFg, fontSize = 13.sp)
                    Spacer(Modifier.height(10.dp))
                    Text("Retry", color = WcColors.Primary, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { onRetry() })
                }
            }
            if (state is UiState.Offline) item {
                EmptyState(Ms.info, "Offline", "Connect to load pending requests.")
            }
        }
    }
}

@Composable
private fun ApprovalCard(a: LeaveRequest, onApprove: (LeaveRequest) -> Unit, onReject: (LeaveRequest) -> Unit) {
    val initials = a.userName.split(" ").mapNotNull { it.firstOrNull()?.toString() }.take(2).joinToString("").uppercase()
    val coverage = a.approvalCoverage()
    val isPending = a.status.equals("pending", ignoreCase = true)
    WcCard(Modifier.fillMaxWidth(), radius = 18) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(42.dp).clip(CircleShape).background(WcColors.Accent), contentAlignment = Alignment.Center) {
                    Text(initials, color = WcColors.OnAccent, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                }
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f)) {
                    Text(a.userName, color = WcColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                    Text(a.employeeId, color = WcColors.TextMuted, fontSize = 12.sp)
                }
                if (!isPending) {
                    // Already actioned — the outcome replaces the (absent) action buttons.
                    val (bg, fg, label) = leaveStatusBadge(a)
                    StatusBadge(label, bg, fg)
                } else if (a.leaveType.isNotBlank()) {
                    Box(
                        Modifier.clip(RoundedCornerShape(8.dp)).background(Color(0xFFFFD7E0)).padding(horizontal = 10.dp, vertical = 5.dp)
                    ) {
                        Text(a.leaveType, color = Color(0xFF8A1B43), fontSize = 11.sp, fontWeight = FontWeight.ExtraBold)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                MsIcon(Ms.date_range, 17.sp, WcColors.TextMuted)
                Spacer(Modifier.width(8.dp))
                Text(
                    "${a.fromDate} → ${a.toDate} · ${a.totalDays} day${if (a.totalDays != 1) "s" else ""}",
                    color = WcColors.TextSecondary,
                    fontSize = 13.sp,
                )
            }
            if (coverage.isPartial) GrantedDatesRow(coverage)
            if (a.placeOfVisit.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MsIcon(Ms.location_on, 15.sp, WcColors.TextMuted)
                    Spacer(Modifier.width(6.dp))
                    Text(a.placeOfVisit, color = WcColors.TextSecondary, fontSize = 12.5.sp)
                }
            }
            if (a.emergencyContact.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text("Emergency: ${a.emergencyContact}", color = WcColors.TextMuted, fontSize = 12.sp)
            }
            if (a.reason.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(WcColors.FieldFill).padding(horizontal = 13.dp, vertical = 11.dp)
                ) {
                    Text(
                        "“${a.reason}”",
                        color = WcColors.TextOnReason,
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                    )
                }
            }
            if (isPending) {
                Spacer(Modifier.height(13.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlineActionButton("Reject", Ms.close, WcColors.DangerFg, Color(0xFFE2C4C4), Modifier.weight(1f)) { onReject(a) }
                    FilledActionButton("Approve", Ms.check, Color(0xFF2E7D55), Modifier.weight(1f)) { onApprove(a) }
                }
            }
        }
    }
}

@Composable
private fun TabPill(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier.clip(RoundedCornerShape(10.dp))
            .background(if (selected) Color.White else Color.Transparent).clickable { onClick() }
            .padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (selected) WcColors.Primary else WcColors.TextSecondary, fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun DateBox(text: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(WcColors.Surface)
            .border(1.5.dp, WcColors.Border, RoundedCornerShape(14.dp)).clickable { onClick() }.padding(13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MsIcon(Ms.event, 18.sp, Color(0xFF8A1B43))
        Spacer(Modifier.width(8.dp))
        Text(text, color = WcColors.TextPrimary, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun OutlineActionButton(label: String, icon: String, fg: Color, border: Color, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier = modifier.height(44.dp).clip(RoundedCornerShape(13.dp)).border(1.5.dp, border, RoundedCornerShape(13.dp)).clickable { onClick() },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MsIcon(icon, 18.sp, fg)
        Spacer(Modifier.width(6.dp))
        Text(label, color = fg, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun FilledActionButton(label: String, icon: String, bg: Color, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier = modifier.height(44.dp).clip(RoundedCornerShape(13.dp)).background(bg).clickable { onClick() },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MsIcon(icon, 18.sp, Color.White)
        Spacer(Modifier.width(6.dp))
        Text(label, color = Color.White, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold)
    }
}
