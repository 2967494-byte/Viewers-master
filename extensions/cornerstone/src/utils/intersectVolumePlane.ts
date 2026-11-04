type Point = [number, number, number];
const dot = (a: Point, b: Point) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const subtract = (a: Point, b: Point): Point => a.map((value, i) => value - b[i]) as Point;

/** Intersect a plane with the 12 edges of an oriented image volume, in patient space. */
export default function intersectVolumePlane(
  corners: Point[],
  origin: Point,
  normal: Point
): Point[] {
  const points: Point[] = [];
  const add = (point: Point) => {
    if (!points.some(other => Math.hypot(...subtract(point, other)) < 1e-4)) points.push(point);
  };
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      const j = i ^ bit;
      if (i >= j) continue;
      const a = corners[i];
      const b = corners[j];
      const da = dot(subtract(a, origin), normal);
      const db = dot(subtract(b, origin), normal);
      if (Math.abs(da) < 1e-6) add(a);
      if (Math.abs(db) < 1e-6) add(b);
      if (da * db < 0) {
        const t = da / (da - db);
        add(a.map((value, axis) => value + t * (b[axis] - value)) as Point);
      }
    }
  }
  if (points.length < 3) return [];
  const center = points.reduce(
    (sum, p) => sum.map((v, i) => v + p[i] / points.length) as Point,
    [0, 0, 0]
  );
  const u = subtract(points[0], center);
  const v: Point = [
    normal[1] * u[2] - normal[2] * u[1],
    normal[2] * u[0] - normal[0] * u[2],
    normal[0] * u[1] - normal[1] * u[0],
  ];
  const lengthU = Math.hypot(...u);
  const lengthV = Math.hypot(...v);
  const angle = (p: Point) =>
    Math.atan2(dot(subtract(p, center), v) / lengthV, dot(subtract(p, center), u) / lengthU);
  return points.sort((a, b) => angle(a) - angle(b));
}
