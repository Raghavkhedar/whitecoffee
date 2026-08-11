package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.data.model.approvalCoverage
import com.raghav.whitecoffee.data.model.formatGrantedDates
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Partial-leave-approval derivation (docs/superpowers/specs/2026-07-20-partial-leave-approval-design.md).
 *
 * The load-bearing case is the **compatibility rule**: on an approved leave a missing or empty
 * `approvedDates` grants the ENTIRE fromDate…toDate range. Every leave already in Firestore lacks
 * the field, and the Android approve action still writes no `approvedDates` — if this ever flipped
 * to "nothing granted", every historic leave would silently become Absent. That is a payroll bug
 * in the dangerous direction, so it is asserted from both ends (missing and explicitly empty).
 */
class LeaveCoverageTest {

    private fun leave(
        status: String = "approved",
        from: String = "2026-07-21",
        to: String = "2026-07-25",
        approvedDates: List<String> = emptyList(),
        cancelledDates: List<String> = emptyList(),
    ) = LeaveRequest(
        userId = "u1",
        fromDate = from,
        toDate = to,
        totalDays = 5,
        status = status,
        approvedDates = approvedDates,
        cancelledDates = cancelledDates,
    )

    // ── Compatibility rule ───────────────────────────────────────────────────
    @Test
    fun `approved with no approvedDates grants the whole range`() {
        val c = leave().approvalCoverage()
        assertFalse(c.isPartial)
        assertEquals(5, c.requestedDays)
        assertEquals(5, c.grantedDays)
        assertEquals(
            listOf("2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"),
            c.grantedDates,
        )
    }

    @Test
    fun `approved with explicitly empty approvedDates grants the whole range`() {
        val c = leave(approvedDates = emptyList()).approvalCoverage()
        assertFalse(c.isPartial)
        assertEquals(5, c.grantedDays)
    }

    // ── Partial ──────────────────────────────────────────────────────────────
    @Test
    fun `approved subset is partial with the granted day count`() {
        val c = leave(approvedDates = listOf("2026-07-21", "2026-07-22", "2026-07-24")).approvalCoverage()
        assertTrue(c.isPartial)
        assertEquals(5, c.requestedDays)
        assertEquals(3, c.grantedDays)
        assertEquals(listOf("2026-07-21", "2026-07-22", "2026-07-24"), c.grantedDates)
    }

    @Test
    fun `approved with every date listed is not partial`() {
        val all = listOf("2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25")
        val c = leave(approvedDates = all).approvalCoverage()
        assertFalse(c.isPartial)
        assertEquals(5, c.grantedDays)
    }

    @Test
    fun `granted dates are sorted and de-duplicated`() {
        val c = leave(approvedDates = listOf("2026-07-24", "2026-07-21", "2026-07-24")).approvalCoverage()
        assertEquals(listOf("2026-07-21", "2026-07-24"), c.grantedDates)
        assertEquals(2, c.grantedDays)
    }

    @Test
    fun `dates outside the requested range are ignored`() {
        // The requested range still bounds the grant, matching the backend predicate.
        val c = leave(approvedDates = listOf("2026-07-21", "2026-08-01")).approvalCoverage()
        assertEquals(listOf("2026-07-21"), c.grantedDates)
        assertEquals(1, c.grantedDays)
        assertTrue(c.isPartial)
    }

    // ── Non-approved ─────────────────────────────────────────────────────────
    @Test
    fun `pending grants nothing and is never partial`() {
        val c = leave(status = "pending").approvalCoverage()
        assertFalse(c.isPartial)
        assertEquals(0, c.grantedDays)
        assertEquals(emptyList<String>(), c.grantedDates)
    }

    @Test
    fun `rejected grants nothing even with approvedDates present`() {
        val c = leave(status = "rejected", approvedDates = listOf("2026-07-21")).approvalCoverage()
        assertFalse(c.isPartial)
        assertEquals(0, c.grantedDays)
    }

    // ── Degenerate input ─────────────────────────────────────────────────────
    @Test
    fun `single day request is never partial when fully granted`() {
        val c = leave(from = "2026-07-21", to = "2026-07-21", approvedDates = listOf("2026-07-21"))
            .approvalCoverage()
        assertFalse(c.isPartial)
        assertEquals(1, c.requestedDays)
        assertEquals(1, c.grantedDays)
    }

    @Test
    fun `unparseable dates fall back to totalDays and never claim partial`() {
        val c = leave(from = "", to = "").approvalCoverage()
        assertEquals(5, c.requestedDays)
        assertFalse(c.isPartial)
    }

    @Test
    fun `inverted range yields no requested days and no partial claim`() {
        val c = LeaveRequest(
            fromDate = "2026-07-25",
            toDate = "2026-07-21",
            totalDays = 0,
            status = "approved",
            approvedDates = listOf("2026-07-22"),
        ).approvalCoverage()
        assertEquals(0, c.requestedDays)
        assertFalse(c.isPartial)
    }

    // ── Cancellation (admin-only overlay; the app only ever reads it) ────────
    @Test
    fun `cancelling a day removes it from the effective grant`() {
        val c = leave(cancelledDates = listOf("2026-07-23")).approvalCoverage()
        assertTrue(c.isCancelled)
        assertTrue(c.isPartiallyCancelled)
        assertEquals(listOf("2026-07-23"), c.cancelledDates)
        assertEquals(4, c.effectiveGrantedDays)
        assertEquals(
            listOf("2026-07-21", "2026-07-22", "2026-07-24", "2026-07-25"),
            c.effectiveGrantedDates,
        )
    }

