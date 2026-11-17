import { mat4, vec3 } from 'gl-matrix';
import type {
  Point3,
  Sampler,
} from '../../../../../extensions/cornerstone/src/components/ManualPanorama/reconstruction';
import { volumeWorldBounds } from '../../../../../extensions/cornerstone/src/components/ManualPanorama/automaticArch';

export type Pixels =
  | Int16Array
  | Uint16Array
  | Uint8Array
  | Int8Array
  | Float32Array
  | Int32Array
  | Uint32Array;
export type CpuFrame = {
  source: File | string;
  frame: number;
  sop: string;
  position: Point3;
  orientation: number[];
  spacing: number[];
  rows: number;
  columns: number;
  slope: number;
  intercept: number;
};
export type CpuGeometry = {
  dimensions: Point3;
  indexToWorld: number[];
  worldToIndex: number[];
  bounds: number[];
  center: Point3;
  step: number;
  invert: boolean;
};
export type CpuSeries = {
  frames: CpuFrame[];
  geometry: CpuGeometry;
  name: string;
  estimatedBytes: number;
  window: { center: number; width: number };
};
export type PlaneId = 'coronal' | 'sagittal' | 'axial';
export type Basis = [Point3, Point3, Point3];
export const IDENTITY_BASIS: Basis = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
export const plus = (a: number[], b: number[], scale = 1): Point3 =>
  a.map((v, i) => v + b[i] * scale) as Point3;
export const transform = (matrix: number[], p: number[]): Point3 =>
  Array.from(vec3.transformMat4(vec3.create(), p as any, matrix as any)) as Point3;
const sequence = (value: any) => (Array.isArray(value) ? value[0] : value);
const numbers = (value: any): number[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? value.split('\\') : []).map(Number);
const scalar = (value: any, fallback: number) =>
  value == null ? fallback : Number(Array.isArray(value) ? value[0] : value);
const valid = (a: number[], size: number) => a.length === size && a.every(Number.isFinite);

