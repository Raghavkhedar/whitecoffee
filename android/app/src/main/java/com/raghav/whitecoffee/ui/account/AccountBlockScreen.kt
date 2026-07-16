package com.raghav.whitecoffee.ui.account

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.data.model.AccountStatus
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

/**
 * Full-screen, non-dismissable overlay shown while the account is suspended. It is an overlay
 * (not a navigation destination) so that when the admin restores the account the caller simply
 * stops rendering it and the user is exactly where they were — auto-lift, no re-login.
 */
@Composable
fun AccountSuspendedBlock(status: AccountStatus.Suspended) = WhiteCoffeeTheme {
    Column(
        modifier = Modifier.fillMaxSize().background(WcColors.ScreenBg).padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier.size(84.dp).clip(CircleShape).background(Color(0xFFFFDAD6)),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) { MsIcon(Ms.info, 40.sp, Color(0xFFBA1A1A)) }

        Spacer(Modifier.height(20.dp))
        Text("Account suspended", color = WcColors.TextPrimary, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)

        if (status.reason.isNotBlank()) {
            Spacer(Modifier.height(10.dp))
            Text(status.reason, color = WcColors.TextSecondary, fontSize = 15.sp, textAlign = TextAlign.Center)
        }
        if (status.expectedReturn.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text("Expected return: ${status.expectedReturn}", color = WcColors.TextMuted, fontSize = 13.sp)
        }

        Spacer(Modifier.height(20.dp))
        Text(
            "Please contact your administrator. Your access will return automatically once restored.",
            color = WcColors.TextMuted, fontSize = 13.sp, textAlign = TextAlign.Center,
        )
    }
}
