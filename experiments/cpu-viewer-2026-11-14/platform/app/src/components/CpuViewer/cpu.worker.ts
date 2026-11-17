import { cpuSampler, type CpuGeometry, type Pixels } from './cpuGeometry';
import { renderCpuPlane } from './cpuRendering';
import { detectDentalArch } from '../../../../../extensions/cornerstone/src/components/ManualPanorama/automaticArch';
import {
  buildCurve,
  reconstructPanorama,
} from '../../../../../extensions/cornerstone/src/components/ManualPanorama/reconstruction';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let geometry: CpuGeometry;
let frames: Array<{ pixels: Pixels; slope: number; intercept: number }> = [];
let bytes = 0,
  budget = 0;
const versions = new Map<string, number>();
let panoramaController: AbortController;
scope.onmessage = async ({ data: { id, kind, payload } }) => {
  try {
    let result: any,
      transfer: Transferable[] = [];
    if (kind === 'init') {
      geometry = payload.geometry;
      frames = [];
      bytes = 0;
      budget = payload.budget;
    } else if (kind === 'slice') {
      if (
        payload.pixels.length !== geometry.dimensions[0] * geometry.dimensions[1] ||
        !Number.isInteger(payload.index) ||
        payload.index < 0 ||
        payload.index >= geometry.dimensions[2]
      )
        throw new Error('Некорректные пиксели среза.');
      const nextBytes =
        bytes - (frames[payload.index]?.pixels.byteLength || 0) + payload.pixels.byteLength;
      if (nextBytes > budget) throw new Error('Исследование превышает лимит памяти CPU-режима.');
      frames[payload.index] = payload;
      bytes = nextBytes;
    } else if (kind === 'render') {
      const key = payload.plane.id;
      versions.set(key, id);
      const pixels = await renderCpuPlane(
        cpuSampler(geometry, frames),
        payload.plane,
        payload.window,
        { ...payload.options, invert: geometry.invert, step: geometry.step },
        () => versions.get(key) !== id
      );
      result = { pixels, plane: payload.plane };
      transfer = [pixels.buffer];
    } else if (kind === 'panorama') {
      panoramaController?.abort();
      const controller = (panoramaController = new AbortController());
      const report = (percent: number) => scope.postMessage({ id, progress: Math.round(percent) });
      const sample = cpuSampler(geometry, frames);
      if (frames.filter(Boolean).length !== geometry.dimensions[2])
        throw new Error('Дождитесь полной загрузки серии.');
      const arch =
        payload.points?.length >= 3
          ? { points: payload.points, coverageWarning: '' }
          : await detectDentalArch({
              sample,
              bounds: geometry.bounds as any,
              signal: controller.signal,
              onProgress: percent => report(percent * 0.6),
            });
      const curve = buildCurve(arch.points),
        up = payload.points?.length >= 3 ? payload.up : [0, 0, 1];
      const raster = await reconstructPanorama({
        curve,
        up,
        sample,
        thickness: 20,
        heightMm: 80,
        mode: 'mean',
        signal: controller.signal,
        onProgress: percent => report(60 + percent * 0.4),
      });
      result = { raster, curve, up, warning: arch.coverageWarning || '' };
      transfer = [raster.pixels.buffer];
    } else throw new Error('Неизвестная операция CPU-режима.');
    scope.postMessage({ id, result }, transfer);
  } catch (error) {
    scope.postMessage({
      id,
      error:
        error.name === 'AbortError' ? 'cancelled' : error.message || 'Ошибка расчёта изображения.',
    });
  }
};
