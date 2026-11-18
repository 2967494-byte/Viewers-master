import { histogramChunks, HISTOGRAM_CHUNK_VOXELS, streamVolumeHistogram, volumeHistogramChunks } from './streamVolumeHistogram';
import { histogramOperations } from './histogramOperations';

const execute = async (task, args) => histogramOperations[task](args);

it('produces the same bins from slices as a contiguous reference, with every voxel counted', async () => {
  const pixels = new Int16Array(600 * 600 * 10);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 4096 - 1024;
  const worker = jest.fn(execute);
  const result = await streamVolumeHistogram(() => histogramChunks(pixels), worker);
  const reference = await execute('calcHistogram', { data: pixels, options: result.range });
  expect(result.bins).toEqual(reference.bins);
  expect(result.bins.reduce((a, b) => a + b, 0)).toBe(pixels.length);
  for (const [, { data }] of worker.mock.calls) {
    expect(data.buffer).not.toBe(pixels.buffer);
    expect(data.buffer.byteLength).toBeLessThanOrEqual(HISTOGRAM_CHUNK_VOXELS * 2);
  }
  expect(pixels[4095]).toBe(3071);
});

it('reads image-backed voxels without ever materializing a full volume and stops after disposal', async () => {
  const pixels = new Int16Array([1, 2, 3]);
  const volume: any = { imageIds: ['a', 'b'], voxelManager: {
    getCompleteScalarDataArray: () => { throw new Error('full copy forbidden'); }
  } };
  const read = jest.fn(() => ({ voxelManager: { getScalarData: () => pixels } }));
  const result = await streamVolumeHistogram(volumeHistogramChunks(volume, read), execute);
  expect(result.bins.reduce((a, b) => a + b, 0)).toBe(6);
  expect(pixels).toEqual(new Int16Array([1, 2, 3]));
  const work = jest.fn(execute);
  await expect(streamVolumeHistogram(volumeHistogramChunks(volume, read), work, undefined, () => false)).resolves.toBeUndefined();
  expect(work).toHaveBeenCalledTimes(1);
});

it('handles clipping, empty data and a constant volume', async () => {
  const clipped = await streamVolumeHistogram(() => [new Int16Array([-10, 0, 10, 20])], execute, { min: 0, max: 10 });
  expect(clipped.bins[0]).toBe(1); expect(clipped.bins[255]).toBe(1);
  const constant = await streamVolumeHistogram(() => [new Int16Array([7, 7])], execute);
  expect(constant.maxBinValue).toBe(2);
  await expect(streamVolumeHistogram(() => [], execute)).resolves.toBeUndefined();
});
