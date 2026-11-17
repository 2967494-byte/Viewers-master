import { grayValue, renderCpuPlane } from './cpuRendering';

const plane = {
  id: 'axial' as const,
  origin: [-0.5, -0.5, 1] as [number, number, number],
  h: [1, 0, 0] as [number, number, number],
  v: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
  width: 4,
  height: 3,
  widthMm: 4,
  heightMm: 3,
};
const window = { center: 150, width: 301 };
const options = { invert: false, thickness: 0, step: 1, projection: 'mean' as const };
describe('CPU raster calculations without WebGL', () => {
  it('uses DICOM LINEAR windowing, threshold width=1 and MONOCHROME1 inversion', () => {
    expect(grayValue(-1000, window)).toBe(0);
    expect(grayValue(1000, window)).toBe(255);
    expect(grayValue(100, { center: 100, width: 1 })).toBe(255);
    expect(grayValue(99, { center: 100, width: 1 })).toBe(0);
    expect(grayValue(100, window, true)).toBeCloseTo(255 - grayValue(100, window));
  });
  it('samples exact physical pixel centres and leaves absent data transparent', async () => {
    const sample = (x, y, z) => x + 10 * y + 100 * z;
    const pixels = await renderCpuPlane(sample, plane, window, options);
    expect(pixels[0]).toBe(Math.round(grayValue(100, window)));
    expect(pixels[44]).toBe(Math.round(grayValue(123, window)));
    expect(pixels[47]).toBe(255);
    const missing = await renderCpuPlane(() => NaN, plane, window, options);
    expect(missing.every(v => v === 0)).toBe(true);
  });
  it('computes mean/MIP slabs in physical millimetres and cancels obsolete work', async () => {
    const sample = (_x, _y, z) => 100 * z;
    const mean = await renderCpuPlane(sample, plane, window, { ...options, thickness: 2 });
    const mip = await renderCpuPlane(sample, plane, window, {
      ...options,
      thickness: 2,
      projection: 'mip',
    });
    expect(mean[0]).toBe(Math.round(grayValue(100, window)));
    expect(mip[0]).toBe(Math.round(grayValue(200, window)));
    await expect(renderCpuPlane(sample, plane, window, options, () => true)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
