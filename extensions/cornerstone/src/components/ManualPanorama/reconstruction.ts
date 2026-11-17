export type Point3 = [number, number, number];
export type Curve = {
  points: Point3[];
  distances: number[];
  length: number;
  tangents?: Point3[];
};
export type Raster = {
  width: number;
  height: number;
  pixels: Float32Array;
  widthMm: number;
  heightMm: number;
  /** Vertical position of the top row relative to the arch plane (after removing empty rows). */
  topMm?: number;
};
export type Sampler = ((x: number, y: number, z: number) => number) & {
  /** Reuse an affine transform along a sampling ray; voxel storage remains slice-backed. */
  prepareLine?: (origin: Point3, direction: Point3) => (mm: number) => number;
};
export const subtract = (a: Point3, b: Point3): Point3 => a.map((v, i) => v - b[i]) as Point3;
export const normalize = (a: Point3): Point3 => {
  const length = Math.hypot(...a);
  return a.map(v => v / (length || 1)) as Point3;
};
export const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const distance = (a: Point3, b: Point3) => Math.hypot(...subtract(a, b));

/** Smooth arch through every visible control, with bounded rounding at all joins. */
export function buildCurve(control: Point3[], { preview = false } = {}): Curve {
  const vertices = control.reduce<Point3[]>((result, p) => {
    if (!result.length || distance(p, result[result.length - 1]) > 1e-8)
      result.push([...p] as Point3);
    return result;
  }, []);
  if (vertices.length < (preview ? 2 : 3))
    throw new Error('Отметьте не менее трёх разных точек дуги.');
  const tangents = vertices.map((_point, index): Point3 | null => {
    if (index === 0 || index === vertices.length - 1) return null;
    const incoming = subtract(vertices[index], vertices[index - 1]);
    const outgoing = subtract(vertices[index + 1], vertices[index]);
    const a = normalize(incoming),
      b = normalize(outgoing);
    const direction = normalize(a.map((v, i) => v + b[i]) as Point3);
    const perpendicular = Math.max(
      ...[a, b].map(unit => {
        const along = direction.reduce((sum, v, axis) => sum + v * unit[axis], 0);
        return Math.hypot(...direction.map((v, axis) => v - unit[axis] * along));
      })
    );
    // Scale one shared tangent for BOTH adjoining segments, preserving its direction.
    // Its Bezier controls stay <=1 mm from either segment without a normal jump at the join.
    const length = Math.min(
      Math.hypot(...incoming) * 0.8,
      Math.hypot(...outgoing) * 0.8,
      3 / (perpendicular || 1)
    );
    return direction.map(v => v * length) as Point3;
  });
  const points: Point3[] = [vertices[0]];
  const sampledTangents: Point3[] = [normalize(subtract(vertices[1], vertices[0]))];
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i],
      b = vertices[i + 1],
      segment = subtract(b, a);
    const length = Math.hypot(...segment);
    // Keep each Bezier control within 1 mm of its straight segment. The displayed curve
    // passes through every handle; a large isolated handle move cannot cause spline overshoot.
    const c1 = (tangents[i] || segment).map(v => v / 3);
    const c2 = (tangents[i + 1] || segment).map(v => v / 3);
    // Use the same smooth path for display, distance measurements and volume sampling.
    const steps = Math.max(16, Math.ceil(length / 0.15));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps,
        u = 1 - t;
      points.push(
        a.map(
          (v, axis) =>
            u * u * u * v +
            3 * u * u * t * (v + c1[axis]) +
            3 * u * t * t * (b[axis] - c2[axis]) +
            t * t * t * b[axis]
        ) as Point3
      );
      // Analytic derivatives avoid changing the section normal in discrete chord steps.
      sampledTangents.push(
        normalize(
          segment.map(
            (v, axis) => u * u * c1[axis] + 2 * u * t * (v - c1[axis] - c2[axis]) + t * t * c2[axis]
          ) as Point3
        )
      );
    }
  }
  const distances = [0];
  for (let i = 1; i < points.length; i++)
    distances.push(distances[i - 1] + distance(points[i], points[i - 1]));
  const length = distances[distances.length - 1];
  if (length < (preview ? 0.1 : 5))
    throw new Error('Дуга слишком короткая. Проведите её вдоль зубного ряда.');
  return { points, distances, length, tangents: sampledTangents };
}

