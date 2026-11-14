import { implantPlaneSection } from '../../tools/implantGeometry';
import { cross, curveFrame, normalize, type Point3 } from './reconstruction';
import type { PanoramaSnapshot } from './panoramaSession';

type Point2 = [number, number];
type Column = { point: Point3; normal: Point3; planeNormal: Point3; x: number };
export type PanoramaImplantGeometry = {
  columns: Column[];
  up: Point3;
  halfThickness: number;
  top: number;
  bottom: number;
  rowScale: number;
};
export type ImplantProjection = { contours: Point2[][] };
const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const finitePoint = (point: Point3) => point?.length === 3 && point.every(Number.isFinite);

/** Reuse the actual CPR columns; never approximate the dental arch with a straight X axis. */
export function preparePanoramaImplantGeometry(
  snapshot: Pick<PanoramaSnapshot, 'curve' | 'up' | 'raster' | 'thickness'>
): PanoramaImplantGeometry | null {
  if (!snapshot?.curve?.length || !finitePoint(snapshot.up) || Math.hypot(...snapshot.up) < 1e-8)
    return null;
  const { raster, thickness, curve } = snapshot;
  const top = raster.topMm ?? raster.heightMm / 2;
  if (
    ![top, raster.heightMm, raster.width, raster.height, thickness].every(Number.isFinite) ||
    raster.width < 2 ||
    raster.width > 4096 ||
    raster.height < 2 ||
    raster.heightMm <= 0 ||
    thickness <= 0
  )
    return null;
  const up = normalize(snapshot.up);
  const columns = Array.from({ length: raster.width }, (_, x) => {
    const { point, normal } = curveFrame(curve, (x * curve.length) / (raster.width - 1), up);
    return { point, normal, planeNormal: normalize(cross(normal, up)), x };
  });
  return {
    columns,
    up,
    halfThickness: thickness / 2,
    top,
    bottom: top - raster.heightMm,
    rowScale: (raster.height - 1) / raster.heightMm,
  };
}

/** Clip a convex section to the physical depth and height represented by the panorama. */
function clip(points: Point2[], axis: number, bound: number, keepGreater: boolean): Point2[] {
  if (!points.length) return points;
  const result: Point2[] = [];
  let a = points[points.length - 1],
    da = (a[axis] - bound) * (keepGreater ? 1 : -1);
  for (const b of points) {
    const db = (b[axis] - bound) * (keepGreater ? 1 : -1);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
    if (db >= 0) result.push(b);
    a = b;
    da = db;
  }
  return result;
}

/** Slab projection of the same nominal finite cylinder used in MPR and 3D.
 * Each curved CPR column intersects the cylinder analytically, then projects only
 * the section inside the slab. No voxel sampling, image decoding or volume copy.
 */
export function projectImplantToPanorama(
  geometry: PanoramaImplantGeometry,
  start: Point3,
  end: Point3,
  diameter: number
): ImplantProjection {
  const contours: Point2[][] = [];
  if (
    !geometry ||
    !finitePoint(start) ||
    !finitePoint(end) ||
    !Number.isFinite(diameter) ||
    diameter <= 0
  )
    return { contours };
  const delta = end.map((v, i) => v - start[i]) as Point3,
    length = Math.hypot(...delta);
  if (length < 1e-6) return { contours };
  const axis = normalize(delta),
    radius = diameter / 2;
  const center = start.map((v, i) => (v + end[i]) / 2) as Point3;
  let upper: Point2[] = [],
    lower: Point2[] = [];
  const finish = () => {
    if (upper.length > 1) contours.push([...upper, ...lower.reverse()]);
    upper = [];
    lower = [];
  };
  const support = (normal: Point3) => {
    const along = Math.min(1, Math.abs(dot(axis, normal)));
    return (length / 2) * along + radius * Math.sqrt(Math.max(0, 1 - along * along));
  };
  for (const column of geometry.columns) {
    const { point, normal, planeNormal, x } = column;
    const offset = center.map((v, i) => v - point[i]) as Point3;
    if (
      Math.hypot(...normal) < 0.9 ||
      Math.abs(dot(offset, planeNormal)) > support(planeNormal) + 1e-7 ||
      Math.abs(dot(offset, normal)) > geometry.halfThickness + support(normal) + 1e-7
    ) {
      finish();
      continue;
    }
    let polygon = implantPlaneSection(start, end, radius, point, planeNormal).map(p => {
      const q = p.map((v, i) => v - point[i]) as Point3;
      return [dot(q, normal), dot(q, geometry.up)] as Point2;
    });
    polygon = clip(polygon, 0, -geometry.halfThickness, true);
    polygon = clip(polygon, 0, geometry.halfThickness, false);
    polygon = clip(polygon, 1, geometry.bottom, true);
    polygon = clip(polygon, 1, geometry.top, false);
    if (polygon.length < 3) {
      finish();
      continue;
    }
    let low = Infinity,
      high = -Infinity;
    for (const p of polygon) {
      low = Math.min(low, p[1]);
      high = Math.max(high, p[1]);
    }
    upper.push([x, (geometry.top - high) * geometry.rowScale]);
    lower.push([x, (geometry.top - low) * geometry.rowScale]);
  }
  finish();
  return { contours };
}
