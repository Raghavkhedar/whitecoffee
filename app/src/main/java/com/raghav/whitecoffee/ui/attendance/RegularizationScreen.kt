package com.raghav.whitecoffee.ui.attendance

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import com.raghav.whitecoffee.ui.theme.EmptyState
import com.raghav.whitecoffee.ui.theme.InfoBanner
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.SectionLabel
import com.raghav.whitecoffee.ui.theme.StatusBadge
import com.raghav.whitecoffee.ui.theme.WcCard
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcPrimaryButton
import com.raghav.whitecoffee.ui.theme.WcTopBar
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

@Composable
fun RegularizationScreen(
    state: UiState<List<RegularizationDayItem>>,
    todayLabel: String,
    onBack: () -> Unit,
    onRequest: (RegularizationDayItem) -> Unit,
    onRetry: () -> Unit,
) = WhiteCoffeeTheme {
    Column(Modifier.fillMaxSize().background(WcColors.ScreenBg)) {
        WcTopBar("Regularization", onBack)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 32.dp)) {
            InfoBanner(
                text = "Missed a punch or wrong location? Request a correction and an admin will review it.",
                bg = Color(0xFFDDDFFF), fg = Color(0xFF2A2A8A),
            )
            Spacer(Modifier.height(8.dp))
            Text(todayLabel, color = WcColors.TextMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp))

            when (state) {
                is UiState.Success -> {
                    SectionLabel("FLAGGED DAYS", Modifier.padding(top = 14.dp, bottom = 10.dp))
                    state.data.forEach { item ->
                        FlaggedDayCard(item, onRequest)
                        Spacer(Modifier.height(11.dp))
                    }
                }
                is UiState.Empty -> {
                    Spacer(Modifier.height(20.dp))
                    EmptyState(Ms.task_alt, "On track", "Today's attendance is on track — no action needed.", iconTint = WcColors.SuccessFg)
                }
                is UiState.Error -> {
                    Spacer(Modifier.height(20.dp))
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(state.message, color = WcColors.DangerFg, fontSize = 13.sp)
                        Spacer(Modifier.height(10.dp))
                        Text("Retry", color = WcColors.Primary, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(WcColors.Accent).clickable { onRetry() }.padding(horizontal = 14.dp, vertical = 8.dp))
                    }
                }
                is UiState.Offline -> {
                    Spacer(Modifier.height(20.dp))
                    EmptyState(Ms.info, "Offline", "Connect to load your attendance.")
                }
                else -> {
                    Spacer(Modifier.height(40.dp))
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Loading…", color = WcColors.TextMuted, fontSize = 13.sp) }
                }
            }
        }
    }
}

@Composable
private fun FlaggedDayCard(item: RegularizationDayItem, onRequest: (RegularizationDayItem) -> Unit) {
    WcCard(Modifier.fillMaxWidth(), radius = 16) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFDDDFFF)), contentAlignment = Alignment.Center) {
                    MsIcon(Ms.event_repeat, 20.sp, Color(0xFF2A2A8A))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("${item.dayOfWeek} · ${item.date}", color = WcColors.TextPrimary, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                    Text("Auto-marked: ${item.originalStatus}", color = WcColors.TextMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
                }
                val req = item.request
                if (req != null) {
                    val (bg, fg, label) = leaveStatusColors(req.status)
                    StatusBadge(label, bg, fg)
                }
            }
            if (item.request == null) {
                Spacer(Modifier.height(13.dp))
                WcPrimaryButton(text = "Request correction", icon = Ms.send, onClick = { onRequest(item) })
            } else {
                val req = item.request
                if (req.status == "approved" && req.approvedStatus.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        MsIcon(Ms.check_circle, 15.sp, WcColors.SuccessFg)
                        Spacer(Modifier.width(6.dp))
                        Text("Marked as ${req.approvedStatus}", color = WcColors.SuccessFg, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                    }
                }
                if (req.approverComment.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(WcColors.FieldFill).padding(horizontal = 13.dp, vertical = 11.dp)) {
                        Text(req.approverComment, color = WcColors.TextOnReason, fontSize = 13.sp)
                    }
                } else if (req.reason.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(WcColors.FieldFill).padding(horizontal = 13.dp, vertical = 11.dp)) {
                        Text(req.reason, color = WcColors.TextOnReason, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}