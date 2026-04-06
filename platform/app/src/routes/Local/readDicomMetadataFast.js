import dcmjs from 'dcmjs';

/** Stop before Pixel Data element; do not load pixel payload into memory (dcmjs option). */
const READ_UNTIL_PIXEL_DATA = {
  untilTag: '7fe00010',
  includeUntilTagValue: false,
};

const INITIAL_CHUNK_SIZE = 512 * 1024; // 512 KiB
const MAX_CHUNK_SIZE = 8 * 1024 * 1024; // cap growth before jumping to full file

/**
 * Reads only the portion of a DICOM P10 file needed for metadata (everything strictly
 * before Pixel Data), using progressively larger prefixes of the file until parsing succeeds.
 * Pixel data is decoded later by wadouri when the viewport requests the image.
 *
 * @param {File} file
 * @returns {Promise<{ dataset: object, bytesRead: number, usedFullFile: boolean }>}
 */
export async function readDicomMetadataFromFile(file) {
  const size = file.size;
  if (!size) {
    throw new Error('Empty DICOM file');
  }

  let chunk = Math.min(INITIAL_CHUNK_SIZE, size);
  let lastError;

  while (chunk <= size) {
    const buffer = await file.slice(0, chunk).arrayBuffer();
    try {
      let dicomData;
      try {
        dicomData = dcmjs.data.DicomMessage.readFile(buffer, READ_UNTIL_PIXEL_DATA);
      } catch (err) {
        // Fallback for DICOM files without standard 128-byte preamble + "DICM" prefix
        if (err.message && err.message.includes('expected header is missing')) {
          const preamble = new Uint8Array(128).fill(0);
          const dicm = new Uint8Array([68, 73, 67, 77]); // "DICM"
          const combined = new Uint8Array(preamble.length + dicm.length + buffer.byteLength);
          combined.set(preamble, 0);
          combined.set(dicm, 128);
          combined.set(new Uint8Array(buffer), 132);
          dicomData = dcmjs.data.DicomMessage.readFile(combined.buffer, READ_UNTIL_PIXEL_DATA);
        } else {
          throw err;
        }
      }

      const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);
      dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(dicomData.meta);
      dataset.AvailableTransferSyntaxUID =
        dataset.AvailableTransferSyntaxUID || dataset._meta.TransferSyntaxUID?.Value?.[0];

      return {
        dataset,
        bytesRead: chunk,
        usedFullFile: chunk >= size,
      };
    } catch (err) {
      lastError = err;
      if (chunk >= size) {
        break;
      }
      const next = Math.min(chunk >= MAX_CHUNK_SIZE ? size : chunk * 2, size);
      chunk = next <= chunk ? size : next;
    }
  }

  throw lastError || new Error('Failed to parse DICOM metadata');
}
