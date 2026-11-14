import { curveFrame, normalize, type Curve, type Point3, type Raster } from './reconstruction';

/** Coordinates of the displayed pixels, excluding object-fit letterboxing and browser zoom. */
export function panoramaRasterPosition(
  rect: { left: number; top: number; width: number; height: number },
  raster: Pick<Raster, 'width' | 'height'>,
  clientX: number,
  clientY: number,
  clamp = false
): [number, number] | null {
  if (
    ![
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      raster.width,
      raster.height,
      clientX,
      clientY,
    ].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    raster.width < 2 ||
    raster.height < 2
  )
    return null;
  const scale = Math.min(rect.width / raster.width, rect.height / raster.height);
  const x = (clientX - rect.left - (rect.width - raster.width * scale) / 2) / scale;
  const y = (clientY - rect.top - (rect.height - raster.height * scale) / 2) / scale;
  if (!clamp && (x < 0 || x >= raster.width || y < 0 || y >= raster.height)) return null;
  return [
    Math.max(0, Math.min(1, x / (raster.width - 1))),
    Math.max(0, Math.min(1, y / (raster.height - 1))),
  ];
}

type PanoramaGeometry = { curve: Curve; up: Point3; raster: Pick<Raster, 'heightMm' | 'topMm'> };
type VolumeGeometry = {
  dimensions: number[];
  imageData: { worldToIndex: (point: Point3) => number[] };
};
const finitePoint = (point: ArrayLike<number>) =>
  point?.length === 3 && Array.from(point).every(Number.isFinite);

/** Pick the middle of the CPR slab. Limit height along that same arch column to actual voxels. */
export function panoramaNavigationTarget(
  snapshot: PanoramaGeometry,
  fraction: number,
  vertical: number,
  volume: VolumeGeometry
): Point3 | null {
  if (
    !snapshot?.curve?.length ||
    !finitePoint(snapshot.up) ||
    Math.hypot(...snapshot.up) < 1e-8 ||
    ![
      fraction,
      vertical,
      snapshot.raster.heightMm,
      snapshot.raster.topMm ?? snapshot.raster.heightMm / 2,
    ].every(Number.isFinite) ||
    fraction < 0 ||
    fraction > 1 ||
    vertical < 0 ||
    vertical > 1 ||
    snapshot.raster.heightMm <= 0 ||
    !finitePoint(volume?.dimensions) ||
    volume.dimensions.some(n => n < 2) ||
    !volume.imageData?.worldToIndex
  )
    return null;
  const up = normalize(snapshot.up);
  const { point } = curveFrame(snapshot.curve, fraction * snapshot.curve.length, up);
  if (!finitePoint(point)) return null;
  const origin = volume.imageData.worldToIndex(point);
  const next = volume.imageData.worldToIndex(point.map((v, i) => v + up[i]) as Point3);
  if (!finitePoint(origin) || !finitePoint(next)) return null;
  let low = -Infinity,
    high = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const direction = next[axis] - origin[axis],
      end = volume.dimensions[axis] - 1;
    if (Math.abs(direction) < 1e-10) {
      if (origin[axis] < -1e-5 || origin[axis] > end + 1e-5) return null;
    } else {
      const a = -origin[axis] / direction,
        b = (end - origin[axis]) / direction;
      low = Math.max(low, Math.min(a, b));
      high = Math.min(high, Math.max(a, b));
    }
  }
  if (low > high || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  const offset = Math.max(
    low,
    Math.min(
      high,
      (snapshot.raster.topMm ?? snapshot.raster.heightMm / 2) - vertical * snapshot.raster.heightMm
    )
  );
  return point.map((v, i) => v + up[i] * offset) as Point3;
}
