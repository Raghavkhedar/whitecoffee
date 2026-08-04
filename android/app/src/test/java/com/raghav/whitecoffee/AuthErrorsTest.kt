package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.repository.AuthFailure
import com.raghav.whitecoffee.data.repository.authFailureMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rule these tests exist to hold: the app must never claim to know WHICH half of a
 * credential failure occurred. Firebase's email-enumeration protection collapses "wrong
 * password" and "no such account" into one error, so a message asserting either one is
 * a guess. See AuthErrors.kt for the 2026-07-31 lockout this cost.
 */
class AuthErrorsTest {

    @Test
    fun `every failure has a non-empty message`() {
        AuthFailure.values().forEach { failure ->
            assertTrue(
                "AuthFailure.$failure has no message",
                authFailureMessage(failure).isNotBlank(),
            )
        }
    }

    @Test
    fun `bad credentials never claims it was the password`() {
        val message = authFailureMessage(AuthFailure.BAD_CREDENTIALS).lowercase()
        // "password" may appear as one of two named possibilities, but never as a verdict.
        assertFalse(
            "must not assert the password specifically was wrong",
            message.contains("incorrect password") || message.contains("wrong password"),
        )
    }

    @Test
    fun `bad credentials never claims the account does not exist`() {
        val message = authFailureMessage(AuthFailure.BAD_CREDENTIALS).lowercase()
        assertFalse(
            "must not assert the account is missing — we cannot know that",
            message.contains("no account found") || message.contains("no user"),
        )
    }

    @Test
    fun `bad credentials names both possibilities and points at the employee ID`() {
        val message = authFailureMessage(AuthFailure.BAD_CREDENTIALS).lowercase()
        assertTrue("should mention the identifier", message.contains("id"))
        assertTrue("should mention the password", message.contains("password"))
        // The failure staff cannot diagnose alone: their ID was moved to an email login.
        assertTrue("should route them to an admin", message.contains("administrator"))
    }

    @Test
    fun `a disabled account is reported as deactivated, not as bad credentials`() {
        val disabled = authFailureMessage(AuthFailure.ACCOUNT_DISABLED)
        assertTrue(disabled.contains("deactivated"))
        assertEquals(
            "a suspension must not be reported as a credential problem",
            false,
            disabled == authFailureMessage(AuthFailure.BAD_CREDENTIALS),
        )
    }

    @Test
    fun `network and throttling stay distinguishable from credentials`() {
        val messages = listOf(
            authFailureMessage(AuthFailure.NO_NETWORK),
            authFailureMessage(AuthFailure.TOO_MANY_ATTEMPTS),
            authFailureMessage(AuthFailure.BAD_CREDENTIALS),
            authFailureMessage(AuthFailure.UNKNOWN),
        )
        assertEquals("each failure needs its own message", messages.size, messages.toSet().size)
    }
}
