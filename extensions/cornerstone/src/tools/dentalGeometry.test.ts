import { angle3D, dentalPath, distance3D, pathInSlice, pathLength } from './dentalGeometry';

describe('Dental measurements in patient world coordinates', () => {
  it('measures spatial distance and a non-coplanar path in millimetres', () => {
    expect(distance3D([0, 0, 0], [3, 4, 12])).toBe(13);
    expect(
      pathLength([
        [0, 0, 0],
        [3, 4, 0],
        [3, 4, 12],
      ])
    ).toBe(17);
  });
  it('uses the second point as the angle vertex and rejects zero-length arms', () => {
    expect(
      angle3D([
        [1, 0, 0],
        [0, 0, 0],
        [0, 0, 5],
      ])
    ).toBe(90);
    expect(
      angle3D([
        [1, 0, 0],
        [0, 0, 0],
        [1, 1, 1],
      ])
    ).toBeCloseTo(54.73561);
    expect(
      angle3D([
        [0, 0, 0],
        [0, 0, 0],
        [1, 1, 1],
      ])
    ).toBe(null);
  });
  it('measures an open interpolated curve without adding an end-to-start segment', () => {
    const points: [number, number, number][] = [
      [0, 0, 0],
      [10, 8, 4],
      [20, 0, 0],
    ];
    const path = dentalPath(points, true);
    expect(path[0]).toEqual(points[0]);
    expect(path[path.length - 1]).toEqual(points[2]);
    expect(pathLength(path)).toBeGreaterThan(pathLength(points));
    expect(pathLength(path)).toBeLessThan(35);
    expect(dentalPath(points, false)).toEqual(points);
  });
  it('clips canal segments that cross a slice even when neither endpoint is inside', () => {
    expect(
      pathInSlice(
        [
          [0, 0, -10],
          [0, 0, 10],
        ],
        [0, 0, 0],
        [0, 0, 1],
        1
      )
    ).toEqual([
      [
        [0, 0, -1],
        [0, 0, 1],
      ],
    ]);
    expect(
      pathInSlice(
        [
          [0, 0, 8],
          [4, 0, 8],
        ],
        [0, 0, 0],
        [0, 0, 1],
        1
      )
    ).toEqual([]);
    expect(
      pathInSlice(
        [
          [0, 0, 0],
          [4, 0, 0],
        ],
        [0, 0, 0],
        [0, 0, 1],
        1
      )
    ).toHaveLength(1);
  });
});