export function curveFrame(curve: Curve, mm: number, up: Point3) {
  const d = Math.max(0, Math.min(curve.length, mm));
  let lo = 0,
    hi = curve.distances.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (curve.distances[mid] < d) lo = mid;
    else hi = mid;
  }
  const t = (d - curve.distances[lo]) / (curve.distances[hi] - curve.distances[lo] || 1);
  const point = curve.points[lo].map((v, i) => v + t * (curve.points[hi][i] - v)) as Point3;
  const tangent = normalize(
    curve.tangents
      ? (curve.tangents[lo].map((v, i) => v + t * (curve.tangents[hi][i] - v)) as Point3)
      : subtract(curve.points[hi], curve.points[lo])
  );
  return { point, tangent, normal: normalize(cross(up, tangent)) };
}

/** A positive angle leans the superior end toward increasing panorama distance. */
export function sectionFrame(curve: Curve, mm: number, up: Point3, tilt = 0) {
  const frame = curveFrame(curve, mm, up);
  const angle = Math.max(-30, Math.min(30, tilt)) * Math.PI / 180;
  const vertical = up.map((v, i) => v * Math.cos(angle) + frame.tangent[i] * Math.sin(angle)) as Point3;
  return { ...frame, vertical, slope: Math.tan(angle) };
}

/** Straight orientation guide in the unfolded panorama (local tangent approximation).
 * The volume itself is sampled in the physical tilted plane, not rotated as a bitmap. */
export function sectionPanoramaPath(curve: Curve, up: Point3, mm: number, tilt: number, raster: Raster) {
  const { slope } = sectionFrame(curve, mm, up, tilt);
  const top = raster.topMm ?? raster.heightMm / 2;
  const x = (z: number) => (mm + z * slope) / curve.length * (raster.width - 1);
  return `M${x(top)},0 L${x(top - raster.heightMm)},${raster.height - 1}`;
}

/** Sample the existing volume without allocating another full decoded copy. Invalid points stay empty. */
export function createTrilinearSampler(
  dimensions: number[],
  matrix: ArrayLike<number>,
  read: (i: number, j: number, k: number) => number
): Sampler {
  const [nx, ny, nz] = dimensions;
  const sampleIndex = (ix: number, iy: number, iz: number) => {
    let x = ix,
      y = iy,
      z = iz;
    if (
      x < -1e-5 ||
      y < -1e-5 ||
      z < -1e-5 ||
      x > nx - 1 + 1e-5 ||
      y > ny - 1 + 1e-5 ||
      z > nz - 1 + 1e-5
    )
      return NaN;
    x = Math.max(0, Math.min(nx - 1, x));
    y = Math.max(0, Math.min(ny - 1, y));
    z = Math.max(0, Math.min(nz - 1, z));
    const i = Math.floor(x),
      j = Math.floor(y),
      k = Math.floor(z);
    const i1 = Math.min(i + 1, nx - 1),
      j1 = Math.min(j + 1, ny - 1),
      k1 = Math.min(k + 1, nz - 1);
    const fx = x - i,
      fy = y - j,
      fz = z - k;
    const a = read(i, j, k) * (1 - fx) + read(i1, j, k) * fx;
    const b = read(i, j1, k) * (1 - fx) + read(i1, j1, k) * fx;
    const c = read(i, j, k1) * (1 - fx) + read(i1, j, k1) * fx;
    const d = read(i, j1, k1) * (1 - fx) + read(i1, j1, k1) * fx;
    return (a * (1 - fy) + b * fy) * (1 - fz) + (c * (1 - fy) + d * fy) * fz;
  };
  const transform = (p: Point3, w: number): Point3 => [
    matrix[0] * p[0] + matrix[4] * p[1] + matrix[8] * p[2] + matrix[12] * w,
    matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2] + matrix[13] * w,
    matrix[2] * p[0] + matrix[6] * p[1] + matrix[10] * p[2] + matrix[14] * w,
  ];
  const sampler: Sampler = (wx, wy, wz) =>
    sampleIndex(
      matrix[0] * wx + matrix[4] * wy + matrix[8] * wz + matrix[12],
      matrix[1] * wx + matrix[5] * wy + matrix[9] * wz + matrix[13],
      matrix[2] * wx + matrix[6] * wy + matrix[10] * wz + matrix[14]
    );
  sampler.prepareLine = (origin, direction) => {
    const [ox, oy, oz] = transform(origin, 1);
    const [dx, dy, dz] = transform(direction, 0);
    // Oblique volumes still use the complete world-to-index affine transform.
    if (dx !== 0 || dy !== 0) return mm => sampleIndex(ox + dx * mm, oy + dy * mm, oz + dz * mm);
    if (ox < -1e-5 || oy < -1e-5 || ox > nx - 1 + 1e-5 || oy > ny - 1 + 1e-5) return () => NaN;
    const x = Math.max(0, Math.min(nx - 1, ox)),
      y = Math.max(0, Math.min(ny - 1, oy));
    const i = Math.floor(x),
      j = Math.floor(y);
    const i1 = Math.min(i + 1, nx - 1),
      j1 = Math.min(j + 1, ny - 1);
    const fx = x - i,
      fy = y - j;
    // In axial CPR, XY neighbours and weights are identical for every row of this ray.
    return mm => {
      const iz = oz + dz * mm;
      if (iz < -1e-5 || iz > nz - 1 + 1e-5) return NaN;
      const z = Math.max(0, Math.min(nz - 1, iz)),
        k = Math.floor(z);
      const k1 = Math.min(k + 1, nz - 1),
        fz = z - k;
      const a = read(i, j, k) * (1 - fx) + read(i1, j, k) * fx;
      const b = read(i, j1, k) * (1 - fx) + read(i1, j1, k) * fx;
      const c = read(i, j, k1) * (1 - fx) + read(i1, j, k1) * fx;
      const d = read(i, j1, k1) * (1 - fx) + read(i1, j1, k1) * fx;
      return (a * (1 - fy) + b * fy) * (1 - fz) + (c * (1 - fy) + d * fy) * fz;
    };
  };
  return sampler;
}

