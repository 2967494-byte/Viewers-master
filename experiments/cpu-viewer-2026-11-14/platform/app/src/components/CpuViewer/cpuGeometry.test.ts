import {
  IDENTITY_BASIS,
  clampWorld,
  cpuSampler,
  makeCpuPlane,
  planePoint,
  projectPoint,
  selectCpuSeries,
  transform,
} from './cpuGeometry';

const dataset = (k: number, extra = {}) => ({
  StudyInstanceUID: 'study',
  SeriesInstanceUID: 'series',
  SOPInstanceUID: `sop-${k}`,
  Modality: 'CT',
  Rows: 3,
  Columns: 4,
  SamplesPerPixel: 1,
  BitsAllocated: 16,
  PhotometricInterpretation: 'MONOCHROME2',
  ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
  ImagePositionPatient: [10, 20, k * 0.3],
  PixelSpacing: [0.5, 0.2],
  ...extra,
});
const items = () => [2, 0, 1].map(k => ({ source: `slice-${k}`, dataset: dataset(k) }));
describe('CPU physical geometry', () => {
  it('sorts by position, honors row/column spacing, and roundtrips all three views after pan/zoom', () => {
    const { geometry, frames } = selectCpuSeries(items(), 1024 * 1024);
    expect(frames.map(f => f.sop)).toEqual(['sop-0', 'sop-1', 'sop-2']);
    expect(geometry.dimensions).toEqual([4, 3, 3]);
    const world = transform(geometry.indexToWorld, [2, 1, 2]);
    expect(world[0]).toBeCloseTo(10.4);
    expect(world[1]).toBeCloseTo(20.5);
    expect(world[2]).toBeCloseTo(0.6);
    const p = transform(geometry.indexToWorld, [1, 1, 1]);
    for (const id of ['axial', 'coronal', 'sagittal'] as const) {
      const plane = makeCpuPlane(geometry, id, IDENTITY_BASIS, p, 800, 400, 3, [1, -2]);
      const screen = projectPoint(plane, p),
        back = planePoint(plane, screen[0] / 800, screen[1] / 400);
      back.forEach((v, i) => expect(v).toBeCloseTo(p[i], 4));
    }
    const clamped = transform(geometry.worldToIndex, clampWorld(geometry, [1000, -500, 900]));
    clamped.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(-1e-4);
      expect(v).toBeLessThanOrEqual(geometry.dimensions[i] - 1 + 1e-4);
    });
  });

  it('preserves oblique/reversed geometry and per-frame rescale without a float volume copy', () => {
    const rotated = items().map(({ source, dataset: ds }) => ({
      source,
      dataset: {
        ...ds,
        ImageOrientationPatient: [0, -1, 0, 1, 0, 0],
        RescaleSlope: 2,
        RescaleIntercept: -1000,
      },
    }));
    const { geometry, frames } = selectCpuSeries(rotated, 1024 * 1024);
    const raw = frames.map((_f, k) => ({
      pixels: Int16Array.from({ length: 12 }, (_, i) => (i % 4) + 10 * Math.floor(i / 4) + 100 * k),
      slope: 2,
      intercept: -1000,
    }));
    const sample = cpuSampler(geometry, raw),
      p = transform(geometry.indexToWorld, [2, 1, 1.5]);
    expect(sample(...p)).toBeCloseTo(-676, 2);
    expect(raw[0].pixels).toBeInstanceOf(Int16Array);
  });

  it('shows an exactly loaded slice even while its adjacent frames are missing', () => {
    const { geometry } = selectCpuSeries(items(), 1024 * 1024);
    const raw = [];
    raw[1] = { pixels: new Int16Array(12).fill(123), slope: 1, intercept: 0 };
    const sample = cpuSampler(geometry, raw);
    expect(sample(...transform(geometry.indexToWorld, [1.5, 1.5, 1]))).toBeCloseTo(123);
    expect(sample(...transform(geometry.indexToWorld, [1.5, 1.5, 0.5]))).toBeNaN();
  });

  it('uses Enhanced CT functional groups instead of repeating root IPP', () => {
    const source = {
      source: 'enhanced',
      dataset: dataset(0, {
        NumberOfFrames: 3,
        ImagePositionPatient: [99, 99, 99],
        SharedFunctionalGroupsSequence: [
          {
            PlaneOrientationSequence: [{ ImageOrientationPatient: [1, 0, 0, 0, 1, 0] }],
            PixelMeasuresSequence: [{ PixelSpacing: [0.5, 0.2] }],
          },
        ],
        PerFrameFunctionalGroupsSequence: [2, 0, 1].map(k => ({
          PlanePositionSequence: [{ ImagePositionPatient: [10, 20, k * 0.3] }],
          PixelValueTransformationSequence: [{ RescaleSlope: 1 + k, RescaleIntercept: -500 }],
        })),
      }),
    };
    const { frames } = selectCpuSeries([source], 1024 * 1024);
    expect(frames.map(f => f.frame)).toEqual([1, 2, 0]);
    expect(frames.map(f => f.slope)).toEqual([1, 2, 3]);
  });

  it('rejects unsafe geometry, repeated SOPs, missing frame positions and volumes over budget', () => {
    expect(() => selectCpuSeries(items(), 1)).toThrow(/памяти/);
    expect(() => selectCpuSeries([items()[0], items()[0]], 1e6)).toThrow(/повторяются/);
    const uneven = items();
    uneven[0].dataset.ImagePositionPatient[2] = 0.9;
    expect(() => selectCpuSeries(uneven, 1e6)).toThrow(/неравномерный/);
    expect(() =>
      selectCpuSeries([{ source: 'enhanced', dataset: dataset(0, { NumberOfFrames: 3 }) }], 1e6)
    ).toThrow(/позиций/);
  });
});
