import { detectDentalArch, volumeWorldBounds, type WorldBounds } from './automaticArch';
import * as levelCoverage from './levelCoverage';

const bounds: WorldBounds = [-65, 65, -50, 65, -12, 32];
function jaw(x: number, y: number, z: number) {
  const r = Math.hypot((x - 4) / 36, (y - 20) / 30);
  const arch = y <= 22 ? 2600 * Math.exp(-(((r - 1) / 0.07) ** 2) - ((z - 9) / 7) ** 2) : 0;
  const spine = 1600 * Math.exp(-(((x - 4) / 9) ** 2) - ((y - 49) / 8) ** 2);
  const metal = 15000 * Math.exp(-(((x - 30) / 2) ** 2) - ((y - 2) / 2) ** 2 - ((z - 9) / 3) ** 2);
  return -800 + Math.max(arch, spine, metal);
}

// A bright closed cranial shell is a stronger geometric U-match than the toothless jaw below it.
function headWithJaw(teeth: number, includeJaw = true) {
  return (x: number, y: number, z: number) => {
    const jawRadius = Math.hypot(x / 35, (y - 17) / 28);
    const bone =
      includeJaw && y <= 19
        ? 1100 * Math.exp(-(((jawRadius - 1) / 0.075) ** 2) - ((z - 8) / 7) ** 2)
        : 0;
    const skullRadius = Math.hypot(x / 48, (y - 9) / 43);
    const skull = z > 48 && z < 135 ? 2600 * Math.exp(-(((skullRadius - 1) / 0.045) ** 2)) : 0;
    const brain = z > 48 && z < 135 && skullRadius < 0.96 ? 500 : 0;
    const posteriorTeeth =
      includeJaw && teeth > 0 && (teeth > 1 || x > 0)
        ? 5500 *
          Math.exp(-(((Math.abs(x) - 29) / 2) ** 2) - ((y - 1) / 3) ** 2 - ((z - 8) / 4) ** 2)
        : 0;
    return -900 + Math.max(bone, skull, brain, posteriorTeeth);
  };
}

const headBounds: WorldBounds = [-70, 70, -60, 75, -18, 145];

