package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.ui.theme.FieldLabel
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.ReadOnlyFieldBox
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcField
import com.raghav.whitecoffee.ui.theme.WcPrimaryButton
import com.raghav.whitecoffee.ui.theme.WcTiles
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

@Composable
fun WorkProgressScreen(
    date: String,
    isOnline: Boolean,
    submitting: Boolean,
    error: String?,
    photos: List<Uri>,
    onBack: () -> Unit,
    onPickDate: () -> Unit,
    onAddPhoto: () -> Unit,
    onRemovePhoto: (Uri) -> Unit,
    onSubmit: (siteId: String, siteName: String, hours: Double, description: String) -> Unit,
) = WhiteCoffeeTheme {
    var siteName by remember { mutableStateOf("") }
    var siteId by remember { mutableStateOf("") }
    var hours by remember { mutableStateOf(7.5) }
    var description by remember { mutableStateOf("") }

    RequestScaffold(title = "Work Progress", onBack = onBack, isOnline = isOnline) {
        Row(horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            Column(Modifier.weight(1f)) {
                FieldLabel("Site Name"); Spacer(Modifier.height(7.dp))
                WcField(siteName, { siteName = it }, placeholder = "e.g. Tower B", leadingIcon = Ms.apartment)
            }
            Column(Modifier.weight(1f)) {
                FieldLabel("Date"); Spacer(Modifier.height(7.dp))
                ReadOnlyFieldBox(text = date, leadingIcon = Ms.event, leadingTint = WcColors.TextSecondary, onClick = onPickDate)
            }
        }
        Spacer(Modifier.height(12.dp))
        FieldLabel("Site ID (optional)"); Spacer(Modifier.height(7.dp))
        WcField(siteId, { siteId = it }, placeholder = "e.g. Site-001")

        Spacer(Modifier.height(18.dp))
        FieldLabel("Hours worked"); Spacer(Modifier.height(9.dp))
        Row(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(WcColors.Surface)
                .border(1.5.dp, WcColors.Border, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StepButton(Ms.remove) { if (hours > 0.5) hours -= 0.5 }
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.Bottom) {
                Text("%.1f".format(hours), color = WcColors.TextPrimary, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.size(4.dp))
                Text("hrs", color = WcColors.TextMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 2.dp))
            }
            StepButton(Ms.add) { hours += 0.5 }
        }

        Spacer(Modifier.height(18.dp))
        FieldLabel("Work description"); Spacer(Modifier.height(9.dp))
        WcField(description, { description = it }, placeholder = "What was accomplished today…", singleLine = false, minLines = 4)

        Spacer(Modifier.height(18.dp))
        FieldLabel("Photos"); Spacer(Modifier.height(9.dp))
        PhotoStrip(photos, onAddPhoto, onRemovePhoto)

        if (error != null) {
            Spacer(Modifier.height(12.dp))
            Text(error, color = WcColors.DangerFg, fontSize = 13.sp)
        }

        Spacer(Modifier.height(24.dp))
        WcPrimaryButton(
            text = "Submit report", icon = Ms.send, loading = submitting, enabled = !submitting,
            onClick = { onSubmit(siteId.trim(), siteName.trim(), hours, description.trim()) },
        )
    }
}

@Composable
private fun StepButton(icon: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier.size(36.dp).clip(CircleShape).background(WcTiles.Work.bg).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) { MsIcon(icon, 20.sp, WcTiles.Work.fg) }
}
