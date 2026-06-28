package com.raghav.whitecoffee.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.raghav.whitecoffee.R

/** Manrope — the redesign's display/body face. Static weights bundled in res/font. */
val Manrope = FontFamily(
    Font(R.font.manrope_400, FontWeight.Normal),
    Font(R.font.manrope_500, FontWeight.Medium),
    Font(R.font.manrope_600, FontWeight.SemiBold),
    Font(R.font.manrope_700, FontWeight.Bold),
    Font(R.font.manrope_800, FontWeight.ExtraBold),
)

/**
 * Material 3 typography, all in Manrope. Most screens set explicit sizes/weights inline
 * (to mirror the design exactly); this makes Manrope the default for any plain Text.
 */
val WcTypography = Typography().run {
    copy(
        displayLarge   = displayLarge.copy(fontFamily = Manrope),
        displayMedium  = displayMedium.copy(fontFamily = Manrope),
        displaySmall   = displaySmall.copy(fontFamily = Manrope),
        headlineLarge  = headlineLarge.copy(fontFamily = Manrope),
        headlineMedium = headlineMedium.copy(fontFamily = Manrope),
        headlineSmall  = headlineSmall.copy(fontFamily = Manrope),
        titleLarge     = titleLarge.copy(fontFamily = Manrope),
        titleMedium    = titleMedium.copy(fontFamily = Manrope),
        titleSmall     = titleSmall.copy(fontFamily = Manrope),
        bodyLarge      = bodyLarge.copy(fontFamily = Manrope),
        bodyMedium     = bodyMedium.copy(fontFamily = Manrope),
        bodySmall      = bodySmall.copy(fontFamily = Manrope),
        labelLarge     = labelLarge.copy(fontFamily = Manrope),
        labelMedium    = labelMedium.copy(fontFamily = Manrope),
        labelSmall     = labelSmall.copy(fontFamily = Manrope),
    )
}

/** Material Symbols Rounded (subset) — icons are rendered as glyphs from this font. */
val MaterialSymbols = FontFamily(Font(R.font.material_symbols))

internal val DefaultTextStyle = TextStyle(fontFamily = Manrope)
