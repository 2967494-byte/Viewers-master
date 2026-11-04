import { buildCurve, curveFrame, type Point3 } from './reconstruction';
import {
  displayedMprCrosshair,
  intersectMprPlanes,
  nearestPanoramaPosition,
} from './panoramaCrosshair';

describe('MPR crosshair on the existing panorama geometry', () => {
  const planes = [
    { focalPoint: [99, 20, 99] as Point3, viewPlaneNormal: [0, 1, 0] as Point3 },
    { focalPoint: [10, 99, 99] as Point3, viewPlaneNormal: [1, 0, 0] as Point3 },
    { focalPoint: [99, 99, 9] as Point3, viewPlaneNormal: [0, 0, 1] as Point3 },
  ];
  it('uses the visible tool center on the axial slice instead of a different camera intersection', () => {
    const center: Point3 = [30, 25, 100];
    expect(intersectMprPlanes(planes)).toEqual([10, 20, 9]);
    expect(displayedMprCrosshair(planes, center)).toEqual([30, 25, 9]);
    expect(center).toEqual([30, 25, 100]);
  });
  it('projects the visible center onto a rotated axial plane in patient coordinates', () => {
    const rotated = [
      ...planes.slice(0, 2),
      {
        focalPoint: [0, 3, 3] as Point3,
        viewPlaneNormal: [0, 2, 2] as Point3,
      },
    ];
    const point = displayedMprCrosshair(rotated, [5, 10, 0]);
    point.forEach((value, i) => expect(value).toBeCloseTo([5, 8, -2][i]));
  });
  it('falls back to camera planes before initialization and rejects an invalid axial plane', () => {
    expect(displayedMprCrosshair(planes)).toEqual([10, 20, 9]);
    expect(displayedMprCrosshair(planes, [NaN, 0, 0])).toEqual([10, 20, 9]);
    expect(displayedMprCrosshair(planes.slice(0, 2), [1, 2, 3])).toBeNull();
    expect(
      displayedMprCrosshair(
        [...planes.slice(0, 2), { ...planes[2], viewPlaneNormal: [0, 0, 0] }],
        [1, 2, 3]
      )
    ).toBeNull();
  });
  it('finds the intersection of rotated planes rather than any individual camera focal point', () => {
    const point = intersectMprPlanes([
      { focalPoint: [10, -4, 1], viewPlaneNormal: [2, 2, 0] },
      { focalPoint: [5, 3, 2], viewPlaneNormal: [-3, 3, 0] },
      { focalPoint: [99, -99, 8], viewPlaneNormal: [0, 0, -1] },
    ]);
    point.forEach((value, i) => expect(value).toBeCloseTo([4, 2, 8][i]));
  });
  it('does not invent an intersection for incomplete, invalid or parallel planes', () => {
    const plane = { focalPoint: [0, 0, 0] as Point3, viewPlaneNormal: [0, 0, 1] as Point3 };
    expect(intersectMprPlanes([plane, plane])).toBe(null);
    expect(intersectMprPlanes([plane, plane, plane])).toBe(null);
    expect(intersectMprPlanes([plane, plane, { ...plane, focalPoint: [NaN, 0, 0] }])).toBe(null);
  });
  it('projects within segments in millimetres and ignores height above the arch plane', () => {
    const curve = buildCurve([
      [0, 0, 7],
      [10, 0, 7],
      [20, 0, 7],
    ]);
    expect(nearestPanoramaPosition(curve, [0, 0, 1], [7, 50, -200])).toBeCloseTo(0.35);
    expect(nearestPanoramaPosition(curve, [0, 0, 2], [7, 50, 200])).toBeCloseTo(0.35);
    expect(nearestPanoramaPosition(curve, [0, 0, 1], [-100, 0, 7])).toBe(0);
    expect(nearestPanoramaPosition(curve, [0, 0, 1], [100, 0, 7])).toBe(1);
  });
  it('locates a point along a curved dental arch without replacing it with a straight X axis', () => {
    const curve = buildCurve([
      [-30, 20, 7],
      [-20, -10, 7],
      [0, -20, 7],
      [20, -10, 7],
      [30, 20, 7],
    ]);
    const frame = curveFrame(curve, curve.length * 0.77, [0, 0, 1]);
    const world = frame.point.map((v, i) => v + frame.normal[i] * 3 + (i === 2 ? 50 : 0)) as Point3;
    expect(nearestPanoramaPosition(curve, [0, 0, 1], world)).toBeCloseTo(0.77, 2);
  });
  it('supports an oblique arch plane and leaves the reconstruction geometry unchanged', () => {
    const curve = buildCurve([
      [0, 0, 0],
      [10, 10, -10],
      [20, 20, -20],
    ]);
    const original = JSON.stringify(curve);
    expect(nearestPanoramaPosition(curve, [0, 1, 1], [6, 36, 24])).toBeCloseTo(0.3);
    expect(JSON.stringify(curve)).toBe(original);
    expect(nearestPanoramaPosition(curve, [0, 0, 0], [6, 36, 24])).toBeUndefined();
    expect(nearestPanoramaPosition(curve, [0, 1, 1], [NaN, 0, 0])).toBeUndefined();
  });
});
