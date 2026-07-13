# Site Manpower Time Utilisation Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nightly Google-Sheets export that reproduces the client's "SITE MANPOWER TIME UTILISATION REPORT" (Aug-2024 format) — one row per ops `site_in`→`site_out` visit for the current month — as a new section in `exportToSheets`.

**Architecture:** A pure, dependency-free module (`manpowerVisits.js`) pairs a day's site events into visits and computes each visit's time-on-site fraction; it is unit-tested with `node --test`. A new block inside `exportToSheets` fetches the month's ops site events, calls the pure builder, layers on the day's credited OT (reusing the existing OT-ledger maps), and writes the rows to a new spreadsheet via the existing `writeTab` helper.

**Tech Stack:** Node.js (CommonJS) Firebase Cloud Functions v2, `googleapis` Sheets v4, `node:test`.

## Global Constraints

- Cloud functions run on a **UTC** clock — derive IST dates by shifting `+05:30` and reading `getUTC*`; never use bare `new Date()`/`getDay()` for an IST date. (This plan reuses `monthStart`/`today`/`getHourIST`/`getMinuteIST` that already do this.)
- No new dependencies. Validate with `node --check index.js` + `npm test` in `firebase/functions/` — **not** eslint (its config is stale and parse-errors on modern JS).
- `work done-time` = time on site ÷ 480 min (8h). **No cap — may exceed 1.**
- Remarks OT = **credited** OT (declared auto-approved + authorized rest-day + admin-granted incl. manual), formatted `HH:MM`, matching the Attendance tab / Employee Dashboard.
- Deploying the function later needs `firebase deploy --only functions` (run by the user; not part of this plan).

## File Structure

- **Create** `firebase/functions/manpowerVisits.js` — pure visit-pairing + fraction builder. One responsibility: turn a day's ordered site events into visit rows. No Firestore, no Sheets.
- **Create** `firebase/functions/manpowerVisits.test.js` — `node --test` suite for the builder.
- **Modify** `firebase/functions/index.js` — require the builder; add `SHEET_ID_MANPOWER`, `TABS.MANPOWER`, `userCategoriesMap`; add the "1c. Site Manpower Time Utilisation" section.
- **Modify** `admin/CLAUDE.md` — document the new export tab under "Google Sheets Export".

---

### Task 1: Pure visit builder + tests

**Files:**
- Create: `firebase/functions/manpowerVisits.js`
- Test: `firebase/functions/manpowerVisits.test.js`

**Interfaces:**
- Consumes: nothing (pure, no imports).
- Produces:
  - `buildManpowerVisits(events)` where `events` is `Array<{type:string, min:number, siteName?:string, siteId?:string, visitType?:string, workDone?:string[]}>` (site_in/site_out, **already chronologically sorted**, `min` = IST minute-of-day). Returns `Array<{siteName:string, siteId:string, visitType:string, workDone:string[], timeFraction:number|null, otTarget:boolean}>` in chronological order — one entry per matched `site_in`→`site_out` pair (FIFO), `timeFraction = round4((outMin-inMin)/480)` or `null` for a missed logout, orphan `site_out` skipped, exactly one entry has `otTarget:true` (greatest departure, or the last entry if none has a departure).
  - `round4(n)` → number rounded to 4 dp.

- [ ] **Step 1: Write the failing test file**

Create `firebase/functions/manpowerVisits.test.js`:

