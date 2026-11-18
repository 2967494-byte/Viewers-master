import { imageLoader } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { s3FileService } from './S3FileService';
import { orbitalS3ImageId, registerOrbitalS3ImageLoader } from './orbitalS3ImageLoader';

jest.mock('@cornerstonejs/core', () => ({ imageLoader: { registerImageLoader: jest.fn() } }), { virtual: true });
jest.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: { fileManager: { add: jest.fn(() => 'dicomfile:7'), remove: jest.fn() }, loadImage: jest.fn() },
}), { virtual: true });
jest.mock('./S3FileService', () => ({ s3FileService: { getObjectAsBlob: jest.fn() } }));

it('deduplicates SDK downloads and returns the requested image ID for each frame', async () => {
  (s3FileService.getObjectAsBlob as jest.Mock).mockResolvedValue(new Blob(['dicom']));
  const decache = jest.fn();
  const pixels = new Int16Array([-32768, -1024, 0, 1234, 32767]);
  (dicomImageLoader.wadouri.loadImage as jest.Mock).mockImplementation(id => ({
    promise: Promise.resolve({ imageId: id, getPixelData: () => pixels }), decache,
  }));
  registerOrbitalS3ImageLoader();
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1];
  const imageId = orbitalS3ImageId('hot/appt_1/a&b.dcm');
  const first = load(imageId + '&frame=1', { priority: 1 });
  const second = load(imageId + '&frame=2');
  const images = await Promise.all([first.promise, second.promise]);
  expect(s3FileService.getObjectAsBlob).toHaveBeenCalledTimes(1);
  expect(s3FileService.getObjectAsBlob).toHaveBeenCalledWith('hot/appt_1/a&b.dcm');
  expect(images.map(x => x.imageId)).toEqual([imageId + '&frame=1', imageId + '&frame=2']);
  expect(images.every(image => image.getPixelData() === pixels)).toBe(true);
  expect(pixels).toEqual(new Int16Array([-32768, -1024, 0, 1234, 32767]));
  expect(dicomImageLoader.wadouri.loadImage).toHaveBeenCalledWith('dicomfile:7&frame=1', { priority: 1 });
  first.decache();
  expect(decache).toHaveBeenCalledTimes(1);
  expect(dicomImageLoader.wadouri.fileManager.remove).not.toHaveBeenCalled();
  second.decache();
  second.decache();
  expect(decache).toHaveBeenCalledTimes(2);
  expect(dicomImageLoader.wadouri.fileManager.remove).toHaveBeenCalledTimes(1);
  expect(dicomImageLoader.wadouri.fileManager.remove).toHaveBeenCalledWith(7);
});

it('clears a rejected download so a later image request can retry it', async () => {
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1];
  (s3FileService.getObjectAsBlob as jest.Mock).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Blob(['retry']));
  const id = orbitalS3ImageId('hot/retry.dcm');
  await expect(load(id).promise).rejects.toThrow('offline');
  const retry = load(id);
  await expect(retry.promise).resolves.toHaveProperty('imageId', id);
  retry.decache();
});

it('downloads again after the final cached frame is released, without retaining a stale file ID', async () => {
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1];
  const id = orbitalS3ImageId('hot/reopen.dcm');
  const before = (s3FileService.getObjectAsBlob as jest.Mock).mock.calls.length;
  (s3FileService.getObjectAsBlob as jest.Mock).mockResolvedValue(new Blob(['data']));
  const first = load(id);
  await first.promise;
  first.cancelFn(); first.decache();
  const second = load(id);
  await second.promise;
  second.decache();
  expect((s3FileService.getObjectAsBlob as jest.Mock).mock.calls.length - before).toBe(2);
});

it('releases a file arriving after eviction without starting its decoder', async () => {
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1];
  let finish: (blob: Blob) => void;
  (s3FileService.getObjectAsBlob as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const before = (dicomImageLoader.wadouri.loadImage as jest.Mock).mock.calls.length;
  const request = load(orbitalS3ImageId('hot/evicted.dcm'));
  await Promise.resolve(); await Promise.resolve();
  request.decache();
  finish(new Blob(['late']));
  await expect(request.promise).rejects.toHaveProperty('name', 'AbortError');
  expect((dicomImageLoader.wadouri.loadImage as jest.Mock).mock.calls.length).toBe(before);
});
