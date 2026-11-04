import { metadataIndexPrefixes, prepareS3Instances } from './s3MetadataIndex';
import { orbitalS3ImageId, parseS3ImageId } from './s3ImageId';

const raw = {
  _url: 'scan/Data/I0001.dcm',
  '0020000D': { vr: 'UI', Value: ['1.2.3'] },
  '0020000E': { vr: 'UI', Value: ['1.2.3.4'] },
  '00080018': { vr: 'UI', Value: ['1.2.3.4.1'] },
  '00200032': { vr: 'DS', Value: [0, 0, 10] },
  '00200037': { vr: 'DS', Value: [1, 0, 0, 0, 1, 0] },
};

it('probes the appointment root early and never ascends into another appointment/date', () => {
  expect(metadataIndexPrefixes('hot/2026/pat_1/appt_1/scan/Data/')).toEqual([
    'hot/2026/pat_1/appt_1/scan/Data/', 'hot/2026/pat_1/appt_1/', 'hot/2026/pat_1/appt_1/scan/',
  ]);
});

it('naturalizes DICOM JSON without losing URL or geometry, or mutating the index', () => {
  const [instance] = prepareS3Instances([raw], 'hot/appt_1/');
  expect(instance.StudyInstanceUID).toBe('1.2.3');
  expect(instance.SeriesInstanceUID).toBe('1.2.3.4');
  expect(instance.ImagePositionPatient).toEqual([0, 0, 10]);
  expect(instance.ImageOrientationPatient).toEqual([1, 0, 0, 0, 1, 0]);
  expect(parseS3ImageId(instance.url).key).toBe('hot/appt_1/scan/Data/I0001.dcm');
  expect(raw).not.toHaveProperty('url');
});

it('keeps naturalized datasets and resolves relative and absolute object keys', () => {
  const natural = { StudyInstanceUID: '1', SeriesInstanceUID: '2', SOPInstanceUID: '3' };
  const entries = ['../Data/a.dcm', '/hot/a.dcm', 'hot/a.dcm', 'https://example.test/a.dcm', orbitalS3ImageId('a.dcm')];
  expect(prepareS3Instances(entries.map(url => ({ ...natural, url })), 'hot/appt_1/index/').map(x => x.url)).toEqual([
    orbitalS3ImageId('hot/appt_1/Data/a.dcm'), orbitalS3ImageId('hot/a.dcm'), orbitalS3ImageId('hot/a.dcm'),
    'wadouri:https://example.test/a.dcm', orbitalS3ImageId('a.dcm'),
  ]);
});

it('fails visibly for an invalid index rather than silently dropping slices', () => {
  expect(() => prepareS3Instances([{ ...raw, _url: '' }], 'hot/')).toThrow('путь');
  expect(() => prepareS3Instances([{ _url: 'a.dcm' }], 'hot/')).toThrow('StudyInstanceUID');
});

it('normalizes integer image dimensions for OHIF strict reconstructability comparisons', () => {
  const [instance] = prepareS3Instances([{ ...raw,
    '00280010': { vr: 'US', Value: ['512'] }, '00280011': { vr: 'US', Value: ['512'] },
    '00280002': { vr: 'US', Value: ['1'] }, '00280100': { vr: 'US', Value: ['16'] },
  }], 'hot/appt_1/');
  expect(instance.Rows).toBe(512);
  expect(instance.Columns).toBe(512);
  expect(instance.SamplesPerPixel).toBe(1);
  expect(instance.BitsAllocated).toBe(16);
});

it('separates multi-frame suffix from encoded S3 keys', () => {
  expect(parseS3ImageId(orbitalS3ImageId('folder/a b&frame=2.dcm') + '&frame=3')).toEqual({
    key: 'folder/a b&frame=2.dcm', frame: '3',
  });
});