```js
"use strict";

// Unit suite for the Site Manpower Time Utilisation visit builder. Pure logic,
// no Firestore. Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildManpowerVisits, round4 } = require("./manpowerVisits");

// Helpers: build site_in / site_out events at an IST minute-of-day.
const IN  = (min, o = {}) => ({ type: "site_in",  min, ...o });
const OUT = (min, o = {}) => ({ type: "site_out", min, ...o });

test("clean single visit → one row, correct fraction, is OT target", () => {
  // 11:00–12:00 = 60 min = 60/480 = 0.125
  const v = buildManpowerVisits([
    IN(660, { siteName: "Burari", siteId: "CCO1", visitType: "inspection", workDone: ["Elec"] }),
    OUT(720),
  ]);
  assert.equal(v.length, 1);
  assert.equal(v[0].siteName, "Burari");
  assert.equal(v[0].siteId, "CCO1");
  assert.equal(v[0].visitType, "inspection");
  assert.deepEqual(v[0].workDone, ["Elec"]);
  assert.equal(v[0].timeFraction, 0.125);
  assert.equal(v[0].otTarget, true);
});

test("same site visited twice in a day → two separate rows", () => {
  const v = buildManpowerVisits([
    IN(600, { siteName: "SiteA" }), OUT(660),   // 10:00–11:00
    IN(720, { siteName: "SiteA" }), OUT(780),   // 12:00–13:00
  ]);
  assert.equal(v.length, 2);
  assert.equal(v[0].siteName, "SiteA");
  assert.equal(v[1].siteName, "SiteA");
  assert.equal(v[0].timeFraction, 0.125);
  assert.equal(v[1].timeFraction, 0.125);
});

test("two different sites → two rows with per-site fractions", () => {
  const v = buildManpowerVisits([
    IN(600, { siteName: "A" }), OUT(690),   // 90 min → 0.1875
    IN(700, { siteName: "B" }), OUT(720),   // 20 min → 0.0417 (rounded)
  ]);
  assert.equal(v.length, 2);
  assert.equal(v[0].timeFraction, 0.1875);
  assert.equal(v[1].timeFraction, 0.0417);
});

test("missed logout (in, no out) → row with null time, still OT target", () => {
  const v = buildManpowerVisits([IN(600, { siteName: "A" })]);
  assert.equal(v.length, 1);
  assert.equal(v[0].timeFraction, null);
  assert.equal(v[0].otTarget, true);
});

test("orphan logout (out, no in) → skipped", () => {
  const v = buildManpowerVisits([OUT(600, { siteName: "A" })]);
  assert.equal(v.length, 0);
});

test("over-8h visit → fraction exceeds 1 (no cap)", () => {
  // 09:00–18:00 = 540 min = 540/480 = 1.125
  const v = buildManpowerVisits([IN(540), OUT(1080)]);
  assert.equal(v[0].timeFraction, 1.125);
});

test("OT target is the visit with the latest departure", () => {
  const v = buildManpowerVisits([
    IN(660, { siteName: "First" }), OUT(720),    // 11:00–12:00
    IN(1020, { siteName: "Last" }), OUT(1110),   // 17:00–18:30 (latest out)
  ]);
  assert.equal(v[0].otTarget, false);
  assert.equal(v[1].otTarget, true);
  assert.equal(v[1].siteName, "Last");
});

test("classification falls back from site_in to site_out when the in is empty", () => {
  const v = buildManpowerVisits([
    IN(600,  { siteName: "", siteId: "", visitType: "", workDone: [] }),
    OUT(660, { siteName: "A", siteId: "CC9", visitType: "complaint", workDone: ["Mech"] }),
  ]);
  assert.equal(v[0].siteName, "A");
  assert.equal(v[0].siteId, "CC9");
  assert.equal(v[0].visitType, "complaint");
  assert.deepEqual(v[0].workDone, ["Mech"]);
});

test("round4 rounds to four decimals", () => {
  assert.equal(round4(20 / 480), 0.0417);
  assert.equal(round4(0.0625), 0.0625);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd firebase/functions && npm test`
Expected: FAIL — `Cannot find module './manpowerVisits'`.

- [ ] **Step 3: Write the module**

Create `firebase/functions/manpowerVisits.js`:

