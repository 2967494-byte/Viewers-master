import { movePointInArchPlane } from './archEditing';
import { buildCurve, type Point3 } from './reconstruction';

describe('Planar arch editing across axial slices', () => {
  it('preserves arch height and grab offset after scrolling to another slice', () => {
    expect(movePointInArchPlane([20, 10, 7], [22, 11, 33], [42, 31, 46], [0, 0, 1])).toEqual([
      40, 30, 7,
    ]);
  });
  it('preserves an oblique plane rather than hard-coding the Z coordinate', () => {
    const original: Point3 = [4, 7, 9],
      up: Point3 = [0, 1, 1];
    const result = movePointInArchPlane(original, [1, 2, 3], [6, 10, 15], up);
    expect(result).toEqual([9, 5, 11]);
    expect(result[1] + result[2]).toBe(original[1] + original[2]);
  });
  it('keeps the reconstruction curve flat when one handle is edited while viewing a higher slice', () => {
    const points: Point3[] = [
      [0, 20, 7],
      [10, 5, 7],
      [20, 0, 7],
      [30, 5, 7],
      [40, 20, 7],
    ];
    points[2] = movePointInArchPlane(points[2], [20, 0, 33], [20, -8, 33], [0, 0, 1]);
    expect(buildCurve(points).points.every(p => Math.abs(p[2] - 7) < 1e-9)).toBe(true);
  });
});
