package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.model.AccountStatus
import com.raghav.whitecoffee.data.model.accountStatusFrom
import org.junit.Assert.assertEquals
import org.junit.Test

class AccountStatusTest {

    @Test fun `active true maps to Active`() {
        assertEquals(AccountStatus.Active, accountStatusFrom(active = true, reason = "x", expectedReturn = "y"))
    }

    @Test fun `active false maps to Suspended carrying reason and return`() {
        assertEquals(
            AccountStatus.Suspended(reason = "Policy breach", expectedReturn = "2026-08-01"),
            accountStatusFrom(active = false, reason = "Policy breach", expectedReturn = "2026-08-01"),
        )
    }

    @Test fun `suspended with blank return is still Suspended`() {
        assertEquals(
            AccountStatus.Suspended(reason = "No reason given", expectedReturn = ""),
            accountStatusFrom(active = false, reason = "No reason given", expectedReturn = ""),
        )
    }
}
