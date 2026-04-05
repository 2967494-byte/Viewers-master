/**
 * @jest-environment node
 */
import fs from 'fs';
import { readDicomMetadataFromFile } from '../readDicomMetadataFast';

describe('readDicomMetadataFast', () => {
  it('exports readDicomMetadataFromFile', () => {
    expect(typeof readDicomMetadataFromFile).toBe('function');
  });

  const fixturePath = process.env.DICOM_METADATA_TEST_FIXTURE;

  (fixturePath ? it : it.skip)('parses metadata reading only a prefix when possible', async () => {
    const buf = fs.readFileSync(fixturePath);
    const file = new File([buf], 'study.dcm', { type: 'application/dicom' });
    const { dataset, bytesRead, usedFullFile } = await readDicomMetadataFromFile(file);

    expect(dataset.StudyInstanceUID).toBeTruthy();
    expect(dataset.SeriesInstanceUID).toBeTruthy();
    expect(dataset.SOPInstanceUID || dataset.SopInstanceUID).toBeTruthy();
    expect(bytesRead).toBeGreaterThan(0);
    expect(bytesRead).toBeLessThanOrEqual(buf.length);
    if (buf.length > 512 * 1024) {
      expect(usedFullFile).toBe(false);
    }
  });
});
