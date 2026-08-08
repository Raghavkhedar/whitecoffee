package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.OfficeState
import com.raghav.whitecoffee.data.model.deriveOfficeState
import com.raghav.whitecoffee.data.model.eventsAreStale
import com.raghav.whitecoffee.data.model.isOfficeEventAllowed
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.notification.AttendanceEntry
import com.raghav.whitecoffee.data.notification.AttendanceNotifier
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.time.Clock
import com.raghav.whitecoffee.domain.toUserMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class OfficeAttendanceViewModel @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider,
    private val clock: Clock,
    private val notifier: AttendanceNotifier,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _uiState = MutableStateFlow(OfficeAttendanceUiState())
    val uiState: StateFlow<OfficeAttendanceUiState> = _uiState.asStateFlow()

    private fun setState(state: OfficeState) = _uiState.update { it.copy(day = state) }

    /**
     * Write-time legality check, run immediately before every office write.
     *
     * The operations flow has always had this; the office flow had nothing, so a stale button —
     * or a tap landing in the frame after `home_out` — wrote straight to Firestore and reopened a
     * finished day. Checking here rather than at render time is the point: the buttons are UX,
     * this is the guarantee.
     *
     * The current phase is re-derived from the events rather than read from [_uiState] so a
     * transient Loading/Error state cannot mask the real one and wave a punch through.
     *
     * **Freshness is checked before the phase, and it is the more important half.** The phase
     * rules are perfectly correct code reading the wrong day; see [refuseStaleDay].
     */
    private suspend fun guard(type: String): Boolean {
        if (refuseStaleDay()) return false

        val state = deriveOfficeState(_uiState.value.events)
        if (isOfficeEventAllowed(state, type)) return true
        setState(
            OfficeState.Error(
                when {
                    state is OfficeState.DayEnded -> "Your day is already complete."
                    type == AttendanceType.HOME_OUT && state is OfficeState.InOffice ->
                        "Check out of the office before ending your day."
                    else -> "That action isn't available right now. Pull down to refresh."
                }
            )
        )
        return false
    }

    // Double-tap / re-entrancy guard — drops a second tap that arrives before the first write
    // finishes, preventing duplicate office check-in/out docs (stress test #2.1).
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

    /**
     * Refuses the punch when the events on screen belong to a different day, reloads, and says so.
     *
     * This is the day-rollover fix. `init { loadTodayState() }` was the only load and the phase was
     * re-derived from whatever `_uiState.events` happened to hold, so an app resumed the next
     * morning authorised an `office_out` against yesterday's open session — and the write landed
     * stamped with the real today, leaving yesterday unclosed and scored LNF = half pay.
     *
     * The reload is **awaited before** the message is published: the other way round, the load
     * would land a moment later and wipe the explanation off the screen, leaving the employee
     * looking at a silently different day.
     */
    private suspend fun refuseStaleDay(): Boolean {
        if (!eventsAreStale(_uiState.value.events, clock.today())) return false
        reloadToday()
        _uiState.update { it.copy(notice = ROLLOVER_NOTICE) }
        return true
    }

    init {
        loadTodayState()
    }

    /**
     * Non-blocking reload. Called from `init` **and from the fragment's `onResume`** — an app
     * brought back to the foreground the next morning must not keep yesterday's day on screen.
     * The previous load is cancelled so a slow one cannot land on top of a newer one.
     */
    fun loadTodayState() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch { reloadToday() }
    }

    private var loadJob: Job? = null

    private suspend fun reloadToday() {
        setState(OfficeState.Loading)
        val result = attendanceRepository.getTodayData()
        if (result.isFailure) {
            setState(OfficeState.NotStarted)
            return
        }
        val (_, events) = result.getOrThrow()
        // One update: the phase and the timeline it was derived from land together. The notice is
        // dropped here — a fresh load has nothing left to explain.
        _uiState.value = OfficeAttendanceUiState(deriveOfficeState(events), events)
        syncSessionReminder(events)
    }

    // ── Home In — starts the day (GPS only, once per day) ──────────────────
    fun homeIn() = recordSimpleEvent(AttendanceType.HOME_IN, "Home check-in failed. Try again.")

    // ── Home Out — ends the day (GPS only, once per day) ───────────────────
    fun homeOut() = recordSimpleEvent(AttendanceType.HOME_OUT, "Home check-out failed. Try again.")

    // locationName: free-text location the user types before checking in (e.g. "Office", "Client Site ABC")
    fun checkIn(locationName: String) = submitEvent {
        if (!guard(AttendanceType.OFFICE_IN)) return@submitEvent
        setState(OfficeState.Loading)
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type         = AttendanceType.OFFICE_IN,
                    latitude     = location.latitude,
                    longitude    = location.longitude,
                    locationName = locationName.trim()
                )
                handleResult(result, "Check-in failed. Try again.")
            }
            else -> setState(OfficeState.Error(location.toUserMessage()))
        }
    }

    // Records check-out using the same location name as the last check-in
    fun checkOut(locationName: String) = submitEvent {
        if (!guard(AttendanceType.OFFICE_OUT)) return@submitEvent
        setState(OfficeState.Loading)
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type         = AttendanceType.OFFICE_OUT,
                    latitude     = location.latitude,
                    longitude    = location.longitude,
                    locationName = locationName
                )
                handleResult(result, "Check-out failed. Try again.")
            }
            else -> setState(OfficeState.Error(location.toUserMessage()))
        }
    }

    // Shared path for GPS-only home events.
    private fun recordSimpleEvent(type: String, failMessage: String) = submitEvent {
        if (!guard(type)) return@submitEvent
        setState(OfficeState.Loading)
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type      = type,
                    latitude  = location.latitude,
                    longitude = location.longitude
                )
                handleResult(result, failMessage)
            }
            else -> setState(OfficeState.Error(location.toUserMessage()))
        }
    }

    // Optimistic update: append the new record and re-derive the day state.
    private fun handleResult(result: Result<AttendanceRecord>, failMessage: String) {
        if (result.isSuccess) {
            val updated = _uiState.value.events + result.getOrThrow()
            _uiState.value = OfficeAttendanceUiState(deriveOfficeState(updated), updated)
            syncSessionReminder(updated)
        } else {
            setState(OfficeState.Error(result.exceptionOrNull()?.message ?: failMessage))
        }
    }

    /**
     * Keeps the ongoing "still checked in" reminder in step with the day.
     *
     * Driven off the derived phase rather than off "which button was just tapped", so there is one
     * rule: an open `office_in` shows it, everything else — the matching `office_out`, `home_out`,
     * a day that was never started — clears it. A reminder left up after check-out would train
     * people to ignore the one notification that protects half a day's pay.
     */
    private fun syncSessionReminder(events: List<AttendanceRecord>) {
        when (val state = deriveOfficeState(events)) {
            is OfficeState.InOffice -> notifier.showCheckedIn(state.checkInTime, AttendanceEntry.OFFICE)
            else -> notifier.clear()
        }
    }

    private companion object {
        const val ROLLOVER_NOTICE =
            "The date changed while this screen was open, so today's attendance has been " +
                "reloaded. Nothing was recorded — check the day above and tap again."
    }
}

/**
 * Everything the office attendance screen renders, as one value.
 *
 * [day] is *derived from* [events], so they must never be published separately — a screen that
 * read the new phase against the old timeline would show a check-in with no matching row.
 */
data class OfficeAttendanceUiState(
    val day: OfficeState = OfficeState.Loading,
    val events: List<AttendanceRecord> = emptyList(),
    /**
     * A transient explanation shown *alongside* the real phase, not instead of it.
     *
     * [OfficeState.Error] replaces the phase, which also removes every button — fine for "that
     * action isn't available", fatal for the day-rollover refusal, which every office employee
     * would hit on the first tap of a morning and which must leave them able to start their day
     * immediately.
     */
    val notice: String? = null,
)
