import { DicomMetadataStore } from '@ohif/core';
import { readDicomMetadataFromFile } from '../routes/Local/readDicomMetadataFast';
import FileLoaderService from '../routes/Local/fileLoaderService';
import { s3FileService } from './S3FileService';
import { orbitalS3ImageId } from './orbitalS3ImageLoader';

/** Prefer small prefixes — CBCT headers usually fit in << 1 MiB. */
const META_PREFIX_SIZES = [128 * 1024, 512 * 1024, 2 * 1024 * 1024];

function studyUidFromDataset(dataset: any): string | undefined {
  return (
    dataset?.StudyInstanceUID ||
    dataset?.studyInstanceUid ||
    dataset?.['0020000D']?.Value?.[0]
  );
}

function formatErr(err: any): string {
  const status = err?.$metadata?.httpStatusCode || err?.status;
  const name = err?.name || err?.Code || '';
  const msg = err?.message || String(err);
  return [status && `HTTP ${status}`, name, msg].filter(Boolean).join(' — ');
}

/**
 * Index one S3 DICOM object.
 * Fast path: prefix bytes only + orbitals3: imageId (pixels on demand via SDK).
 * Fallback: full download → dicomfile.
 */
export async function processS3DicomObject(
  key: string
): Promise<{ uid?: string; bytes: number; mode: 'range' | 'full' }> {
  const filename = key.split('/').pop() || 's3.dcm';
  let lastError: unknown;

  for (const size of META_PREFIX_SIZES) {
    try {
      const blob = await s3FileService.getObjectPrefix(key, size);
      const file = new File([blob], filename, { type: 'application/dicom' });
      const { dataset } = await readDicomMetadataFromFile(file);
      const uid = studyUidFromDataset(dataset);
      if (!uid) {
        throw new Error('StudyInstanceUID missing in prefix');
      }
      dataset.url = orbitalS3ImageId(key);
      DicomMetadataStore.addInstance(dataset);
      return { uid, bytes: blob.size, mode: 'range' };
    } catch (err) {
      lastError = err;
    }
  }

  try {
    const blob = await s3FileService.getObjectAsBlob(key);
    const file = new File([blob], filename, { type: 'application/dicom' });
    const fileLoaderService = new FileLoaderService(file);
    const imageId = fileLoaderService.addFile(file);
    const { dataset } = await readDicomMetadataFromFile(file);
    dataset.url = imageId;
    DicomMetadataStore.addInstance(dataset);
    return { uid: studyUidFromDataset(dataset), bytes: blob.size, mode: 'full' };
  } catch (err) {
    const e: any = err || lastError || new Error('S3 DICOM index failed');
    e.message = `${key}: ${formatErr(e)}`;
    throw e;
  }
}
