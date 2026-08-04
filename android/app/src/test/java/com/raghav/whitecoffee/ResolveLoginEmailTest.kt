package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.repository.FirebaseAuthRepository
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * ⚠️ MIRROR SUITE. Every case here also exists in `admin/src/lib/constants.test.ts`
 * (`npx tsx`). The app and the portal must accept exactly the same login identifiers —
 * a divergence means an employee can sign in on the phone but not the portal, or the
 * reverse, and it would surface only as "wrong credentials" with no way to tell why.
 *
 * If you change the rule on one side, change it on the other AND update both suites.
 */
class ResolveLoginEmailTest {

    private fun resolve(identifier: String) =
        FirebaseAuthRepository.resolveLoginEmail(identifier)

    @Test
    fun `an employee id becomes a synthetic login`() {
        assertEquals("s464@whitecoffee.internal", resolve("s464"))
    }

    @Test
    fun `an employee id is lowercased`() {
        assertEquals("s464@whitecoffee.internal", resolve("S464"))
    }

    @Test
    fun `surrounding whitespace is trimmed`() {
        assertEquals("s464@whitecoffee.internal", resolve("  S464  "))
    }

    @Test
    fun `mixed case ids normalise identically`() {
        assertEquals("emp001@whitecoffee.internal", resolve("EmP001"))
    }

    @Test
    fun `anything containing an at sign is already a login email`() {
        assertEquals("admin@senken.com", resolve("admin@senken.com"))
    }

    @Test
    fun `a login email is lowercased and trimmed`() {
        assertEquals("admin@senken.com", resolve(" Admin@Senken.com "))
    }

    @Test
    fun `a personal address passes through untouched`() {
        // The real 2026-07-31 case: an employee whose Auth login was moved to a personal
        // address. Typing her employee ID resolves to an account that does not exist.
        assertEquals("rinki66228@gmail.com", resolve("rinki66228@gmail.com"))
    }

    @Test
    fun `a synthetic address typed in full is accepted as-is`() {
        assertEquals("s464@whitecoffee.internal", resolve("S464@whitecoffee.internal"))
    }

    @Test
    fun `the login domain matches the portal constant`() {
        assertEquals("whitecoffee.internal", FirebaseAuthRepository.LOGIN_EMAIL_DOMAIN)
    }
}
