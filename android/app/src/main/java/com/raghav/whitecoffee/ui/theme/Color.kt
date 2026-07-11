package com.raghav.whitecoffee.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * White Coffee — Material 3 redesign palette (teal).
 *
 * Single source of truth for every colour used by the Compose UI. Mirrors the
 * "White Coffee - M3 Redesign" design system. Screens reference [WcColors] directly
 * for bespoke values; [WhiteCoffeeTheme] feeds the core ones into MaterialTheme.
 */
object WcColors {
    // ── Brand teal ──
    val Primary       = Color(0xFF006A71)   // buttons, active states
    val PrimaryDark   = Color(0xFF00474C)   // deep accent / grand-total bar
    val OnPrimary     = Color(0xFFFFFFFF)

    // Hero header gradients
    val HeaderTop     = Color(0xFF00363B)
    val HeaderBottom  = Color(0xFF00585E)
    val LoginMid      = Color(0xFF00565C)
    val LoginBottom   = Color(0xFF00767E)

    // Light-teal accents used on dark headers / chips
    val HeaderSub     = Color(0xFFA7E9EC)
    val HeaderSubSoft = Color(0xFFCDEFF1)
    val Accent        = Color(0xFFCDE7EC)   // secondary button bg
    val OnAccent      = Color(0xFF00474C)

    // ── Surfaces & neutrals ──
    val ScreenBg      = Color(0xFFF4F9F9)
    val Surface       = Color(0xFFFFFFFF)
    val Border        = Color(0xFFE2E9E9)   // input / card outline
    val BorderSoft    = Color(0xFFEAF1F0)   // soft card outline
    val DashBorder    = Color(0xFFB6C7C7)   // dashed "add" borders
    val Divider       = Color(0xFFE6EDED)
    val FieldFill     = Color(0xFFF2F7F7)

    // ── Text ──
    val TextPrimary   = Color(0xFF101414)
    val TextSecondary = Color(0xFF5A6566)
    val TextMuted     = Color(0xFF8591A0)
    val TextHint      = Color(0xFF8FA0A0)
    val TextOnReason  = Color(0xFF3A4445)

    // ── Status (chips / badges) ──
    val SuccessBg     = Color(0xFFC7F0D2)
    val SuccessFg     = Color(0xFF0A5132)
    val WarnBg        = Color(0xFFFCEFC7)
    val WarnFg        = Color(0xFF8A6700)
    val SlBg          = Color(0xFFFFE1C2)   // Short Leave — softer amber, distinct from Half Day
    val SlFg          = Color(0xFF8A4B00)
    val DangerBg      = Color(0xFFFFDAD6)
    val DangerFg      = Color(0xFFBA1A1A)

    // Toast
    val ToastBg       = Color(0xFF16282A)
    val ToastFg       = Color(0xFFEAF5F4)
    val ToastIcon     = Color(0xFF7FE0C0)
}

/** A coloured module / icon-tile pairing (background + foreground). */
data class WcTile(val bg: Color, val fg: Color)

/** Tile colours per feature, matching the design's module grid. */
object WcTiles {
    val Attendance     = WcTile(Color(0xFFC6EEF1), Color(0xFF00474C))
    val MtRequest      = WcTile(Color(0xFFD7E2FF), Color(0xFF0A3A86))
    val MtBuy          = WcTile(Color(0xFFC7F0D2), Color(0xFF0A5132))
    val MaterialXfer   = WcTile(Color(0xFFE7DDFF), Color(0xFF3A1D8A))
    val ToolXfer       = WcTile(Color(0xFFBFE8FF), Color(0xFF064A6E))
    val Work           = WcTile(Color(0xFFFFE2AE), Color(0xFF6B4A00))
    val Leave          = WcTile(Color(0xFFFFD7E0), Color(0xFF8A1B43))
    val Approvals      = WcTile(Color(0xFFC7F1D9), Color(0xFF0A5132))
    val Users          = WcTile(Color(0xFFE2E2F5), Color(0xFF34357A))
    val Sites          = WcTile(Color(0xFFFFDCC2), Color(0xFF8A3A12))
    val Regularization = WcTile(Color(0xFFDDDFFF), Color(0xFF2A2A8A))
}