const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const checkCancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
};

/** Yield by elapsed work, rather than a fixed number of arbitrarily expensive columns. */
function reconstructionWork(signal: AbortSignal) {
  let deadline = performance.now() + 8;
  return () => {
    checkCancelled(signal);
    if (performance.now() < deadline) return null;
    return yieldToUI().then(() => {
      checkCancelled(signal);
      deadline = performance.now() + 8;
    });
  };
}

function samplingLine(sample: Sampler, origin: Point3, direction: Point3) {
  return (
    sample.prepareLine?.(origin, direction) ??
    (mm =>
      sample(
        origin[0] + direction[0] * mm,
        origin[1] + direction[1] * mm,
        origin[2] + direction[2] * mm
      ))
  );
}

/** Remove only completely unsampled outer rows, never dark voxels or internal gaps. */
export function trimEmptyRasterRows(raster: Raster): Raster {
  const { pixels, width, height, heightMm } = raster;
  const hasData = (row: number) => {
    for (let x = 0; x < width; x++) if (Number.isFinite(pixels[row * width + x])) return true;
    return false;
  };
  let first = 0,
    last = height - 1;
  while (first < height && !hasData(first)) first++;
  if (first === height) return raster;
  while (last > first && !hasData(last)) last--;
  // Keep at least two rows so display/click coordinates retain a nonzero physical height.
  if (first === last) {
    first = Math.max(0, first - 1);
    last = Math.min(height - 1, first + 1);
  }
  if (first === 0 && last === height - 1) return raster;
  const rowMm = heightMm / (height - 1);
  return {
    ...raster,
    pixels: pixels.slice(first * width, (last + 1) * width),
    height: last - first + 1,
    heightMm: (last - first) * rowMm,
    topMm: (raster.topMm ?? heightMm / 2) - first * rowMm,
  };
}

