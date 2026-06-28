package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.data.model.PurchaseItem
import com.raghav.whitecoffee.ui.theme.AddItemButton
import com.raghav.whitecoffee.ui.theme.FieldLabel
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.SectionLabel
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcField
import com.raghav.whitecoffee.ui.theme.WcPrimaryButton
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

private data class BuyRow(val name: String = "", val qty: String = "", val unit: String = "", val price: String = "")

@Composable
fun MaterialToolBuyScreen(
    isOnline: Boolean,
    submitting: Boolean,
    error: String?,
    photos: List<Uri>,
    onBack: () -> Unit,
    onAddPhoto: () -> Unit,
    onRemovePhoto: (Uri) -> Unit,
    onSubmit: (siteId: String, siteName: String, items: List<PurchaseItem>, notes: String) -> Unit,
) = WhiteCoffeeTheme {
    val items = remember { mutableStateListOf(BuyRow()) }
    var siteName by remember { mutableStateOf("") }
    var siteId by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }

    fun lineTotal(r: BuyRow): Double = (r.qty.toDoubleOrNull() ?: 0.0) * (r.price.toDoubleOrNull() ?: 0.0)
    val grandTotal = items.sumOf { lineTotal(it) }

    RequestScaffold(title = "M&T Buy", onBack = onBack, isOnline = isOnline) {
        FieldLabel("Site Name")
        Spacer(Modifier.height(7.dp))
        WcField(siteName, { siteName = it }, placeholder = "e.g. Skyline Tower B", leadingIcon = Ms.apartment)
        Spacer(Modifier.height(12.dp))
        FieldLabel("Site ID (optional)")
        Spacer(Modifier.height(7.dp))
        WcField(siteId, { siteId = it }, placeholder = "e.g. Site-001")

        SectionLabel("PURCHASED ITEMS", Modifier.padding(top = 22.dp, bottom = 10.dp))
        items.forEachIndexed { i, row ->
            ItemEditorCard(index = i, removable = items.size > 1, onRemove = { items.removeAt(i) }) {
                WcField(row.name, { items[i] = row.copy(name = it) }, placeholder = "Item name", leadingIcon = Ms.shopping_bag)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WcField(row.qty, { items[i] = row.copy(qty = it) }, placeholder = "Qty", keyboardType = KeyboardType.Decimal, modifier = Modifier.weight(1f))
                    WcField(row.unit, { items[i] = row.copy(unit = it) }, placeholder = "Unit", modifier = Modifier.weight(1f))
                    WcField(row.price, { items[i] = row.copy(price = it) }, placeholder = "₹/unit", keyboardType = KeyboardType.Decimal, modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(6.dp))
                Text("₹%,.2f".format(lineTotal(row)), color = WcColors.SuccessFg, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.fillMaxWidth().padding(end = 4.dp), textAlign = androidx.compose.ui.text.style.TextAlign.End)
            }
            Spacer(Modifier.height(10.dp))
        }
        AddItemButton("Add purchase", onClick = { items.add(BuyRow()) })

        Spacer(Modifier.height(18.dp))
        Row(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(WcColors.PrimaryDark).padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Grand total", color = WcColors.HeaderSub, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("₹%,.0f".format(grandTotal), color = androidx.compose.ui.graphics.Color.White, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
        }

        Spacer(Modifier.height(20.dp))
        FieldLabel("Notes")
        Spacer(Modifier.height(9.dp))
        WcField(notes, { notes = it }, placeholder = "Overall notes…", singleLine = false, minLines = 2)

        Spacer(Modifier.height(20.dp))
        FieldLabel("Photos")
        Spacer(Modifier.height(9.dp))
        PhotoStrip(photos, onAddPhoto, onRemovePhoto)

        if (error != null) {
            Spacer(Modifier.height(12.dp))
            Text(error, color = WcColors.DangerFg, fontSize = 13.sp)
        }

        Spacer(Modifier.height(20.dp))
        WcPrimaryButton(
            text = "Submit purchase log", icon = Ms.send, loading = submitting, enabled = !submitting,
            onClick = {
                val mapped = items.mapNotNull {
                    val q = it.qty.trim().toDoubleOrNull()
                    val p = it.price.trim().toDoubleOrNull() ?: 0.0
                    if (it.name.isBlank() || q == null) null
                    else PurchaseItem(it.name.trim(), q, it.unit.trim(), p, q * p)
                }
                onSubmit(siteId.trim(), siteName.trim(), mapped, notes.trim())
            },
        )
    }
}
