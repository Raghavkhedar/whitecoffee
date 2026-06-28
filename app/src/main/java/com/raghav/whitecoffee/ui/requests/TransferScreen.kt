package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.data.model.TransferItem
import com.raghav.whitecoffee.ui.theme.AddItemButton
import com.raghav.whitecoffee.ui.theme.FieldLabel
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.ReadOnlyFieldBox
import com.raghav.whitecoffee.ui.theme.SectionLabel
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcField
import com.raghav.whitecoffee.ui.theme.WcPrimaryButton
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

private data class XferRow(
    val name: String = "", val qty: String = "", val unit: String = "", val condition: String = "",
    val make: String = "", val spec1: String = "", val spec2: String = "",
)

@Composable
fun TransferScreen(
    isTool: Boolean,
    todayDate: String,
    isOnline: Boolean,
    submitting: Boolean,
    error: String?,
    photos: List<Uri>,
    onBack: () -> Unit,
    onAddPhoto: () -> Unit,
    onRemovePhoto: (Uri) -> Unit,
    onSubmit: (from: String, to: String, transferredBy: String, receivedBy: String, items: List<TransferItem>, notes: String) -> Unit,
) = WhiteCoffeeTheme {
    val items = remember { mutableStateListOf(XferRow()) }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var transferredBy by remember { mutableStateOf("") }
    var receivedBy by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }

    RequestScaffold(title = if (isTool) "Tool Transfer" else "Material Transfer", onBack = onBack, isOnline = isOnline) {
        Row(horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            Column(Modifier.weight(1f)) {
                FieldLabel("From"); Spacer(Modifier.height(7.dp))
                WcField(from, { from = it }, placeholder = "Origin", leadingIcon = Ms.warehouse)
            }
            Column(Modifier.weight(1f)) {
                FieldLabel("To"); Spacer(Modifier.height(7.dp))
                WcField(to, { to = it }, placeholder = "Destination", leadingIcon = Ms.apartment)
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            Column(Modifier.weight(1f)) {
                FieldLabel("Handed over by"); Spacer(Modifier.height(7.dp))
                WcField(transferredBy, { transferredBy = it }, placeholder = "Name")
            }
            Column(Modifier.weight(1f)) {
                FieldLabel("Received by"); Spacer(Modifier.height(7.dp))
                WcField(receivedBy, { receivedBy = it }, placeholder = "Name")
            }
        }

        SectionLabel("ITEMS", Modifier.padding(top = 22.dp, bottom = 10.dp))
        items.forEachIndexed { i, row ->
            ItemEditorCard(index = i, removable = items.size > 1, onRemove = { items.removeAt(i) }) {
                WcField(row.name, { items[i] = row.copy(name = it) }, placeholder = "Item name", leadingIcon = if (isTool) Ms.handyman else Ms.inventory_2)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WcField(row.qty, { items[i] = row.copy(qty = it) }, placeholder = "Qty", keyboardType = KeyboardType.Decimal, modifier = Modifier.weight(1f))
                    WcField(row.unit, { items[i] = row.copy(unit = it) }, placeholder = "Unit", modifier = Modifier.weight(1f))
                    WcField(row.condition, { items[i] = row.copy(condition = it) }, placeholder = "Condition", modifier = Modifier.weight(1.4f))
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WcField(row.make, { items[i] = row.copy(make = it) }, placeholder = "Make (opt.)", modifier = Modifier.weight(1f))
                    WcField(row.spec1, { items[i] = row.copy(spec1 = it) }, placeholder = "Spec 1 (opt.)", modifier = Modifier.weight(1f))
                    WcField(row.spec2, { items[i] = row.copy(spec2 = it) }, placeholder = "Spec 2 (opt.)", modifier = Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(10.dp))
        }
        AddItemButton("Add item", onClick = { items.add(XferRow()) })

        Spacer(Modifier.height(18.dp))
        ReadOnlyFieldBox(text = "Transfer date · $todayDate", leadingIcon = Ms.event, leadingTint = WcColors.TextSecondary)

        Spacer(Modifier.height(16.dp))
        FieldLabel("Notes"); Spacer(Modifier.height(9.dp))
        WcField(notes, { notes = it }, placeholder = "Notes (optional)…", singleLine = false, minLines = 2)

        if (!isTool) {
            Spacer(Modifier.height(18.dp))
            FieldLabel("Photos"); Spacer(Modifier.height(9.dp))
            PhotoStrip(photos, onAddPhoto, onRemovePhoto)
        }

        if (error != null) {
            Spacer(Modifier.height(12.dp))
            Text(error, color = WcColors.DangerFg, fontSize = 13.sp)
        }

        Spacer(Modifier.height(22.dp))
        WcPrimaryButton(
            text = "Record transfer", icon = Ms.swap_horiz, loading = submitting, enabled = !submitting,
            onClick = {
                val mapped = items.mapNotNull {
                    val q = it.qty.trim().toDoubleOrNull()
                    if (it.name.isBlank() || q == null) null
                    else TransferItem(it.name.trim(), q, it.unit.trim(), it.condition.trim(), it.spec1.trim(), it.spec2.trim(), it.make.trim())
                }
                onSubmit(from.trim(), to.trim(), transferredBy.trim(), receivedBy.trim(), mapped, notes.trim())
            },
        )
    }
}
