import { chooseCoveredJawLevel, type CoverageLevel } from './levelCoverage';

function level(z: number, forward = 0, sideShift = 0): CoverageLevel {
  const seed = Array.from({ length: 41 }, (_, i) => {
    const a = Math.PI + (i * Math.PI) / 40;
    return [80 + (30 + sideShift) * Math.cos(a), 70 + (30 + forward) * Math.sin(a)];
  });
  return {
    z,
    path: seed,
    front: seed.slice(12, 29),
    right: seed.slice(0, 8),
    left: seed.slice(33),
  };
}
describe('Cross-height anterior and posterior coverage', () => {
  it('does not hide a missed central incisor region behind good average canine coverage', () => {
    const basal = level(20);
    const makeUpper = (z: number) => {
      const result = level(z);
      result.path = result.path.map(([x, y]) => [x, y - 10 * Math.exp(-(((x - 80) / 4) ** 4))]);
      result.front = result.path.slice(12, 29);
      result.right = result.path.slice(0, 8);
      result.left = result.path.slice(33);
      return result;
    };
    const upper = makeUpper(40),
      upper2 = makeUpper(44);
    expect(chooseCoveredJawLevel([basal, upper, upper2], basal, 1, 4)).toBe(upper);
  });
  it('replaces a deep basal route with a stable higher contour while covering both sides', () => {
    const basal = level(20),
      upper = level(40, 24),
      upper2 = level(44, 24);
    expect(chooseCoveredJawLevel([basal, upper, upper2], basal, 1, 4)).toBe(upper);
  });
  it('keeps the previous level when all contours already fit its slab', () => {
    const basal = level(20),
      upper = level(40, 2),
      upper2 = level(44, 2);
    expect(chooseCoveredJawLevel([basal, upper, upper2], basal, 1, 4)).toBe(basal);
  });
  it('does not elevate an edentulous route just because more levels are present', () => {
    const basal = level(20);
    expect(
      chooseCoveredJawLevel([basal, level(32), level(36), level(40), level(44)], basal, 1, 4)
    ).toBe(basal);
  });
  it('ignores an isolated high contour and contours beyond the bounded height search', () => {
    const basal = level(20);
    expect(chooseCoveredJawLevel([basal, level(40, 24)], basal, 1, 4)).toBe(basal);
    expect(chooseCoveredJawLevel([basal, level(60, 24), level(64, 24)], basal, 1, 4)).toBe(basal);
  });
  it('does not use a pair of upper contours that disagree spatially', () => {
    const basal = level(20);
    expect(chooseCoveredJawLevel([basal, level(40, 24), level(44, 8)], basal, 1, 4)).toBe(basal);
  });
  it('rejects an alternative that fixes the front but misses one posterior side', () => {
    const basal = level(20),
      upper = level(40, 24),
      upper2 = level(44, 24);
    // A candidate with the reference front but an inward rear shortcut on one side.
    const bad = level(32, 24);
    bad.path = bad.path.map((p, i) => (i < 8 ? [p[0] + 18, p[1]] : p));
    expect(chooseCoveredJawLevel([basal, bad, upper, upper2], basal, 1, 4)).toBe(upper);
  });
  it('keeps the established molar ends when higher contours are shorter posteriorly', () => {
    const basal = level(20),
      upper = level(40, 24),
      upper2 = level(44, 24);
    const right = Array.from({ length: 21 }, (_, i) => [50, 110 - i * 2]);
    const left = Array.from({ length: 21 }, (_, i) => [110, 70 + i * 2]);
    basal.path = [...right, ...basal.path, ...left];
    basal.right = right;
    basal.left = left;
    expect(chooseCoveredJawLevel([basal, upper, upper2], basal, 1, 4)).toBe(basal);
  });
});
