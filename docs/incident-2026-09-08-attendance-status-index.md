# Incident — OT Settlements & OT Shortage tabs failed to load (2026-09-08)

**Status:** Resolved · **Duration of fix:** ~5 minutes from diagnosis to service restored
**Severity:** Read-only outage on 4 admin tabs. **No data was lost, changed, or miscalculated.**
**Fix committed in:** `firebase/firestore.indexes.json`

---

## Part 1 — The plain-English version

### What people saw

Opening **OT Settlements** or **OT Shortage** in the admin portal showed a red error
instead of the table:

> The query requires a COLLECTION_GROUP_ASC index for collection attendance_status and
> field date. You can create it here: https://console.firebase.google.com/…

### What that actually meant

Think of our database like a very large filing cabinet with one folder per employee, and
inside each folder one sheet of paper per working day.

The OT pages ask a question that cuts *across* every folder at once:

> "Give me every attendance-status sheet dated between 1 August and 31 August — for all
> employees, in one go."

A database can only answer a question like that quickly if someone has built an **index**
for that exact shape of question — the equivalent of the index at the back of a book, or a
card catalogue that lists every sheet by date regardless of which folder it lives in.

**That specific index was missing.** Without it, the database does not guess, and it does
not answer slowly — it refuses the question outright and tells you which index it needs.
That refusal is the error message above.

The important part for anyone worried about the numbers: because the page could not get
its data, it showed an error and displayed **nothing at all**. It never showed a half-built
or zeroed-out OT table. Nobody could have read a wrong figure off that screen, and no
payroll calculation was affected — this was purely a failure to *read*, not to *compute* or
*store*.

### Why the index went missing

Every index we rely on is supposed to be written down in a configuration file that lives in
our code (`firebase/firestore.indexes.json`), so that it is version-controlled and re-created
on every deployment.

This particular index was **not** in that file. The most likely explanation is that it was
originally created by hand through the Firebase web console — which works, but leaves no
record in the code. Our deployment process treats that configuration file as the *complete
and authoritative list* of indexes. So when someone later ran a routine backend deployment,
the database was brought in line with the file, and the hand-made index — being absent from
the file — was removed.

Nothing in the application code changed. The pages kept asking the same question they had
always asked; the support underneath them quietly disappeared.

### How it was fixed

1. The missing index was written into the configuration file properly, so it is now part of
   the code and will survive every future deployment.
2. A second index in exactly the same situation (`planned_hours`, used by the same pages)
   was fixed at the same time, before it could cause a second outage.
3. The configuration was deployed.
4. The database then had to **build** the index, which means reading through every existing
   record once. During those few minutes the pages still showed an error — a *different*
   one, saying "that index is not ready yet" — which was the expected, temporary state.
5. Once the build finished, the tabs loaded normally. Confirmed working.

### Could it happen again?

Not by the same route. The index now lives in the code rather than only in the web console,
so a deployment re-creates it instead of removing it. The residual risk is a *new* page in
future asking a new cross-employee question without its index being added to the file — the
technical note below records the rule that prevents that.

---

## Part 2 — The technical version

### Root cause

`admin/src/lib/firestore.ts` contains two functions that issue **collection-group queries
with a `where()` filter**:

```ts
// admin/src/lib/firestore.ts
export async function getAttendanceStatusForDateRange(start: string, end: string) {
  const q = query(
    collectionGroup(db, 'attendance_status'),
    where('date', '>=', start),
    where('date', '<=', end),
  );
  …
}
// …and the identical getPlannedHoursForDateRange() over `planned_hours`
```

