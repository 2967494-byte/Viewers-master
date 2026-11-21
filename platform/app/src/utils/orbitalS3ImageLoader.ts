import { imageLoader } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { s3FileService } from './S3FileService';
import { ORBITAL_S3_SCHEME, parseS3ImageId } from './s3ImageId';
import { getViewerDiagnostics, recordViewerNetwork, recordViewerDecode } from '@ohif/core/src/constants/orbitalViewerDiagnostics';
import { createBoundedImageTasks } from './boundedImageTasks';
import { detachDecodedVolumeSource } from './decodedVolumeSource';
import { getOrbitalDecodeBudget } from '@ohif/core/src/constants/orbitalDecodeBudget';

export { ORBITAL_S3_SCHEME, orbitalS3ImageId } from './s3ImageId';

type LocalFile = { users: number; localId?: string; pending?: Promise<string>; controller: AbortController; signals: Set<AbortSignal> };
const localFiles = new Map<string, LocalFile>();
const imageBudget = () => getOrbitalDecodeBudget(undefined,
  typeof window === 'undefined' ? undefined : (window as any).config?.maxNumberOfWebWorkers);
// Bound decoded files as well as transfers; retain headroom for UI and panorama.
const runImageTask = createBoundedImageTasks(() => imageBudget().pipelines);
// Hold the source File until its decoder slot is available; do not parse more
// DICOM datasets or enqueue more WASM work while the decoder is busy.
const runDecodeTask = createBoundedImageTasks(() => imageBudget().decoders);
export function getOrbitalImageTaskStats() {
  return { budget: imageBudget(), pipelines: runImageTask.getStats(), decoding: runDecodeTask.getStats(), activeRequests: activeRequests.size };
}
const activeRequests = new Set<() => void>();
export function cancelOrbitalImageTasks() {
  [...activeRequests].forEach(cancel => cancel());
}
let registered = false;

function removeLocalFile(entry: LocalFile) {
  if (!entry.localId) return;
  dicomImageLoader.wadouri.fileManager.remove(Number(entry.localId.split(':')[1]));
  entry.localId = undefined;
}

async function ensureLocalImageId(key: string, entry: LocalFile): Promise<string> {
  const cached = entry.localId;
  if (cached) return cached;

  let pending = entry.pending;
  if (!pending) {
    pending = (async () => {
      const tracked = !!getViewerDiagnostics();
      const before = tracked ? performance.now() : 0;
      let blob: Blob;
      try {
        blob = await s3FileService.getObjectAsBlob(key, entry.controller.signal);
        if (entry.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (tracked) recordViewerNetwork(blob.size, performance.now() - before, true);
      } catch (error) {
        if (tracked) recordViewerNetwork(0, performance.now() - before, false);
        throw error;
      }
      const filename = key.split('/').pop() || 's3.dcm';
      const file = new File([blob], filename, { type: 'application/dicom' });
      const localId = dicomImageLoader.wadouri.fileManager.add(file);
      entry.localId = localId;
      return localId;
    })().finally(() => {
      entry.pending = undefined;
      if (!entry.users) removeLocalFile(entry);
    });
    entry.pending = pending;
  }
  return pending;
}

function loadImage(imageId: string, options?: unknown) {
  const { key, frame } = parseS3ImageId(imageId);
  const entry = localFiles.get(key) || { users: 0, controller: new AbortController(), signals: new Set<AbortSignal>() };
  localFiles.set(key, entry);
  entry.users++;
  const controller = new AbortController();
  entry.signals.add(controller.signal);
  let decoded: any;
  let released = false;
  let settled = false;
  let disposed = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.signals.delete(controller.signal);
    decoded?.decache?.();
    if (--entry.users === 0) {
      if (localFiles.get(key) === entry) localFiles.delete(key);
      removeLocalFile(entry);
    }
  };
  const promise = runImageTask(async () => {
    const localId = await ensureLocalImageId(key, entry);
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return runDecodeTask(async () => {
      const tracked = !!getViewerDiagnostics();
      const before = tracked ? performance.now() : 0;
      try {
        decoded = dicomImageLoader.wadouri.loadImage(
          frame ? `${localId}&frame=${frame}` : localId, options as any
        );
        const image = await (decoded?.promise || decoded);
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        // Cornerstone's cache, volume events and UI refer to the requested ID.
        // The private dicomfile ID is only a decoder implementation detail.
        image.imageId = imageId;
        detachDecodedVolumeSource(image, options, () => {
          release();
          decoded = undefined;
        });
        if (tracked) recordViewerDecode(performance.now() - before, true);
        return image;
      } catch (error) {
        if (tracked) recordViewerDecode(performance.now() - before, false);
        throw error;
      }
    }, controller.signal);
  }, controller.signal).catch(error => {
    disposed = true;
    throw error;
  }).finally(() => {
    activeRequests.delete(decache);
    settled = true;
    if (disposed) release();
  });
  const decache = () => {
    disposed = true;
    controller.abort();
    if ([...entry.signals].every(signal => signal.aborted)) {
      entry.controller.abort();
      // A new request must not attach to an already cancelled download.
      if (localFiles.get(key) === entry) localFiles.delete(key);
    }
    if (!settled) decoded?.cancelFn?.();
    if (settled) release();
  };
  activeRequests.add(decache);
  return { promise, decache, cancelFn: decache };
}

/** pixels via SDK GetObject — no presigned URLs required */
export function registerOrbitalS3ImageLoader(): void {
  if (registered) return;
  imageLoader.registerImageLoader(ORBITAL_S3_SCHEME, loadImage as any);
  // Read-only counters for local resource comparisons; no timers or reporting requests.
  (window as any).__orbitalImageTaskStats = getOrbitalImageTaskStats;
  window.addEventListener('orbital:release-study-resources', cancelOrbitalImageTasks);
  window.addEventListener('pagehide', cancelOrbitalImageTasks);
  registered = true;
  console.log('[orbital-s3] image loader registered');
}