export async function reconstructPanorama({
  curve,
  up,
  sample,
  thickness,
  heightMm,
  mode,
  signal,
  onProgress = () => {},
}: {
  curve: Curve;
  up: Point3;
  sample: Sampler;
  thickness: number;
  heightMm: number;
  mode: 'mean' | 'mip';
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<Raster> {
  const width = Math.min(1000, Math.max(64, Math.ceil(curve.length / 0.35)));
  const height = Math.min(450, Math.ceil(heightMm / 0.35));
  const pixels = new Float32Array(width * height);
  const count = Math.min(41, Math.max(3, Math.ceil(thickness / 0.35) + 1));
  const checkpoint = reconstructionWork(signal);
  let reported = -1;
  for (let x = 0; x < width; x++) {
    checkCancelled(signal);
    const { point, normal } = curveFrame(curve, (x / (width - 1)) * curve.length, up);
    const rays = Array.from({ length: count }, (_, s) => {
      const offset = (s / (count - 1) - 0.5) * thickness;
      return samplingLine(
        sample,
        [
          point[0] + normal[0] * offset,
          point[1] + normal[1] * offset,
          point[2] + normal[2] * offset,
        ],
        up
      );
    });
    for (let y = 0; y < height; y++) {
      const vertical = (0.5 - y / (height - 1)) * heightMm;
      let value = mode === 'mip' ? -Infinity : 0,
        valid = 0;
      for (let s = 0; s < count; s++) {
        const voxel = rays[s](vertical);
        if (Number.isFinite(voxel)) {
          value = mode === 'mip' ? Math.max(value, voxel) : value + voxel;
          valid++;
        }
      }
      pixels[y * width + x] = valid ? (mode === 'mip' ? value : value / valid) : NaN;
      // Even a tall slab must remain cancellable before a whole column is finished.
      if (y % 16 === 15) {
        const pause = checkpoint();
        if (pause) await pause;
      }
    }
    const percent = Math.floor(((x + 1) / width) * 99);
    if (percent !== reported) {
      reported = percent;
      onProgress(percent);
    }
    const pause = checkpoint();
    if (pause) await pause;
  }
  checkCancelled(signal);
  onProgress(100);
  checkCancelled(signal);
  return trimEmptyRasterRows({ pixels, width, height, widthMm: curve.length, heightMm });
}

type SectionParameters = { curve: Curve; up: Point3; sample: Sampler; distance: number; heightMm: number; tilt?: number };

/** The same sampling grid is used for a live frame and for all nine review frames. */
function prepareSection({ curve, up, sample, distance: mm, heightMm, tilt = 0 }: SectionParameters) {
  if (!Number.isFinite(mm) || mm < 0 || mm > curve.length) return null;
  const widthMm = 60, width = Math.ceil(widthMm / 0.5) + 1, height = Math.ceil(heightMm / 0.5) + 1;
  const { point, normal, vertical } = sectionFrame(curve, mm, up, tilt);
  const rays = Array.from({ length: width }, (_, x) => {
    const horizontal = (x / (width - 1) - 0.5) * widthMm;
    return samplingLine(sample, point.map((v, i) => v + normal[i] * horizontal) as Point3, vertical);
  });
  const raster: Raster = { pixels: new Float32Array(width * height), width, height, widthMm, heightMm };
  const row = (y: number) => {
    const vertical = (0.5 - y / (height - 1)) * heightMm;
    for (let x = 0; x < width; x++) raster.pixels[y * width + x] = rays[x](vertical);
  };
  return { raster, row };
}

/** One real section for interactive navigation, without the other eight frames or a debounce. */
export function reconstructSection(parameters: SectionParameters): Raster | null {
  const section = prepareSection(parameters);
  if (!section) return null;
  for (let y = 0; y < section.raster.height; y++) section.row(y);
  return section.raster;
}

export async function reconstructSections({
  curve,
  up,
  sample,
  center,
  step,
  heightMm,
  signal,
}: {
  curve: Curve;
  up: Point3;
  sample: Sampler;
  center: number;
  step: number;
  heightMm: number;
  signal: AbortSignal;
}): Promise<Array<{ distance: number; raster: Raster | null }>> {
  const sections = [];
  const checkpoint = reconstructionWork(signal);
  for (let index = -4; index <= 4; index++) {
    checkCancelled(signal);
    const mm = center + index * step;
    if (mm < 0 || mm > curve.length) {
      sections.push({ distance: mm, raster: null });
      continue;
    }
    const section = prepareSection({ curve, up, sample, distance: mm, heightMm });
    for (let y = 0; y < section.raster.height; y++) {
      section.row(y);
      const pause = checkpoint();
      if (pause) await pause;
    }
    sections.push({ distance: mm, raster: section.raster });
    const pause = checkpoint();
    if (pause) await pause;
  }
  checkCancelled(signal);
  return sections;
}
