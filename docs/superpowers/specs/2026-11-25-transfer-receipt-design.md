# Receipt confirmation for material and tool transfers

## Context
A sender records a transfer, but the receiver has no way to confirm it arrived, and filing a second form duplicates the entry. Goal: the receiver confirms (or reports a problem) on the **same** record, which closes it.

Today: `receivedBy` is free text, only the owner, admin and the Submissions tab can read a transfer, and employees cannot read other users' profiles.

## Approaches
- **A (chosen):** receipt fields on the transfer doc; the receiver gets narrow read/update rights. One record, works offline.
- B: server-synced copy in the receiver's inbox. Two copies can drift.
- C: callables only. Confirming fails without signal.

## Decisions
- Receivers are always app users (picked from a list).
- Actions: **Received** (closes) or **Problem** (note required; sender and admins notified).
- Employee app changes: **Android only**. `mobile/` is untouched.

## Design

### Data (`material_transfers`, `tool_transfers`)
New fields: `receiverId`, `receiptStatus` (`pending|received|problem`), `receiptNote`, `receiptAt`.
`receivedBy` stays and is filled with the picked name, so the portal and sheets keep working.
Transitions: `pending → received|problem`, `problem → received`. `received` is final.
Old transfers have no `receiverId` and stay as they are (no backfill).

### Employee list
New top-level `directory/{uid}` = `{name, employeeId, active}` only. Any signed-in user reads; no client writes. Kept in step by an `onDocumentWritten("users/{userId}")` trigger (writes only when those three change), plus a one-off backfill in `firebase/functions/scripts/`.

### Rules (`firebase/firestore.rules`, both transfer collections)
- Read: add `resource.data.receiverId == request.auth.uid`, in the per-doc match and the `{path=**}` match (needed for the incoming query).
- Update, receiver branch: active user, is `receiverId`, `changedKeysWithin(withStamp(['receiptStatus','receiptNote','receiptAt']))`, `stampIsTruthful()`, allowed transition only, non-empty string note for `problem`. From review: `receiptAt` is the server time and `lastModifiedBy` is required; the note cannot change when marking `received`.
- Create: no `receiptNote`/`receiptAt`; `receiptStatus` absent or `pending`; `receiverId` not the sender. Creates without these fields still pass, so old APKs keep working.
- The sender's branch stays `photoUrls` only, so a sender cannot mark their own transfer received.
- `firestore.indexes.json`: collection-group field override for `receiverId` on both collections (keep the default collection-scope indexes).

### Functions
New pure `transferReceipt.js` (+ `.test.js`) builds the notification docs, following `openSessionReminder.js`: `sent_notifications` **and** the bell row, deterministic IDs, one batch.
- Transfer created with `receiverId` → notify receiver.
- `receiptStatus` becomes `received` → notify sender. `problem` → notify sender and all admins.
- `exportToSheets`: append Receipt Status, Receipt Note, Received At at the end of both transfer tabs (existing columns do not move).

### Android
- `data/model/Transfer.kt`: new fields; `toMap()` includes them only when `receiverId` is set.
- `RequestRepository` / `FirestoreRequestRepository` / `FakeRequestRepository`: `getDirectory()`, `observeIncomingTransfers()` (collection-group `receiverId == me`, both collections), `confirmReceipt()`. Confirm write is **not awaited** and is audit-stamped with `withAuditStamp`.
- `TransferScreen`: "Received by" becomes a `ReadOnlyFieldBox` that opens a picker dialog (self excluded), hosted by both transfer fragments. `TransferViewModel` takes `receiverId` and requires it.
- New `IncomingTransfers` Fragment, ViewModel, Screen: open items with items/from/sender, buttons Received and Problem (note dialog). Home tile for all roles, nav graph action. Reuse `WcCard`, `StatusBadge`, `OfflineBanner`, `EmptyState`.
- Filtering by status is client-side. `shortcut:` loads all of a user's incoming transfers; add a status query and index if that grows large.

### Admin portal (`admin/src/app/(admin)/submissions/page.tsx`)
For the two transfer tabs: receipt status badge, and a "Mark received" button (confirm prompt, `stamped()`) to close problem or unanswered transfers. Existing admin/Submissions update rights cover it.

## Not included
Per-item received quantities, receiver viewing the sender's photos (Storage rules unchanged), reassigning a wrong receiver (receiver reports a problem, admin closes), sender history screen, tapping a push to open the screen, reminders, `mobile/` parity.

## Order of work
1. Save this design to `docs/superpowers/specs/2026-11-25-transfer-receipt-design.md` on a new branch from `main` (the working tree has unrelated uncommitted changes; leave them alone).
2. Rules tests first (new `firebase/rules-tests/transfer-receipt.test.js`), then rules and indexes.
3. Functions, then Android (tests first), then portal.
4. Update the schema notes in `android/CLAUDE.md`; `graphify update .`.

## Verification
- `cd firebase/rules-tests && npm test` before and after. New cases: receiver can read and confirm; third party cannot; sender cannot confirm; receiver cannot edit items; `received` cannot be reopened; problem without note fails; forged `received` at create fails; legacy create passes.
- `cd firebase/functions && npm test` and `npm run lint`.
- `cd android && ./gradlew :app:testDebugUnitTest --rerun-tasks` and `:app:assembleDebug`.
- `cd admin && npm run build`.
- On two phones with two accounts: send, receive push, confirm offline then reconnect, check portal status.

## Rollout (each step only when you say so)
Deploy indexes, functions and rules → run directory backfill → ship the Android release (version bump).
