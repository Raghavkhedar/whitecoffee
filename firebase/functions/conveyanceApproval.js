"use strict";

// Pure decisions for conveyance manual-approval status, split out so `npm test` can pin them
// without the Firestore/Sheets machinery around the nightly exportToSheets conveyance block.
// See docs/superpowers/specs/2026-09-22-conveyance-manual-approval-design.md.
//
// A `conveyance` doc has no `status` field until this feature: any such doc predates it and is
// grandfathered as approved (the whole month it was written was auto-approved-on-write). A doc
// with `markedBy: 'admin'` and no `status` is a pre-existing Protocol 2 regularization override,
// also grandfathered. Only a doc explicitly carrying `status: 'pending'` is unreviewed money.

// The rupee figure that should count toward payroll (Employee Dashboard total, Daily Spend
// Snapshot) for a given conveyance record.
function effectiveConveyanceAmount(rec) {
  if (!rec) return 0;
  if (rec.status === "rejected") return 0;
  if (rec.status === "pending") return 0;
  if (rec.status === "approved") return Number(rec.approvedAmount ?? rec.conveyance) || 0;
  return Number(rec.conveyance) || 0; // legacy: no status field — grandfathered approved
}

// Whether the nightly recompute must leave this doc alone instead of overwriting it with a
// freshly-computed route/km/amount. True for anything already reviewed (approved or rejected,
// whether via the new approval flow or the legacy admin regularization override) — a pending
// doc is still fair game to recompute every night until someone reviews it.
function isFrozenConveyance(rec) {
  if (!rec) return false;
  return rec.markedBy === "admin" || rec.status === "approved" || rec.status === "rejected";
}

module.exports = { effectiveConveyanceAmount, isFrozenConveyance };
