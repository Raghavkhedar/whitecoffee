import { fitWithin } from './resize';

describe('fitWithin', () => {
  it('leaves small images alone', () => {
    expect(fitWithin(1080, 800)).toBeNull();
    expect(fitWithin(640, 480)).toBeNull();
  });
  it('caps the longest edge', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1080 });
    expect(fitWithin(3024, 4032)).toEqual({ height: 1080 });
    expect(fitWithin(2000, 2000)).toEqual({ width: 1080 });
  });
});
