import { vec3 } from 'gl-matrix';
import {
  implantEndpoints,
  implantMatrix,
  implantPlaneSection,
  rotateImplantInPlane,
  implantAngles,
  implantAxisFromAngles,
} from './implantGeometry';

describe('Implant geometry shared by axial, coronal, sagittal and 3D', () => {
  it('uses the anatomical Z axis regardless of which pane placed the implant', () => {
    const [start, end] = implantEndpoints([2, 3, 4], 10);
    expect(start).toEqual([2, 3, 4]);
    expect(end).toEqual([2, 3, 14]);
    // Axial projects XY: a circular end view. Coronal XZ / sagittal YZ: 10 mm side view.
    expect([start[0], start[1]]).toEqual([end[0], end[1]]);
    expect(Math.abs(end[2] - start[2])).toBe(10);
  });
  it('applies scale once and maps both ends of a unit cylinder exactly into patient coordinates', () => {
    for (const end of [
      [10, 20, 40],
      [10, 20, 20],
      [10, 40, 30],
      [10, 0, 30],
    ] as [number, number, number][]) {
      const start: [number, number, number] = [10, 20, 30];
      const matrix = implantMatrix(start, end, 4);
      const a = vec3.transformMat4(vec3.create(), [0, -0.5, 0], matrix);
      const b = vec3.transformMat4(vec3.create(), [0, 0.5, 0], matrix);
      start.forEach((v, i) => expect(a[i]).toBeCloseTo(v));
      end.forEach((v, i) => expect(b[i]).toBeCloseTo(v));
      const left = vec3.transformMat4(vec3.create(), [-0.5, 0, 0], matrix);
      const right = vec3.transformMat4(vec3.create(), [0.5, 0, 0], matrix);
      expect(vec3.distance(left, right)).toBeCloseTo(4);
    }
  });
});

describe('Finite cylinder intersections and rigid editing in patient coordinates', () => {
  it.each([0, 30, 60, 89.999])(
    'matches the ellipse of an axis at %s degrees and every contour point lies in the plane/body',
    angle => {
      const a = (angle * Math.PI) / 180,
        axis = [Math.sin(a), 0, Math.cos(a)];
      const start = axis.map(v => -10 * v) as [number, number, number],
        end = axis.map(v => 10 * v) as [number, number, number];
      const contour = implantPlaneSection(start, end, 2, [0, 0, 0], [0, 0, 1]);
      expect(contour.length).toBeGreaterThan(3);
      for (const p of contour) {
        expect(p[2]).toBeCloseTo(0, 6);
        const t = p.reduce((s, v, i) => s + (v - start[i]) * axis[i], 0);
        expect(t).toBeGreaterThanOrEqual(-1e-6);
        expect(t).toBeLessThanOrEqual(20 + 1e-6);
        const radial = p.reduce((s, v, i) => s + (v - start[i] - t * axis[i]) ** 2, 0);
        expect(radial).toBeLessThanOrEqual(4 + 1e-5);
      }
      if (angle <= 60) expect(Math.max(...contour.map(p => p[0]))).toBeCloseTo(2 / Math.cos(a), 5);
    }
  );
  it('clips an ellipse to both finite end caps and rejects a plane beyond the body', () => {
    const c = Math.SQRT1_2,
      start: [number, number, number] = [-c, 0, -c],
      end: [number, number, number] = [c, 0, c];
    const section = implantPlaneSection(start, end, 2, [0, 0, 0], [0, 0, 1]);
    expect(Math.max(...section.map(p => p[0]))).toBeCloseTo(Math.SQRT2);
    expect(Math.min(...section.map(p => p[0]))).toBeCloseTo(-Math.SQRT2);
    expect(implantPlaneSection([0, 0, 0], [0, 0, 10], 2, [0, 0, 11], [0, 0, 1])).toEqual([]);
    expect(
      implantPlaneSection([0, 0, 0], [0, 0, 10], 2, [0, 0, 10], [0, 0, -2]).length
    ).toBeGreaterThan(3);
  });
  it('gives an exact parallel chord and a normalized oblique plane', () => {
    const section = implantPlaneSection([0, 0, 0], [0, 0, 10], 2, [0, 1, 0], [0, 2, 0]);
    expect(section).toHaveLength(4);
    section.forEach(p => {
      expect(p[1]).toBeCloseTo(1);
      expect(Math.abs(p[0])).toBeCloseTo(Math.sqrt(3));
    });
    expect(implantPlaneSection([0, 0, 0], [0, 0, 10], 2, [0, 3, 0], [0, 1, 0])).toEqual([]);
  });
  it('keeps length, platform and out-of-plane tilt while rotating with a grab offset', () => {
    const start: [number, number, number] = [2, 3, 4],
      end: [number, number, number] = [8, 3, 12];
    const result = rotateImplantInPlane(start, end, [9, 3, 0], [2, 10, 0], [0, 0, 1]);
    [2, 9, 12].forEach((v, i) => expect(result[i]).toBeCloseTo(v, 10));
    expect(Math.hypot(...result.map((v, i) => v - start[i]))).toBeCloseTo(10);
    expect(start).toEqual([2, 3, 4]);
    expect(rotateImplantInPlane(start, end, [9, 3, 0], [9, 3, 0], [0, 0, 1])).toEqual(end);
  });
  it('round-trips arbitrary world axes through two editor angles, including both jaw directions', () => {
    for (const end of [
      [3, 4, 5],
      [-3, 4, -5],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, -5],
    ] as [number, number, number][]) {
      const angles = implantAngles([0, 0, 0], end),
        axis = implantAxisFromAngles(angles.frontal, angles.sagittal, angles.direction);
      end.forEach((v, i) => expect(axis[i]).toBeCloseTo(v / Math.hypot(...end), 10));
    }
  });
});