```js
"use strict";

// Pure builder for the Site Manpower Time Utilisation report (spec:
// docs/superpowers/specs/2026-07-13-site-manpower-utilisation-report-design.md).
// Firestore-free so it can be unit-tested with node --test. index.js reduces each
// ops site_in/site_out attendance event to the plain shape below (IST minute-of-day
// + the admin-filled classification fields) and calls buildManpowerVisits().

const MINUTES_PER_DAY_UNIT = 480; // 8h workday — on-site time is a fraction of this

// Round to 4 dp without floating-point trailing noise.
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// site_in value wins; fall back to the paired site_out when it is empty.
function firstNonEmpty(a, b) {
  const av = (a == null ? "" : String(a)).trim();
  return av || (b == null ? "" : String(b)).trim();
}
function firstNonEmptyArr(a, b) {
  if (Array.isArray(a) && a.length) return a;
  if (Array.isArray(b) && b.length) return b;
  return [];
}

/**
 * Build per-visit rows for one ops technician on one day.
 *
 * @param {Array<{type:string, min:number, siteName?:string, siteId?:string,
 *                visitType?:string, workDone?:string[]}>} events
 *   site_in / site_out events, ALREADY sorted chronologically. `min` = IST
 *   minute-of-day. Other event types are ignored.
 * @returns {Array<{siteName:string, siteId:string, visitType:string,
 *                  workDone:string[], timeFraction:number|null, otTarget:boolean}>}
 */
function buildManpowerVisits(events) {
  const visits = [];       // emitted rows (carry a private outMin until the end)
  const openIns = [];      // unmatched site_in events, FIFO

  for (const e of events || []) {
    if (e.type === "site_in") {
      openIns.push(e);
    } else if (e.type === "site_out") {
      if (openIns.length === 0) continue;            // orphan logout → skip
      const inEv = openIns.shift();
      const outMin = e.min;
      const timeFraction =
        (typeof inEv.min === "number" && typeof outMin === "number" && outMin > inEv.min)
          ? round4((outMin - inEv.min) / MINUTES_PER_DAY_UNIT)
          : null;
      visits.push({
        siteName:  firstNonEmpty(inEv.siteName, e.siteName),
        siteId:    firstNonEmpty(inEv.siteId, e.siteId),
        visitType: firstNonEmpty(inEv.visitType, e.visitType),
        workDone:  firstNonEmptyArr(inEv.workDone, e.workDone),
        timeFraction,
        outMin: (typeof outMin === "number") ? outMin : null,
        otTarget: false,
      });
    }
  }

  // Missed logout: any still-open site_in → row with blank time, no departure.
  for (const inEv of openIns) {
    visits.push({
      siteName:  firstNonEmpty(inEv.siteName, ""),
      siteId:    firstNonEmpty(inEv.siteId, ""),
      visitType: firstNonEmpty(inEv.visitType, ""),
      workDone:  firstNonEmptyArr(inEv.workDone, []),
      timeFraction: null,
      outMin: null,
      otTarget: false,
    });
  }

  // The day's OT is earned by staying past shift end — during the visit with the
  // latest departure. Flag it; if no visit has a departure (all missed logouts),
  // the last-emitted visit carries it so the day's OT still lands somewhere.
  if (visits.length) {
    let target = -1, best = -Infinity;
    visits.forEach((v, i) => {
      if (v.outMin != null && v.outMin > best) { best = v.outMin; target = i; }
    });
    if (target === -1) target = visits.length - 1;
    visits[target].otTarget = true;
  }

  return visits.map(({ outMin, ...rest }) => rest); // drop the private outMin
}

module.exports = { buildManpowerVisits, round4 };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd firebase/functions && npm test`
Expected: PASS — all `manpowerVisits.test.js` tests green (and the existing `attendanceRules.test.js` still green).

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/manpowerVisits.js firebase/functions/manpowerVisits.test.js
git commit -m "feat(functions): pure site-manpower visit builder + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire the report into exportToSheets

**Files:**
- Modify: `firebase/functions/index.js`

**Interfaces:**
- Consumes: `buildManpowerVisits` (Task 1); existing in-function maps `otOverrideMap`, `plannedMap`, `otAuthSet`, `approvalMap`, `allHolidaySet`, `userRoleMap`, `userNameMap`; helpers `computeDayLedger`, `minToHHMM`, `getHourIST`, `getMinuteIST`, `uidOf`, `writeTab`; constants `OPS_IN_TYPES`, `OPS_OUT_TYPES`, `DEFAULT_SHIFT_START_MIN`, `DEFAULT_SHIFT_END_MIN`, `monthStart`, `today`.
- Produces: a new Sheets tab; no code consumed by later tasks.

- [ ] **Step 1: Require the builder**

In `firebase/functions/index.js`, immediately after the `require("./attendanceRules")` block (ends at line 15), add:

```js
// Site Manpower Time Utilisation — pure visit builder (see manpowerVisits.js).
const { buildManpowerVisits } = require("./manpowerVisits");
```

- [ ] **Step 2: Add the spreadsheet id and tab name**

After the `SHEET_ID_OT` declaration (line 55), add:

```js
// Sheet9: Site Manpower Time Utilisation (ops per-site visits, current month)
const SHEET_ID_MANPOWER = "1U66-ldSNMm01f3rnJabJe0BxTUFvDglSX5rAFqXDJZ4";
```

In the `TABS` object, after the `OT_EXCEPTION:` line, add:

```js
  MANPOWER:           "Manpower Utilisation",
```

