package com.raghav.whitecoffee.data.repository

import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException

/**
 * Why a sign-in attempt failed, as far as we are ALLOWED to know.
 *
 * ⚠️ There is deliberately no "wrong password" and no "no such account". With Firebase's
 * email-enumeration protection enabled — the default for projects of this vintage, and
 * recommended by Google — both come back as one indistinguishable `invalid-credential`.
 * Any message claiming to tell them apart is a guess presented as fact.
 *
 * The old mapper did exactly that, by matching on exception *message text*:
 *
 *     e.message?.contains("password")      -> "Incorrect password. Please try again."
 *     e.message?.contains("no user record") -> "No account found with this email."
 *
 * Those strings stopped appearing, so both branches became unreachable and every failure
 * fell through to a bare "Login failed." On 2026-07-31 that is what two new hires saw:
 * one had a genuinely wrong password, the other's account had been moved to a different
 * address so it did not exist under her employee ID. Same message. Nobody could tell.
 */
enum class AuthFailure {
    /** Wrong password, OR no account with that identifier. Genuinely indistinguishable. */
    BAD_CREDENTIALS,

    /** The account exists but is disabled — an admin suspended it. */
    ACCOUNT_DISABLED,

    NO_NETWORK,
    TOO_MANY_ATTEMPTS,
    UNKNOWN,
}

/**
 * Message shown to the employee. Pure and exhaustive, so it can be unit-tested without
 * constructing Firebase exceptions (see AuthErrorsTest).
 *
 * BAD_CREDENTIALS names BOTH possibilities rather than picking one, and points at the
 * employee ID specifically — an ID that has been moved to an email login is the failure
 * mode staff cannot diagnose on their own.
 */
fun authFailureMessage(failure: AuthFailure): String = when (failure) {
    AuthFailure.BAD_CREDENTIALS ->
        "Incorrect ID/email or password. If your employee ID stopped working, ask your administrator to check your login."
    AuthFailure.ACCOUNT_DISABLED ->
        "This account has been deactivated. Contact your administrator."
    AuthFailure.NO_NETWORK ->
        "Network error. Check your connection and try again."
    AuthFailure.TOO_MANY_ATTEMPTS ->
        "Too many failed attempts. Please wait a few minutes and try again."
    AuthFailure.UNKNOWN ->
        "Login failed. Please try again."
}

/**
 * Classifies by exception TYPE, never by message text — message strings are not API and
 * change silently when Firebase changes its error reporting, which is precisely how the
 * old mapper rotted.
 */
fun classifyAuthException(e: Exception): AuthFailure = when (e) {
    // Disabled accounts and genuinely absent users both land here; the disabled case is
    // the only one enumeration protection still lets us distinguish, via its error code.
    is FirebaseAuthInvalidUserException ->
        if (e.errorCode == "ERROR_USER_DISABLED") AuthFailure.ACCOUNT_DISABLED
        else AuthFailure.BAD_CREDENTIALS
    is FirebaseAuthInvalidCredentialsException -> AuthFailure.BAD_CREDENTIALS
    is FirebaseNetworkException -> AuthFailure.NO_NETWORK
    is FirebaseTooManyRequestsException -> AuthFailure.TOO_MANY_ATTEMPTS
    else -> AuthFailure.UNKNOWN
}
