package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.eventsAreStale
import com.raghav.whitecoffee.data.model.isEventAllowed
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.notification.AttendanceEntry
import com.raghav.whitecoffee.data.notification.AttendanceNotifier
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.session.SessionManager
import com.raghav.whitecoffee.data.time.Clock
import com.raghav.whitecoffee.domain.RecordAttendanceEventUseCase
import com.raghav.whitecoffee.domain.RecordEventOutcome
import com.raghav.whitecoffee.domain.toUserMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// SiteRepository + SiteTask imports removed — daily assignment system commented out.
// To re-enable: import SiteRepository, SiteTask; restore _assignedSites, loadSites(),
// ActionState.SiteSelectionRequired, initiateSiteCheckIn() site-picker logic,
// confirmSiteCheckIn(SiteTask) with Haversine geofence check, and getTaskForSite().

@HiltViewModel
class AttendanceViewModel @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider,
    private val sessionManager: SessionManager,
    private val recordAttendanceEvent: RecordAttendanceEventUseCase,
    private val clock: Clock,
    private val notifier: AttendanceNotifier,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _uiState = MutableStateFlow(AttendanceUiState())
    val uiState: StateFlow<AttendanceUiState> = _uiState.asStateFlow()

    private fun setAction(action: ActionState) = _uiState.update { it.copy(action = action) }

    private fun setError(message: String) = setAction(ActionState.Error(message))

    val isOperations: Boolean get() = sessionManager.isOperations

    // Double-tap / re-entrancy guard. ViewModel methods are called on the main thread, so a plain
    // flag is race-free here: a second tap arriving before the first write finishes is dropped,
    // preventing duplicate attendance docs (stress test #2.1) even if the button re-enables early.
    private var isSubmitting = false

    private fun submitEvent(block: suspend () -> Unit) {
        if (isSubmitting) return
        isSubmitting = true
        viewModelScope.launch {
            try {
                block()
            } finally {
                isSubmitting = false
            }
        }
    }

    private fun currentAttendanceState(): AttendanceState =
        (_uiState.value.day as? UiState.Success)?.data ?: AttendanceState.NoRecord

    // Write-time guard against the button-visibility gate being stale (e.g. a check-in button
    // still on screen for a moment after home_out landed). Checked right before every event write
    // so an out-of-order tap can never reach Firestore, not just fail to render afterwards.
    //
    // Freshness comes first and matters more: the phase rules below are correct code, and reading
    // them against yesterday's events is exactly how a punch gets authorised for a day that ended.
    private suspend fun guardEvent(type: String): Boolean {
        if (refuseStaleDay()) return false

        val state = currentAttendanceState()
        if (isEventAllowed(state, type)) return true
        setError(
            if (state is AttendanceState.DayComplete) "Your day is already complete."
            else "That action isn't available right now. Pull down to refresh."
        )
        return false
    }

    /**
     * Refuses the punch when the events on screen belong to a different day, re-subscribes, and
     * says so.
     *
     * The day-rollover fix on the operations side. `observeTodayData()` used to bake
     * `LocalDate.now()` into its Firestore query outside the flow builder, so an app left open
     * overnight kept receiving yesterday's documents; the phase derived from them still looked
     * like an open site visit, and the `site_out` it authorised was stamped with the real today —
     * leaving yesterday with an unclosed `site_in`, which the nightly compute scores LNF = half pay.
     *
     * The message lands in [ActionState], which is a separate field from `day`, so the reload
     * kicked off here cannot wipe the explanation off the screen the way it would on the office
     * side.
     */
    private fun refuseStaleDay(): Boolean {
        if (!eventsAreStale(_uiState.value.events, clock.today())) return false
        loadTodayData()
        setError(ROLLOVER_MESSAGE)
        return true
    }

    sealed interface ActionState {
        data object Idle : ActionState
        data object Loading : ActionState
        data class Error(val message: String) : ActionState
        data object Success : ActionState
        // User must type Site Name + Site ID — shown as a dialog with two text fields
        data object SiteInputRequired : ActionState
        data class MarketNameRequired(val currentLat: Double, val currentLng: Double) : ActionState
    }

    init {
        loadTodayData()
    }

    private var todayJob: Job? = null

    /**
     * Subscribes to today's punches. Called from `init` **and from the fragment's `onResume`** —
     * an app brought back to the foreground the next morning must not keep yesterday's day on
     * screen while it waits for the rollover poll.
     *
     * The previous subscription is cancelled first. Without that, every resume would stack another
     * collector on the same flow and each emission would be applied N times.
     */
    fun loadTodayData() {
        todayJob?.cancel()
        todayJob = viewModelScope.launch {
            _uiState.update { it.copy(day = UiState.Loading()) }
            attendanceRepository.observeTodayData()
                .catch { e ->
                    _uiState.update {
                        it.copy(day = UiState.Error("Failed to load attendance. Try again."))
                    }
                }
                .collect { (state, events) ->
                    // One update, not two. The buttons key off `day` and the timeline off
                    // `events`; as separate flows the screen could render a site check-in whose
                    // event had not appeared in the timeline yet.
                    _uiState.update { it.copy(day = UiState.Success(state), events = events) }
                    syncSessionReminder(state)
                }
        }
    }

    // ── Home Check In ─────────────────────────────────────────────────────

    fun homeCheckIn() = submitEvent { record(AttendanceType.HOME_IN) }

    // ── Home Check Out ────────────────────────────────────────────────────

    fun homeCheckOut() = submitEvent { record(AttendanceType.HOME_OUT) }

    // ── Site Check In — Step 1: Show dialog for user to type Site Name + Site ID ──

    // Launched rather than run inline because the guard is now suspending (a stale day awaits
    // nothing, but the freshness check lives on the same path as the write guards).
    fun initiateSiteCheckIn() {
        viewModelScope.launch {
            if (!guardEvent(AttendanceType.SITE_IN)) return@launch
            setAction(ActionState.SiteInputRequired)
        }
    }

    // ── Site Check In — Step 2: User typed site name + ID, record event ───
    // Geofence validation removed — user checks in from wherever they are.

    fun confirmSiteCheckIn(siteId: String, siteName: String) {
        if (siteName.isBlank()) {
            setError("Please enter the site name.")
            return
        }
        submitEvent {
            record(AttendanceType.SITE_IN, siteId = siteId.trim(), siteName = siteName.trim())
        }
    }

    // ── Site Check Out ────────────────────────────────────────────────────

    fun siteCheckOut(siteId: String, siteName: String) = submitEvent {
        record(AttendanceType.SITE_OUT, siteId = siteId, siteName = siteName)
    }

    // ── Market Check In — Step 1: Get location first ──────────────────────

    fun initiateMarketCheckIn() = submitEvent {
        if (!guardEvent(AttendanceType.MARKET_IN)) return@submitEvent
        setAction(ActionState.Loading)
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success ->
                setAction(ActionState.MarketNameRequired(location.latitude, location.longitude))
            else -> setError(location.toUserMessage())
        }
    }

    // ── Market Check In — Step 2: User entered market name ───────────────
    // If currently SiteCheckedIn, auto-records site_out first (same GPS coords),
    // then records market_in. Both events appear in the timeline.

    fun confirmMarketCheckIn(marketName: String, latitude: Double, longitude: Double) {
        if (marketName.isBlank()) {
            setError("Please enter the market name.")
            return
        }
        submitEvent {
            if (!guardEvent(AttendanceType.MARKET_IN)) return@submitEvent
            setAction(ActionState.Loading)

            val currentState = currentAttendanceState()
            if (currentState is AttendanceState.SiteCheckedIn) {
                val siteRecord = currentState.record
                val siteOutResult = attendanceRepository.recordEvent(
                    type = AttendanceType.SITE_OUT,
                    latitude = latitude, longitude = longitude,
                    siteId = siteRecord.siteId, siteName = siteRecord.siteName,
                )
                if (siteOutResult.isFailure) {
                    setError(
                        siteOutResult.exceptionOrNull()?.message ?: "Failed to auto check-out from site."
                    )
                    return@submitEvent
                }
            }

            val result = attendanceRepository.recordEvent(
                type = AttendanceType.MARKET_IN,
                latitude = latitude, longitude = longitude,
                marketName = marketName.trim(),
            )
            handleResult(result)
        }
    }

    // ── Market Check Out ──────────────────────────────────────────────────

    fun marketCheckOut(marketName: String) = submitEvent {
        record(AttendanceType.MARKET_OUT, marketName = marketName)
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /**
     * Records one punch and reflects the outcome in [ActionState].
     *
     * The legality check happens inside the use case, immediately before the write — see
     * [RecordAttendanceEventUseCase]. Setting Loading first costs nothing: a rejected punch
     * returns without suspending, so the UI never observes the intermediate state.
     */
    private suspend fun record(
        type: String,
        siteId: String = "",
        siteName: String = "",
        marketName: String = "",
    ) {
        // Freshness only — the legality check stays inside the use case, immediately before the
        // write. The use case is handed `currentAttendanceState()`, so if the events behind it
        // belong to another day it would authorise from the wrong one and never know.
        if (refuseStaleDay()) return

        setAction(ActionState.Loading)
        val outcome = recordAttendanceEvent(
            state = currentAttendanceState(),
            type = type,
            siteId = siteId,
            siteName = siteName,
            marketName = marketName,
        )
        setAction(
            when (outcome) {
                is RecordEventOutcome.Recorded -> ActionState.Success
                is RecordEventOutcome.NotAllowed -> ActionState.Error(
                    if (outcome.dayAlreadyComplete) "Your day is already complete."
                    else "That action isn't available right now. Pull down to refresh."
                )
                is RecordEventOutcome.NoLocation -> ActionState.Error(outcome.state.toUserMessage())
                is RecordEventOutcome.Failed -> ActionState.Error(
                    outcome.error.message ?: "Something went wrong. Try again."
                )
            }
        )
    }

    private fun handleResult(result: Result<AttendanceRecord>) {
        setAction(
            if (result.isSuccess) ActionState.Success
            else ActionState.Error(result.exceptionOrNull()?.message ?: "Something went wrong. Try again.")
        )
    }

    /**
     * Keeps the ongoing "still checked in" reminder in step with the day.
     *
     * Driven off the live derived state, so it is posted the moment a `site_in`/`market_in` lands
     * and cleared by the matching check-out, by `home_out`, and by the day never having opened.
     * The open **field** session is the one that costs money: a `site_in` with no `site_out`
     * leaves the day with a single punch, which the nightly compute scores LNF = half pay.
     * `home_in` is a commute marker and is never scored, so it gets no reminder.
     */
    private fun syncSessionReminder(state: AttendanceState) {
        when (state) {
            is AttendanceState.SiteCheckedIn ->
                notifier.showCheckedIn(state.record.displayTime(), AttendanceEntry.OPERATIONS)
            is AttendanceState.MarketCheckedIn ->
                notifier.showCheckedIn(state.record.displayTime(), AttendanceEntry.OPERATIONS)
            else -> notifier.clear()
        }
    }

    fun resetActionState() = setAction(ActionState.Idle)

    private companion object {
        const val ROLLOVER_MESSAGE =
            "The date changed while this screen was open, so today's attendance has been " +
                "reloaded. Nothing was recorded — check the day above and tap again."
    }
}

/**
 * Everything the operations attendance screen renders, as one value.
 *
 * [day] drives which buttons exist and [events] drives the timeline below them. They are derived
 * from the same repository emission and so are updated together — as separate flows the screen
 * could show a site check-in whose event had not yet reached the timeline.
 */
data class AttendanceUiState(
    val day: UiState<AttendanceState> = UiState.Loading(),
    val events: List<AttendanceRecord> = emptyList(),
    val action: AttendanceViewModel.ActionState = AttendanceViewModel.ActionState.Idle,
)
