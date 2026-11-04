import {
  buildCurve,
  createTrilinearSampler,
  curveFrame,
  reconstructPanorama,
  reconstructSections,
  trimEmptyRasterRows,
} from './reconstruction';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const straight = () =>
  buildCurve([
    [0, 0, 0],
    [10, 0, 0],
    [20, 0, 0],
  ]);

describe('Manual dental CPR in physical coordinates', () => {
  it.each([
    { matrix: identity, direction: [0, 0, 1] },
    { matrix: identity, direction: [0.2, -0.1, 0.9] },
    { matrix: [0, -0.5, 0, 0, 2, 0, 0, 0, 0, 0, 0.25, 0, 1, 2, 1, 1], direction: [0, 0, 1] },
    { matrix: [0.8, 0, 0.6, 0, 0, 2, 0, 0, -0.6, 0, 0.8, 0, 1, 2, 1, 1], direction: [0, 0, 1] },
  ])(
    'prepared rays preserve the affine geometry and signed interpolation: %j',
    ({ matrix, direction }) => {
      const sample = createTrilinearSampler([8, 9, 10], matrix, (i, j, k) => -900 + i * j + 13 * k);
      const origin: [number, number, number] = [1.3, 1.1, 2.7];
      const ray = sample.prepareLine(origin, direction as [number, number, number]);
      for (let mm = -12; mm <= 12; mm += 0.13) {
        const expected = sample(
          ...(origin.map((v, axis) => v + mm * direction[axis]) as [number, number, number])
        );
        if (Number.isNaN(expected)) expect(Number.isNaN(ray(mm))).toBe(true);
        else expect(ray(mm)).toBeCloseTo(expected, 8);
      }
    }
  );

  it('prepared axial rays preserve exact boundary planes, single-voxel axes and partial coverage', () => {
    const sample = createTrilinearSampler([1, 2, 3], identity, (i, j, k) => -1000 + i + j + k);
    expect(sample.prepareLine([0, 1, 0], [0, 0, 1])(2)).toBe(-997);
    expect(sample.prepareLine([0, 1, 0], [0, 0, 1])(2.1)).toBeNaN();
    expect(sample.prepareLine([0.1, 1, 0], [0, 0, 1])(1)).toBeNaN();
    expect(sample.prepareLine([0, 1, 0], [0, 0, 1])(0.25)).toBe(-998.75);
  });

  it.each(['mean', 'mip'] as const)(
    'prepared rays retain %s slab values, missing-data mask and physical extents',
    async mode => {
      const sample = createTrilinearSampler(
        [31, 21, 11],
        identity,
        (i, j, k) => -900 + i * j + 11 * k
      );
      const curve = buildCurve([
        [2, 0, 4],
        [12, 5, 4],
        [25, 0, 4],
      ]);
      const common = {
        curve,
        up: [0, 0, 1] as [number, number, number],
        thickness: 10,
        heightMm: 12,
        mode,
        signal: new AbortController().signal,
      };
      const optimized = await reconstructPanorama({ ...common, sample });
      // A plain callable takes the reference path without the prepared-ray optimisation.
      const reference = await reconstructPanorama({
        ...common,
        sample: (x, y, z) => sample(x, y, z),
      });
      expect({ ...optimized, pixels: null }).toEqual({ ...reference, pixels: null });
      optimized.pixels.forEach((v, i) => {
        if (Number.isNaN(reference.pixels[i])) expect(v).toBeNaN();
        else expect(v).toBeCloseTo(reference.pixels[i], 4);
      });
    }
  );

  it('cancels a tall panorama within its first column, before the next progress notification', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      reconstructPanorama({
        curve: straight(),
        up: [0, 0, 1],
        thickness: 20,
        heightMm: 150,
        mode: 'mean',
        signal: controller.signal,
        sample: () => {
          calls++;
          controller.abort();
          return 100;
        },
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBeLessThanOrEqual(16 * 41);
  });

  it('does not return a raster if the final progress callback cancels its owner', async () => {
    const controller = new AbortController();
    await expect(
      reconstructPanorama({
        curve: straight(),
        up: [0, 0, 1],
        thickness: 2,
        heightMm: 2,
        mode: 'mean',
        signal: controller.signal,
        sample: () => 100,
        onProgress: percent => {
          if (percent === 100) controller.abort();
        },
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancels perpendicular sections within a row instead of finishing an obsolete section', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      reconstructSections({
        curve: straight(),
        up: [0, 0, 1],
        center: 10,
        step: 2,
        heightMm: 150,
        signal: controller.signal,
        sample: () => {
          calls++;
          controller.abort();
          return 100;
        },
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBeLessThanOrEqual(121);
  });

  it('lets browser tasks interrupt expensive work and never finishes with a stale raster', async () => {
    const controller = new AbortController();
    let clock = 0;
    const now = jest.spyOn(performance, 'now').mockImplementation(() => (clock += 9));
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await expect(
        reconstructPanorama({
          curve: straight(),
          up: [0, 0, 1],
          thickness: 20,
          heightMm: 150,
          mode: 'mean',
          signal: controller.signal,
          sample: () => 100,
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      clearTimeout(timer);
      now.mockRestore();
    }
  });

  it('allows a two-point preview while keeping three points mandatory for reconstruction', () => {
    const points: [number, number, number][] = [
      [0, 0, 0],
      [10, 0, 0],
    ];
    expect(() => buildCurve(points)).toThrow();
    const preview = buildCurve(points, { preview: true });
    expect(preview.length).toBeCloseTo(10);
    expect(curveFrame(preview, 5, [0, 0, 1]).normal).toEqual([0, 1, 0]);
  });
  it('interpolates signed voxels, with anisotropic/rotated world-to-index geometry', () => {
    const sampler = createTrilinearSampler(
      [3, 3, 3],
      identity,
      (i, j, k) => -1000 + i * 10 + j * 100 + k * 1000
    );
    expect(sampler(0.3, 0.4, 0.2)).toBeCloseTo(-757);
    expect(Number.isNaN(sampler(-1, 0, 0))).toBe(true);
    expect(sampler(2, 2, 2)).toBe(1220);
    const affine = [0, -0.5, 0, 0, 2, 0, 0, 0, 0, 0, 0.25, 0, -20, 5, -25, 1];
    const rotated = createTrilinearSampler([3, 3, 3], affine, (i, j, k) => i + 2 * j + 3 * k);
    // World (8, 10.5, 104) maps to voxel (1, 1, 1).
    expect(rotated(8, 10.5, 104)).toBeCloseTo(6);
  });

  it('uses millimetres along an open curve with stable perpendicular section planes', () => {
    const curve = straight();
    expect(curve.length).toBeCloseTo(20);
    expect(curve.points[0]).toEqual([0, 0, 0]);
    expect(curve.points[curve.points.length - 1]).toEqual([20, 0, 0]);
    const frame = curveFrame(curve, 7, [0, 0, 1]);
    expect(frame.point[0]).toBeCloseTo(7);
    expect(frame.normal).toEqual([0, 1, 0]);
    expect(() =>
      buildCurve([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ])
    ).toThrow();
  });
  it('smooths the whole arch through every control within one millimetre of the visible polygon', () => {
    const vertices: [number, number, number][] = [
      [-30, 30, 7],
      [-25, 5, 7],
      [-10, -10, 7],
      [0, -14, 7],
      [10, -10, 7],
      [25, 5, 7],
      [30, 30, 7],
    ];
    const curve = buildCurve(vertices);
    vertices.forEach(vertex => expect(curve.points).toContainEqual(vertex));
    const distances = curve.points.map(p =>
      Math.min(
        ...vertices.slice(1).map((b, i) => {
          const a = vertices[i],
            dx = b[0] - a[0],
            dy = b[1] - a[1];
          const t = Math.max(
            0,
            Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))
          );
          return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
        })
      )
    );
    expect(Math.max(...distances)).toBeLessThanOrEqual(1.000001);
    expect(Math.max(...distances)).toBeGreaterThan(0.05);
    expect(curve.points.every(p => Math.abs(p[2] - 7) < 1e-9)).toBe(true);
  });
  it('uses the endpoint tangent of the displayed curve when sampling the panorama', async () => {
    const curve = buildCurve([
      [0, 40, 0],
      [0, 20, 0],
      [5, 10, 0],
      [10, 0, 0],
      [15, 10, 0],
      [20, 20, 0],
      [20, 40, 0],
    ]);
    const raster = await reconstructPanorama({
      curve,
      up: [0, 0, 1],
      sample: (x, y) => x + 10 * y,
      thickness: 2,
      heightMm: 2,
      mode: 'mip',
      signal: new AbortController().signal,
    });
    // The one-sided endpoint tangent is vertical, so its sampling normal is (1,0,0).
    expect(raster.pixels[0]).toBeCloseTo(401);
  });
  it('keeps section directions continuous across ALL unevenly spaced controls, including lateral joins', () => {
    const controls: [number, number, number][] = [
      [-45, 35, 7],
      [-36, 10, 7],
      [-12, -15, 7],
      [0, -20, 7],
      [6, -17, 7],
      [30, 8, 7],
      [40, 35, 7],
    ];
    const curve = buildCurve(controls);
    for (const point of controls.slice(1, -1)) {
      const index = curve.points.findIndex(p => p.every((v, axis) => v === point[axis]));
      expect(index).toBeGreaterThan(0);
      const mm = curve.distances[index];
      const a = curveFrame(curve, mm - 0.01, [0, 0, 1]).normal;
      const b = curveFrame(curve, mm + 0.01, [0, 0, 1]).normal;
      const angle = Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            a.reduce((sum, v, axis) => sum + v * b[axis], 0)
          )
        )
      );
      expect((angle * 180) / Math.PI).toBeLessThan(1);
    }
  });

  it('reconstructs true grayscale mean/MIP slabs rather than screenshots of a 3D surface', async () => {
    const common = {
      curve: straight(),
      up: [0, 0, 1] as [number, number, number],
      sample: (x, y, z) => x + 100 * y + 1000 * z,
      thickness: 2,
      heightMm: 2,
      signal: new AbortController().signal,
    };
    const mean = await reconstructPanorama({ ...common, mode: 'mean' });
    const mip = await reconstructPanorama({ ...common, mode: 'mip' });
    expect(mean.pixels[0]).toBeCloseTo(1000);
    expect(mip.pixels[0]).toBeCloseTo(1100);
    expect(mean.pixels[mean.width - 1]).toBeCloseTo(1020);
    expect(mean.pixels[(mean.height - 1) * mean.width]).toBeCloseTo(-1000);
  });

  it('places nine perpendicular sections at the requested physical step without aspect distortion', async () => {
    const sections = await reconstructSections({
      curve: straight(),
      up: [0, 0, 1],
      sample: x => x,
      center: 10,
      step: 2,
      heightMm: 60,
      signal: new AbortController().signal,
    });
    expect(sections.map(section => section.distance)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    sections.forEach(section => {
      expect(section.raster.pixels[0]).toBeCloseTo(section.distance);
      expect((section.raster.width - 1) / section.raster.widthMm).toBeCloseTo(
        (section.raster.height - 1) / section.raster.heightMm
      );
    });
  });

  it.each(['mean', 'mip'] as const)(
    'removes unscanned top/bottom rows from a %s panorama and retains their physical position',
    async mode => {
      const raster = await reconstructPanorama({
        curve: straight(),
        up: [0, 0, 1],
        sample: (_x, _y, z) => (z >= -10 && z <= 30 ? 1000 + z : NaN),
        thickness: 2,
        heightMm: 80,
        mode,
        signal: new AbortController().signal,
      });
      const rowMm = 80 / (Math.ceil(80 / 0.35) - 1);
      expect(raster.height).toBeLessThan(Math.ceil(80 / 0.35));
      expect(raster.topMm).toBeLessThanOrEqual(30);
      expect(raster.topMm).toBeGreaterThan(30 - rowMm);
      expect(raster.topMm - raster.heightMm).toBeGreaterThanOrEqual(-10);
      expect(raster.topMm - raster.heightMm).toBeLessThan(-10 + rowMm);
      expect(raster.pixels.every(Number.isFinite)).toBe(true);
      expect(raster.pixels[0]).toBeCloseTo(1000 + raster.topMm, 3);
      expect(raster.pixels[(raster.height - 1) * raster.width]).toBeCloseTo(
        1000 + raster.topMm - raster.heightMm,
        3
      );
    }
  );

  it('retains black/dark sampled voxels, partial rows and internal empty gaps when trimming', () => {
    const raster = {
      width: 2,
      height: 6,
      widthMm: 1,
      heightMm: 10,
      pixels: new Float32Array([NaN, NaN, 0, NaN, NaN, NaN, -1000, -500, NaN, 0, NaN, NaN]),
    };
    const result = trimEmptyRasterRows(raster);
    expect(result.height).toBe(4);
    expect(result.heightMm).toBe(6);
    expect(result.topMm).toBe(3);
    expect([...result.pixels]).toEqual([0, NaN, NaN, NaN, -1000, -500, NaN, 0]);
    expect(raster.height).toBe(6);
    expect(raster.pixels).toHaveLength(12);
  });

  it('keeps an all-empty raster intact and a one-row scan at a nonzero physical height', () => {
    const empty = {
      width: 2,
      height: 4,
      widthMm: 1,
      heightMm: 6,
      pixels: new Float32Array(8).fill(NaN),
    };
    expect(trimEmptyRasterRows(empty)).toBe(empty);
    const single = { ...empty, pixels: empty.pixels.slice() };
    single.pixels[4] = 0;
    const result = trimEmptyRasterRows(single);
    expect(result.height).toBe(2);
    expect(result.heightMm).toBe(2);
    expect(result.pixels).toContain(0);
    expect(trimEmptyRasterRows(result)).toEqual(result);
  });

  it('does not publish a completed raster after cancellation', async () => {
    const controller = new AbortController();
    await expect(
      reconstructPanorama({
        curve: straight(),
        up: [0, 0, 1],
        sample: () => 10,
        thickness: 2,
        heightMm: 2,
        mode: 'mean',
        signal: controller.signal,
        onProgress: () => controller.abort(),
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      reconstructSections({
        curve: straight(),
        up: [0, 0, 1],
        sample: () => 10,
        center: 10,
        step: 2,
        heightMm: 2,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
