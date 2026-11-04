import { act, renderHook } from '@testing-library/react';
import { DicomMetadataStore } from '@ohif/core';
import { imageLoader } from '@cornerstonejs/core';
import { s3FileService } from './S3FileService';
import { useS3Loader } from './useS3Loader';

const mockNavigate = jest.fn();
const mockShow = jest.fn();
const mockHide = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
jest.mock('@ohif/core', () => ({ DicomMetadataStore: { addInstance: jest.fn() } }), { virtual: true });
jest.mock('@ohif/ui-next', () => ({ useModal: () => ({ show: mockShow, hide: mockHide }) }), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ imageLoader: { loadAndCacheImage: jest.fn(() => Promise.resolve({})) } }), { virtual: true });
jest.mock('../components/S3ProgressModal/S3ProgressModal', () => () => null);
jest.mock('./orbitalS3ImageLoader', () => ({ registerOrbitalS3ImageLoader: jest.fn() }));
jest.mock('./S3FileService', () => ({ s3FileService: {
  normalizePrefix: value => value, getMetadataIndex: jest.fn(), listAllObjects: jest.fn(),
  getJsonObject: jest.fn(),
} }));

beforeEach(() => {
  jest.clearAllMocks();
  (window as any).config = { s3: { compressedOnly: false } };
});

it('opens a tagged index without listing/indexing DICOM files, warms one middle slice and navigates', async () => {
  const instances = Array.from({ length: 3 }, (_, i) => ({
    _url: `Data/${i}.dcm`,
    '0020000D': { vr: 'UI', Value: ['1'] }, '0020000E': { vr: 'UI', Value: ['2'] },
    '00080018': { vr: 'UI', Value: [`3.${i}`] }, '00080060': { vr: 'CS', Value: ['CT'] },
    '00200013': { vr: 'IS', Value: [i] },
  }));
  (s3FileService.getMetadataIndex as jest.Mock).mockResolvedValue({ instances, indexPrefix: 'hot/appt_1/', indexKey: 'index' });
  const { result } = renderHook(() => useS3Loader());
  await act(async () => { await result.current.loadFromS3('hot/appt_1/Data/'); });
  expect(s3FileService.listAllObjects).not.toHaveBeenCalled();
  expect(mockShow).not.toHaveBeenCalled();
  expect(DicomMetadataStore.addInstance).toHaveBeenCalledTimes(3);
  expect(imageLoader.loadAndCacheImage).toHaveBeenCalledTimes(1);
  expect(imageLoader.loadAndCacheImage).toHaveBeenCalledWith('orbitals3:hot%2Fappt_1%2FData%2F1.dcm');
  expect(mockNavigate).toHaveBeenCalledWith('/segmentation/dicomlocal?StudyInstanceUIDs=1');
  expect(result.current.progress.text).toContain('Индекс готов: 3');
});

it('exposes index download progress through React before any navigation', async () => {
  let report;
  let complete;
  (s3FileService.getMetadataIndex as jest.Mock).mockImplementation((_, callback) => {
    report = callback;
    return new Promise(resolve => { complete = resolve; });
  });
  const { result } = renderHook(() => useS3Loader());
  let loading;
  act(() => { loading = result.current.loadFromS3('hot/appt_1/'); });
  act(() => report({ phase: 'download', loadedBytes: 1048576, totalBytes: 2097152 }));
  expect(result.current.progress.text).toContain('1.0 / 2.0 МБ');
  expect(result.current.loading).toBe(true);
  expect(mockNavigate).not.toHaveBeenCalled();
  (s3FileService.listAllObjects as jest.Mock).mockResolvedValue([]);
  await act(async () => { complete(null); await loading; });
});

it('does not start a slow scan after a network/index error', async () => {
  (s3FileService.getMetadataIndex as jest.Mock).mockRejectedValue(new Error('CORS'));
  const { result } = renderHook(() => useS3Loader());
  await act(async () => { await result.current.loadFromS3('hot/appt_1/'); });
  expect(result.current.error).toBe('CORS');
  expect(result.current.loading).toBe(false);
  expect(s3FileService.listAllObjects).not.toHaveBeenCalled();
});

it('never falls back to original metadata/listing when a compressed pointer is missing', async () => {
  (window as any).config = { s3: { compressedOnly: true } };
  (s3FileService.getJsonObject as jest.Mock).mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
  const { result } = renderHook(() => useS3Loader());
  await act(async () => { await result.current.loadFromS3('hot/appt_1/Data/'); });
  expect(result.current.error).toContain('ещё не подготовлена');
  expect(s3FileService.getMetadataIndex).not.toHaveBeenCalled();
  expect(s3FileService.listAllObjects).not.toHaveBeenCalled();
  expect(DicomMetadataStore.addInstance).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});
