import intersectVolumePlane from './intersectVolumePlane';

type Point = [number, number, number];
const cube = Array.from(
  { length: 8 },
  (_, i) => [i & 1 ? 10 : 0, i & 2 ? 10 : 0, i & 4 ? 10 : 0] as Point
);

describe('3D slice reference geometry', () => {
  it('moves with the axial plane and remains within the volume', () => {
    for (const z of [0, 3, 10]) {
      const polygon = intersectVolumePlane(cube, [0, 0, z], [0, 0, 1]);
      expect(polygon).toHaveLength(4);
      expect(polygon.every(point => point[2] === z)).toBe(true);
      expect(new Set(polygon.map(point => point.join(','))).size).toBe(4);
    }
  });

  it('handles an oblique plane with six intersections', () => {
    const polygon = intersectVolumePlane(cube, [5, 5, 5], [1, 1, 1]);
    expect(polygon).toHaveLength(6);
    polygon.forEach(point => expect(point.reduce((sum, v) => sum + v, 0)).toBeCloseTo(15));
    // Adjacent edges of the sorted polygon must not cross the interior.
    polygon.forEach((point, i) => {
      const next = polygon[(i + 1) % polygon.length];
      expect(point.some((value, axis) => value === next[axis] && [0, 10].includes(value))).toBe(
        true
      );
    });
  });

  it('respects an oriented, anisotropic image in patient coordinates', () => {
    const transform = ([x, y, z]: Point): Point => [100 - y * 2, 200 + x * 3, 300 + z * 0.4];
    const polygon = intersectVolumePlane(cube.map(transform), transform([0, 0, 5]), [0, 0, 1]);
    expect(polygon).toHaveLength(4);
    polygon.forEach(([x, y, z]) => {
      expect(x).toBeGreaterThanOrEqual(80);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(200);
      expect(y).toBeLessThanOrEqual(230);
      expect(z).toBeCloseTo(302);
    });
  });

  it('hides planes outside the volume or only touching a corner', () => {
    expect(intersectVolumePlane(cube, [0, 0, 11], [0, 0, 1])).toEqual([]);
    expect(intersectVolumePlane(cube, [0, 0, 0], [1, 1, 1])).toEqual([]);
  });
});
