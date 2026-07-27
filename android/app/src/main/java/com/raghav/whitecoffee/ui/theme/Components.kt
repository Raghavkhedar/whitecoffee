package com.raghav.whitecoffee.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

// ── Top bar (light): back arrow + title, optional trailing slot ───────────────
@Composable
fun WcTopBar(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(WcTheme.colors.ScreenBg)
            .padding(start = WcSpacing.Space12, end = WcSpacing.Space12, top = 48.dp, bottom = WcSpacing.Space12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(42.dp)
                .clip(CircleShape)
                .clickable { onBack() },
            contentAlignment = Alignment.Center,
        ) { MsIcon(Ms.arrow_back, 24.sp, Color(0xFF16201F)) }
        Spacer(Modifier.width(WcSpacing.Space6))
        Text(
            title,
            color = WcTheme.colors.TextPrimary,
            fontSize = 19.sp,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier.weight(1f),
        )
        if (trailing != null) trailing()
    }
}

// ── Section label (uppercase, muted, tracked) ─────────────────────────────────
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = WcTheme.colors.TextSecondary,
        fontSize = 12.sp,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = 0.6.sp,
        modifier = modifier,
    )
}

@Composable
fun FieldLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = WcTheme.colors.TextSecondary,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = modifier,
    )
}

// ── Primary teal button (with optional leading icon + loading state) ──────────
@Composable
fun WcPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: String? = null,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (enabled) WcTheme.colors.Primary else WcTheme.colors.Primary.copy(alpha = 0.5f))
            .clickable(enabled = enabled && !loading) { onClick() },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (loading) {
            CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        } else {
            if (icon != null) {
                MsIcon(icon, 21.sp, Color.White)
                Spacer(Modifier.width(9.dp))
            }
            Text(text, color = Color.White, fontSize = 15.5.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}

// ── Status / role chip with leading dot ───────────────────────────────────────
@Composable
fun StatusBadge(label: String, bg: Color, fg: Color, modifier: Modifier = Modifier, dot: Boolean = true) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .padding(horizontal = WcSpacing.Space10, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(fg))
            Spacer(Modifier.width(5.dp))
        }
        Text(label, color = fg, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold)
    }
}

// ── White rounded card with soft border ───────────────────────────────────────
@Composable
fun WcCard(
    modifier: Modifier = Modifier,
    radius: Int = 18,
    border: Color = WcTheme.colors.BorderSoft,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(radius.dp))
            .background(WcTheme.colors.Surface)
            .border(1.dp, border, RoundedCornerShape(radius.dp)),
    ) { content() }
}

// ── Rounded icon tile (coloured square holding a Material Symbol) ──────────────
@Composable
fun IconTile(icon: String, tile: WcTile, size: Int = 40, radius: Int = 12, iconSize: Int = 21) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(RoundedCornerShape(radius.dp))
            .background(tile.bg),
        contentAlignment = Alignment.Center,
    ) { MsIcon(icon, iconSize.sp, tile.fg) }
}

// ── Editable text field, teal M3 look ─────────────────────────────────────────
@Composable
fun WcField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    leadingIcon: String? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    minLines: Int = 1,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        singleLine = singleLine,
        minLines = minLines,
        placeholder = { Text(placeholder, color = WcTheme.colors.TextHint, fontSize = 14.sp) },
        leadingIcon = leadingIcon?.let { { MsIcon(it, 20.sp, WcTheme.colors.Primary) } },
        textStyle = DefaultTextStyle.copy(fontSize = 15.sp, color = WcTheme.colors.TextPrimary),
        shape = RoundedCornerShape(14.dp),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = WcTheme.colors.Primary,
            unfocusedBorderColor = WcTheme.colors.Border,
            cursorColor = WcTheme.colors.Primary,
            focusedContainerColor = WcTheme.colors.Surface,
            unfocusedContainerColor = WcTheme.colors.Surface,
        ),
    )
}

// ── Read-only "field box" (display value with optional icon / trailing) ───────
@Composable
fun ReadOnlyFieldBox(
    text: String,
    modifier: Modifier = Modifier,
    leadingIcon: String? = null,
    leadingTint: Color = WcTheme.colors.Primary,
    trailingIcon: String? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(WcTheme.colors.Surface)
            .border(1.5.dp, WcTheme.colors.Border, RoundedCornerShape(14.dp))
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)
            .padding(WcSpacing.Space14),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingIcon != null) {
            MsIcon(leadingIcon, 20.sp, leadingTint)
            Spacer(Modifier.width(WcSpacing.Space10))
        }
        Text(text, color = WcTheme.colors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        if (trailingIcon != null) MsIcon(trailingIcon, 20.sp, WcTheme.colors.TextHint)
    }
}

