package com.raghav.whitecoffee.ui.attendance

import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.fake.FakeLeaveRepository
import com.raghav.whitecoffee.fake.FakeSessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The leave application form (Session 28: no leave-type field; joining date / emergency contact /
 * place of visit added).
 *
 * The validation-order tests matter because each guard returns immediately with its own message
 * — if a later guard were checked first, the employee would be told to fix the wrong field first,
 * fix it, and hit the same dead end again.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ApplyLeaveViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private lateinit var repo: FakeLeaveRepository

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repo = FakeLeaveRepository()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun subject() = ApplyLeaveViewModel(repo, FakeSessionManager(name = "Asha Rao"))

    private fun submitValid(
        vm: ApplyLeaveViewModel,
        fromDate: String = "2026-08-01",
        toDate: String = "2026-08-03",
        joiningDate: String = "2025-01-15",
        emergencyContact: String = "9999999999",
        placeOfVisit: String = "Hometown",
        reason: String = "Family function",
    ) = vm.submit(fromDate, toDate, joiningDate, emergencyContact, placeOfVisit, reason)

    @Test
    fun `the applicant name is auto-filled from the session, not re-entered`() {
        // Session 28: the form no longer asks for a name field.
        val vm = subject()
        assertEquals("Asha Rao", vm.userName)
    }

    // ── calculateDays ────────────────────────────────────────────────────

    @Test
    fun `day count is inclusive of both endpoints`() {
        val vm = subject()
        assertEquals(3, vm.calculateDays("2026-08-01", "2026-08-03"))
    }

    @Test
    fun `a single-day leave counts as one day`() {
        val vm = subject()
        assertEquals(1, vm.calculateDays("2026-08-01", "2026-08-01"))
    }

    @Test
    fun `an unparsable date yields zero days rather than throwing`() {
        val vm = subject()
        assertEquals(0, vm.calculateDays("not-a-date", "2026-08-03"))
    }

    // ── validation, in the order the form checks it ─────────────────────

    @Test
    fun `a missing start or end date is refused and writes nothing`() = runTest(dispatcher) {
        val vm = subject()
        vm.submit("", "2026-08-03", "2025-01-15", "9999999999", "Hometown", "Family function")
        advanceUntilIdle()

        assertTrue(repo.submitted.isEmpty())
        assertEquals(
            "Please select both start and end dates.",
            (vm.submitState.value as UiState.Error).message,
        )
    }

    @Test
    fun `an end date before the start date is refused`() = runTest(dispatcher) {
        val vm = subject()
        vm.submit("2026-08-05", "2026-08-01", "2025-01-15", "9999999999", "Hometown", "Family function")
        advanceUntilIdle()

        assertTrue(repo.submitted.isEmpty())
        assertEquals(
            "End date must be on or after start date.",
            (vm.submitState.value as UiState.Error).message,
        )
    }

    @Test
    fun `a blank joining date is refused`() = runTest(dispatcher) {
        val vm = subject()
        vm.submit("2026-08-01", "2026-08-03", "", "9999999999", "Hometown", "Family function")
        advanceUntilIdle()

        assertTrue(repo.submitted.isEmpty())
        assertEquals("Please select joining date.", (vm.submitState.value as UiState.Error).message)
    }

    @Test
    fun `a blank emergency contact is refused`() = runTest(dispatcher) {
        val vm = subject()
        vm.submit("2026-08-01", "2026-08-03", "2025-01-15", "", "Hometown", "Family function")
        advanceUntilIdle()

        assertTrue(repo.submitted.isEmpty())
        assertEquals(
            "Please enter an emergency contact number.",
            (vm.submitState.value as UiState.Error).message,
        )
    }

    @Test
    fun `a blank place of visit is refused`() = runTest(dispatcher) {
        val vm = subject()
        vm.submit("2026-08-01", "2026-08-03", "2025-01-15", "9999999999", "", "Family function")
        advanceUntilIdle()

        assertTrue(repo.submitted.isEmpty())
        assertEquals("Please enter place of visit.", (vm.submitState.value as UiState.Error).message)
    }

    @Test
    fun `a blank reason is refused and writes nothing`() = runTest(dispatcher) {
        val vm = subject()
        vm.submit("2026-08-01", "2026-08-03", "2025-01-15", "9999999999", "Hometown", "")
        advanceUntilIdle()

        assertTrue(repo.submitted.isEmpty())
        assertEquals(
            "Please enter a reason for leave.",
            (vm.submitState.value as UiState.Error).message,
        )
    }

    // ── the happy path ───────────────────────────────────────────────────

    @Test
    fun `a valid submission computes total days and writes a trimmed request`() = runTest(dispatcher) {
        val vm = subject()
        vm.submit(
            "2026-08-01", "2026-08-03",
            "  2025-01-15  ", "  9999999999  ", "  Hometown  ", "  Family function  ",
        )
        advanceUntilIdle()

        val written = repo.submitted.single()
        assertEquals(3, written.totalDays)
        assertEquals("2025-01-15", written.joiningDate)
        assertEquals("9999999999", written.emergencyContact)
        assertEquals("Hometown", written.placeOfVisit)
        assertEquals("Family function", written.reason)
        assertTrue(vm.submitState.value is UiState.Success)
    }

    @Test
    fun `a failed submission surfaces the repository's message`() = runTest(dispatcher) {
        val vm = subject()
        repo.failWith = IllegalStateException("permission denied")

        submitValid(vm)
        advanceUntilIdle()

        assertEquals("permission denied", (vm.submitState.value as UiState.Error).message)
    }

    @Test
    fun `resetSubmitState clears a previous result`() = runTest(dispatcher) {
        val vm = subject()
        vm.submit("", "", "", "", "", "")
        advanceUntilIdle()
        assertTrue(vm.submitState.value is UiState.Error)

        vm.resetSubmitState()

        assertTrue(vm.submitState.value is UiState.Empty)
    }
}
