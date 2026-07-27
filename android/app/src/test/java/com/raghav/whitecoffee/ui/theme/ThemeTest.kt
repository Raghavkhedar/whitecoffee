package com.raghav.whitecoffee.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * Guards the palette seam — the thing that makes dark mode possible at all.
 *
 * The screens were rewritten from `WcColors.X` (hardcoded constants) to `WcTheme.colors.X`
 * (a CompositionLocal fed by [WhiteCoffeeTheme]). That rewrite is only worth anything if the
 * Material colour scheme is genuinely *derived from* the active palette. If [wcColorScheme]
 * ever went back to reading constants, every call site would still compile, every screen would
 * still look right today, and dark mode would be silently broken again — with nothing failing.
 *
 * There is no Compose UI test infrastructure in this module, so these assert on the derivation
 * directly. They are cheap, and they are the only thing standing between this refactor and a
 * quiet regression to hardcoded colours.
 */
class ThemeTest {

    @Test
    fun `the colour scheme is derived from the palette it is given, not from constants`() {
        val magenta = Color(0xFFFF00FF)
        val altered = LightWcPalette.copy(Primary = magenta)

        assertEquals(
            "primary must follow the palette handed to wcColorScheme",
            magenta,
            wcColorScheme(altered).primary,
        )
        assertNotEquals(
            "a hardcoded scheme would return the light palette's primary regardless",
            wcColorScheme(LightWcPalette).primary,
            wcColorScheme(altered).primary,
        )
    }

    @Test
    fun `every Material slot tracks its palette source`() {
        val p = LightWcPalette.copy(
            Primary   = Color(0xFF111111),
            OnPrimary = Color(0xFF222222),
            Accent    = Color(0xFF333333),
            OnAccent  = Color(0xFF444444),
            ScreenBg  = Color(0xFF555555),
            Surface   = Color(0xFF666666),
            DangerFg  = Color(0xFF777777),
            Border    = Color(0xFF888888),
        )
        val scheme = wcColorScheme(p)

        assertEquals(p.Primary, scheme.primary)
        assertEquals(p.OnPrimary, scheme.onPrimary)
        assertEquals(p.Accent, scheme.secondary)
        assertEquals(p.OnAccent, scheme.onSecondary)
        assertEquals(p.ScreenBg, scheme.background)
        assertEquals(p.Surface, scheme.surface)
        assertEquals(p.DangerFg, scheme.error)
        assertEquals(p.Border, scheme.outline)
    }

    /**
     * Adding dark mode must stay a one-object change. `copy` is what makes that true — if
     * WcPalette ever stopped being a data class, a dark palette would mean retyping 34 fields.
     */
    @Test
    fun `a variant palette is one copy call away`() {
        val dark = LightWcPalette.copy(
            ScreenBg    = Color(0xFF101414),
            Surface     = Color(0xFF16201F),
            TextPrimary = Color(0xFFF4F9F9),
        )

        assertEquals(Color(0xFF101414), dark.ScreenBg)
        // Untouched fields carry over — the brand teal does not need restating.
        assertEquals(LightWcPalette.Primary, dark.Primary)
    }

    /** The shipped palette is the light one; nothing in this change may have altered it. */
    @Test
    fun `the light palette still holds the brand teal`() {
        assertEquals(Color(0xFF006A71), LightWcPalette.Primary)
        assertEquals(Color(0xFFF4F9F9), LightWcPalette.ScreenBg)
        assertEquals(Color(0xFF101414), LightWcPalette.TextPrimary)
    }
}
