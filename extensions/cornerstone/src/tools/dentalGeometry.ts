import { buildCurve, type Point3 } from '../components/ManualPanorama/reconstruction';

export type { Point3 };
export const distance3D = (a: Point3, b: Point3) => Math.hypot(...a.map((v, i) => v - b[i]));
export const pathLength = (points: Point3[]) =>
  points.reduce((sum, point, i) => sum + (i ? distance3D(point, points[i - 1]) : 0), 0);

export function angle3D(points: Point3[]) {
  if (points.length !== 3) return null;
  const a = points[0].map((v, i) => v - points[1][i]);
  const b = points[2].map((v, i) => v - points[1][i]);
  const length = Math.hypot(...a) * Math.hypot(...b);
  if (length < 1e-6) return null;
  const cosine = a.reduce((sum, v, i) => sum + v * b[i], 0) / length;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

export function dentalPath(points: Point3[], curved: boolean): Point3[] {
  if (!curved || points.length < 3) return points;
  try {
    return buildCurve(points, { preview: true }).points;
  } catch {
    return points;
  }
}

/** Clip a 3D path to the current slice slab, including crossings with no vertex inside it. */
export function pathInSlice(points: Point3[], origin: Point3, normal: Point3, halfWidth: number) {
  const result: Point3[][] = [];
  const signed = (p: Point3) => p.reduce((sum, v, i) => sum + (v - origin[i]) * normal[i], 0);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const da = signed(a),
      db = signed(b),
      delta = db - da;
    let start = 0,
      end = 1;
    if (Math.abs(delta) < 1e-9) {
      if (Math.abs(da) > halfWidth) continue;
    } else {
      const t1 = (-halfWidth - da) / delta,
        t2 = (halfWidth - da) / delta;
      start = Math.max(0, Math.min(t1, t2));
      end = Math.min(1, Math.max(t1, t2));
      if (start > end) continue;
    }
    const interpolate = (t: number) => a.map((v, axis) => v + t * (b[axis] - v)) as Point3;
    result.push([interpolate(start), interpolate(end)]);
  }
  return result;
}
