import {
  attendanceInTypes,
  attendanceOutTypes,
  attendanceRouteFor,
  getsCategories,
  inManpowerReports,
  isKnownRole,
  tracksShortage,
  usesConveyance,
  usesFixedWindow,
  usesOtShortageLedger,
  type Role,
} from './roleCapabilities';

// Same table as admin/src/lib/roleCapabilities.test.ts — the four mirrors must agree exactly.
const TABLE: Record<
  Role,
  {
    in: string[];
    out: string[];
    fixed: boolean;
    ledger: boolean;
    shortage: boolean;
    conveyance: boolean;
    categories: boolean;
    manpower: boolean;
  }
> = {
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

describe.each(Object.keys(TABLE) as Role[])('%s capabilities', (role) => {
  const r = TABLE[role];
  it('matches the shared table', () => {
    expect(attendanceInTypes(role)).toEqual(r.in);
    expect(attendanceOutTypes(role)).toEqual(r.out);
    expect(usesFixedWindow(role)).toBe(r.fixed);
    expect(usesOtShortageLedger(role)).toBe(r.ledger);
    expect(tracksShortage(role)).toBe(r.shortage);
    expect(usesConveyance(role)).toBe(r.conveyance);
    expect(getsCategories(role)).toBe(r.categories);
    expect(inManpowerReports(role)).toBe(r.manpower);
  });
});

describe('sales is the hybrid the table exists for', () => {
  it('scores a fixed window with no shortage/OT or ledger, but earns conveyance', () => {
    expect(usesFixedWindow('sales')).toBe(true);
    expect(tracksShortage('sales')).toBe(false);
    expect(usesOtShortageLedger('sales')).toBe(false);
    expect(usesConveyance('sales')).toBe(true);
  });

  it('office shows shortage without a ledger', () => {
    expect(tracksShortage('office') && !usesOtShortageLedger('office')).toBe(true);
  });
});

describe('unknown role', () => {
  it('falls back to office behavior for read-side predicates, like the other mirrors', () => {
    expect(usesFixedWindow('bogus')).toBe(true);
    expect(usesOtShortageLedger('bogus')).toBe(false);
    expect(tracksShortage('bogus')).toBe(true);
    expect(attendanceInTypes('bogus')).toEqual(['office_in']);
  });

  it('is not a known role', () => {
    expect(isKnownRole('bogus')).toBe(false);
    expect(isKnownRole('')).toBe(false);
    expect(isKnownRole('toString')).toBe(false);
  });
});

describe('attendanceRouteFor', () => {
  it('routes each role by its check-in types', () => {
    expect(attendanceRouteFor('office')).toBe('Attendance');
    expect(attendanceRouteFor('admin')).toBe('Attendance');
    expect(attendanceRouteFor('operations')).toBe('OperationsAttendance');
    expect(attendanceRouteFor('sales')).toBe('SalesAttendance');
  });

  it('fails closed for unknown or missing roles — no office fallback on the write path', () => {
    expect(attendanceRouteFor('bogus')).toBeUndefined();
    expect(attendanceRouteFor('')).toBeUndefined();
  });
});
