package com.raghav.whitecoffee.data.model

sealed interface AccountStatus {
    data object Active : AccountStatus
    data class Suspended(val reason: String, val expectedReturn: String) : AccountStatus
}

/** Pure mapper from the user doc's suspension fields to a UI-facing status. */
fun accountStatusFrom(active: Boolean, reason: String, expectedReturn: String): AccountStatus =
    if (active) AccountStatus.Active
    else AccountStatus.Suspended(reason = reason, expectedReturn = expectedReturn)