describe('Automatic arch detection from volume pixels', () => {
  it('moves above a deep basal contour when a stable superior arch is outside the old vertical neighbourhood', async () => {
    const options = {
      sample: (x: number, y: number, z: number) => {
        if (z < 0 || z > 60) return -900;
        const rise = Math.max(0, Math.min(1, (z - 40) / 8));
        const cy = 25 - 5 * rise,
          ry = 25 + 20 * rise;
        const r = Math.hypot(x / 35, (y - cy) / ry);
        const front = y <= cy + 1 ? (3100 - 1400 * rise) * Math.exp(-(((r - 1) / 0.075) ** 2)) : 0;
        const rear = y > cy && y < 50 ? 1700 * Math.exp(-(((Math.abs(x) - 35) / 2.5) ** 2)) : 0;
        return -900 + Math.max(front, rear);
      },
      bounds: [-70, 70, -60, 85, -10, 75] as WorldBounds,
      signal: new AbortController().signal,
    };
    const fallbackOnly = jest
      .spyOn(levelCoverage, 'chooseCoveredJawLevel')
      .mockImplementation((_levels, preferred) => preferred);
    try {
      const old = await detectDentalArch(options);
      expect(Math.min(...old.points.map(p => p[1]))).toBeGreaterThan(-15);
    } finally {
      fallbackOnly.mockRestore();
    }
    const result = await detectDentalArch(options);
    expect(result.sliceZ).toBeGreaterThan(40);
    expect(Math.min(...result.points.map(p => p[1]))).toBeLessThan(-20);
    expect(result.points[0][1]).toBeGreaterThan(49);
    expect(result.points[result.points.length - 1][1]).toBeGreaterThan(49);
    expect(result.coverageWarning).toBeUndefined();
  }, 60000); // Two complete synthetic reconstructions; allow slower Windows CI hosts.
  it.each([0, 1, 2])(
    'chooses the lower jaw over the brighter forehead with %s posterior teeth',
    async teeth => {
      const result = await detectDentalArch({
        sample: headWithJaw(teeth),
        bounds: headBounds,
        signal: new AbortController().signal,
      });
      expect(result.sliceZ).toBeLessThan(30);
      for (const [x, y] of result.points)
        expect(Math.abs(Math.hypot(x / 35, (y - 17) / 28) - 1)).toBeLessThan(0.22);
    },
    20000
  );
  it('uses the available maxillary arch near the inferior edge of an ENT scan', async () => {
    const result = await detectDentalArch({
      sample: headWithJaw(2),
      bounds: [-70, 70, -60, 75, 5, 145],
      signal: new AbortController().signal,
    });
    expect(result.sliceZ).toBeLessThan(25);
  }, 20000);
  it.each([true, false])(
    'excludes a bright midface U enclosing paired cavities (jaw present: %s)',
    async includeJaw => {
      const pending = detectDentalArch({
        sample: (x, y, z) => {
          const lower = headWithJaw(0, includeJaw)(x, y, z);
          if (z < 42 || z > 66) return lower;
          const r = Math.hypot(x / 42, (y - 10) / 38);
          const front = y <= 12 ? 2600 * Math.exp(-(((r - 1) / 0.06) ** 2)) : 0;
          const sinus = Math.hypot((Math.abs(x) - 20) / 11, (y + 3) / 14);
          const wall = 2600 * Math.exp(-(((sinus - 1) / 0.08) ** 2));
          return Math.max(lower, -900 + Math.max(front, wall));
        },
        bounds: headBounds,
        signal: new AbortController().signal,
      });
      if (includeJaw) expect((await pending).sliceZ).toBeLessThan(30);
      else await expect(pending).rejects.toThrow('вручную');
    },
    20000
  );
  it('does not substitute a skull contour when the scan contains no jaw', async () => {
    await expect(
      detectDentalArch({
        sample: headWithJaw(0, false),
        bounds: headBounds,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('вручную');
  }, 20000);
  it('does not mistake an open cranial shell at the edge of a cropped field for an edentulous jaw', async () => {
    await expect(
      detectDentalArch({
        sample: headWithJaw(0, false),
        bounds: [-70, 70, -60, 28, -18, 145],
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('вручную');
  }, 20000);
  it('can find the available jaw above the initial search region when the inferior field is empty', async () => {
    const result = await detectDentalArch({
      sample: (x, y, z) => jaw(x, y, z - 65),
      bounds: [-65, 65, -50, 65, -20, 100],
      signal: new AbortController().signal,
    });
    expect(Math.abs(result.sliceZ - 74)).toBeLessThan(8);
  }, 20000);
  it('finds the arch and its axial level despite a posterior spine and a bright restoration', async () => {
    const progress = jest.fn();
    const result = await detectDentalArch({
      sample: jaw,
      bounds,
      signal: new AbortController().signal,
      onProgress: progress,
    });
    expect(result.points.length).toBeGreaterThanOrEqual(11);
    expect(Math.abs(result.sliceZ - 9)).toBeLessThan(8);
    expect(result.support).toBeGreaterThan(0.65);
    for (const [x, y, z] of result.points) {
      expect(Math.abs(Math.hypot((x - 4) / 36, (y - 20) / 30) - 1)).toBeLessThan(0.2);
      // Bone ends at y=22; include the new 5 mm posterior margin plus sampling tolerance.
      expect(y).toBeLessThan(29);
      expect(z).toBe(result.sliceZ);
    }
    expect(result.points[0][0]).toBeLessThan(result.points[result.points.length - 1][0]);
    expect(progress).toHaveBeenLastCalledWith(100);
  }, 20000);
  it('does not invent an arch in empty, constant, solid or missing data', async () => {
    for (const sample of [
      () => -1000,
      () => NaN,
      (x, y) => (Math.abs(x) < 35 && Math.abs(y) < 25 ? 1500 : -1000),
    ]) {
      await expect(
        detectDentalArch({ sample, bounds, signal: new AbortController().signal })
      ).rejects.toThrow('вручную');
    }
  }, 20000);
  it('cancels after yielding and never returns a stale result', async () => {
    const controller = new AbortController();
    const pending = detectDentalArch({ sample: jaw, bounds, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('tracks translated anatomy with a different intensity scale rather than a fixed template', async () => {
    const shifted: WorldBounds = [-45, 85, -65, 50, -5, 39];
    const result = await detectDentalArch({
      sample: (x, y, z) => jaw(x - 20, y + 15, z - 7) * 0.3 + 1200,
      bounds: shifted,
      signal: new AbortController().signal,
    });
    expect(Math.abs(result.sliceZ - 16)).toBeLessThan(8);
    for (const [x, y] of result.points)
      expect(Math.abs(Math.hypot((x - 24) / 36, (y - 5) / 30) - 1)).toBeLessThan(0.2);
  }, 20000);
  it('rejects a cropped arm instead of silently supplying the missing half of an arch', async () => {
    await expect(
      detectDentalArch({
        sample: jaw,
        bounds: [0, 65, -50, 65, -12, 32],
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('вручную');
  }, 20000);
  it('derives physical bounds from every corner of a rotated/reversed volume', () => {
    expect(
      volumeWorldBounds([3, 4, 5], ([i, j, k]) => [10 - j * 2, 20 + i * 3, 30 - k * 0.5])
    ).toEqual([4, 10, 20, 26, 28, 30]);
  });
  it('includes the complete posterior molar regions when the bright anterior arch is only a short seed', async () => {
    const result = await detectDentalArch({
      sample: (x, y, z) => {
        const r = Math.hypot(x / 25, (y - 10) / 23);
        const front = y <= 10 ? 2600 * Math.exp(-(((r - 1) / 0.07) ** 2)) : 0;
        const side = Math.abs(x) - (25 + (y - 10) * 0.18);
        const bone = y > 10 && y <= 50 ? 1100 * Math.exp(-((side / 2.5) ** 2)) : 0;
        const molars = 2200 * Math.exp(-((side / 3) ** 2) - ((y - 46) / 4) ** 2);
        return -900 + Math.max(front, bone, molars) * Math.exp(-(((z - 8) / 6) ** 2));
      },
      bounds: [-65, 65, -45, 80, -10, 32],
      signal: new AbortController().signal,
    });
    expect(result.points[0][1]).toBeGreaterThan(51);
    expect(result.points[result.points.length - 1][1]).toBeGreaterThan(51);
    expect(result.points[0][0]).toBeLessThan(-28);
    expect(result.points[result.points.length - 1][0]).toBeGreaterThan(28);
    expect(result.coverageWarning).toBeUndefined();
  }, 20000);
  it('includes posterior regions above the seed plane instead of extending through an empty inner route', async () => {
    const result = await detectDentalArch({
      sample: (x, y, z) => {
        const r = Math.hypot(x / 25, (y - 10) / 23);
        const front = y <= 10 ? 2600 * Math.exp(-(((r - 1) / 0.07) ** 2) - ((z - 8) / 6) ** 2) : 0;
        const side = Math.abs(x) - (25 + (y - 10) * 0.18);
        const bone =
          y > 10 && y <= 50 ? 1700 * Math.exp(-((side / 2.5) ** 2) - ((z - 19) / 2) ** 2) : 0;
        const molar =
          2400 * Math.exp(-((side / 3) ** 2) - ((y - 46) / 4) ** 2 - ((z - 19) / 2) ** 2);
        return -900 + Math.max(front, bone, molar);
      },
      bounds: [-65, 65, -45, 80, -10, 32],
      signal: new AbortController().signal,
    });
    expect(result.sliceZ).toBeLessThan(16);
    expect(result.points[0][1]).toBeGreaterThan(51);
    expect(result.points[result.points.length - 1][1]).toBeGreaterThan(51);
    expect(result.points[0][0]).toBeLessThan(-28);
    expect(result.points[result.points.length - 1][0]).toBeGreaterThan(28);
    expect(result.coverageWarning).toBeUndefined();
  }, 20000);
  it('chooses the superior alveolar part of a jaw band instead of the brighter basal chin cortex', async () => {
    const result = await detectDentalArch({
      sample: (x, y, z) => {
        if (z < -6 || z > 40 || y > 21) return -900;
        const fraction = (z + 6) / 46;
        const radius = Math.hypot(x / (40 - 7 * fraction), (y - 20) / (34 - 7 * fraction));
        const bone = 1250 + 2200 * Math.exp(-((z / 5) ** 2));
        return -900 + bone * Math.exp(-(((radius - 1) / 0.07) ** 2));
      },
      bounds: [-65, 65, -50, 65, -15, 75],
      signal: new AbortController().signal,
    });
    expect(result.sliceZ).toBeGreaterThan(20);
    expect(result.sliceZ).toBeLessThan(41);
  }, 20000);
  it('covers protruding anterior anatomy visible above the seed plane while retaining posterior coverage', async () => {
    const result = await detectDentalArch({
      sample: (x, y, z) => {
        const base = 20 - 30 * Math.sqrt(Math.max(0, 1 - (x / 34) ** 2));
        const front =
          Math.abs(x) <= 34 && y <= 20
            ? 1700 * Math.exp(-(((y - base) / 1.8) ** 2) - ((z - 8) / 5) ** 2)
            : 0;
        const forward = base - 14 * Math.exp(-((x / 13) ** 4));
        const incisors =
          Math.abs(x) < 17 ? 3000 * Math.exp(-(((y - forward) / 2) ** 2) - ((z - 17) / 2) ** 2) : 0;
        const side = Math.abs(x) - (34 + (y - 20) * 0.1);
        const rear =
          y > 20 && y < 50 ? 1700 * Math.exp(-((side / 2.5) ** 2) - ((z - 8) / 5) ** 2) : 0;
        return -900 + Math.max(front, incisors, rear);
      },
      bounds: [-70, 70, -60, 80, -10, 32],
      signal: new AbortController().signal,
    });
    expect(Math.min(...result.points.map(p => p[1]))).toBeLessThan(-20);
    expect(result.points[0][1]).toBeGreaterThan(49);
    expect(result.points[result.points.length - 1][1]).toBeGreaterThan(49);
    expect(result.coverageWarning).toBeUndefined();
  }, 20000);
});
