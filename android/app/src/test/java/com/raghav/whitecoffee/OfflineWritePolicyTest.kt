package com.raghav.whitecoffee

import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * Architectural guard: the writes a field user makes offline must never await a server ack.
 *
 * With Firestore's persistent cache enabled a write Task resolves only on **server
 * acknowledgement**, so `add(...).await()` never completes while offline. That is not a slow
 * path, it is a hang: the spinner spins, the user concludes the submission failed, and every
 * retry queues another document. That is exactly how duplicate leave requests reached the
 * approver's queue before `1960d1a`.
 *
 * **Why a source-level test.** The real proof would exercise `FirestoreLeaveRepository` against
 * the Firestore emulator, which needs an instrumented (on-device) run — see
 * `app/src/androidTest/.../RepositoryOfflineWriteTest.kt`. This runs on the JVM in milliseconds
 * and catches the one regression that actually happened: someone re-adding `.await()` to a write.
 * It is a fitness function, not a behavioural test, and it is deliberately narrow.
 *
 * **Reads may await.** `get()` resolves from the local cache when the server is unreachable, so
 * it cannot hang. Only writes are constrained here.
 */
class OfflineWritePolicyTest {

    private val repoDir =
        File("src/main/java/com/raghav/whitecoffee/data/repository")

    /**
     * Functions an employee triggers in the field, possibly with no signal. Each must return as
     * soon as the write is durable on disk.
     *
     * Deliberately an allowlist of protected paths rather than a blanket ban, because some
     * write-awaits are correct and must stay:
     *  - `approveLeave` / `rejectLeave` write to *another user's* document — the one path the
     *    rules can refuse — and a permission-denied only surfaces from the server. Reporting
     *    success for an approval the rules then reject is worse than a spinner at a desk.
     *  - `updatePhotoUrls` is called by `PhotoUploadWorker`, which must know whether the patch
     *    landed to decide retry vs success, and runs under a REQUIRES_NETWORK constraint.
     *  - The admin `UserRepository` / `SiteRepository` methods run from the web portal path only,
     *    never offline in the field.
     */
    private val protected = mapOf(
        "FirestoreAttendanceRepository.kt" to listOf("recordEvent"),
        "FirestoreLeaveRepository.kt" to listOf("submitLeaveRequest"),
        "FirestoreRegularizationRepository.kt" to listOf("submitRequest"),
        "FirestoreNotificationRepository.kt" to listOf("markAsRead", "markAllAsRead"),
        "FirestoreRequestRepository.kt" to listOf(
            "submitMaterialToolRequest",
            "submitMaterialToolPurchase",
            "submitMaterialTransfer",
            "submitToolTransfer",
            "submitWorkProgress",
        ),
    )

    private val writeCalls = listOf(".set(", ".add(", ".update(", ".commit(", ".delete(")

    @Test
    fun `no field-critical write awaits a server acknowledgement`() {
        val violations = mutableListOf<String>()

        protected.forEach { (fileName, functions) ->
            val file = File(repoDir, fileName)
            assertTrue("missing repository source: ${file.path}", file.exists())
            val source = file.readText()

            functions.forEach { fn ->
                val body = bodyOf(source, fn)
                    ?: fail("could not locate fun $fn in $fileName — has it been renamed?").let { return@forEach }
                awaitedWritesIn(body as String).forEach { call ->
                    violations += "$fileName::$fn awaits a $call write"
                }
            }
        }

        if (violations.isNotEmpty()) {
            fail(
                buildString {
                    appendLine("Field-critical writes must not await a server acknowledgement.")
                    appendLine("With offline persistence the Task resolves only on server ack, so")
                    appendLine("these hang instead of completing, and each user retry duplicates the doc.")
                    appendLine("Use document() + set() and return once the local write is durable.")
                    appendLine()
                    violations.forEach { appendLine("  - $it") }
                }
            )
        }
    }

    /** The read side of the same policy: awaiting `get()` is fine and must stay allowed. */
    @Test
    fun `awaiting a read is not treated as a violation`() {
        val body = """
            val snap = collection().whereEqualTo("isRead", false).get().await()
        """.trimIndent()

        assertTrue(awaitedWritesIn(body).isEmpty())
    }

    /** The detector must actually fire — otherwise the policy test would pass vacuously. */
    @Test
    fun `the detector catches an awaited write`() {
        val body = """
            val ref = leaveCol.add(data.toMap()).await()
        """.trimIndent()

        assertTrue(awaitedWritesIn(body).contains(".add("))
    }

    // ── helpers ───────────────────────────────────────────────────────────

    /** Extracts a function body by brace-matching from its signature. */
    private fun bodyOf(source: String, function: String): String? {
        val sig = Regex("fun\\s+$function\\s*\\(").find(source) ?: return null
        val open = source.indexOf('{', sig.range.last)
        if (open < 0) return null
        var depth = 0
        for (i in open until source.length) {
            when (source[i]) {
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) return source.substring(open, i + 1)
                }
            }
        }
        return null
    }

    /**
     * Returns the write calls in [body] that are followed by `.await()`.
     *
     * For each `.await()`, whichever call verb appears closest before it decides whether this is
     * a read-await (fine) or a write-await (a hang offline).
     */
    private fun awaitedWritesIn(body: String): List<String> {
        val flat = body.replace(Regex("\\s+"), " ")
        val found = mutableListOf<String>()
        Regex("\\.await\\(\\)").findAll(flat).forEach { m ->
            val preceding = flat.substring(0, m.range.first)
            val nearest = (writeCalls + ".get(")
                .map { it to preceding.lastIndexOf(it) }
                .filter { it.second >= 0 }
                .maxByOrNull { it.second }
                ?.first
            if (nearest != null && nearest in writeCalls) found += nearest
        }
        return found
    }
}
