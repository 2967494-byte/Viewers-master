import FileLoaderService from './fileLoaderService';
import { DicomMetadataStore } from '@ohif/core';
import { readDicomMetadataFromFile } from './readDicomMetadataFast';

/** Limit parallel metadata reads to avoid memory spikes with huge folder drops. */
const METADATA_PARSE_CONCURRENCY = 32;

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) {
        return;
      }
      results[i] = await mapper(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export const processFile = async file => {
  try {
    const fileLoaderService = new FileLoaderService(file);
    const imageId = fileLoaderService.addFile(file);

    if (file.type === 'application/pdf') {
      const image = await fileLoaderService.loadFile(file, imageId);
      const dicomJSONDataset = await fileLoaderService.getDataset(image, imageId);
      DicomMetadataStore.addInstance(dicomJSONDataset);
      return dicomJSONDataset.StudyInstanceUID || dicomJSONDataset.studyInstanceUid || (dicomJSONDataset['0020000D'] && dicomJSONDataset['0020000D'].Value && dicomJSONDataset['0020000D'].Value[0]);
    }

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.json') || lowerName.endsWith('.txt') || lowerName.endsWith('.png') || lowerName.endsWith('.jpg')) {
      return;
    }

    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    try {
      const { dataset, bytesRead, usedFullFile } = await readDicomMetadataFromFile(file);
      dataset.url = imageId;
      DicomMetadataStore.addInstance(dataset);

      if (process.env.NODE_ENV === 'development' && t0) {
        const ms = performance.now() - t0;
        // eslint-disable-next-line no-console
        console.debug(
          `[DICOM local] metadata: ${file.name} in ${ms.toFixed(1)}ms (${(bytesRead / 1024).toFixed(1)} KiB read${usedFullFile ? ', full prefix' : ''})`
        );
      }
      return dataset.StudyInstanceUID || dataset.studyInstanceUid || (dataset['0020000D'] && dataset['0020000D'].Value && dataset['0020000D'].Value[0]);
    } catch (partialErr) {
      const image = await fileLoaderService.loadFile(file, imageId);
      const dicomJSONDataset = await fileLoaderService.getDataset(image, imageId);
      DicomMetadataStore.addInstance(dicomJSONDataset);

      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.warn(
          `[DICOM local] partial metadata failed for ${file.name}, used full read:`,
          partialErr?.message || partialErr
        );
      }
      return dicomJSONDataset.StudyInstanceUID || dicomJSONDataset.studyInstanceUid || (dicomJSONDataset['0020000D'] && dicomJSONDataset['0020000D'].Value && dicomJSONDataset['0020000D'].Value[0]);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(
      error.name,
      ':Error when trying to load and process local files:',
      error.message
    );
  }
};

export default async function filesToStudies(files) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

  await mapPool(files, METADATA_PARSE_CONCURRENCY, processFile);

  if (process.env.NODE_ENV === 'development' && t0 && files.length) {
    const total = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.info(
      `[DICOM local] indexed ${files.length} file(s) in ${total.toFixed(0)}ms (partial metadata, concurrency ${METADATA_PARSE_CONCURRENCY})`
    );
  }

  return DicomMetadataStore.getStudyInstanceUIDs();
}
