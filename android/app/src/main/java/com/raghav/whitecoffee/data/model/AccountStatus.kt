package com.raghav.whitecoffee.data.model

sealed interface AccountStatus {
    data object Active : AccountStatus
    data class Suspended(val reason: String, val expectedReturn: String) : AccountStatus
}

/** Pure mapper from the user doc's suspension fields to a UI-facing status. */
fun accountStatusFrom(active: Boolean, reason: String, expectedReturn: String): AccountStatus =
    if (active) AccountStatus.Active
    else AccountStatus.Suspended(reason = reason, expectedReturn = expectedReturn)

/**
 * One emission of the signed-in user's account document — everything the app root watches.
 *
 * [activeSessionToken] is `""` when the field is absent as well as when it is empty; the two
 * cases are indistinguishable to the app because neither ever invalidates a session (see
 * [isSessionSuperseded]).
 */
data class AccountSnapshot(
    val status: AccountStatus,
    val activeSessionToken: String,
)

/**
 * True when the server says some *other* device now owns this account — the single-device
 * session rule (decision #34a).
 *
 * An absent or empty server token means "no session recorded", NOT "your session is stale", so
 * it must never sign anyone out: a user whose doc predates the token field would otherwise be
 * ejected on every snapshot. Only a non-empty token that differs from the one this device
 * cached counts as being superseded.
 */
fun isSessionSuperseded(serverToken: String, localToken: String): Boolean =
    serverToken.isNotEmpty() && serverToken != localToken
