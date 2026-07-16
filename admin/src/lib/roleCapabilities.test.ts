// Standalone tests for the role-capabilities table. Run: npx tsx src/lib/roleCapabilities.test.ts
import {
  attendanceInTypes, attendanceOutTypes, usesFixedWindow, usesOtShortageLedger,
  tracksShortage, usesConveyance, getsCategories, inManpowerReports, type Role,
} from './roleCapabilities';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

// The full capability table — the single source of truth this must match exactly.
const TABLE: Record<Role, {
  in: string[]; out: string[]; fixed: boolean; ledger: boolean; shortage: boolean;
  conveyance: boolean; categories: boolean; manpower: boolean;
}> = {
  office: {
    in: ['office_in'], out: ['office_out'],
    fixed: true, ledger: false, shortage: true, conveyance: false, categories: false, manpower: false,
  },
  operations: {
    in: ['site_in', 'market_in'], out: ['site_out', 'market_out'],
    fixed: false, ledger: true, shortage: true, conveyance: true, categories: true, manpower: true,
  },
  sales: {
    in: ['office_in', 'site_in', 'market_in'], out: ['office_out', 'site_out', 'market_out'],
    fixed: true, ledger: false, shortage: false, conveyance: true, categories: false, manpower: false,
  },
  admin: {
    in: ['office_in'], out: ['office_out'],
    fixed: true, ledger: false, shortage: true, conveyance: false, categories: false, manpower: false,
  },
};

(Object.keys(TABLE) as Role[]).forEach(role => {
  const r = TABLE[role];
  console.log(`\n${role}:`);
  eq('attendanceInTypes',    attendanceInTypes(role),    r.in);
  eq('attendanceOutTypes',   attendanceOutTypes(role),   r.out);
  eq('usesFixedWindow',      usesFixedWindow(role),      r.fixed);
  eq('usesOtShortageLedger', usesOtShortageLedger(role), r.ledger);
  eq('tracksShortage',       tracksShortage(role),       r.shortage);
  eq('usesConveyance',       usesConveyance(role),       r.conveyance);
  eq('getsCategories',       getsCategories(role),       r.categories);
  eq('inManpowerReports',    inManpowerReports(role),    r.manpower);
});

console.log('\nSales is the hybrid the table exists for:');
// Sales must not collapse into either binary branch: office-style fixed window and NO
// shortage/OT, but ops-style conveyance and hybrid check-ins.
eq('sales scores a fixed window',    usesFixedWindow('sales'),      true);
eq('sales has no shortage/OT',       tracksShortage('sales'),       false);
eq('sales has no ledger',            usesOtShortageLedger('sales'), false);
eq('sales earns conveyance',         usesConveyance('sales'),       true);
// The distinction the pages depend on: office/admin show shortage WITHOUT a ledger, so
// shortage cannot be inferred from `usesOtShortageLedger` alone.
eq('office: shortage without ledger',
   tracksShortage('office') && !usesOtShortageLedger('office'), true);

console.log('\nUnknown role falls back to office behavior:');
eq('unknown usesFixedWindow',      usesFixedWindow('bogus'),      true);
eq('unknown usesOtShortageLedger', usesOtShortageLedger('bogus'), false);
eq('unknown tracksShortage',       tracksShortage('bogus'),       true);
eq('unknown attendanceInTypes',    attendanceInTypes('bogus'),    ['office_in']);

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
