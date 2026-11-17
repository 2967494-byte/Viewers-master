import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { s3FileService } from '../../utils/S3FileService';
import { loadCompressedStudy } from '../../utils/s3CompressedStudy';
import { prepareS3Instances } from '../../utils/s3MetadataIndex';
import { parseS3ImageId } from '../../utils/s3ImageId';
import { validateViewerLaunch } from '../../utils/viewerLaunch';
import { readDicomMetadataFromFile } from '../../routes/Local/readDicomMetadataFast';
import { selectCpuSeries, type CpuSeries, type Pixels } from './cpuGeometry';
import type { CpuWorkerClient } from './CpuWorkerClient';

export type CpuProgress = { text: string; percent: number; loaded?: number; total?: number };
let decoderReady = false;
// Deduplicate development StrictMode mounts without redeeming a one-use token twice.
let resolving: {
  token: string;
  url: string;
  promise: Promise<ReturnType<typeof validateViewerLaunch>>;
} | null = null;
const active = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
};
export function cpuMemoryBudget(deviceMemory?: number) {
  return (
    Math.min(1024, Math.max(256, Number.isFinite(deviceMemory) ? (deviceMemory * 1024) / 5 : 768)) *
    1024 ** 2
  );
}

export async function cpuSources(
  files: File[] | null,
  token: string | null,
  config: any,
  signal: AbortSignal,
  report: (value: CpuProgress) => void
) {
  if (files) {
    const items = [];
    for (let i = 0; i < files.length; i++) {
      active(signal);
      if (/\.(json|png|jpe?g|txt|pdf)$/i.test(files[i].name)) continue;
      try {
        const { dataset } = await readDicomMetadataFromFile(files[i]);
        items.push({ dataset, source: files[i] });
      } catch (_error) {
        /* Non-DICOM companions are not a medical series. */
      }
      report({
        text: `Читаем метаданные: ${i + 1} / ${files.length}`,
        percent: 5 + ((i + 1) / files.length) * 10,
      });
    }
    active(signal);
    if (!items.length) throw new Error('В выбранных файлах не найдены DICOM-изображения.');
    return items;
  }
  if (!token || config.disableTokenViewer || !config.viewerIntegration?.resolveUrl)
    throw new Error('Откройте исследование из личного кабинета или выберите DICOM-файлы.');
  const url = config.viewerIntegration.resolveUrl.replace('{token}', encodeURIComponent(token));
  if (!resolving || resolving.token !== token || resolving.url !== url) {
    const promise = fetch(url, {
      credentials: 'include',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    }).then(async response => {
      if (!response.ok)
        throw new Error('Нет доступа к исследованию. Откройте его заново из личного кабинета.');
      return validateViewerLaunch(await response.json());
    });
    resolving = { token, url, promise };
    promise.catch(() => {
      if (resolving?.promise === promise) resolving = null;
    });
  }
  const launch = await resolving.promise;
  active(signal);
  s3FileService.setStudyAccess(launch.s3Prefix, launch.access.resources, launch.access.expiresAt);
  report({ text: 'Читаем индекс сжатой серии…', percent: 10 });
  const index = await loadCompressedStudy(
    launch.s3Prefix,
    key => s3FileService.getJsonObject(key),
    undefined,
    launch.sourceVersion
  );
  active(signal);
  return prepareS3Instances(index.instances, index.indexPrefix).map(dataset => {
    if (!dataset.url.startsWith('orbitals3:')) throw new Error('Некорректный путь сжатого DICOM.');
    return { dataset, source: parseS3ImageId(dataset.url).key };
  });
}

export async function loadCpuStudy(
  items: Awaited<ReturnType<typeof cpuSources>>,
  worker: CpuWorkerClient,
  signal: AbortSignal,
  report: (value: CpuProgress) => void,
  onSeries: (series: CpuSeries) => void,
  onSlice: () => void
) {
  const budget = cpuMemoryBudget((navigator as any).deviceMemory);
  const series = selectCpuSeries(items, budget);
  if (!decoderReady) {
    // Register pixel decoders/workers only. Do not initialize Cornerstone's GPU engine.
    dicomImageLoader.init({ maxWebWorkers: 2 });
    decoderReady = true;
  }
  active(signal);
  await worker.request('init', { geometry: series.geometry, budget });
  onSeries(series);
  // Middle first, followed by neighbouring slices. Only one decoded frame in flight.
  const middle = Math.floor(series.frames.length / 2);
  const ordered = series.frames
    .map((_frame, i) => i)
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
  let loaded = 0;
  let pinned: { source: File | string; localId: string; index: number } | null = null;
  const release = () => {
    if (!pinned) return;
    dicomImageLoader.wadouri.dataSetCacheManager.unload(String(pinned.index));
    dicomImageLoader.wadouri.fileManager.remove(pinned.index);
    pinned = null;
  };
  try {
    for (const index of ordered) {
      active(signal);
      const frame = series.frames[index];
      if (pinned?.source !== frame.source) {
        release();
        const blob =
          typeof frame.source === 'string'
            ? await s3FileService.getObjectAsBlob(frame.source)
            : frame.source;
        active(signal);
        const file =
          blob instanceof File
            ? blob
            : new File([blob], 'slice.dcm', { type: 'application/dicom' });
        const localId = dicomImageLoader.wadouri.fileManager.add(file),
          fileIndex = Number(localId.split(':')[1]);
        pinned = { source: frame.source, localId, index: fileIndex };
        // Hold only one compressed object and parsed dataset. Enhanced CT frames can
        // reuse it without downloading the same multi-frame file hundreds of times.
        await dicomImageLoader.wadouri.dataSetCacheManager.load(
          String(fileIndex),
          dicomImageLoader.wadouri.loadFileRequest,
          localId
        );
      }
      // Pin the parsed dataset first: the decoder's cached multi-frame path uses
      // correct 1-based image IDs -> 0-based frame offsets, including Enhanced CT.
      const decoded = dicomImageLoader.wadouri.loadImage(
        `${pinned.localId}&frame=${frame.frame + 1}`,
        {
          preScale: { enabled: false },
        }
      );
      const image = await decoded.promise;
      active(signal);
      const source = image.getPixelData() as Pixels;
      if (source.length !== frame.rows * frame.columns)
        throw new Error('Размер декодированного среза не совпадает с метаданными.');
      const pixels = source.slice() as Pixels;
      await worker.request(
        'slice',
        { index, pixels, slope: frame.slope, intercept: frame.intercept },
        [pixels.buffer]
      );
      active(signal);
      loaded++;
      report({
        text: `Загружено ${loaded} / ${series.frames.length} срезов`,
        percent: 15 + (loaded / series.frames.length) * 85,
        loaded,
        total: series.frames.length,
      });
      if (loaded < 4 || loaded % 8 === 0 || loaded === series.frames.length) onSlice();
    }
  } finally {
    release();
  }
  return series;
}
