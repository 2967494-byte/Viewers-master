export const HISTOGRAM_CHUNK_VOXELS = 256 * 1024;

export function* histogramChunks(data: any) {
  for (let offset = 0; offset < data.length; offset += HISTOGRAM_CHUNK_VOXELS) {
    // A subarray's structured clone copies its ENTIRE underlying buffer.
    // Copy just this bounded chunk before posting to the worker.
    yield data.slice(offset, offset + HISTOGRAM_CHUNK_VOXELS);
  }
}

export function volumeHistogramChunks(volume: any, getImage: (id: string) => any) {
  const imageIds = volume.isDynamicVolume?.()
    ? volume.getCurrentDimensionGroupImageIds()
    : volume.imageIds;
  return function* chunks() {
    const existing = volume.scalarData ?? volume.voxelManager?.scalarData;
    const sources = existing ? [null] : imageIds || [];
    for (const id of sources) {
      const image = id == null ? undefined : getImage(id);
      const data = existing ?? image?.voxelManager?.getScalarData() ?? image?.getPixelData?.();
      if (data?.length) yield* histogramChunks(data);
    }
  };
}

/** Never concatenate slices or transfer/detach buffers used by the renderer. */
export async function streamVolumeHistogram(
  chunks: () => Iterable<ArrayLike<number>>,
  execute: (task: string, args: any) => Promise<any>,
  options?: { min?: number; max?: number },
  isCurrent = () => true
) {
  let min = Infinity, max = -Infinity;
  for (const data of chunks()) {
    const range = await execute('getChunkRange', { data });
    if (!isCurrent()) return undefined;
    min = Math.min(min, range.minimum);
    max = Math.max(max, range.maximum);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  min = Math.max(min, options?.min ?? min);
  max = Math.min(max, options?.max ?? max);
  const bins = new Int32Array(256);
  for (const data of chunks()) {
    const part = await execute('calcHistogram', { data, options: { numBins: 256, min, max } });
    if (!isCurrent()) return undefined;
    for (let i = 0; i < bins.length; i++) bins[i] += part.bins[i];
  }
  let maxBin = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[maxBin]) maxBin = i;
  return { numBins: 256, range: { min, max }, bins, maxBin, maxBinValue: bins[maxBin] };
}
