import { imageLoader } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { s3FileService } from './S3FileService';
import { orbitalS3ImageId, registerOrbitalS3ImageLoader, cancelOrbitalImageTasks, getOrbitalImageTaskStats } from './orbitalS3ImageLoader';

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
  expect(s3FileService.getObjectAsBlob).toHaveBeenCalledWith('hot/appt_1/a&b.dcm', expect.any(AbortSignal));
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

it('drops a completed single-frame volume source while keeping its exact decoded pixels', async () => {
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1];
  const pixels = new Int16Array([-32768, -1024, 0, 1234, 32767]);
  const image = { imageId: '', data: { string: tag => tag === 'x00020010' ? '1.2.840.10008.1.2.4.91' : '1', byteArray: new Uint8Array(100) }, getPixelData: () => pixels };
  const decache = jest.fn();
  (s3FileService.getObjectAsBlob as jest.Mock).mockResolvedValue(new Blob(['volume']));
  (dicomImageLoader.wadouri.loadImage as jest.Mock).mockReturnValue({ promise: Promise.resolve(image), decache });
  const before = (dicomImageLoader.wadouri.fileManager.remove as jest.Mock).mock.calls.length;
  const request = load(orbitalS3ImageId('hot/volume-source.dcm'), { additionalDetails: { volumeId: 'volume:1' } });
  const result = await request.promise;
  expect(result.data).toBeUndefined();expect(result.getPixelData()).toBe(pixels);
  expect(Array.from(pixels)).toEqual([-32768, -1024, 0, 1234, 32767]);
  expect(decache).toHaveBeenCalledTimes(1);
  request.decache();request.cancelFn();expect(decache).toHaveBeenCalledTimes(1);
  expect((dicomImageLoader.wadouri.fileManager.remove as jest.Mock).mock.calls.length - before).toBe(1);
});

it('keeps the source for multiframe volume consumers', async () => {
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1], decache = jest.fn();
  const data = { string: tag => tag === 'x00020010' ? '1.2.840.10008.1.2.4.90' : '2' };
  const image = { data, getPixelData: () => new Uint16Array([42]) };
  (dicomImageLoader.wadouri.loadImage as jest.Mock).mockReturnValue({ promise: Promise.resolve(image), decache });
  const request = load(orbitalS3ImageId('hot/multiframe-volume.dcm'), { additionalDetails: { volumeId: 'volume:2' } });
  expect((await request.promise).data).toBe(data);expect(decache).not.toHaveBeenCalled();
  request.decache();expect(decache).toHaveBeenCalledTimes(1);
});

it('aborts an active transfer on study exit and does not start a late decoder', async () => {
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1];
  let finish: (value: Blob) => void;
  let signal: AbortSignal;
  (s3FileService.getObjectAsBlob as jest.Mock).mockImplementationOnce((_key, currentSignal) => {
    signal = currentSignal;
    return new Promise(resolve => { finish = resolve; });
  });
  const before = (dicomImageLoader.wadouri.loadImage as jest.Mock).mock.calls.length;
  const request = load(orbitalS3ImageId('hot/exit-active.dcm'));
  const rejected = expect(request.promise).rejects.toHaveProperty('name', 'AbortError');
  await Promise.resolve(); await Promise.resolve();
  cancelOrbitalImageTasks();
  expect(signal.aborted).toBe(true);
  finish(new Blob(['late'])); await rejected;
  expect((dicomImageLoader.wadouri.loadImage as jest.Mock).mock.calls.length).toBe(before);
});

it('lets a second frame finish when only one consumer cancels a shared transfer', async () => {
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1];
  let finish: (value: Blob) => void;
  let signal: AbortSignal;
  (s3FileService.getObjectAsBlob as jest.Mock).mockImplementationOnce((_key, currentSignal) => {
    signal = currentSignal; return new Promise(resolve => { finish = resolve; });
  });
  const id = orbitalS3ImageId('hot/shared-cancel.dcm');
  const first = load(id + '&frame=1'), second = load(id + '&frame=2');
  const rejected = expect(first.promise).rejects.toHaveProperty('name', 'AbortError');
  await Promise.resolve(); await Promise.resolve(); first.cancelFn();
  expect(signal.aborted).toBe(false);
  finish(new Blob(['shared'])); await rejected; await second.promise; second.decache();
});

it('decodes one frame on a constrained device while downloading ahead, and cancels a waiting decode', async () => {
  const hardware = jest.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(2);
  const load = (imageLoader.registerImageLoader as jest.Mock).mock.calls[0][1];
  const releases: Array<() => void> = [];let active=0,peak=0;
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const downloads=(s3FileService.getObjectAsBlob as jest.Mock).mock.calls.length;
  (s3FileService.getObjectAsBlob as jest.Mock).mockResolvedValue(new Blob(['compressed']));
  (dicomImageLoader.wadouri.loadImage as jest.Mock).mockImplementation(() => ({
    promise:new Promise(resolve=>{
      peak=Math.max(peak,++active);
      releases.push(()=>{active--;resolve({getPixelData:()=>new Int16Array([1,-1024,32767])});});
    }),decache:jest.fn(),
  }));
  const requests=Array.from({length:4},(_,i)=>load(orbitalS3ImageId(`hot/bounded-${i}.dcm`)));
  const all=Promise.allSettled(requests.map(r=>r.promise));
  try {
    await tick();expect(releases).toHaveLength(1);
    expect((s3FileService.getObjectAsBlob as jest.Mock).mock.calls.length-downloads).toBe(2);
    requests[1].cancelFn();await tick();
    for(let i=0;i<3;i++){expect(releases[i]).toBeDefined();releases[i]();await tick();}
    const results=await all;
    expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected','fulfilled','fulfilled']);
    expect((results[1] as PromiseRejectedResult).reason.name).toBe('AbortError');
    expect(peak).toBe(1);expect(releases).toHaveLength(3);
    for(const result of results)if(result.status==='fulfilled')expect(Array.from(result.value.getPixelData())).toEqual([1,-1024,32767]);
    expect(getOrbitalImageTaskStats()).toMatchObject({decoding:{active:0,queued:0},pipelines:{active:0,queued:0},activeRequests:0});
  } finally { requests.forEach(r=>r.decache());hardware.mockRestore(); }
});
