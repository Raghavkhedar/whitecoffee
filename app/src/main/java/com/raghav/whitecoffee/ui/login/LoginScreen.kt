package com.raghav.whitecoffee.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.ui.theme.DefaultTextStyle
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.WcColors
import com.raghav.whitecoffee.ui.theme.WcPrimaryButton
import com.raghav.whitecoffee.ui.theme.WhiteCoffeeTheme

/**
 * Login screen — Material 3 teal redesign.
 *
 * Pure UI: holds only email/password text locally and reports taps upward via [onLogin].
 * All real logic (validation, Firebase auth, FCM token) stays in LoginViewModel.
 */
@Composable
fun LoginScreen(
    uiState: UiState<User>,
    onLogin: (email: String, password: String) -> Unit,
) = WhiteCoffeeTheme {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var passwordVisible by rememberSaveable { mutableStateOf(false) }

    val isLoading = uiState is UiState.Loading
    val errorMessage = (uiState as? UiState.Error)?.message

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = WcColors.Primary,
        unfocusedBorderColor = WcColors.Border,
        cursorColor = WcColors.Primary,
        focusedContainerColor = WcColors.Surface,
        unfocusedContainerColor = WcColors.Surface,
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(WcColors.ScreenBg)
            .verticalScroll(rememberScrollState()),
    ) {
        // ── Dark teal hero header ──
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.verticalGradient(
                        listOf(WcColors.HeaderTop, WcColors.LoginMid, WcColors.LoginBottom)
                    )
                )
                .padding(top = 104.dp, bottom = 92.dp)
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(84.dp)
                    .clip(RoundedCornerShape(26.dp))
                    .background(Color.White.copy(alpha = 0.13f)),
                contentAlignment = Alignment.Center,
            ) {
                Text("WC", color = Color.White, fontSize = 27.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.5.sp)
            }
            Spacer(Modifier.height(20.dp))
            Text("White Coffee", color = Color.White, fontSize = 27.sp, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(7.dp))
            Text(
                "Senken Engineering · Field Operations",
                color = WcColors.HeaderSub,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )
        }

        // ── Login form card (overlaps hero) ──
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp)
                .offset(y = (-32).dp),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = WcColors.Surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 3.dp),
        ) {
            Column(Modifier.padding(24.dp)) {
                Text("Welcome back", color = WcColors.TextPrimary, fontSize = 21.sp, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(4.dp))
                Text("Sign in with your company credentials", color = WcColors.TextSecondary, fontSize = 13.5.sp)
                Spacer(Modifier.height(22.dp))

                Text("Email address", color = WcColors.TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(7.dp))
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    placeholder = { Text("you@senken.in", color = WcColors.TextHint, fontSize = 15.sp) },
                    leadingIcon = { MsIcon(Ms.mail, 20.sp, WcColors.Primary) },
                    singleLine = true,
                    enabled = !isLoading,
                    textStyle = DefaultTextStyle.copy(fontSize = 15.sp, color = WcColors.TextPrimary),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    shape = RoundedCornerShape(14.dp),
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(16.dp))

                Text("Password", color = WcColors.TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(7.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    placeholder = { Text("••••••••", color = WcColors.TextHint, fontSize = 15.sp) },
                    leadingIcon = { MsIcon(Ms.lock, 20.sp, WcColors.TextHint) },
                    singleLine = true,
                    enabled = !isLoading,
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    textStyle = DefaultTextStyle.copy(fontSize = 15.sp, color = WcColors.TextPrimary),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { if (!isLoading) onLogin(email.trim(), password) }),
                    trailingIcon = {
                        TextButton(onClick = { passwordVisible = !passwordVisible }) {
                            Text(if (passwordVisible) "Hide" else "Show", color = WcColors.Primary, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                        }
                    },
                    shape = RoundedCornerShape(14.dp),
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth(),
                )

                if (errorMessage != null) {
                    Spacer(Modifier.height(10.dp))
                    Text(errorMessage, color = WcColors.DangerFg, fontSize = 13.sp)
                }

                Spacer(Modifier.height(24.dp))
                WcPrimaryButton(
                    text = "Sign In",
                    icon = Ms.arrow_forward,
                    onClick = { onLogin(email.trim(), password) },
                    enabled = !isLoading,
                    loading = isLoading,
                )
            }
        }

        Spacer(Modifier.height(26.dp))
        Text(
            "Senken Engineering © 2025",
            color = WcColors.TextHint,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(bottom = 36.dp),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun LoginScreenPreview() {
    LoginScreen(uiState = UiState.Empty, onLogin = { _, _ -> })
}
