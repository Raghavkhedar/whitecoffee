package com.raghav.whitecoffee.ui.theme

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Named dp scale for gaps between elements (`Spacer`/`padding`), derived from the values already
 * repeated across `ui/theme/Components.kt`. Spacing does not vary by theme, so this is a plain
 * object — never a `CompositionLocal`.
 *
 * Only literals that already exactly match one of these values were substituted; anything that
 * didn't fit the scale (a one-off safe-area offset, a bespoke dot size, …) was left as a literal
 * rather than nudged onto the grid.
 */
object WcSpacing {
    val Space4: Dp = 4.dp
    val Space6: Dp = 6.dp
    val Space8: Dp = 8.dp
    val Space10: Dp = 10.dp
    val Space12: Dp = 12.dp
    val Space14: Dp = 14.dp
    val Space16: Dp = 16.dp
    val Space18: Dp = 18.dp
    val Space20: Dp = 20.dp
    val Space24: Dp = 24.dp
}
