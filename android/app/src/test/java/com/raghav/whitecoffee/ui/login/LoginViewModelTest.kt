package com.raghav.whitecoffee.ui.login

import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.fake.FakeAuthRepository
import com.raghav.whitecoffee.fake.FakeNotificationRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Login: local validation before Firebase, then the auth + profile round-trip.
 *
 * The blank/short-password tests matter because they must never reach the repository — showing
 * "Password must be at least 6 characters" is only honest if that check ran locally instead of
 * being what Firebase Auth itself rejected the attempt for.
 *
 * `saveFcmToken()` calls the real `FirebaseMessaging.getInstance()` directly (LoginViewModel.kt
 * has no seam for it), which throws on a plain JVM test runner with no FirebaseApp initialized.
 * That's caught and swallowed by design ("non-critical — FcmService.onNewToken() will retry"),
 * so login still succeeds — but it also means `notificationRepository.saveToken()` is never
 * actually reached in this test environment. That's asserted below as documented behaviour, not
 * a gap in the fake.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private lateinit var auth: FakeAuthRepository
    private lateinit var notifications: FakeNotificationRepository

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        auth = FakeAuthRepository()
        notifications = FakeNotificationRepository()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun subject() = LoginViewModel(auth, notifications)

    // ── local validation short-circuits before touching Firebase ────────

    @Test
    fun `a blank email is refused before Firebase is touched`() = runTest(dispatcher) {
        val vm = subject()
        vm.login("", "password1")
        advanceUntilIdle()

        assertEquals(0, auth.loginCallCount)
        assertEquals(
            "Please enter your email or employee ID.",
            (vm.loginState.value as UiState.Error).message,
        )
    }

    @Test
    fun `a blank password is refused before Firebase is touched`() = runTest(dispatcher) {
        val vm = subject()
        vm.login("test@whitecoffee.com", "")
        advanceUntilIdle()

        assertEquals(0, auth.loginCallCount)
        assertEquals("Please enter your password.", (vm.loginState.value as UiState.Error).message)
    }

    @Test
    fun `a password under six characters is refused before Firebase is touched`() = runTest(dispatcher) {
        val vm = subject()
        vm.login("test@whitecoffee.com", "abc12")
        advanceUntilIdle()

        assertEquals(0, auth.loginCallCount)
        assertEquals(
            "Password must be at least 6 characters.",
            (vm.loginState.value as UiState.Error).message,
        )
    }

    // ── the happy and unhappy paths ──────────────────────────────────────

    @Test
    fun `a successful login publishes the signed-in user`() = runTest(dispatcher) {
        val user = User(id = "u1", name = "Asha Rao", email = "asha@whitecoffee.com", role = "office")
        auth.loginResult = Result.success(user)
        val vm = subject()

        vm.login("asha@whitecoffee.com", "password1")
        advanceUntilIdle()

        assertEquals(1, auth.loginCallCount)
        val state = vm.loginState.value
        assertTrue(state is UiState.Success)
        assertEquals(user, (state as UiState.Success).data)
    }

    @Test
    fun `a failed login surfaces the repository's message`() = runTest(dispatcher) {
        auth.loginResult = Result.failure(IllegalStateException("Invalid credentials."))
        val vm = subject()

        vm.login("test@whitecoffee.com", "password1")
        advanceUntilIdle()

        assertEquals(
            "Invalid credentials.",
            (vm.loginState.value as UiState.Error).message,
        )
    }

    @Test
    fun `a login failure with no message falls back to a generic one`() = runTest(dispatcher) {
        auth.loginResult = Result.failure(RuntimeException())
        val vm = subject()

        vm.login("test@whitecoffee.com", "password1")
        advanceUntilIdle()

        assertEquals(
            "Login failed. Please try again.",
            (vm.loginState.value as UiState.Error).message,
        )
    }

    /**
     * Documents current behaviour (see class KDoc): the FCM save is unreachable on a plain JVM
     * test runner because `FirebaseMessaging.getInstance()` throws first and the failure is
     * swallowed. Login must still succeed either way — that resilience is the point of decision
     * #24 (token save also happens on refresh), and it must not make login itself flaky.
     */
    @Test
    fun `login succeeds even though the FCM token save is unreachable in this test environment`() =
        runTest(dispatcher) {
            val vm = subject()

            vm.login("test@whitecoffee.com", "password1")
            advanceUntilIdle()

            assertTrue(vm.loginState.value is UiState.Success)
            assertFalse(
                "FirebaseMessaging.getInstance() has no Android runtime to succeed against here",
                notifications.savedToken != null,
            )
        }

    // ── other observable behaviour ───────────────────────────────────────

    @Test
    fun `isAlreadyLoggedIn delegates to the auth repository`() {
        auth.loggedIn = true
        val vm = subject()
        assertTrue(vm.isAlreadyLoggedIn())

        auth.loggedIn = false
        assertFalse(vm.isAlreadyLoggedIn())
    }

    @Test
    fun `resetState clears a previous result`() = runTest(dispatcher) {
        val vm = subject()
        vm.login("", "")
        advanceUntilIdle()
        assertTrue(vm.loginState.value is UiState.Error)

        vm.resetState()

        assertTrue(vm.loginState.value is UiState.Empty)
    }
}
