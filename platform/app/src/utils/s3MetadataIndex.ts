import dcmjs from 'dcmjs';
import { orbitalS3ImageId } from './s3ImageId';

/** Do not probe unrelated appointments/date folders above the selected study. */
export function metadataIndexPrefixes(prefix: string): string[] {
  const candidates: string[] = [];
  let parts = prefix.replace(/\/+$/, '').split('/').filter(Boolean);
  for (let i = 0; parts.length && i < 5; i++) {
    candidates.push(parts.join('/') + '/');
    if (/^appt_/i.test(parts[parts.length - 1])) break;
    parts = parts.slice(0, -1);
  }
  // Uploader writes to appointment root. Probe it alongside the selected folder,
  // rather than waiting on every missing intermediate directory first.
  const appointment = candidates.find(path => /\/appt_[^/]+\/$/i.test('/' + path));
  return appointment
    ? [...new Set([candidates[0], appointment, ...candidates.slice(1)])]
    : candidates;
}

export function prepareS3Instances(instances: any[], indexPrefix: string): any[] {
  if (!instances.length) throw new Error('Индекс метаданных пуст');
  return instances.map((source, index) => {
    const raw = source.url || source._url;
    if (typeof raw !== 'string' || !raw) {
      throw new Error(`В индексе отсутствует путь к DICOM (элемент ${index + 1})`);
    }
    // Naturalizing url/_url as if they were DICOM tags turns the strings into null.
    // Only pass hexadecimal tags to dcmjs, then attach the resolved URL afterwards.
    const tags = Object.fromEntries(Object.entries(source).filter(([key]) => /^[\da-f]{8}$/i.test(key)));
    const dataset = source.SeriesInstanceUID
      ? { ...source }
      : dcmjs.data.DicomMetaDictionary.naturalizeDataset(tags);
    // Some index generators serialize US/IS values as strings. OHIF's volume
    // reconstructability check compares these fields as numbers, strictly.
    for (const name of ['Rows', 'Columns', 'SamplesPerPixel', 'BitsAllocated', 'BitsStored', 'HighBit', 'PixelRepresentation', 'NumberOfFrames']) {
      if (dataset[name] != null && Number.isFinite(Number(dataset[name]))) dataset[name] = Number(dataset[name]);
    }
    for (const name of ['StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID']) {
      if (!dataset[name]) throw new Error(`В индексе отсутствует ${name} (элемент ${index + 1})`);
    }
    if (/^(orbitals3|wadouri|dicomfile|dicomweb):/.test(raw)) dataset.url = raw;
    else if (/^https?:\/\//i.test(raw)) dataset.url = `wadouri:${raw}`;
    else {
      const absolute = raw.startsWith('/') || raw.startsWith('hot/') || raw.startsWith(indexPrefix);
      const path = (absolute ? raw.replace(/^\/+/, '') : indexPrefix + raw).replace(/\\/g, '/');
      const segments: string[] = [];
      for (const part of path.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
          if (!segments.length) throw new Error('Некорректный путь к DICOM в индексе');
          segments.pop();
        } else segments.push(part);
      }
      dataset.url = orbitalS3ImageId(segments.join('/'));
    }
    return dataset;
  });
}
