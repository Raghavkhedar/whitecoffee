package com.raghav.whitecoffee.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

/** Holds whichever [WcPalette] is currently active; defaults to [LightWcPalette]. */
val LocalWcPalette = staticCompositionLocalOf { LightWcPalette }

/** Read the active palette from anywhere inside [WhiteCoffeeTheme] via `WcTheme.colors.X`. */
object WcTheme {
    val colors: WcPalette
        @Composable
        @ReadOnlyComposable
        get() = LocalWcPalette.current
}

/** Derives the Material3 [androidx.compose.material3.ColorScheme] from a given palette. */
internal fun wcColorScheme(palette: WcPalette) = lightColorScheme(
    primary       = palette.Primary,
    onPrimary     = palette.OnPrimary,
    secondary     = palette.Accent,
    onSecondary   = palette.OnAccent,
    background     = palette.ScreenBg,
    onBackground   = palette.TextPrimary,
    surface       = palette.Surface,
    onSurface     = palette.TextPrimary,
    error         = palette.DangerFg,
    outline       = palette.Border,
)

/**
 * Wraps a screen in the White Coffee M3 theme (teal scheme + Manrope typography).
 *
 * [palette] defaults to [LightWcPalette] — the only palette shipped today. Adding dark mode
 * later requires exactly two things: a `DarkWcPalette` (in `Color.kt`, alongside
 * [LightWcPalette]) and changing this default to
 * `if (isSystemInDarkTheme()) DarkWcPalette else LightWcPalette`. No call site needs to change —
 * every screen already reads colours via `WcTheme.colors.X`, which is fed by whichever palette
 * is provided here.
 */
@Composable
fun WhiteCoffeeTheme(palette: WcPalette = LightWcPalette, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalWcPalette provides palette) {
        MaterialTheme(
            colorScheme = wcColorScheme(palette),
            typography  = WcTypography,
            content     = content,
        )
    }
}
