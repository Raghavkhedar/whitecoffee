import {
  expandDateRange,
  requestedDates,
  grantedDates,
  cancelledDates,
  effectiveGrantedDates,
  effectiveGrantedDayCount,
  isCancelled,
  isPartiallyCancelled,
  isPartialApproval,
  leaveDisplayStatus,
  type LeaveLike,
} from './leaveCoverage';

describe('expandDateRange', () => {
  it('expands an inclusive range', () => {
    expect(expandDateRange('2026-01-01', '2026-01-03')).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
  });

  it('treats a missing "to" as a single-day range', () => {
    expect(expandDateRange('2026-01-05')).toEqual(['2026-01-05']);
  });

  it('returns [] for an inverted range', () => {
    expect(expandDateRange('2026-01-05', '2026-01-01')).toEqual([]);
  });

  it('returns [] for a malformed date', () => {
    expect(expandDateRange('not-a-date')).toEqual([]);
  });
});

describe('requestedDates', () => {
  it('returns the full fromDate..toDate range', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-03' };
    expect(requestedDates(leave)).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
  });
});

describe('grantedDates', () => {
  it('is the whole requested range when approvedDates is empty (compatibility rule)', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-03', approvedDates: [] };
    expect(grantedDates(leave)).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
  });

  it('is bounded to the requested range, ignoring a stray out-of-range entry', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      approvedDates: ['2026-02-01', '2026-03-01'],
    };
    expect(grantedDates(leave)).toEqual(['2026-02-01']);
  });
});

describe('cancelledDates', () => {
  it('is empty when cancelledDates is empty or absent', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-02' };
    expect(cancelledDates(leave)).toEqual([]);
  });

  it('is bounded to what was actually granted', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      approvedDates: ['2026-02-01'],
      cancelledDates: ['2026-02-01', '2026-02-02'],
    };
    expect(cancelledDates(leave)).toEqual(['2026-02-01']);
  });
});

describe('effectiveGrantedDates / effectiveGrantedDayCount', () => {
  it('is granted minus cancelled', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-03',
      cancelledDates: ['2026-02-02'],
    };
    expect(effectiveGrantedDates(leave)).toEqual(['2026-02-01', '2026-02-03']);
    expect(effectiveGrantedDayCount(leave)).toBe(2);
  });
});

describe('isCancelled / isPartiallyCancelled', () => {
  it('is false when nothing was cancelled', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-02' };
    expect(isCancelled(leave)).toBe(false);
    expect(isPartiallyCancelled(leave)).toBe(false);
  });

  it('isPartiallyCancelled is true only when some but not all days remain', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      cancelledDates: ['2026-02-01'],
    };
    expect(isCancelled(leave)).toBe(true);
    expect(isPartiallyCancelled(leave)).toBe(true);
  });

  it('isPartiallyCancelled is false when ALL granted days were cancelled', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      cancelledDates: ['2026-02-01', '2026-02-02'],
    };
    expect(isCancelled(leave)).toBe(true);
    expect(isPartiallyCancelled(leave)).toBe(false);
  });
});

describe('isPartialApproval', () => {
  it('is false for a pending leave', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-02', status: 'pending' };
    expect(isPartialApproval(leave)).toBe(false);
  });

  it('is false for a legacy approval with no approvedDates', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-02', status: 'approved' };
    expect(isPartialApproval(leave)).toBe(false);
  });

  it('is true when approvedDates covers fewer days than requested', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-03',
      status: 'approved',
      approvedDates: ['2026-02-01'],
    };
    expect(isPartialApproval(leave)).toBe(true);
  });
});

describe('leaveDisplayStatus', () => {
  it('is pending for a pending leave', () => {
    expect(leaveDisplayStatus({ fromDate: '2026-02-01', status: 'pending' })).toBe('pending');
  });

  it('is rejected for a rejected leave', () => {
    expect(leaveDisplayStatus({ fromDate: '2026-02-01', status: 'rejected' })).toBe('rejected');
  });

  it('is approved for a plain approval with no overlays', () => {
    expect(leaveDisplayStatus({ fromDate: '2026-02-01', status: 'approved' })).toBe('approved');
  });

  it('is partial for a partial approval', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-03',
      status: 'approved',
      approvedDates: ['2026-02-01'],
    };
    expect(leaveDisplayStatus(leave)).toBe('partial');
  });

  it('is partial when some but not all granted days were cancelled', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      status: 'approved',
      cancelledDates: ['2026-02-01'],
    };
    expect(leaveDisplayStatus(leave)).toBe('partial');
  });

  it('is rejected when a full cancellation revoked every granted day', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      status: 'approved',
      cancelledDates: ['2026-02-01', '2026-02-02'],
    };
    expect(leaveDisplayStatus(leave)).toBe('rejected');
  });
});
