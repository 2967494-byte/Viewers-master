import { buildCurve, curveFrame, type Point3 } from './reconstruction';
import { nearestPanoramaPosition } from './panoramaCrosshair';
import { panoramaNavigationTarget, panoramaRasterPosition } from './panoramaNavigation';

const volume = { dimensions: [101, 101, 101], imageData: { worldToIndex: (p: Point3) => [...p] } };
const snapshot = {
  curve: buildCurve([
    [10, 40, 50],
    [40, 10, 50],
    [80, 40, 50],
  ]),
  up: [0, 0, 1] as Point3,
  raster: { heightMm: 60, topMm: 22 },
};

describe('panorama navigation in patient coordinates', () => {
  it('uses arc distance and cropped raster height, with a consistent reverse marker', () => {
    const target = panoramaNavigationTarget(snapshot, 0.72, 0.3, volume);
    const expected = curveFrame(snapshot.curve, 0.72 * snapshot.curve.length, snapshot.up).point;
    expect(target[0]).toBeCloseTo(expected[0]);
    expect(target[1]).toBeCloseTo(expected[1]);
    expect(target[2]).toBeCloseTo(54);
    expect(nearestPanoramaPosition(snapshot.curve, snapshot.up, target)).toBeCloseTo(0.72, 5);
    expect((snapshot.raster.topMm - (target[2] - 50)) / snapshot.raster.heightMm).toBeCloseTo(0.3);
  });
  it('follows an edited, reversed arch without relying on left/right screen X', () => {
    const edited = {
      ...snapshot,
      curve: buildCurve([
        [80, 40, 50],
        [40, 10, 50],
        [10, 40, 50],
      ]),
    };
    const original = JSON.stringify(edited);
    const a = panoramaNavigationTarget(edited, 0, 0, volume),
      b = panoramaNavigationTarget(edited, 1, 1, volume);
    expect(a).toEqual([80, 40, 72]);
    expect(b).toEqual([10, 40, 12]);
    expect(JSON.stringify(edited)).toBe(original);
  });
  it('limits height to actual voxels while retaining the same arch column', () => {
    const tall = { ...snapshot, raster: { heightMm: 400 } };
    const top = panoramaNavigationTarget(tall, 0.4, 0, volume),
      bottom = panoramaNavigationTarget(tall, 0.4, 1, volume);
    expect(top[2]).toBeCloseTo(100);
    expect(bottom[2]).toBeCloseTo(0);
    expect(top.slice(0, 2)).toEqual(bottom.slice(0, 2));
  });
  it('uses the physical volume transform and an oblique up vector', () => {
    const oblique = { ...snapshot, up: [0, 2, 2] as Point3 };
    const transformed = {
      dimensions: [101, 101, 101],
      imageData: { worldToIndex: (p: Point3) => [p[1] / 2, p[2], 100 - p[0]] },
    };
    const target = panoramaNavigationTarget(oblique, 0.5, 0, transformed);
    const base = curveFrame(oblique.curve, oblique.curve.length * 0.5, oblique.up).point;
    target.forEach((v, i) => expect(v).toBeCloseTo(base[i] + ([0, 1, 1][i] * 22) / Math.sqrt(2)));
  });
  it('ignores an arch column that never intersects the scanned volume', () => {
    const outside = {
      ...snapshot,
      curve: buildCurve([
        [-30, 10, 50],
        [-20, 10, 50],
        [-10, 10, 50],
      ]),
    };
    expect(panoramaNavigationTarget(outside, 0.5, 0.5, volume)).toBeNull();
  });
  it('rejects invalid geometry and positions rather than moving the planes', () => {
    for (const [x, y] of [
      [NaN, 0.5],
      [-0.1, 0.5],
      [1.1, 0.5],
      [0.5, Infinity],
      [0.5, -1],
    ])
      expect(panoramaNavigationTarget(snapshot, x, y, volume)).toBeNull();
    expect(panoramaNavigationTarget({ ...snapshot, up: [0, 0, 0] }, 0.5, 0.5, volume)).toBeNull();
    expect(
      panoramaNavigationTarget(snapshot, 0.5, 0.5, { ...volume, dimensions: [1, 1, 1] })
    ).toBeNull();
  });
});

describe('picking the displayed panorama pixels', () => {
  const raster = { width: 401, height: 201 };
  const rect = { left: 10, top: 20, width: 802, height: 602 };
  it('excludes object-fit margins and maps pixel centers at fractional browser scale', () => {
    expect(panoramaRasterPosition(rect, raster, 410, 320)).toEqual([0.5, 0.5]);
    expect(panoramaRasterPosition(rect, raster, 410, 30)).toBeNull();
    const scaled = { left: 8, top: 16, width: 641.6, height: 481.6 };
    const position = panoramaRasterPosition(scaled, raster, 328, 256);
    position.forEach(v => expect(v).toBeCloseTo(0.5));
  });
  it('allows a held drag to reach image edges but rejects a click in side margins', () => {
    const narrow = { left: 0, top: 0, width: 800, height: 201 };
    expect(panoramaRasterPosition(narrow, raster, 0, 100)).toBeNull();
    expect(panoramaRasterPosition(narrow, raster, -500, 500, true)).toEqual([0, 1]);
    expect(panoramaRasterPosition(narrow, raster, 1500, -500, true)).toEqual([1, 0]);
  });
  it('ignores missing display area and non-finite coordinates', () => {
    expect(panoramaRasterPosition({ ...rect, width: 0 }, raster, 0, 0)).toBeNull();
    expect(panoramaRasterPosition(rect, raster, NaN, 0)).toBeNull();
  });
});
