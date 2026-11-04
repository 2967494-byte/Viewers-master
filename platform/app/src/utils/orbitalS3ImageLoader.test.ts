import { imageLoader } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { s3FileService } from './S3FileService';
import { orbitalS3ImageId, registerOrbitalS3ImageLoader } from './orbitalS3ImageLoader';

jest.mock('@cornerstonejs/core', () => ({ imageLoader: { registerImageLoader: jest.fn() } }), { virtual: true });
jest.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: { fileManager: { add: jest.fn(() => 'dicomfile:7') }, loadImage: jest.fn() },
}), { virtual: true });
jest.mock('./S3FileService', () => ({ s3FileService: { getObjectAsBlob: jest.fn() } }));

it('deduplicates SDK downloads and returns the requested image ID for each frame', async () => {
  (s3FileService.getObjectAsBlob as jest.Mock).mockResolvedValue(new Blob(['dicom']));
  const decache = jest.fn();
  (dicomImageLoader.wadouri.loadImage as jest.Mock).mockImplementation(id => ({
    promise: Promise.resolve({ imageId: id }), decache,
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
  expect(dicomImageLoader.wadouri.loadImage).toHaveBeenCalledWith('dicomfile:7&frame=1', { priority: 1 });
  first.decache();
  expect(decache).toHaveBeenCalledTimes(1);
});

it('clears a rejected download so a later image request can retry it', async () => {
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1];
  (s3FileService.getObjectAsBlob as jest.Mock).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Blob(['retry']));
  const id = orbitalS3ImageId('hot/retry.dcm');
  await expect(load(id).promise).rejects.toThrow('offline');
  await expect(load(id).promise).resolves.toHaveProperty('imageId', id);
});
