import { imageLoader } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { s3FileService } from './S3FileService';
import { ORBITAL_S3_SCHEME, parseS3ImageId } from './s3ImageId';
import { getViewerDiagnostics, recordViewerNetwork, recordViewerDecode } from '@ohif/core/src/constants/orbitalViewerDiagnostics';

export { ORBITAL_S3_SCHEME, orbitalS3ImageId } from './s3ImageId';

const localIdByKey = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let registered = false;

async function ensureLocalImageId(key: string): Promise<string> {
  const cached = localIdByKey.get(key);
  if (cached) return cached;

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const tracked = !!getViewerDiagnostics();
      const before = tracked ? performance.now() : 0;
      let blob: Blob;
      try {
        blob = await s3FileService.getObjectAsBlob(key);
        if (tracked) recordViewerNetwork(blob.size, performance.now() - before, true);
      } catch (error) {
        if (tracked) recordViewerNetwork(0, performance.now() - before, false);
        throw error;
      }
      const filename = key.split('/').pop() || 's3.dcm';
      const file = new File([blob], filename, { type: 'application/dicom' });
      const localId = dicomImageLoader.wadouri.fileManager.add(file);
      localIdByKey.set(key, localId);
      return localId;
    })().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, pending);
  }
  return pending;
}

function loadImage(imageId: string, options?: unknown) {
  const { key, frame } = parseS3ImageId(imageId);
  let decoded: any;
  const promise = ensureLocalImageId(key).then(async localId => {
    const tracked = !!getViewerDiagnostics();
    const before = tracked ? performance.now() : 0;
    try {
      decoded = dicomImageLoader.wadouri.loadImage(
        frame ? `${localId}&frame=${frame}` : localId, options as any
      );
      const image = await (decoded?.promise || decoded);
      // Cornerstone's cache, volume events and UI must refer to the requested ID.
      // The private dicomfile ID is only an implementation detail of the decoder.
      image.imageId = imageId;
      if (tracked) recordViewerDecode(performance.now() - before, true);
      return image;
    } catch (error) {
      if (tracked) recordViewerDecode(performance.now() - before, false);
      throw error;
    }
  });
  return { promise, decache: () => decoded?.decache?.() };
}

/** pixels via SDK GetObject — no presigned URLs required */
export function registerOrbitalS3ImageLoader(): void {
  if (registered) return;
  imageLoader.registerImageLoader(ORBITAL_S3_SCHEME, loadImage as any);
  registered = true;
  console.log('[orbital-s3] image loader registered');
}
