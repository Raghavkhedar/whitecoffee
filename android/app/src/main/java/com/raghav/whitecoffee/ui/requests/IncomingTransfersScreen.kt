package com.raghav.whitecoffee.ui.requests

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.IncomingTransfer
import com.raghav.whitecoffee.ui.theme.EmptyState
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.WcCard
import com.raghav.whitecoffee.ui.theme.WcPrimaryButton
import com.raghav.whitecoffee.ui.theme.WcTheme
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

@Composable
fun IncomingTransfersScreen(
    state: UiState<List<IncomingTransfer>>,
    isOnline: Boolean,
    onBack: () -> Unit,
    onReceived: (IncomingTransfer) -> Unit,
    onProblem: (IncomingTransfer) -> Unit,
) = WhiteCoffeeTheme {
    RequestScaffold(title = "Incoming Transfers", onBack = onBack, isOnline = isOnline) {
        when (state) {
            is UiState.Loading -> Text("Loading…", color = WcTheme.colors.TextMuted)
            is UiState.Error -> Text(state.message, color = WcTheme.colors.DangerFg)
            is UiState.Empty -> EmptyState(Ms.check_circle, "Nothing to confirm", "Transfers sent to you appear here.")
            is UiState.Success -> state.data.forEach { item ->
                IncomingCard(item, onReceived, onProblem)
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

@Composable
private fun IncomingCard(
    item: IncomingTransfer,
    onReceived: (IncomingTransfer) -> Unit,
    onProblem: (IncomingTransfer) -> Unit,
) {
    val t = item.transfer
    val reported = t.receiptStatus == "problem"
    WcCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(
                if (item.collection == "tool_transfers") "Tool transfer" else "Material transfer",
                color = WcTheme.colors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold,
            )
            Text(
                "${t.fromLocation} → ${t.toLocation} · ${t.transferDate}\nSent by ${t.userName}",
                color = WcTheme.colors.TextSecondary, fontSize = 13.sp,
            )
            Spacer(Modifier.height(8.dp))
            t.items.forEach {
                val details = listOf(it.make, it.spec1, it.spec2, it.condition).filter(String::isNotBlank)
                Text(
                    "• ${it.itemName} — ${it.quantity.toString().removeSuffix(".0")} ${it.unit}" +
                        if (details.isEmpty()) "" else " (${details.joinToString()})",
                    color = WcTheme.colors.TextPrimary, fontSize = 14.sp,
                )
            }
            if (t.notes.isNotBlank()) Text(t.notes, color = WcTheme.colors.TextMuted, fontSize = 12.5.sp)
            if (reported) {
                Spacer(Modifier.height(8.dp))
                Text("Problem reported: ${t.receiptNote}", color = WcTheme.colors.DangerFg, fontSize = 13.sp)
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!reported) {
                    OutlinedButton(onClick = { onProblem(item) }, modifier = Modifier.height(54.dp)) { Text("Problem") }
                }
                WcPrimaryButton(text = "Received", icon = Ms.check_circle, onClick = { onReceived(item) })
            }
        }
    }
}
