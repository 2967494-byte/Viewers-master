import type { Sampler } from '../../../../../extensions/cornerstone/src/components/ManualPanorama/reconstruction';
import { planePoint, type CpuPlane } from './cpuGeometry';

export type CpuWindow = { center: number; width: number };
export function grayValue(value: number, window: CpuWindow, invert = false) {
  // DICOM LINEAR windowing, including the width=1 threshold case.
  const c = window.center - 0.5,
    w = Math.max(0, window.width - 1);
  const v = w ? Math.max(0, Math.min(255, ((value - c) / w + 0.5) * 255)) : value > c ? 255 : 0;
  return invert ? 255 - v : v;
}

/** Worker-side CPU sampling; no graphics context or second full-volume buffer. */
export async function renderCpuPlane(
  sample: Sampler,
  plane: CpuPlane,
  window: CpuWindow,
  options: { invert: boolean; thickness: number; step: number; projection: 'mean' | 'mip' },
  cancelled = () => false
): Promise<Uint8ClampedArray> {
  const pixels = new Uint8ClampedArray(plane.width * plane.height * 4);
  const thickness = Math.max(0, Math.min(50, options.thickness));
  const intervals = thickness ? Math.ceil(thickness / Math.max(0.05, options.step)) : 0;
  let deadline = performance.now() + 10;
  for (let y = 0; y < plane.height; y++) {
    if (cancelled()) throw new DOMException('Cancelled', 'AbortError');
    for (let x = 0; x < plane.width; x++) {
      const p = planePoint(plane, (x + 0.5) / plane.width, (y + 0.5) / plane.height);
      const ray = sample.prepareLine?.(p, plane.normal);
      let total = 0,
        count = 0,
        max = -Infinity;
      for (let s = 0; s <= intervals; s++) {
        const offset = intervals ? (s / intervals - 0.5) * thickness : 0;
        const value = ray
          ? ray(offset)
          : sample(
              p[0] + plane.normal[0] * offset,
              p[1] + plane.normal[1] * offset,
              p[2] + plane.normal[2] * offset
            );
        if (Number.isFinite(value)) {
          total += value;
          count++;
          max = Math.max(max, value);
        }
      }
      if (!count) continue;
      const value = grayValue(
          options.projection === 'mip' ? max : total / count,
          window,
          options.invert
        ),
        index = (y * plane.width + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
    if (performance.now() > deadline) {
      await new Promise(resolve => setTimeout(resolve, 0));
      deadline = performance.now() + 10;
    }
  }
  return pixels;
}
