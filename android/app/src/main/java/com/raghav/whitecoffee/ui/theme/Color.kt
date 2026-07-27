package com.raghav.whitecoffee.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * White Coffee — Material 3 redesign palette (teal).
 *
 * A [WcPalette] is a full set of every colour the Compose UI needs. This is the seam that makes
 * theming possible: screens never read colour constants directly — they read [WcTheme.colors],
 * which resolves to whichever [WcPalette] is currently provided (see `Theme.kt`).
 *
 * [LightWcPalette] is the app's one and only palette today. Adding dark mode later is exactly
 * one new `DarkWcPalette` object plus a branch in `WhiteCoffeeTheme` — see the KDoc there.
 */
data class WcPalette(
    // ── Brand teal ──
    val Primary: Color,       // buttons, active states
    val PrimaryDark: Color,   // deep accent / grand-total bar
    val OnPrimary: Color,

    // Hero header gradients
    val HeaderTop: Color,
    val HeaderBottom: Color,
    val LoginMid: Color,
    val LoginBottom: Color,

    // Light-teal accents used on dark headers / chips
    val HeaderSub: Color,
    val HeaderSubSoft: Color,
    val Accent: Color,        // secondary button bg
    val OnAccent: Color,

    // ── Surfaces & neutrals ──
    val ScreenBg: Color,
    val Surface: Color,
    val Border: Color,        // input / card outline
    val BorderSoft: Color,    // soft card outline
    val DashBorder: Color,    // dashed "add" borders
    val Divider: Color,
    val FieldFill: Color,

    // ── Text ──
    val TextPrimary: Color,
    val TextSecondary: Color,
    val TextMuted: Color,
    val TextHint: Color,
    val TextOnReason: Color,

    // ── Status (chips / badges) ──
    val SuccessBg: Color,
    val SuccessFg: Color,
    val WarnBg: Color,
    val WarnFg: Color,
    val SlBg: Color,          // Short Leave — softer amber, distinct from Half Day
    val SlFg: Color,
    val DangerBg: Color,
    val DangerFg: Color,

    // Toast
    val ToastBg: Color,
    val ToastFg: Color,
    val ToastIcon: Color,
)

/** The app's one shipped palette today. Mirrors the "White Coffee - M3 Redesign" design system. */
val LightWcPalette = WcPalette(
    // ── Brand teal ──
    Primary       = Color(0xFF006A71),
    PrimaryDark   = Color(0xFF00474C),
    OnPrimary     = Color(0xFFFFFFFF),

    // Hero header gradients
    HeaderTop     = Color(0xFF00363B),
    HeaderBottom  = Color(0xFF00585E),
    LoginMid      = Color(0xFF00565C),
    LoginBottom   = Color(0xFF00767E),

    // Light-teal accents used on dark headers / chips
    HeaderSub     = Color(0xFFA7E9EC),
    HeaderSubSoft = Color(0xFFCDEFF1),
    Accent        = Color(0xFFCDE7EC),
    OnAccent      = Color(0xFF00474C),

    // ── Surfaces & neutrals ──
    ScreenBg      = Color(0xFFF4F9F9),
    Surface       = Color(0xFFFFFFFF),
    Border        = Color(0xFFE2E9E9),
    BorderSoft    = Color(0xFFEAF1F0),
    DashBorder    = Color(0xFFB6C7C7),
    Divider       = Color(0xFFE6EDED),
    FieldFill     = Color(0xFFF2F7F7),

    // ── Text ──
    TextPrimary   = Color(0xFF101414),
    TextSecondary = Color(0xFF5A6566),
    TextMuted     = Color(0xFF8591A0),
    TextHint      = Color(0xFF8FA0A0),
    TextOnReason  = Color(0xFF3A4445),

    // ── Status (chips / badges) ──
    SuccessBg     = Color(0xFFC7F0D2),
    SuccessFg     = Color(0xFF0A5132),
    WarnBg        = Color(0xFFFCEFC7),
    WarnFg        = Color(0xFF8A6700),
    SlBg          = Color(0xFFFFE1C2),
    SlFg          = Color(0xFF8A4B00),
    DangerBg      = Color(0xFFFFDAD6),
    DangerFg      = Color(0xFFBA1A1A),

    // Toast
    ToastBg       = Color(0xFF16282A),
    ToastFg       = Color(0xFFEAF5F4),
    ToastIcon     = Color(0xFF7FE0C0),
)

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
