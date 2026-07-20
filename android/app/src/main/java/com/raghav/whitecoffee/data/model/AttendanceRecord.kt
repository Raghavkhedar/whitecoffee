package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

/**
 * Attendance event types — every check-in and check-out
 * is a separate document in the attendance collection.
 */
object AttendanceType {
    const val HOME_IN     = "home_in"
    const val HOME_OUT    = "home_out"
    const val SITE_IN     = "site_in"
    const val SITE_OUT    = "site_out"
    const val MARKET_IN   = "market_in"
    const val MARKET_OUT  = "market_out"
    // Office role — simple check-in/out only
    const val OFFICE_IN   = "office_in"
    const val OFFICE_OUT  = "office_out"

    // Operations attendance is scored on the first arrival and last departure across site and
    // market visits — home_in/home_out are commute markers only. Mirrors OPS_IN_TYPES /
    // OPS_OUT_TYPES in the computeDailyAttendanceStatus cloud function.
    val OPS_IN_TYPES  = setOf(SITE_IN, MARKET_IN)
    val OPS_OUT_TYPES = setOf(SITE_OUT, MARKET_OUT)
}

/**
 * Represents the current attendance state of the user for today.
 * Derived by reading all today's attendance events in order.
 */
sealed interface AttendanceState {
    data object NoRecord : AttendanceState
    data class HomeCheckedIn(val record: AttendanceRecord) : AttendanceState
    data class SiteCheckedIn(val record: AttendanceRecord) : AttendanceState
    data class MarketCheckedIn(val record: AttendanceRecord) : AttendanceState
    data object DayComplete : AttendanceState
}

data class AttendanceRecord(
    @DocumentId
    val id: String = "",
    val userId: String = "",
    val employeeId: String = "",
    val userName: String = "",
    val date: String = "",
    val type: String = "",          // AttendanceType constant
    val timestamp: Timestamp? = null,
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val siteId: String = "",
    val siteName: String = "",
    val marketName: String = "",
    val locationName: String = "",  // office check-in/out: free-text location entered by user
    // Whether the location fix came from a mock provider. Recorded for the server-side
    // integrity verdict; NEVER used to block a check-in locally.
    val isMockLocation: Boolean = false
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "userId"       to userId,
        "employeeId"   to employeeId,
        "userName"     to userName,
        "date"         to date,
        "type"         to type,
        "timestamp"    to timestamp,
        "latitude"     to latitude,
        "longitude"    to longitude,
        "siteId"       to siteId,
        "siteName"     to siteName,
        "marketName"   to marketName,
        "locationName" to locationName,
        "isMockLocation" to isMockLocation
    )

    /** Display time — hh:mm a format from Firestore Timestamp */
    fun displayTime(): String {
        val ts = timestamp ?: return ""
        val sdf = java.text.SimpleDateFormat("hh:mm a", java.util.Locale.getDefault())
        return sdf.format(ts.toDate())
    }

    companion object {
        fun fromDocument(doc: DocumentSnapshot): AttendanceRecord? {
            return try {
                AttendanceRecord(
                    id          = doc.id,
                    userId      = doc.getString("userId") ?: return null,
                    employeeId  = doc.getString("employeeId") ?: "",
                    userName    = doc.getString("userName") ?: "",
                    date        = doc.getString("date") ?: return null,
                    type        = doc.getString("type") ?: return null,
                    timestamp   = doc.getTimestamp("timestamp"),
                    latitude    = doc.getDouble("latitude") ?: 0.0,
                    longitude   = doc.getDouble("longitude") ?: 0.0,
                    siteId       = doc.getString("siteId") ?: "",
                    siteName     = doc.getString("siteName") ?: "",
                    marketName   = doc.getString("marketName") ?: "",
                    locationName = doc.getString("locationName") ?: "",
                    isMockLocation = doc.getBoolean("isMockLocation") ?: false
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}

/**
 * Derives the current AttendanceState from an ordered list of today's events.
 *
 * HOME_OUT is terminal: once it has fired, the day stays DayComplete no matter what shows up
 * after it in the list. Without this, a stray event recorded post-checkout (e.g. a UI race where
 * a check-in button was tapped in the moment before the screen re-rendered to the closed state)
 * would flip the day back open, since a naive "last event wins" read has no way to tell the
 * difference between that and a legitimate new cycle.
 */
fun deriveAttendanceState(events: List<AttendanceRecord>): AttendanceState {
    if (events.isEmpty()) return AttendanceState.NoRecord
    if (events.any { it.type == AttendanceType.HOME_OUT }) return AttendanceState.DayComplete
    return when (events.last().type) {
        AttendanceType.HOME_IN    -> AttendanceState.HomeCheckedIn(events.last())
        AttendanceType.HOME_OUT   -> AttendanceState.DayComplete
        AttendanceType.SITE_IN    -> AttendanceState.SiteCheckedIn(events.last())
        AttendanceType.SITE_OUT   -> AttendanceState.HomeCheckedIn(events.last())
        AttendanceType.MARKET_IN  -> AttendanceState.MarketCheckedIn(events.last())
        AttendanceType.MARKET_OUT -> AttendanceState.HomeCheckedIn(events.last())
        else                      -> AttendanceState.NoRecord
    }
}

/**
 * Whether recording an event of [type] is a legal transition from [state]. Write-time guard —
 * checked by the ViewModel before it ever calls the repository — so a stray tap on a stale button
 * (e.g. one still visible mid-recomposition right after home_out) can't reach Firestore, rather
 * than relying solely on the UI only ever showing the "right" buttons.
 */
fun isEventAllowed(state: AttendanceState, type: String): Boolean = when (type) {
    AttendanceType.HOME_IN    -> state is AttendanceState.NoRecord
    AttendanceType.HOME_OUT   -> state is AttendanceState.HomeCheckedIn
    AttendanceType.SITE_IN    -> state is AttendanceState.HomeCheckedIn
    AttendanceType.SITE_OUT   -> state is AttendanceState.SiteCheckedIn
    AttendanceType.MARKET_IN  -> state is AttendanceState.HomeCheckedIn || state is AttendanceState.SiteCheckedIn
    AttendanceType.MARKET_OUT -> state is AttendanceState.MarketCheckedIn
    else                      -> false
}

/**
 * Whether logging out right now would close the user's day — i.e. whether MainViewModel's
 * auto-checkout would write a HOME_OUT, which is terminal (see [deriveAttendanceState]).
 *
 * Single source of truth for that question, used by BOTH the auto-checkout itself (as its guard)
 * and the home screen (to decide whether logging out needs a confirmation). Answering it in two
 * places would let the warning drift from the behaviour it warns about.
 *
 * The two branches differ and must: operations act on the live [AttendanceState], while office
 * keys on the once-per-day home_in/home_out gates because [deriveAttendanceState] has no branch
 * for office_in/office_out and reports NoRecord mid-office-day. **Sales dispatches on the actual
 * state, NOT the role** — it is hybrid, so the open day cannot be inferred from the role.
 */
fun willLogoutCloseDay(
    state: AttendanceState,
    events: List<AttendanceRecord>,
    isOperations: Boolean,
    isSales: Boolean,
): Boolean {
    val inField = state is AttendanceState.SiteCheckedIn || state is AttendanceState.MarketCheckedIn
    return if (isOperations || (isSales && inField)) {
        state is AttendanceState.SiteCheckedIn ||
            state is AttendanceState.MarketCheckedIn ||
            state is AttendanceState.HomeCheckedIn
    } else {
        events.any { it.type == AttendanceType.HOME_IN } &&
            events.none { it.type == AttendanceType.HOME_OUT }
    }
}