/** Strict physical geometry: never infer anatomical position from file/instance numbering. */
export function selectCpuSeries(
  items: Array<{ dataset: any; source: File | string }>,
  budgetBytes: number
): CpuSeries {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const ds = item.dataset;
    if (!['CT', 'MR'].includes(ds.Modality) || scalar(ds.SamplesPerPixel, 1) !== 1) continue;
    const key = `${ds.StudyInstanceUID}|${ds.SeriesInstanceUID}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  let lastError = new Error('Не найдена объёмная серия КТ/МР с корректной геометрией.');
  const candidates = [...groups.values()].sort(
    (a, b) =>
      b.reduce((n, x) => n + scalar(x.dataset.NumberOfFrames, 1), 0) -
      a.reduce((n, x) => n + scalar(x.dataset.NumberOfFrames, 1), 0)
  );
  for (const group of candidates) {
    try {
      return buildCpuSeries(group, budgetBytes);
    } catch (error) {
      if (error.name === 'CpuMemoryError') throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function buildCpuSeries(
  items: Array<{ dataset: any; source: File | string }>,
  budget: number
): CpuSeries {
  const frames: CpuFrame[] = [];
  const seen = new Set<string>();
  let estimatedBytes = 0;
  for (const { dataset: ds, source } of items) {
    if (
      !ds.StudyInstanceUID ||
      !ds.SeriesInstanceUID ||
      !ds.SOPInstanceUID ||
      seen.has(ds.SOPInstanceUID)
    )
      throw new Error('В серии отсутствуют или повторяются DICOM-идентификаторы.');
    seen.add(ds.SOPInstanceUID);
    const count = scalar(ds.NumberOfFrames, 1),
      rows = Number(ds.Rows),
      columns = Number(ds.Columns);
    if (!['MONOCHROME1', 'MONOCHROME2'].includes(ds.PhotometricInterpretation))
      throw new Error('CPU-режим поддерживает чёрно-белые серии КТ/МР.');
    if (![rows, columns, count].every(n => Number.isSafeInteger(n) && n > 0) || count > 20000)
      throw new Error('Некорректные размеры DICOM.');
    const bits = Number(ds.BitsAllocated);
    if (![8, 16, 32].includes(bits))
      throw new Error('CPU-режим поддерживает скалярные DICOM 8/16/32 бит.');
    estimatedBytes += (rows * columns * count * bits) / 8;
    if (estimatedBytes > budget) {
      const error = new Error(
        'Для этой серии недостаточно доступной памяти CPU-режима. Закройте другие исследования или используйте компьютер с большим объёмом памяти.'
      );
      error.name = 'CpuMemoryError';
      throw error;
    }
    const shared = sequence(ds.SharedFunctionalGroupsSequence) || {};
    const perFrames = ds.PerFrameFunctionalGroupsSequence;
    if (count > 1 && (!Array.isArray(perFrames) || perFrames.length !== count))
      throw new Error('В многокадровой серии нет точных позиций всех кадров.');
    for (let frame = 0; frame < count; frame++) {
      const per = perFrames?.[frame] || {};
      const position = numbers(
        sequence(per.PlanePositionSequence)?.ImagePositionPatient || ds.ImagePositionPatient
      );
      const orientation = numbers(
        sequence(per.PlaneOrientationSequence)?.ImageOrientationPatient ||
          sequence(shared.PlaneOrientationSequence)?.ImageOrientationPatient ||
          ds.ImageOrientationPatient
      );
      const spacing = numbers(
        sequence(per.PixelMeasuresSequence)?.PixelSpacing ||
          sequence(shared.PixelMeasuresSequence)?.PixelSpacing ||
          ds.PixelSpacing
      );
      const scaling =
        sequence(per.PixelValueTransformationSequence) ||
        sequence(shared.PixelValueTransformationSequence) ||
        ds;
      const slope = scalar(scaling.RescaleSlope, 1),
        intercept = scalar(scaling.RescaleIntercept, 0);
      if (
        !valid(position, 3) ||
        !valid(orientation, 6) ||
        !valid(spacing, 2) ||
        spacing.some(v => v <= 0) ||
        !Number.isFinite(slope) ||
        slope === 0 ||
        !Number.isFinite(intercept)
      )
        throw new Error('Недостаточно данных для точной геометрии срезов.');
      frames.push({
        source,
        frame,
        sop: ds.SOPInstanceUID,
        position: position as Point3,
        orientation,
        spacing,
        rows,
        columns,
        slope,
        intercept,
      });
    }
  }
  if (frames.length < 2) throw new Error('Для трёх плоскостей необходимо не менее двух срезов.');
  const first = frames[0],
    x = first.orientation.slice(0, 3),
    y = first.orientation.slice(3);
  if (
    items.some(
      ({ dataset }) =>
        dataset.PhotometricInterpretation !== items[0].dataset.PhotometricInterpretation ||
        (dataset.FrameOfReferenceUID &&
          items[0].dataset.FrameOfReferenceUID &&
          dataset.FrameOfReferenceUID !== items[0].dataset.FrameOfReferenceUID)
    )
  )
    throw new Error('Серия содержит несовместимые системы координат.');
  if (
    Math.abs(Math.hypot(...x) - 1) > 1e-3 ||
    Math.abs(Math.hypot(...y) - 1) > 1e-3 ||
    Math.abs(dot(x, y)) > 1e-3
  )
    throw new Error('Некорректное направление DICOM-плоскости.');
  const normal = Array.from(vec3.cross(vec3.create(), x as any, y as any));
  for (const frame of frames) {
    if (
      frame.rows !== first.rows ||
      frame.columns !== first.columns ||
      frame.orientation.some((v, i) => Math.abs(v - first.orientation[i]) > 1e-4) ||
      frame.spacing.some((v, i) => Math.abs(v - first.spacing[i]) > 1e-5)
    )
      throw new Error('Серия содержит несовместимые размеры или направления кадров.');
  }
  frames.sort((a, b) => dot(a.position, normal) - dot(b.position, normal));
  const origin = frames[0].position;
  const stepVector = frames[frames.length - 1].position.map(
    (v, i) => (v - origin[i]) / (frames.length - 1)
  );
  if (dot(stepVector, normal) < 1e-4) throw new Error('Позиции срезов совпадают.');
  frames.forEach((frame, k) => {
    if (Math.hypot(...frame.position.map((v, i) => v - origin[i] - stepVector[i] * k)) > 0.05)
      throw new Error('CPU-режим пока не поддерживает неравномерный шаг этой серии.');
  });
  const matrix = [
    x[0] * first.spacing[1],
    x[1] * first.spacing[1],
    x[2] * first.spacing[1],
    0,
    y[0] * first.spacing[0],
    y[1] * first.spacing[0],
    y[2] * first.spacing[0],
    0,
    ...stepVector,
    0,
    ...origin,
    1,
  ];
  const inverse = mat4.invert(mat4.create(), matrix as any);
  if (!inverse) throw new Error('Не удалось определить геометрию исследования.');
  const dimensions: Point3 = [first.columns, first.rows, frames.length];
  const geometry: CpuGeometry = {
    dimensions,
    indexToWorld: matrix,
    worldToIndex: Array.from(inverse),
    bounds: volumeWorldBounds(dimensions, p => transform(matrix, p)),
    center: transform(
      matrix,
      dimensions.map(n => (n - 1) / 2)
    ),
    step: Math.min(...first.spacing, Math.hypot(...stepVector)),
    invert: items[0].dataset.PhotometricInterpretation === 'MONOCHROME1',
  };
  return {
    frames,
    geometry,
    estimatedBytes,
    name: String(items[0].dataset.SeriesDescription || items[0].dataset.Modality),
    window: {
      center: Number.isFinite(scalar(items[0].dataset.WindowCenter, 1000))
        ? scalar(items[0].dataset.WindowCenter, 1000)
        : 1000,
      width: Number.isFinite(scalar(items[0].dataset.WindowWidth, 3000))
        ? Math.max(1, scalar(items[0].dataset.WindowWidth, 3000))
        : 3000,
    },
  };
}

export function cpuSampler(
  geometry: CpuGeometry,
  frames: Array<{ pixels: Pixels; slope: number; intercept: number } | undefined>
) {
  const [nx, ny, nz] = geometry.dimensions,
    m = geometry.worldToIndex;
  const sampleIndex = (x: number, y: number, z: number) => {
    if (
      x < -1e-4 ||
      y < -1e-4 ||
      z < -1e-4 ||
      x > nx - 1 + 1e-4 ||
      y > ny - 1 + 1e-4 ||
      z > nz - 1 + 1e-4
    )
      return NaN;
    const snap = (v: number) => (Math.abs(v - Math.round(v)) < 1e-4 ? Math.round(v) : v);
    x = Math.max(0, Math.min(nx - 1, snap(x)));
    y = Math.max(0, Math.min(ny - 1, snap(y)));
    z = Math.max(0, Math.min(nz - 1, snap(z)));
    const i = Math.floor(x),
      j = Math.floor(y),
      k = Math.floor(z),
      fx = x - i,
      fy = y - j,
      fz = z - k;
    let value = 0;
    for (let dz = 0; dz < 2; dz++) {
      const wz = dz ? fz : 1 - fz;
      if (wz < 1e-10) continue;
      const frame = frames[Math.min(k + dz, nz - 1)];
      if (!frame) return NaN;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const weight = wz * (dy ? fy : 1 - fy) * (dx ? fx : 1 - fx);
          if (weight < 1e-10) continue;
          value +=
            (frame.pixels[Math.min(j + dy, ny - 1) * nx + Math.min(i + dx, nx - 1)] * frame.slope +
              frame.intercept) *
            weight;
        }
    }
    return value;
  };
  const index = (p: number[], w: number): Point3 => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w,
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w,
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w,
  ];
  const sample: Sampler = (x, y, z) => sampleIndex(...index([x, y, z], 1));
  sample.prepareLine = (origin, direction) => {
    const a = index(origin, 1),
      b = index(direction, 0);
    return mm => sampleIndex(a[0] + b[0] * mm, a[1] + b[1] * mm, a[2] + b[2] * mm);
  };
  return sample;
}
export function clampWorld(geometry: CpuGeometry, point: Point3): Point3 {
  return transform(
    geometry.indexToWorld,
    transform(geometry.worldToIndex, point).map((v, i) =>
      Math.max(0, Math.min(geometry.dimensions[i] - 1, v))
    )
  );
}
export function planeAxes(id: PlaneId, basis: Basis) {
  const h = id === 'sagittal' ? basis[1] : basis[0];
  const v = id === 'axial' ? basis[1] : (basis[2].map(n => -n) as Point3);
  const normal = Array.from(vec3.cross(vec3.create(), h, v)) as Point3;
  return { h, v, normal };
}
export type CpuPlane = ReturnType<typeof makeCpuPlane>;
export function makeCpuPlane(
  geometry: CpuGeometry,
  id: PlaneId,
  basis: Basis,
  point: Point3,
  width: number,
  height: number,
  zoom = 1,
  pan: [number, number] = [0, 0]
) {
  const { h, v, normal } = planeAxes(id, basis);
  const corners = Array.from({ length: 8 }, (_, mask) =>
    transform(
      geometry.indexToWorld,
      geometry.dimensions.map((n, i) => (mask & (1 << i) ? n - 1 : 0))
    )
  );
  const span = (axis: Point3) =>
    Math.max(...corners.map(p => dot(p, axis))) - Math.min(...corners.map(p => dot(p, axis))) + 10;
  const widthMm = Math.max(span(h), (span(v) * width) / height) / zoom,
    heightMm = (widthMm * height) / width;
  let center = plus(geometry.center, normal, dot(plus(point, geometry.center, -1), normal));
  center = plus(plus(center, h, pan[0]), v, pan[1]);
  const origin = plus(plus(center, h, -widthMm / 2), v, -heightMm / 2);
  return { id, origin, h, v, normal, width, height, widthMm, heightMm };
}
export function planePoint(plane: CpuPlane, u: number, v: number): Point3 {
  return plus(plus(plane.origin, plane.h, plane.widthMm * u), plane.v, plane.heightMm * v);
}
export function projectPoint(plane: CpuPlane, point: Point3): [number, number] {
  const delta = plus(point, plane.origin, -1);
  return [
    (dot(delta, plane.h) / plane.widthMm) * plane.width,
    (dot(delta, plane.v) / plane.heightMm) * plane.height,
  ];
}
