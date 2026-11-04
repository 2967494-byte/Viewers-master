import { refineAnteriorCoverage } from './anteriorCoverage';

const seed = Array.from({ length: 41 }, (_, i) => {
  const a = Math.PI + (i * Math.PI) / 40;
  return [80 + 30 * Math.cos(a), 80 + 30 * Math.sin(a)];
});
const targetY = (x: number) =>
  80 -
  30 * Math.sqrt(Math.max(0, 1 - ((x - 80) / 30) ** 2)) -
  14 * Math.exp(-(((x - 80) / 13) ** 4));

describe('Anterior arch coverage', () => {
  it.each([
    [1, 0.6],
    [1.6, 0.6],
    [1, 1],
    [1.6, 1],
  ])(
    'follows a pronounced bend at %s mm sampling with inner shortcut strength %s',
    (spacing, innerStrength) => {
      const path = seed.map(p => p.map(v => v / spacing));
      const result = refineAnteriorCoverage({
        path,
        spacing,
        width: Math.ceil(170 / spacing),
        height: Math.ceil(130 / spacing),
        read: (x, y) => {
          x *= spacing;
          y *= spacing;
          if (Math.abs(x - 80) > 30) return 0;
          const shortcut = 80 - 30 * Math.sqrt(Math.max(0, 1 - ((x - 80) / 30) ** 2));
          return Math.max(
            Math.exp(-(((y - targetY(x)) / 2) ** 2)),
            innerStrength * Math.exp(-(((y - shortcut) / 1.5) ** 2))
          );
        },
      });
      expect(result.confirmed).toBe(true);
      const anterior = result.path
        .map(p => p.map(v => v * spacing))
        .filter(([x]) => Math.abs(x - 80) < 9);
      expect(anterior.length).toBeGreaterThan(3);
      expect(anterior.every(([x, y]) => Math.abs(y - targetY(x)) < 3)).toBe(true);
      expect(result.path.slice(0, 9)).toEqual(path.slice(0, 9));
      expect(result.path.slice(-9)).toEqual(path.slice(-9));
    }
  );
  it('does not create an incisor bulge without supported anatomy', () => {
    const result = refineAnteriorCoverage({
      path: seed,
      spacing: 1,
      width: 170,
      height: 130,
      read: () => 0,
    });
    expect(result.path).toBe(seed);
    expect(result.confirmed).toBe(false);
  });
  it('does not confirm a front gap merely because both side regions are supported', () => {
    const result = refineAnteriorCoverage({
      path: seed,
      spacing: 1,
      width: 170,
      height: 130,
      read: (x, y) =>
        Math.abs(x - 80) > 10 ? Math.exp(-(((Math.hypot(x - 80, y - 80) - 30) / 1.5) ** 2)) : 0,
    });
    expect(result.confirmed).toBe(false);
  });
  it('does not follow an isolated bright spot in front of an otherwise supported edentulous arch', () => {
    const result = refineAnteriorCoverage({
      path: seed,
      spacing: 1,
      width: 170,
      height: 130,
      read: (x, y) =>
        Math.max(
          Math.exp(-(((Math.hypot(x - 80, y - 80) - 30) / 1.5) ** 2)),
          Math.exp(-(((x - 80) / 1.5) ** 2) - ((y - 36) / 1.5) ** 2)
        ),
    });
    expect(result.confirmed).toBe(true);
    expect(Math.min(...result.path.map(p => p[1]))).toBeGreaterThan(47);
  });
});