// ── Dashed "add" button ───────────────────────────────────────────────────────
@Composable
fun AddItemButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: String = Ms.add) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .border(1.5.dp, WcTheme.colors.DashBorder, RoundedCornerShape(16.dp))
            .clickable { onClick() }
            .padding(WcSpacing.Space14),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MsIcon(icon, 20.sp, WcTheme.colors.Primary)
        Spacer(Modifier.width(WcSpacing.Space8))
        Text(text, color = WcTheme.colors.Primary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
    }
}

// ── Removable item row (icon tile + title/sub + close) ────────────────────────
@Composable
fun RemovableItemRow(
    title: String,
    subtitle: String,
    icon: String,
    tile: WcTile,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
    trailingContent: (@Composable () -> Unit)? = null,
) {
    WcCard(modifier = modifier.fillMaxWidth(), radius = 16) {
        Column(Modifier.padding(13.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(icon, tile)
                Spacer(Modifier.width(WcSpacing.Space12))
                Column(Modifier.weight(1f)) {
                    Text(title, color = WcTheme.colors.TextPrimary, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(2.dp))
                    Text(subtitle, color = WcTheme.colors.TextHint, fontSize = 12.5.sp)
                }
                Box(
                    modifier = Modifier.size(34.dp).clip(CircleShape).clickable { onRemove() },
                    contentAlignment = Alignment.Center,
                ) { MsIcon(Ms.close, 20.sp, WcTheme.colors.DangerFg) }
            }
            if (trailingContent != null) trailingContent()
        }
    }
}

// ── Empty / "all caught up" dashed state ──────────────────────────────────────
@Composable
fun EmptyState(icon: String, title: String, subtitle: String, modifier: Modifier = Modifier, iconTint: Color = Color(0xFFA8B8B8)) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .border(1.5.dp, Color(0xFFC4D2D2), RoundedCornerShape(18.dp))
            .padding(vertical = 36.dp, horizontal = WcSpacing.Space20),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        MsIcon(icon, 34.sp, iconTint)
        Spacer(Modifier.height(WcSpacing.Space8))
        Text(title, color = WcTheme.colors.TextSecondary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(3.dp))
        Text(subtitle, color = WcTheme.colors.TextMuted, fontSize = 12.5.sp)
    }
}

// ── Info banner (tinted, leading icon) ────────────────────────────────────────
@Composable
fun InfoBanner(text: String, bg: Color, fg: Color, icon: String = Ms.info, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .padding(WcSpacing.Space14),
    ) {
        MsIcon(icon, 21.sp, fg)
        Spacer(Modifier.width(WcSpacing.Space10))
        Text(text, color = fg, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 18.sp)
    }
}

/**
 * The app's one offline banner. Renders nothing when [isOnline].
 *
 * Connectivity is *informational*, never a gate: Firestore is configured with a persistent local
 * cache (see `WhiteCoffeeApp`), so every screen still reads from disk and every write is durable
 * the moment it is made. All this banner says is "your writes have not synced yet" — which is why
 * it draws over the content rather than replacing it.
 *
 * One definition so the wording and colour cannot drift; call it at the top of a screen's Column.
 */
@Composable
fun OfflineBanner(isOnline: Boolean, modifier: Modifier = Modifier) {
    if (isOnline) return
    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(OFFLINE_BANNER_BG)
            .padding(horizontal = WcSpacing.Space18, vertical = WcSpacing.Space10),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "No internet connection",
            color = Color.White,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

private val OFFLINE_BANNER_BG = Color(0xFF78350F)

// ── Styled input dialog (teal M3) — rounded card, title/subtitle, content slot ─
// Replaces raw View AlertDialog + EditText prompts. Put WcField(s) in [content].
@Composable
fun WcDialog(
    title: String,
    confirmText: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    confirmEnabled: Boolean = true,
    dismissText: String = "Cancel",
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(WcTheme.colors.Surface)
                .padding(horizontal = 22.dp, vertical = WcSpacing.Space20),
        ) {
            Text(title, color = WcTheme.colors.TextPrimary, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
            if (subtitle != null) {
                Spacer(Modifier.height(WcSpacing.Space4))
                Text(subtitle, color = WcTheme.colors.TextSecondary, fontSize = 13.sp)
            }
            Spacer(Modifier.height(WcSpacing.Space18))
            content()
            Spacer(Modifier.height(WcSpacing.Space20))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(54.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .clickable { onDismiss() },
                    contentAlignment = Alignment.Center,
                ) { Text(dismissText, color = WcTheme.colors.TextSecondary, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.width(WcSpacing.Space10))
                WcPrimaryButton(
                    text = confirmText,
                    onClick = onConfirm,
                    enabled = confirmEnabled,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

internal val ScreenContentPadding = PaddingValues(horizontal = WcSpacing.Space18)