    // The original grant is the RECORD of what the approver decided and must never shrink —
    // cancellation adds an overlay, it does not rewrite history.
    @Test
    fun `cancelling does not alter the original granted dates`() {
        val c = leave(cancelledDates = listOf("2026-07-23")).approvalCoverage()
        assertEquals(5, c.grantedDays)
        assertEquals(
            listOf("2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"),
            c.grantedDates,
        )
        assertFalse(c.isPartial)
    }

    @Test
    fun `cancelling every granted day leaves nothing and is not partial cancellation`() {
        val all = listOf("2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25")
        val c = leave(cancelledDates = all).approvalCoverage()
        assertTrue(c.isCancelled)
        assertFalse(c.isPartiallyCancelled)
        assertEquals(0, c.effectiveGrantedDays)
        assertEquals(emptyList<String>(), c.effectiveGrantedDates)
    }

    @Test
    fun `cancellation composes with a partial approval`() {
        val c = leave(
            approvedDates = listOf("2026-07-21", "2026-07-22", "2026-07-24"),
            cancelledDates = listOf("2026-07-22"),
        ).approvalCoverage()
        assertTrue(c.isPartial)          // 3 of 5 originally granted
        assertEquals(3, c.grantedDays)
        assertTrue(c.isCancelled)
        assertEquals(2, c.effectiveGrantedDays)
        assertEquals(listOf("2026-07-21", "2026-07-24"), c.effectiveGrantedDates)
    }

    // Empty cancelledDates must NOT mirror the approvedDates compatibility rule. Reading it as
    // "everything cancelled" would silently revoke every leave in the database at once.
    @Test
    fun `empty cancelledDates cancels nothing`() {
        val c = leave(cancelledDates = emptyList()).approvalCoverage()
        assertFalse(c.isCancelled)
        assertEquals(5, c.effectiveGrantedDays)
        assertEquals(c.grantedDates, c.effectiveGrantedDates)
    }

    @Test
    fun `a day that was never granted cannot be cancelled`() {
        val c = leave(
            approvedDates = listOf("2026-07-21"),
            cancelledDates = listOf("2026-07-23"),   // granted only 21st
        ).approvalCoverage()
        assertFalse(c.isCancelled)
        assertEquals(emptyList<String>(), c.cancelledDates)
        assertEquals(1, c.effectiveGrantedDays)
    }

    @Test
    fun `a cancelled date outside the requested range is ignored`() {
        val c = leave(cancelledDates = listOf("2026-08-01")).approvalCoverage()
        assertFalse(c.isCancelled)
        assertEquals(5, c.effectiveGrantedDays)
    }

    @Test
    fun `cancelled dates are sorted and de-duplicated`() {
        val c = leave(cancelledDates = listOf("2026-07-24", "2026-07-22", "2026-07-24"))
            .approvalCoverage()
        assertEquals(listOf("2026-07-22", "2026-07-24"), c.cancelledDates)
        assertEquals(3, c.effectiveGrantedDays)
    }

    @Test
    fun `cancellation on a pending request grants nothing either way`() {
        val c = leave(status = "pending", cancelledDates = listOf("2026-07-23")).approvalCoverage()
        assertEquals(0, c.grantedDays)
        assertEquals(0, c.effectiveGrantedDays)
        assertFalse(c.isCancelled)
    }

    // ── Display formatting ───────────────────────────────────────────────────
    @Test
    fun `granted dates format compactly within one month`() {
        assertEquals(
            "21, 22, 24 Jul",
            formatGrantedDates(listOf("2026-07-21", "2026-07-22", "2026-07-24")),
        )
    }

    @Test
    fun `granted dates spanning two months name each month`() {
        assertEquals(
            "31 Jul · 1 Aug",
            formatGrantedDates(listOf("2026-07-31", "2026-08-01")),
        )
    }

    @Test
    fun `formatting empty or junk dates yields empty string`() {
        assertEquals("", formatGrantedDates(emptyList()))
        assertEquals("", formatGrantedDates(listOf("not-a-date")))
    }

    /**
     * The exact document behind the 2026-08-11 report that the app "shows approved for 5 days"
     * when only 3 were granted (Sachin Kumar, `leave_requests/ytnA8KUANiBXRSCSus5e`). Pinned
     * from live Firestore so a regression here is caught against the real payload, not a
     * hand-made one — the reported bug turned out to be a stale APK, and this is the assertion
     * that proves which side is at fault next time.
     */
    @Test
    fun `real partial approval from Firestore reads as 3 of 5`() {
        val c = leave(
            from = "2026-08-27",
            to = "2026-08-31",
            approvedDates = listOf("2026-08-28", "2026-08-29", "2026-08-30"),
        ).approvalCoverage()
        assertTrue(c.isPartial)
        assertEquals(5, c.requestedDays)
        assertEquals(3, c.grantedDays)
        assertEquals(3, c.effectiveGrantedDays)
        assertEquals("28, 29, 30 Aug", formatGrantedDates(c.effectiveGrantedDates))
    }
}
