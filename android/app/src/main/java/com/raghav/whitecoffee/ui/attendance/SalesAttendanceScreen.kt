package com.raghav.whitecoffee.ui.attendance

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.ui.theme.IconTile
import com.raghav.whitecoffee.ui.theme.InfoBanner
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcTile
import com.raghav.whitecoffee.ui.theme.WcTiles
import com.raghav.whitecoffee.ui.theme.WcTopBar
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

/**
 * Sales attendance — a per-day chooser between the two existing attendance flows.
 *
 * Sales is a true hybrid role: on any given day the user does EITHER an office day
 * (Home → Office → Home, `office_in`/`office_out`) OR a site-visit day (Home → Site/Market → Home,
 * `site_in`/`site_out`). Rather than rewrite either flow, this screen simply surfaces both entry
 * points and routes to the existing [OfficeAttendanceScreen] / [OperationsAttendanceScreen] hosts,
 * which own all the check-in/out logic. Daily status is scored on the fixed 10–18 window over the
 * first check-in / last check-out of ANY type (see RoleCapabilities + AttendanceStatusRules).
 */
@Composable
fun SalesAttendanceScreen(
    onBack: () -> Unit,
    onOfficeDay: () -> Unit,
    onSiteVisit: () -> Unit,
) = WhiteCoffeeTheme {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(WcColors.ScreenBg)
            .verticalScroll(rememberScrollState()),
    ) {
        WcTopBar(title = "Attendance", onBack = onBack)

        Column(modifier = Modifier.padding(horizontal = 18.dp)) {
            InfoBanner(
                text = "Choose how you're working today. Pick Office for an office day, or Site Visit " +
                    "when you're out meeting a customer or at a site.",
                bg = WcColors.Accent,
                fg = WcColors.OnAccent,
            )
            Spacer(Modifier.height(18.dp))

            OptionCard(
                title = "Office Day",
                subtitle = "Check in / out at the office (Home → Office → Home)",
                icon = Ms.apartment,
                tile = WcTiles.Attendance,
                onClick = onOfficeDay,
            )
            Spacer(Modifier.height(14.dp))
            OptionCard(
                title = "Site Visit",
                subtitle = "Out for a customer or site visit (Home → Site / Market → Home)",
                icon = Ms.storefront,
                tile = WcTiles.MaterialXfer,
                onClick = onSiteVisit,
            )
        }
    }
}

@Composable
private fun OptionCard(
    title: String,
    subtitle: String,
    icon: String,
    tile: WcTile,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(WcColors.Surface)
            .border(1.dp, WcColors.BorderSoft, RoundedCornerShape(20.dp))
            .clickable { onClick() }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(icon, tile, size = 50, radius = 16, iconSize = 26)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = WcColors.TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
            Text(
                subtitle,
                color = WcColors.TextHint,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 3.dp),
                lineHeight = 16.sp,
            )
        }
        Spacer(Modifier.width(10.dp))
        MsIcon(Ms.arrow_forward, 22.sp, WcColors.TextMuted)
    }
}

@Preview(showBackground = true)
@Composable
private fun SalesAttendanceScreenPreview() {
    SalesAttendanceScreen(onBack = {}, onOfficeDay = {}, onSiteVisit = {})
}
