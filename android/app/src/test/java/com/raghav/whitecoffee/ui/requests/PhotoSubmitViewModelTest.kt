package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.MaterialToolRequest
import com.raghav.whitecoffee.data.model.RequestItem
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.data.model.TransferItem
import com.raghav.whitecoffee.fake.FakeNetworkMonitor
import com.raghav.whitecoffee.fake.FakePhotoPipeline
import com.raghav.whitecoffee.fake.FakeRequestRepository
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
 * The shared submit pipeline behind the four request forms, exercised through two of them.
 *
 * These ViewModels were the last untested ones in the app: they injected `PhotoUploadManager`
 * and `WorkManager` directly, both of which need a Context, so none could be constructed on a
 * JVM runner. `PhotoPipeline` is the seam that unblocked them.
 *
 * The ordering assertions are the valuable ones. Decision #10 fixes the sequence — write the
 * document, then upload against its id — and an upload scheduled for a document that was never
 * written retries three times and drops the photos silently, so the field report survives with
 * its evidence missing.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PhotoSubmitViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private lateinit var repo: FakeRequestRepository
    private lateinit var photos: FakePhotoPipeline

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repo = FakeRequestRepository()
        photos = FakePhotoPipeline()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun requestVm() =
        MaterialToolRequestViewModel(repo, photos, FakeNetworkMonitor())

    private fun transferVm() =
        TransferViewModel(repo, photos, FakeNetworkMonitor())

    /**
     * Uri is abstract with a private constructor, so a test cannot build a real one. Nothing
     * under test reads a Uri — the pipeline only counts them — so a stub token is enough.
     * `isReturnDefaultValues` (app/build.gradle.kts) is what makes this safe.
     */
    private fun photoTokens(n: Int): List<Uri> = List(n) { Uri.EMPTY }

    private fun items() = listOf(RequestItem(itemName = "Cement", quantity = 10.0))

    private fun transferItems() = listOf(TransferItem(itemName = "Drill", quantity = 1.0))

    // ── validation ────────────────────────────────────────────────────────

    @Test
    fun `an empty item list is refused and nothing is written`() = runTest(dispatcher) {
        val vm = requestVm()

        vm.submitRequest("S-001", "Gurugaon Site", emptyList(), "notes")
        advanceUntilIdle()

        assertTrue(repo.written.isEmpty())
        assertTrue(photos.scheduled.isEmpty())
        val state = vm.submitState.value
        assertTrue(state is UiState.Error)
        assertEquals("Please add at least one item.", (state as UiState.Error).message)
    }

    @Test
    fun `an item with no quantity is refused`() = runTest(dispatcher) {
        val vm = requestVm()

        vm.submitRequest("S-001", "Site", listOf(RequestItem(itemName = "Cement", quantity = 0.0)), "")
        advanceUntilIdle()

        assertTrue(repo.written.isEmpty())
        assertEquals(
            "Please fill in all item names and quantities.",
            (vm.submitState.value as UiState.Error).message,
        )
    }

    // ── the happy path and its ordering ───────────────────────────────────

    @Test
    fun `a submission without photos writes the document and schedules no upload`() =
        runTest(dispatcher) {
            val vm = requestVm()

            vm.submitRequest("S-001", "Gurugaon Site", items(), "notes")
            advanceUntilIdle()

            assertEquals(1, repo.written.size)
            assertEquals("material_requests", repo.written.single().first)
            assertTrue("no photos means no upload work", photos.scheduled.isEmpty())
            assertTrue(vm.submitState.value is UiState.Success)
        }

    @Test
    fun `photos are uploaded against the document that was actually written`() =
        runTest(dispatcher) {
            val vm = requestVm()

            vm.onPhotosChanged(photoTokens(2))
            advanceUntilIdle()
            vm.submitRequest("S-001", "Gurugaon Site", items(), "notes", photoTokens(2))
            advanceUntilIdle()

            val (collection, writtenDocId, _) = repo.written.single()
            val (uploadCollection, uploadDocId, paths) = photos.scheduled.single()
            assertEquals(collection, uploadCollection)
            assertEquals(
                "the upload must target the document that was written",
                writtenDocId,
                uploadDocId,
            )
            assertEquals(2, paths.size)
        }

    @Test
    fun `the id reserved when photos were picked is the one the document is written under`() =
        runTest(dispatcher) {
            val vm = requestVm()

            vm.onPhotosChanged(photoTokens(1))
            advanceUntilIdle()
            val reserved = repo.issuedIds.single()

            vm.submitRequest("S-001", "Site", items(), "", photoTokens(1))
            advanceUntilIdle()

            assertEquals(
                "re-deriving an id at submit time would orphan the cached files",
                reserved,
                repo.written.single().second,
            )
        }

    // ── failure branches ──────────────────────────────────────────────────

    @Test
    fun `a failed write discards the cached photos and schedules nothing`() =
        runTest(dispatcher) {
            val vm = requestVm()
            vm.onPhotosChanged(photoTokens(2))
            advanceUntilIdle()

            repo.failWith = IllegalStateException("permission denied")
            vm.submitRequest("S-001", "Site", items(), "", photoTokens(2))
            advanceUntilIdle()

            assertTrue("never upload against a document that was not written", photos.scheduled.isEmpty())
            assertEquals(1, photos.discarded.size)
            assertEquals("permission denied", (vm.submitState.value as UiState.Error).message)
        }

    /**
     * Compression is local and can fail on a full disk. The field data is the report; the photos
     * are supporting evidence. Losing the whole submission because a JPEG could not be written
     * would be the worse outcome, so this degrades to submitting without them.
     */
    @Test
    fun `a compression failure still submits the report, without photos`() = runTest(dispatcher) {
        val vm = requestVm()
        photos.cacheFails = IllegalStateException("no space left on device")

        vm.submitRequest("S-001", "Site", items(), "", photoTokens(2))
        advanceUntilIdle()

        assertEquals(1, repo.written.size)
        assertTrue(photos.scheduled.isEmpty())
        assertTrue(vm.submitState.value is UiState.Success)
    }

    // ── state reset ───────────────────────────────────────────────────────

    @Test
    fun `resetSubmitState clears a previous error`() = runTest(dispatcher) {
        val vm = requestVm()
        vm.submitRequest("S-001", "Site", emptyList(), "")
        advanceUntilIdle()
        assertTrue(vm.submitState.value is UiState.Error)

        vm.resetSubmitState()

        assertTrue(vm.submitState.value is UiState.Empty)
    }

    // ── transfers: one ViewModel, two collections ─────────────────────────

    @Test
    fun `material and tool transfers land in different collections`() = runTest(dispatcher) {
        val vm = transferVm()

        vm.submitMaterialTransfer("Depot", "Site A", "Ravi", "Asha", transferItems(), "")
        advanceUntilIdle()
        vm.submitToolTransfer("Depot", "Site B", "Ravi", "Asha", transferItems(), "")
        advanceUntilIdle()

        assertEquals(
            listOf("material_transfers", "tool_transfers"),
            repo.written.map { it.first },
        )
    }

    @Test
    fun `a transfer missing its receiver is refused`() = runTest(dispatcher) {
        val vm = transferVm()

        vm.submitMaterialTransfer("Depot", "Site A", "Ravi", "  ", transferItems(), "")
        advanceUntilIdle()

        assertTrue(repo.written.isEmpty())
        assertEquals(
            "Please enter who is receiving.",
            (vm.submitState.value as UiState.Error).message,
        )
    }

    @Test
    fun `transfer fields are trimmed before they are stored`() = runTest(dispatcher) {
        val vm = transferVm()

        vm.submitMaterialTransfer("  Depot  ", "  Site A  ", "  Ravi  ", "  Asha  ", transferItems(), "  n  ")
        advanceUntilIdle()

        val transfer = repo.written.single().third as Transfer
        assertEquals("Depot", transfer.fromLocation)
        assertEquals("Site A", transfer.toLocation)
        assertEquals("Ravi", transfer.transferredBy)
        assertEquals("Asha", transfer.receivedBy)
        assertEquals("n", transfer.notes)
    }

    @Test
    fun `request site fields are trimmed before they are stored`() = runTest(dispatcher) {
        val vm = requestVm()

        vm.submitRequest("  S-001  ", "  Gurugaon Site  ", items(), "  note  ")
        advanceUntilIdle()

        val request = repo.written.single().third as MaterialToolRequest
        assertEquals("S-001", request.siteId)
        assertEquals("Gurugaon Site", request.siteName)
        assertEquals("note", request.notes)
    }
}