- [ ] **Step 3: Add a per-user categories map**

In `exportToSheets`, right after the `userPlBalMap` line (~line 416), add:

```js
    const userCategoriesMap = new Map(allUsersData.map((u) => [u.id, Array.isArray(u.categories) ? u.categories : []]));
```

- [ ] **Step 4: Add the report section**

In `index.js`, immediately after the Overtime Exception Report block closes — after its `console.log(\`OT Exception Report: ${rows.length} rows\`);` (line 733) and that block's closing `}` (line 734), and before `// ── 2. MT Requests` (line 736) — insert:

```js
    // ── 1c. Site Manpower Time Utilisation — ops per-site visits, current month ──
    // One row per ops site_in→site_out visit this month, written to its own
    // spreadsheet (SHEET_ID_MANPOWER). Reproduces the client's manual "SITE MANPOWER
    // TIME UTILISATION REPORT" (Aug-2024 format). work-done-time = time on site ÷ 8h
    // (may exceed 1). Remarks carries the day's CREDITED OT (H:MM) on the visit with
    // the latest departure. Pairing/fraction is the unit-tested buildManpowerVisits().
    {
      const header = [
        "DATE", "SITE", "Cust ID", "Visit type", "TecH name",
        "Category (as per daily schedule)", "work done-Category", "work done-time", "Remarks",
      ];

      // Ops site events for the current month, grouped by employee + day.
      const snap = await db.collectionGroup("attendance")
        .where("date", ">=", monthStart).where("date", "<=", today).get();
      const groups = new Map(); // `${uid}__${date}` → { uid, date, events[] }
      snap.docs.forEach((doc) => {
        const uid = uidOf(doc);
        if (userRoleMap.get(uid) !== "operations") return;      // ops-only report
        const d = doc.data();
        if (d.type !== "site_in" && d.type !== "site_out") return; // market carries no visit fields
        const key = `${uid}__${d.date || ""}`;
        if (!groups.has(key)) groups.set(key, { uid, date: d.date || "", events: [] });
        groups.get(key).events.push(d);
      });

      const rows = [];
      groups.forEach((group, key) => {
        const { uid, date } = group;

        // Chronological site events → the pure builder's shape.
        const sorted = [...group.events].sort(
          (a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
        const visits = buildManpowerVisits(sorted.map((e) => ({
          type: e.type,
          min: getHourIST(e.timestamp) * 60 + getMinuteIST(e.timestamp),
          siteName: e.siteName || "",
          siteId: e.siteId || "",
          visitType: e.visitType || "",
          workDone: Array.isArray(e.workDoneCategories) ? e.workDoneCategories : [],
        })));
        if (!visits.length) return;

        // Day's CREDITED OT — same number as the Attendance tab / Employee Dashboard.
        // Effective window: regularized override wins; else first-in…last-out across
        // site AND market events (matches the ledger).
        const override = otOverrideMap.get(key);
        let inMin = null, outMin = null;
        if (override) {
          inMin = override.inMin; outMin = override.outMin;
        } else {
          const ins  = group.events.filter((e) => OPS_IN_TYPES.has(e.type));
          const outs = group.events.filter((e) => OPS_OUT_TYPES.has(e.type));
          if (ins.length && outs.length) {
            const inEv  = ins.reduce((a, b) => ((a.timestamp?.seconds || 0) <= (b.timestamp?.seconds || 0) ? a : b));
            const outEv = outs.reduce((a, b) => ((a.timestamp?.seconds || 0) >= (b.timestamp?.seconds || 0) ? a : b));
            const im = getHourIST(inEv.timestamp) * 60 + getMinuteIST(inEv.timestamp);
            const om = getHourIST(outEv.timestamp) * 60 + getMinuteIST(outEv.timestamp);
            if (om > im) { inMin = im; outMin = om; }
          }
        }
        let creditedOt = 0;
        if (inMin != null && outMin != null) {
          const plan = plannedMap.get(key);
          const restDay = new Date(date + "T00:00:00Z").getUTCDay() === 0 || allHolidaySet.has(date);
          const led = computeDayLedger({
            shiftStartMin: plan ? plan.startMin : DEFAULT_SHIFT_START_MIN,
            shiftEndMin:   plan ? plan.endMin   : DEFAULT_SHIFT_END_MIN,
            inMin, outMin,
            declaredOtMins: plan ? plan.declared : 0,
            isRestDay: restDay,
            otAuthorized: otAuthSet.has(key),
          });
          creditedOt = led.autoOtMins + led.restDayOtMins;
        }
        creditedOt += approvalMap.get(key) || 0;

        const categories = (userCategoriesMap.get(uid) || []).join(" ");
        visits.forEach((v) => {
          rows.push([
            date,
            v.siteName,
            v.siteId,
            v.visitType,
            userNameMap.get(uid) ?? "",
            categories,
            v.workDone.join(" + "),
            v.timeFraction == null ? "" : v.timeFraction,
            (v.otTarget && creditedOt > 0) ? minToHHMM(creditedOt) : "",
          ]);
        });
      });

      rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      await writeTab(sheets, SHEET_ID_MANPOWER, TABS.MANPOWER, [header, ...rows]);
      console.log(`Manpower Utilisation: ${rows.length} rows`);
    }
```

