import type { Point3 } from './reconstruction';

/** Move in the original arch plane, regardless of the axial slice currently being viewed. */
export function movePointInArchPlane(
  original: Point3,
  start: Point3,
  current: Point3,
  up: Point3
): Point3 {
  const delta = current.map((v, i) => v - start[i]) as Point3;
  const normSquared = up.reduce((sum, v) => sum + v * v, 0) || 1;
  const vertical = delta.reduce((sum, v, i) => sum + v * up[i], 0) / normSquared;
  return original.map((v, i) => v + delta[i] - up[i] * vertical) as Point3;
}
