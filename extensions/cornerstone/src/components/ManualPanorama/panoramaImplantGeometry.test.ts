import { buildCurve, curveFrame, type Point3 } from './reconstruction';
import {
  preparePanoramaImplantGeometry,
  projectImplantToPanorama,
} from './panoramaImplantGeometry';

const snapshot = {
  curve: buildCurve([
    [-20, 0, 0],
    [0, 0, 0],
    [20, 0, 0],
  ]),
  up: [0, 0, 1] as Point3,
  thickness: 8,
  raster: { width: 401, height: 201, widthMm: 40, heightMm: 20, pixels: new Float32Array(0) },
};
const geometry = preparePanoramaImplantGeometry(snapshot);
const bounds = result => {
  const points = result.contours.flat();
  return {
    left: Math.min(...points.map(p => p[0])),
    right: Math.max(...points.map(p => p[0])),
    top: Math.min(...points.map(p => p[1])),
    bottom: Math.max(...points.map(p => p[1])),
  };
};

describe('physical implant projection through the curved CPR slab', () => {
  it('shows the same nominal diameter and length in millimetres as MPR', () => {
    const result = projectImplantToPanorama(geometry, [0, 0, -4], [0, 0, 4], 4);
    expect(result.contours).toHaveLength(1);
    const box = bounds(result);
    expect(Math.abs(box.left - 180)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.right - 220)).toBeLessThanOrEqual(1);
    expect(box.top).toBeCloseTo(60);
    expect(box.bottom).toBeCloseTo(140);
  });
  it('projects only the part intersecting the slab, including partial radial intersection', () => {
    const full = bounds(projectImplantToPanorama(geometry, [0, 0, -4], [0, 0, 4], 4));
    const partial = bounds(projectImplantToPanorama(geometry, [0, 5, -4], [0, 5, 4], 4));
    expect(partial.right - partial.left).toBeLessThan(full.right - full.left);
    expect(partial.right - partial.left).toBeGreaterThan(32);
    expect(projectImplantToPanorama(geometry, [0, 7, -4], [0, 7, 4], 4).contours).toEqual([]);
  });
  it('represents an end-on implant as a round projection rather than its catalog length', () => {
    const box = bounds(projectImplantToPanorama(geometry, [0, -6, 0], [0, 6, 0], 4));
    expect(box.left).toBeGreaterThanOrEqual(179);
    expect(box.right).toBeLessThanOrEqual(221);
    expect(box.top).toBeCloseTo(80);
    expect(box.bottom).toBeCloseTo(120);
  });
  it('retains tilt and platform position instead of drawing a vertical symbol', () => {
    const tilted = projectImplantToPanorama(geometry, [-3, 0, -4], [3, 0, 4], 4),
      box = bounds(tilted);
    expect(box.right - box.left).toBeGreaterThan(80);
    const topBand = tilted.contours.flat().filter(p => p[1] < 65);
    const bottomBand = tilted.contours.flat().filter(p => p[1] > 135);
    expect(topBand.reduce((s, p) => s + p[0], 0) / topBand.length).toBeGreaterThan(215);
    expect(bottomBand.reduce((s, p) => s + p[0], 0) / bottomBand.length).toBeLessThan(185);
  });
  it('clips to cropped panorama rows and hides implants beyond either arch end', () => {
    const cropped = preparePanoramaImplantGeometry({
      ...snapshot,
      raster: { ...snapshot.raster, topMm: 3, heightMm: 10 },
    });
    const box = bounds(projectImplantToPanorama(cropped, [0, 0, 1], [0, 0, 8], 4));
    expect(box.top).toBeCloseTo(0);
    expect(box.bottom).toBeCloseTo(40);
    expect(projectImplantToPanorama(geometry, [25, 0, -4], [25, 0, 4], 4).contours).toEqual([]);
    expect(projectImplantToPanorama(geometry, [0, 0, 15], [0, 0, 20], 4).contours).toEqual([]);
  });
  it('uses the edited curved arch and reverses display side without moving the implant', () => {
    const points: Point3[] = [
      [-20, 10, 0],
      [-10, -5, 0],
      [0, -10, 0],
      [10, -5, 0],
      [20, 10, 0],
    ];
    const curve = buildCurve(points),
      p = curveFrame(curve, curve.length * 0.8, snapshot.up).point;
    const a = [p[0], p[1], -4] as Point3,
      b = [p[0], p[1], 4] as Point3;
    const forward = bounds(
      projectImplantToPanorama(preparePanoramaImplantGeometry({ ...snapshot, curve }), a, b, 4)
    );
    const reverse = bounds(
      projectImplantToPanorama(
        preparePanoramaImplantGeometry({ ...snapshot, curve: buildCurve([...points].reverse()) }),
        a,
        b,
        4
      )
    );
    expect((forward.left + forward.right) / 800).toBeCloseTo(0.8, 1);
    expect((reverse.left + reverse.right) / 800).toBeCloseTo(0.2, 1);
    expect(forward.left).toBeCloseTo(400 - reverse.right);
  });
  it('is invariant under a rotated/translated patient coordinate system', () => {
    const transform = (p: Point3): Point3 => [
      100 + (p[0] + p[2]) / Math.sqrt(2),
      200 + p[1],
      300 + (p[2] - p[0]) / Math.sqrt(2),
    ];
    const rotated = {
      ...snapshot,
      curve: buildCurve(
        [
          [-20, 0, 0],
          [0, 0, 0],
          [20, 0, 0],
        ].map(p => transform(p as Point3))
      ),
      up: [1 / Math.sqrt(2), 0, 1 / Math.sqrt(2)] as Point3,
    };
    const a = projectImplantToPanorama(geometry, [-3, 0, -4], [3, 0, 4], 4);
    const b = projectImplantToPanorama(
      preparePanoramaImplantGeometry(rotated),
      transform([-3, 0, -4]),
      transform([3, 0, 4]),
      4
    );
    const ba = bounds(a),
      bb = bounds(b);
    // A grazing boundary may move by one sampled column due to floating-point roundoff.
    for (const key of Object.keys(ba)) expect(Math.abs(bb[key] - ba[key])).toBeLessThanOrEqual(1.001);
  });
  it('rejects invalid geometry without mutating the existing points or allocating voxel data', () => {
    const before = JSON.stringify(snapshot),
      start: Point3 = [0, 0, -4],
      end: Point3 = [0, 0, 4];
    expect(projectImplantToPanorama(geometry, start, end, NaN).contours).toEqual([]);
    expect(projectImplantToPanorama(geometry, start, start, 4).contours).toEqual([]);
    expect(projectImplantToPanorama(geometry, [NaN, 0, 0], end, 4).contours).toEqual([]);
    expect(preparePanoramaImplantGeometry({ ...snapshot, thickness: 0 })).toBeNull();
    expect(preparePanoramaImplantGeometry({ ...snapshot, up: [0, 0, 0] })).toBeNull();
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(start).toEqual([0, 0, -4]);
  });
});