- [ ] **Step 5: Syntax-check and run tests**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: `node --check` prints nothing (exit 0); `npm test` PASSES all suites. (The section itself needs Firestore to run end-to-end; that happens on deploy. `node --check` confirms the edits are syntactically valid and reference only in-scope names.)

- [ ] **Step 6: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): add Site Manpower Time Utilisation export tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Document the new export

**Files:**
- Modify: `admin/CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (docs only).

- [ ] **Step 1: Add a bullet under "Google Sheets Export"**

In `admin/CLAUDE.md`, in the "## Google Sheets Export" section, immediately after the `- **Overtime Exception Report tab** …` bullet (the last bullet in that list), add:

```markdown
- **Site Manpower Time Utilisation tab** ("Manpower Utilisation") — written to its **own** spreadsheet (`SHEET_ID_MANPOWER` in `functions/index.js`), **operations only**, **current month, cleared & rebuilt each run**. Reproduces the client's manual "SITE MANPOWER TIME UTILISATION REPORT" (Aug-2024 format): one row per ops `site_in`→`site_out` visit. Columns: DATE | SITE | Cust ID (admin-filled `siteId`) | Visit type (`visitType`) | TecH name | Category (as per daily schedule — user's `categories`) | work done-Category (`workDoneCategories`, `+`-joined) | work done-time | Remarks. **work done-time** = time on site ÷ 8h (`(site_out − site_in)/480`), **uncapped — may exceed 1**; blank on a missed logout (visible data gap). **Remarks** = the day's *credited* OT as `HH:MM` (declared auto-approved + authorized rest-day + admin-granted), placed on the visit with the latest departure (where the post-shift OT was earned); blank elsewhere. Market visits are excluded (they carry no visit fields). Pairing/fraction logic is the pure, unit-tested `functions/manpowerVisits.js` (`npm test`). Not θ-filled (blanks stay blank).
```

- [ ] **Step 2: Commit**

```bash
git add admin/CLAUDE.md
git commit -m "docs: document Site Manpower Time Utilisation export tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Destination (new spreadsheet, single tab, current-month rebuild, `writeTab`) → Task 2 Steps 2 & 4. ✓
- Columns 1–9 incl. Category / work-done-Category / work-done-time / Remarks → Task 2 Step 4 row assembly. ✓
- Data flow: month fetch, ops+site filter, group, FIFO pair, fraction, OT on latest-departure row, sort → Task 1 (pairing/fraction/otTarget) + Task 2 (fetch/filter/OT/sort). ✓
- Edge cases: missed logout blank time, orphan logout skipped, missing category/workDone/siteId blank, not θ-filled → Task 1 tests + Task 2 (blanks passed through as `""`). ✓
- Remarks = credited (approved) OT, `HH:MM` → Task 2 `creditedOt` + `minToHHMM`, matching user's final confirmation. ✓
- Testing: pure helper extracted + `node --test` cases 1–7 → Task 1. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps — every code step shows full code, every run step shows the command and expected result. ✓

**Type consistency:** `buildManpowerVisits` return shape (`siteName`, `siteId`, `visitType`, `workDone`, `timeFraction`, `otTarget`) defined in Task 1 is consumed unchanged in Task 2 Step 4. Event input shape (`type`, `min`, `siteName`, `siteId`, `visitType`, `workDone`) matches what Task 2 constructs from `workDoneCategories`. `creditedOt` is minutes (number) → `minToHHMM`. ✓
