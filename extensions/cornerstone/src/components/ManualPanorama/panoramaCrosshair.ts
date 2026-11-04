import { cross, normalize, type Curve, type Point3 } from './reconstruction';

const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const finitePoint = (point: Point3) => point?.length === 3 && point.every(Number.isFinite);
type Plane = { focalPoint?: Point3; viewPlaneNormal?: Point3 };

/** Read the real MPR intersection, including before CrosshairsTool has emitted its first move. */
export function intersectMprPlanes(planes: Plane[]): Point3 | null {
  if (
    planes.length !== 3 ||
    planes.some(p => !p || !finitePoint(p.focalPoint) || !finitePoint(p.viewPlaneNormal))
  )
    return null;
  const normals = planes.map(p => normalize(p.viewPlaneNormal));
  const terms = [
    cross(normals[1], normals[2]),
    cross(normals[2], normals[0]),
    cross(normals[0], normals[1]),
  ];
  const denominator = dot(normals[0], terms[0]);
  if (Math.abs(denominator) < 1e-8) return null;
  const offsets = planes.map((p, i) => dot(normals[i], p.focalPoint));
  return [0, 1, 2].map(
    axis => terms.reduce((sum, term, i) => sum + offsets[i] * term[axis], 0) / denominator
  ) as Point3;
}

/** Match the point drawn by CrosshairsTool on the current axial image.
 * Its center can differ from the camera-plane intersection after a programmatic
 * camera change. Project onto the displayed plane, just as worldToCanvas does.
 * Before the tool is initialized, the camera intersection remains the fallback.
 */
export function displayedMprCrosshair(planes: Plane[], toolCenter?: Point3): Point3 | null {
  if (!finitePoint(toolCenter)) return intersectMprPlanes(planes);
  const axial = planes.length === 3 ? planes[2] : null;
  if (
    !axial ||
    !finitePoint(axial.focalPoint) ||
    !finitePoint(axial.viewPlaneNormal) ||
    Math.hypot(...axial.viewPlaneNormal) < 1e-8
  )
    return null;
  const normal = normalize(axial.viewPlaneNormal);
  const offset = normal.reduce(
    (sum, value, i) => sum + value * (toolCenter[i] - axial.focalPoint[i]),
    0
  );
  return toolCenter.map((value, i) => value - offset * normal[i]) as Point3;
}

/** Project to the existing CPR path in its own plane, without sampling or rebuilding the volume. */
export function nearestPanoramaPosition(
  curve: Curve,
  up: Point3,
  world: Point3
): number | undefined {
  if (!curve?.length || !finitePoint(world) || !finitePoint(up) || !Math.hypot(...up)) return;
  const vertical = normalize(up);
  let bestSquared = Infinity,
    bestDistance = 0;
  for (let i = 0; i < curve.points.length - 1; i++) {
    const a = curve.points[i],
      b = curve.points[i + 1];
    // Avoid per-segment allocations during continuous MPR dragging.
    let dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    let px = world[0] - a[0],
      py = world[1] - a[1],
      pz = world[2] - a[2];
    const dzUp = dx * vertical[0] + dy * vertical[1] + dz * vertical[2];
    const pzUp = px * vertical[0] + py * vertical[1] + pz * vertical[2];
    dx -= dzUp * vertical[0];
    dy -= dzUp * vertical[1];
    dz -= dzUp * vertical[2];
    px -= pzUp * vertical[0];
    py -= pzUp * vertical[1];
    pz -= pzUp * vertical[2];
    const t = Math.max(
      0,
      Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz || 1))
    );
    const rx = px - t * dx,
      ry = py - t * dy,
      rz = pz - t * dz;
    const squared = rx * rx + ry * ry + rz * rz;
    if (squared < bestSquared) {
      bestSquared = squared;
      bestDistance = curve.distances[i] + t * (curve.distances[i + 1] - curve.distances[i]);
    }
  }
  return Number.isFinite(bestSquared) ? bestDistance / curve.length : undefined;
}
