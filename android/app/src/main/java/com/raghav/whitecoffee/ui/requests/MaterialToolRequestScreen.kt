package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import com.raghav.whitecoffee.data.model.RequestItem
import com.raghav.whitecoffee.ui.theme.AddItemButton
import com.raghav.whitecoffee.ui.theme.FieldLabel
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.SectionLabel
import com.raghav.whitecoffee.ui.theme.WcCard
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcField
import com.raghav.whitecoffee.ui.theme.WcPrimaryButton
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

internal data class ReqRow(
    val name: String = "", val qty: String = "", val unit: String = "",
    val spec1: String = "", val spec2: String = "", val notes: String = "",
)

@Composable
fun MaterialToolRequestScreen(
    isOnline: Boolean,
    submitting: Boolean,
    error: String?,
    photos: List<Uri>,
    onBack: () -> Unit,
    onAddPhoto: () -> Unit,
    onRemovePhoto: (Uri) -> Unit,
    onSubmit: (siteId: String, siteName: String, items: List<RequestItem>, notes: String) -> Unit,
) = WhiteCoffeeTheme {
    val items = remember { mutableStateListOf(ReqRow()) }
    var siteName by remember { mutableStateOf("") }
    var siteId by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }

    RequestScaffold(title = "M&T Request", onBack = onBack, isOnline = isOnline) {
        FieldLabel("Site Name")
        Spacer(Modifier.height(7.dp))
        WcField(siteName, { siteName = it }, placeholder = "e.g. Skyline Tower B", leadingIcon = Ms.apartment)
        Spacer(Modifier.height(12.dp))
        FieldLabel("Site ID (optional)")
        Spacer(Modifier.height(7.dp))
        WcField(siteId, { siteId = it }, placeholder = "e.g. Site-001")

        Row(Modifier.fillMaxWidth().padding(top = 22.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            SectionLabel("ITEMS", Modifier.weight(1f))
            Text("${items.size} added", color = WcColors.TextMuted, fontSize = 12.sp)
        }
        items.forEachIndexed { i, row ->
            ItemEditorCard(index = i, removable = items.size > 1, onRemove = { items.removeAt(i) }) {
                WcField(row.name, { items[i] = row.copy(name = it) }, placeholder = "Item name", leadingIcon = Ms.inventory_2)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                    WcField(row.qty, { items[i] = row.copy(qty = it) }, placeholder = "Qty", keyboardType = KeyboardType.Decimal, modifier = Modifier.weight(1f))
                    WcField(row.unit, { items[i] = row.copy(unit = it) }, placeholder = "Unit", modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                    WcField(row.spec1, { items[i] = row.copy(spec1 = it) }, placeholder = "Spec 1 (opt.)", modifier = Modifier.weight(1f))
                    WcField(row.spec2, { items[i] = row.copy(spec2 = it) }, placeholder = "Spec 2 (opt.)", modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                WcField(row.notes, { items[i] = row.copy(notes = it) }, placeholder = "Notes (optional)")
            }
            Spacer(Modifier.height(10.dp))
        }
        AddItemButton("Add item", onClick = { items.add(ReqRow()) })

        Spacer(Modifier.height(22.dp))
        FieldLabel("Notes")
        Spacer(Modifier.height(9.dp))
        WcField(notes, { notes = it }, placeholder = "Overall notes…", singleLine = false, minLines = 3)

        Spacer(Modifier.height(22.dp))
        FieldLabel("Photos")
        Spacer(Modifier.height(9.dp))
        PhotoStrip(photos, onAddPhoto, onRemovePhoto)

        if (error != null) {
            Spacer(Modifier.height(12.dp))
            Text(error, color = WcColors.DangerFg, fontSize = 13.sp)
        }

        Spacer(Modifier.height(24.dp))
        WcPrimaryButton(
            text = "Submit request", icon = Ms.send, loading = submitting, enabled = !submitting,
            onClick = {
                val mapped = items.mapNotNull {
                    val q = it.qty.trim().toDoubleOrNull()
                    if (it.name.isBlank() || q == null) null
                    else RequestItem(it.name.trim(), q, it.unit.trim(), it.spec1.trim(), it.spec2.trim(), it.notes.trim())
                }
                onSubmit(siteId.trim(), siteName.trim(), mapped, notes.trim())
            },
        )
    }
}

@Composable
internal fun ItemEditorCard(index: Int, removable: Boolean, onRemove: () -> Unit, fields: @Composable () -> Unit) {
    WcCard(Modifier.fillMaxWidth(), radius = 16) {
        Column(Modifier.padding(13.dp)) {
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Item ${index + 1}", color = WcColors.TextSecondary, fontSize = 12.sp,
                    fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f),
                )
                if (removable) {
                    Text(
                        "Remove", color = WcColors.DangerFg, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable { onRemove() }.padding(4.dp),
                    )
                }
            }
            fields()
        }
    }
}
