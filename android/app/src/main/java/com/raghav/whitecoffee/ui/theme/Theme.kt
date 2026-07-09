package com.raghav.whitecoffee.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val WcColorScheme = lightColorScheme(
    primary       = WcColors.Primary,
    onPrimary     = WcColors.OnPrimary,
    secondary     = WcColors.Accent,
    onSecondary   = WcColors.OnAccent,
    background     = WcColors.ScreenBg,
    onBackground   = WcColors.TextPrimary,
    surface       = WcColors.Surface,
    onSurface     = WcColors.TextPrimary,
    error         = WcColors.DangerFg,
    outline       = WcColors.Border,
)

/** Wraps a screen in the White Coffee M3 theme (teal scheme + Manrope typography). */
@Composable
fun WhiteCoffeeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = WcColorScheme,
        typography  = WcTypography,
        content     = content,
    )
}
