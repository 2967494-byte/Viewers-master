import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { s3FileService } from '../../utils/S3FileService';
import { cpuMemoryBudget, loadCpuStudy } from './cpuStudyLoader';

jest.mock(
  '@cornerstonejs/dicom-image-loader',
  () => ({
    __esModule: true,
    default: {
      init: jest.fn(),
      wadouri: {
        fileManager: { add: jest.fn(() => 'dicomfile:7'), remove: jest.fn() },
        loadFileRequest: jest.fn(),
        dataSetCacheManager: { load: jest.fn(async () => ({})), unload: jest.fn() },
        loadImage: jest.fn(),
      },
    },
  }),
  { virtual: true }
);
jest.mock('../../utils/S3FileService', () => ({
  s3FileService: { getObjectAsBlob: jest.fn(async () => new Blob(['test'])) },
}));
jest.mock('../../utils/s3CompressedStudy', () => ({ loadCompressedStudy: jest.fn() }));
jest.mock('../../utils/s3MetadataIndex', () => ({ prepareS3Instances: jest.fn() }));
jest.mock('../../routes/Local/readDicomMetadataFast', () => ({
  readDicomMetadataFromFile: jest.fn(),
}));

const enhanced = () => [
  {
    source: 'multi-frame.dcm',
    dataset: {
      StudyInstanceUID: 'study',
      SeriesInstanceUID: 'series',
      SOPInstanceUID: 'sop',
      Modality: 'CT',
      Rows: 2,
      Columns: 2,
      NumberOfFrames: 3,
      BitsAllocated: 16,
      SamplesPerPixel: 1,
      PhotometricInterpretation: 'MONOCHROME2',
      ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
      PixelSpacing: [1, 1],
      PerFrameFunctionalGroupsSequence: [0, 1, 2].map(k => ({
        PlanePositionSequence: [{ ImagePositionPatient: [0, 0, k] }],
        PixelValueTransformationSequence: [{ RescaleSlope: 2, RescaleIntercept: -1000 }],
      })),
    },
  },
];
describe('CPU loading and bounded memory ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (dicomImageLoader.wadouri.loadImage as jest.Mock).mockImplementation(id => ({
      promise: Promise.resolve({
        getPixelData: () => new Uint16Array(4).fill(Number(id.match(/frame=(\d+)/)[1])),
      }),
    }));
  });
  it('pins one Enhanced CT file, decodes correct frames unscaled and transfers each buffer once', async () => {
    const request = jest.fn(async () => undefined),
      slice = jest.fn();
    await loadCpuStudy(
      enhanced(),
      { request } as any,
      new AbortController().signal,
      () => {},
      () => {},
      slice
    );
    expect(s3FileService.getObjectAsBlob).toHaveBeenCalledTimes(1);
    expect(dicomImageLoader.wadouri.fileManager.add).toHaveBeenCalledTimes(1);
    expect(dicomImageLoader.wadouri.dataSetCacheManager.load).toHaveBeenCalledTimes(1);
    expect((dicomImageLoader.wadouri.loadImage as jest.Mock).mock.calls.map(([id]) => id)).toEqual([
      'dicomfile:7&frame=2',
      'dicomfile:7&frame=1',
      'dicomfile:7&frame=3',
    ]);
    expect((dicomImageLoader.wadouri.loadImage as jest.Mock).mock.calls[0][1]).toEqual({
      preScale: { enabled: false },
    });
    const slices = request.mock.calls.filter(([kind]) => kind === 'slice') as any[];
    expect(slices.map(([, payload]) => payload.index)).toEqual([1, 0, 2]);
    expect(slices[0][1].slope).toBe(2);
    expect(slices[0][1].intercept).toBe(-1000);
    expect(slices[0][2]).toEqual([slices[0][1].pixels.buffer]);
    expect(dicomImageLoader.wadouri.dataSetCacheManager.unload).toHaveBeenCalledTimes(1);
    expect(dicomImageLoader.wadouri.fileManager.remove).toHaveBeenCalledWith(7);
    expect(slice).toHaveBeenCalledTimes(3);
  });
  it('releases pinned files after a decode failure and stops cancelled work', async () => {
    (dicomImageLoader.wadouri.loadImage as jest.Mock).mockReturnValue({
      promise: Promise.reject(new Error('decode-failed')),
    });
    const worker = { request: jest.fn(async () => {}) } as any;
    await expect(
      loadCpuStudy(
        enhanced(),
        worker,
        new AbortController().signal,
        () => {},
        () => {},
        () => {}
      )
    ).rejects.toThrow('decode-failed');
    expect(dicomImageLoader.wadouri.fileManager.remove).toHaveBeenCalledWith(7);
    jest.clearAllMocks();
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadCpuStudy(
        enhanced(),
        worker,
        controller.signal,
        () => {},
        () => {},
        () => {}
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s3FileService.getObjectAsBlob).not.toHaveBeenCalled();
  });
  it('keeps a conservative bounded CPU budget even on large devices', () => {
    expect(cpuMemoryBudget()).toBe(768 * 1024 ** 2);
    expect(cpuMemoryBudget(2)).toBeLessThan(512 * 1024 ** 2);
    expect(cpuMemoryBudget(64)).toBe(1024 ** 3);
  });
});
