package com.raghav.whitecoffee.ui.theme

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text

/**
 * Material Symbols Rounded glyph codepoints (subset bundled in res/font/material_symbols.ttf).
 * Each value is the PUA codepoint for that icon; render with [MsIcon].
 */
object Ms {
const val signal_cellular_alt = "\ue202"
    const val wifi = "\ue63e"
    const val battery_full = "\ue1a4"
    const val mail = "\ue0be"
    const val lock = "\ue88d"
    const val arrow_forward = "\ue5c8"
    const val notifications = "\ue7f4"
    const val verified_user = "\ue8e8"
    const val schedule = "\ue192"
    const val event = "\ue24f"
    const val build = "\ue869"
    const val shopping_cart = "\ue547"
    const val inventory_2 = "\ue1a1"
    const val handyman = "\uf10b"
    const val insights = "\uf092"
    const val event_busy = "\ue615"
    const val fact_check = "\uf0c5"
    const val group = "\ue7ef"
    const val location_on = "\ue0c8"
    const val event_repeat = "\ueb7b"
    const val arrow_back = "\ue5c4"
    const val edit = "\ue150"
    const val task_alt = "\ue2e6"
    const val pin_drop = "\ue55e"
    const val home = "\ue88a"
    const val apartment = "\uea40"
    const val logout = "\ue9ba"
    const val storefront = "\uea12"
    const val login = "\uea77"
    const val expand_more = "\ue5cf"
    const val close = "\ue14c"
    const val add = "\ue145"
    const val photo_camera = "\ue3b0"
    const val send = "\ue163"
    const val shopping_bag = "\uf1cc"
    const val swap_horiz = "\ue8d4"
    const val warehouse = "\uebb8"
    const val remove = "\ue15b"
    const val sick = "\uf220"
    const val beach_access = "\ueb3e"
    const val flight = "\ue539"
    const val money_off = "\ue25c"
    const val date_range = "\ue916"
    const val check = "\ue5ca"
    const val event_available = "\ue614"
    const val person_add = "\ue7fe"
    const val add_location_alt = "\uef3a"
    const val info = "\ue88e"
    const val check_circle = "\ue86c"
}

/**
 * Renders a Material Symbols glyph at [size] (sp ≈ the design's px). Tight line metrics so the
 * glyph occupies a square box with no extra vertical padding.
 */
@Composable
fun MsIcon(
    icon: String,
    size: TextUnit = 22.sp,
    tint: Color = Color.Unspecified,
    modifier: Modifier = Modifier,
) {
    Text(
        text = icon,
        color = tint,
        fontSize = size,
        fontFamily = MaterialSymbols,
        textAlign = TextAlign.Center,
        style = TextStyle(
            lineHeight = size,
            platformStyle = PlatformTextStyle(includeFontPadding = false),
            lineHeightStyle = LineHeightStyle(
                alignment = LineHeightStyle.Alignment.Center,
                trim = LineHeightStyle.Trim.Both,
            ),
        ),
        modifier = modifier,
    )
}
