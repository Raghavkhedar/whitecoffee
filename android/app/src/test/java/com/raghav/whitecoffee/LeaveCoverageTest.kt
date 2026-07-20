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
    ) = LeaveRequest(
        userId = "u1",
        fromDate = from,
        toDate = to,
        totalDays = 5,
        status = status,
        approvedDates = approvedDates,
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
}