Firestore's **automatic** single-field indexes are created with `COLLECTION` query scope
only. A collection-group query filtering on a field additionally requires a single-field
index with `COLLECTION_GROUP` scope, and that one is **never** automatic — it has to be
declared explicitly as a field override (the console calls it a "single-field index
exemption").

Two facts established during diagnosis:

- `firebase/firestore.indexes.json` contained `"fieldOverrides": []`.
- The live database also reported `fieldOverrides: []`
  (`firebase firestore:indexes --project white-coffee-92c27`).

Yet the queries themselves are old code (introduced in `91e4a90`, "Add paid WO status + WO
ledger debit and net view"), and had been working. The consistent explanation is that a
console-created exemption existed and was later pruned: `firebase deploy` reconciles the
live field overrides against `firestore.indexes.json`, and an override absent from the file
is removed. This is inference from the two facts above rather than something confirmed in a
deploy log — but the remediation is the same either way, and the remediation also makes the
mechanism moot.

### Why this is easy to miss

Almost every other collection-group read in `admin/src/lib/firestore.ts` deliberately
fetches the whole group and filters client-side, with an explicit comment saying why:

```ts
// Fetch + client-filter (no collection-group index required; this set stays small).
const snap = await getDocs(collectionGroup(db, 'ot_approvals'));
```

`attendance_status.date` and `planned_hours.date` are the **only two** places that use a
real server-side `where()` on a collection group — so they are the only two with an index
dependency, and that dependency is invisible in the diff that introduced them.

### The fix

Added to `firebase/firestore.indexes.json`:

```json
"fieldOverrides": [
  {
    "collectionGroup": "attendance_status",
    "fieldPath": "date",
    "indexes": [
      { "order": "ASCENDING",  "queryScope": "COLLECTION" },
      { "order": "DESCENDING", "queryScope": "COLLECTION" },
      { "order": "ASCENDING",  "queryScope": "COLLECTION_GROUP" }
    ]
  },
  { …identical block for "planned_hours"… }
]
```

**Why the two `COLLECTION`-scoped entries are listed even though only the
`COLLECTION_GROUP` one was missing:** a field override *replaces* the field's default index
configuration, it does not add to it. Declaring only the collection-group entry would have
silently disabled the ordinary collection-scoped indexes on `date`. (Audited before
deploying: nothing queries these collections with a collection-scoped range on `date` —
every other access is a direct document `get()` by date-as-document-id, in both the Android
app and `firebase/functions/index.js` — so listing them was belt-and-braces rather than
strictly required. Listing them is still the correct habit.)

Deployed with:

```bash
firebase deploy --only firestore:indexes --project white-coffee-92c27
```

### Why the error persisted for several minutes after a successful deploy

An index does not serve queries until it has **backfilled** every pre-existing document.
While in state `CREATING`, Firestore rejects the query with a message that is
confusingly similar to the original one. The distinguishing wording:

| Message | Meaning |
|---|---|
| "requires a … index … You can **create it here**" | The index does not exist. |
| "… That index is **not ready yet**. See its **status** here" | It exists and is backfilling. |

Build state was polled directly rather than assumed:

```bash
firebase firestore:indexes --project white-coffee-92c27 --debug 2>&1 \
  | grep -o '{"fields":\[{"name":"projects.*'    # → per-index "state" field
```

Final state, all six index configurations:

```
attendance_status/fields/date    COLLECTION        ASCENDING   READY
attendance_status/fields/date    COLLECTION        DESCENDING  READY
attendance_status/fields/date    COLLECTION_GROUP  ASCENDING   READY
planned_hours/fields/date        COLLECTION        ASCENDING   READY
planned_hours/fields/date        COLLECTION        DESCENDING  READY
planned_hours/fields/date        COLLECTION_GROUP  ASCENDING   READY
```

### Blast radius

| Surface | Affected | Notes |
|---|---|---|
| Admin → OT Settlements | Yes | Reported |
| Admin → OT Shortage | Yes | Reported |
| Admin → Working Hours Shortage/Excess | Yes | Same `getAttendanceStatusForDateRange` + `getPlannedHoursForDateRange` pair |
| Admin → Attendance | Yes | Month variant of the same two queries |
| Android app | No | Reads these collections by document id only |
| Cloud Functions / nightly scorer | No | Uses `collectionGroup("attendance_status").get()` with no `where()`; function logs showed no `FAILED_PRECONDITION` |
| Stored data / payroll figures | No | Read-path only |

The affected pages load via `Promise.all(...)` inside a `try/catch`; a rejection means no
state is set at all, so the page renders the error and no table. It failed **closed** — no
partial, empty, or zeroed OT figures were ever displayed.

### Prevention

**Rule:** any new `collectionGroup(...).where(field, …)` query requires a matching
`fieldOverrides` entry in `firebase/firestore.indexes.json` in the same change. Never create
the exemption through the Firebase console alone — a later `firebase deploy` will prune it.

When adding one, list the `COLLECTION` ASC/DESC entries alongside the `COLLECTION_GROUP`
one, because the override replaces the field's default index configuration.

The cheaper alternative, and the prevailing pattern in `admin/src/lib/firestore.ts`, is to
fetch the collection group unfiltered and filter client-side — appropriate only while the
collection stays small. `attendance_status` and `planned_hours` grow by one document per
employee per day, so the indexed query is the right choice for them.

### Timeline (IST, 2026-09-08)

| Time | Event |
|---|---|
| — | Tabs reported broken by user |
| 16:48 | Root cause identified; `fieldOverrides` added to `firebase/firestore.indexes.json` |
| 16:49 | `firebase deploy --only firestore:indexes` — succeeded |
| 16:51 | All six index configs verified present, state `CREATING`; error text changes to "not ready yet" |
| ~16:53 | Backfill complete, all configs `READY` |
| 16:5x | User confirms tabs load after refresh |
