import { extendPosteriorCoverage, fullArchControls } from './posteriorCoverage';

const seed = Array.from({ length: 41 }, (_, i) => {
  const angle = Math.PI + (i * Math.PI) / 40;
  return [80 + 25 * Math.cos(angle), 50 + 20 * Math.sin(angle)];
});
function evidence(leftEnd = 90, rightEnd = 90, gap = false) {
  return (x: number, y: number) => {
    const r = Math.hypot((x - 80) / 25, (y - 50) / 20);
    const front = y <= 50 ? Math.exp(-(((r - 1) / 0.07) ** 2)) : 0;
    const end = x < 80 ? leftEnd : rightEnd;
    const side = Math.abs(x - 80) - (25 + (y - 50) * 0.18);
    const bone =
      y > 50 && y <= end && !(gap && y > 63 && y < 69) ? 0.48 * Math.exp(-((side / 2) ** 2)) : 0;
    const molar = Math.exp(-((side / 3) ** 2) - ((y - end + 4) / 3) ** 2);
    return Math.max(front, bone, molar);
  };
}

describe('Posterior molar coverage', () => {
  it.each([
    [10, 1],
    [14, 1],
    [14, 1.6],
  ])('centres between cortical borders %s mm apart at %s mm sampling', (separation, spacing) => {
    const full = extendPosteriorCoverage({
      path: seed.map(p => p.map(v => v / spacing)),
      spacing,
      width: Math.ceil(170 / spacing),
      height: Math.ceil(140 / spacing),
      read: (x, y) => {
        x *= spacing;
        y *= spacing;
        if (y <= 50) return evidence()(x, y);
        if (y > 90) return 0;
        const inner = 25 + (y - 50) * 0.02;
        const outer = inner + Math.min(separation, (y - 50) * 0.65);
        return Math.max(
          Math.exp(-(((Math.abs(x - 80) - inner) / 1.5) ** 2)),
          0.65 * Math.exp(-(((Math.abs(x - 80) - outer) / 1.5) ** 2))
        );
      },
    });
    const rear = full.path.map(p => p.map(v => v * spacing)).filter(([, y]) => y >= 75 && y <= 85);
    expect(rear.length).toBeGreaterThan(10);
    expect(
      rear.every(
        ([x, y]) => Math.abs(Math.abs(x - 80) - (25 + separation / 2 + (y - 50) * 0.02)) < 2.5
      )
    ).toBe(true);
    expect(full.unsafe).toBe(false);
  });
  it('extends a short anterior seed beyond the far edges of both molar regions, with margin', () => {
    const full = extendPosteriorCoverage({
      path: seed,
      read: evidence(),
      spacing: 1,
      width: 170,
      height: 130,
    });
    expect(full.path[0][1]).toBeGreaterThanOrEqual(94);
    expect(full.path[full.path.length - 1][1]).toBeGreaterThanOrEqual(94);
    expect(full.fieldLimited).toBe(false);
    expect(full.unsafe).toBe(false);
    const controls = fullArchControls(full.path, 1);
    expect(controls[0]).toEqual(full.path[0]);
    expect(controls[controls.length - 1]).toEqual(full.path[full.path.length - 1]);
    expect(controls.length).toBeGreaterThan(11);
  });
  it('follows each side independently, including a short gap in the posterior bone', () => {
    const full = extendPosteriorCoverage({
      path: seed,
      read: evidence(82, 98, true),
      spacing: 1,
      width: 170,
      height: 140,
    });
    expect(full.path[0][1]).toBeGreaterThanOrEqual(85);
    expect(full.path[full.path.length - 1][1]).toBeGreaterThanOrEqual(101);
    expect(full.path[full.path.length - 1][1] - full.path[0][1]).toBeGreaterThan(10);
  });
  it('reports a clipped posterior field and keeps all points inside available bounds', () => {
    const full = extendPosteriorCoverage({
      path: seed,
      read: evidence(),
      spacing: 1,
      width: 170,
      height: 78,
    });
    expect(full.fieldLimited).toBe(true);
    expect(full.path.every(([x, y]) => x >= 1 && x <= 168 && y >= 1 && y <= 76)).toBe(true);
  });
  it('does not grow a long invented tail into empty background', () => {
    const full = extendPosteriorCoverage({
      path: seed,
      read: (x, y) => (y <= 50 ? evidence()(x, y) : 0),
      spacing: 1,
      width: 170,
      height: 130,
    });
    expect(full.path[0][1]).toBeCloseTo(55);
    expect(full.path[full.path.length - 1][1]).toBeCloseTo(55);
  });
  it('does not follow converging posterior bone towards a central spine', () => {
    const full = extendPosteriorCoverage({
      path: seed,
      spacing: 1,
      width: 170,
      height: 150,
      read: (x, y) =>
        Math.max(
          y <= 70 ? evidence(70, 70)(x, y) : 0,
          y > 70 && y < 125
            ? Math.exp(-(((Math.abs(x - 80) - Math.max(9, 29 - (y - 70) * 0.8)) / 2) ** 2))
            : 0
        ),
    });
    expect(full.path.filter(([, y]) => y > 50).every(([x]) => Math.abs(x - 80) >= 18)).toBe(true);
    expect(Math.max(...full.path.map(p => p[1]))).toBeLessThan(90);
  });
  it('cannot reconnect across a long unsupported gap to unrelated posterior bone', () => {
    const full = extendPosteriorCoverage({
      path: seed,
      spacing: 1,
      width: 170,
      height: 150,
      read: (x, y) => (y < 72 ? evidence(70, 70)(x, y) : y > 90 ? evidence(125, 125)(x, y) : 0),
    });
    expect(Math.max(...full.path.map(p => p[1]))).toBeLessThan(80);
    expect(full.unsafe).toBe(false);
  });
  it('rejects continued support at an artificial search bound instead of certifying molar coverage', () => {
    const full = extendPosteriorCoverage({
      path: seed,
      read: evidence(140, 140),
      spacing: 1,
      width: 170,
      height: 180,
    });
    expect(full.unsafe).toBe(true);
  });
  it('rejects an overlong combined contour even when neither branch reaches a search boundary', () => {
    const broad = seed.map(([x, y]) => [130 + (x - 80) * 2.4, y]);
    const full = extendPosteriorCoverage({
      path: broad,
      spacing: 1,
      width: 270,
      height: 170,
      read: (x, y) => (y > 50 && y <= 100 ? Math.exp(-(((Math.abs(x - 130) - 60) / 2) ** 2)) : 0),
    });
    expect(full.fieldLimited).toBe(false);
    expect(full.unsafe).toBe(true);
  });
});
