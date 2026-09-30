import { describeDayClose, planDayClose } from './dayClose';

const t = (...types: string[]) => types.map((type) => ({ type }));

describe('planDayClose', () => {
  it('nothing to close before home_in or after home_out', () => {
    expect(planDayClose([])).toEqual([]);
    expect(planDayClose(t('home_in', 'office_in', 'office_out', 'home_out'))).toEqual([]);
  });

  it('home only → home_out', () => {
    expect(planDayClose(t('home_in'))).toEqual([{ type: 'home_out' }]);
    expect(planDayClose(t('home_in', 'office_in', 'office_out'))).toEqual([{ type: 'home_out' }]);
  });

  it('open office session carries its location name', () => {
    expect(planDayClose([{ type: 'home_in' }, { type: 'office_in', locationName: 'HQ' }])).toEqual([
      { type: 'office_out', locationName: 'HQ' },
      { type: 'home_out' },
    ]);
  });

  it('open site visit carries site id and name', () => {
    expect(
      planDayClose([{ type: 'home_in' }, { type: 'site_in', siteId: 'S1', siteName: 'Tower B' }]),
    ).toEqual([{ type: 'site_out', siteId: 'S1', siteName: 'Tower B' }, { type: 'home_out' }]);
  });

  it('market opened from a site closes market, then site, then home', () => {
    expect(
      planDayClose([
        { type: 'home_in' },
        { type: 'site_in', siteName: 'Tower B' },
        { type: 'market_in', marketName: 'Lohar Chawl' },
      ]).map((p) => p.type),
    ).toEqual(['market_out', 'site_out', 'home_out']);
  });

  it('sales mixed day: an office session left open under field events is closed too', () => {
    expect(planDayClose(t('home_in', 'office_in', 'site_in')).map((p) => p.type)).toEqual([
      'site_out',
      'office_out',
      'home_out',
    ]);
  });
});

describe('describeDayClose', () => {
  it('reads as a sequence', () => {
    expect(describeDayClose([{ type: 'site_out' }, { type: 'home_out' }])).toBe('Site Out → Home Out');
  });
});
