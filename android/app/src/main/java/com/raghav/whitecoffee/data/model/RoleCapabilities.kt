package com.raghav.whitecoffee.data.model

import com.raghav.whitecoffee.data.session.SessionManager

/**
 * Single source of truth for the axes on which the four account roles differ.
 *
 * The codebase historically wrote almost every role decision as a binary
 * `isOps ? (site behavior) : (office behavior)`. Adding a fourth role, `sales`, that is a
 * *mix* of office and operations behavior would silently land in the office branch everywhere
 * — correct for the status window, but wrong for the hybrid check-in events and for conveyance.
 * This object centralizes those axes so `office`/`operations`/`admin` behavior is unchanged and
 * `sales` is defined entirely by its column.
 *
 * This table is mirrored on the other two sides of the monorepo (`admin/src/lib/roleCapabilities.ts`
 * and `firebase/functions/roleCapabilities.js`) — they must stay in lockstep.
 *
 * | capability            | office     | operations       | sales                          | admin      |
 * |-----------------------|------------|------------------|--------------------------------|------------|
 * | attendanceInTypes     | office_in  | site_in,market_in| office_in,site_in,market_in    | office_in  |
 * | attendanceOutTypes    | office_out | site_out,market_out | office_out,site_out,market_out | office_out |
 * | usesFixedWindow       | true       | false            | true                           | true       |
 * | usesOtShortageLedger  | false      | true             | false                          | false      |
 * | tracksShortage        | true       | true             | false                          | true       |
 * | usesConveyance        | false      | true             | true                           | false      |
 * | getsCategories        | false      | true             | false                          | false      |
 * | inManpowerReports     | false      | true             | false                          | false      |
 *
 * Unknown roles (and `admin`) fall through to the office column, matching the app's historical
 * "admin behaves as office for attendance" rule.
 */
object RoleCapabilities {

    /** Event types that count as a check-IN for this role's daily-status scoring. */
    fun attendanceInTypes(role: String): List<String> = when (role) {
        SessionManager.ROLE_OPERATIONS -> listOf(AttendanceType.SITE_IN, AttendanceType.MARKET_IN)
        SessionManager.ROLE_SALES ->
            listOf(AttendanceType.OFFICE_IN, AttendanceType.SITE_IN, AttendanceType.MARKET_IN)
        else -> listOf(AttendanceType.OFFICE_IN) // office + admin
    }

    /** Event types that count as a check-OUT for this role's daily-status scoring. */
    fun attendanceOutTypes(role: String): List<String> = when (role) {
        SessionManager.ROLE_OPERATIONS -> listOf(AttendanceType.SITE_OUT, AttendanceType.MARKET_OUT)
        SessionManager.ROLE_SALES ->
            listOf(AttendanceType.OFFICE_OUT, AttendanceType.SITE_OUT, AttendanceType.MARKET_OUT)
        else -> listOf(AttendanceType.OFFICE_OUT) // office + admin
    }

    /**
     * True when daily status is scored against the fixed 10:00–18:00 window (office/admin/sales);
     * false for operations, which is scored against the day's admin-set planned shift.
     */
    fun usesFixedWindow(role: String): Boolean = role != SessionManager.ROLE_OPERATIONS

    /** True when the role accrues OT / shortage ledger entries. Operations only. */
    fun usesOtShortageLedger(role: String): Boolean = role == SessionManager.ROLE_OPERATIONS

    /**
     * True when the role has a shortage / OT concept at all. Deliberately distinct from
     * [usesOtShortageLedger]: office/admin keep no ledger yet still have shortage measured
     * against the fixed window (shown on the portal's Working Hours page). Sales is the one
     * fixed-window role scored for STATUS ONLY, so it is the only role that tracks nothing.
     */
    fun tracksShortage(role: String): Boolean = role != SessionManager.ROLE_SALES

    /** True when the role earns conveyance from field visits. Operations and sales. */
    fun usesConveyance(role: String): Boolean =
        role == SessionManager.ROLE_OPERATIONS || role == SessionManager.ROLE_SALES

    /** True when the role carries employee-category labor codes. Operations only. */
    fun getsCategories(role: String): Boolean = role == SessionManager.ROLE_OPERATIONS

    /** True when the role appears in manpower / labor tracking reports. Operations only. */
    fun inManpowerReports(role: String): Boolean = role == SessionManager.ROLE_OPERATIONS
}
