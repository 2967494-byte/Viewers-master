import { cache, getWebWorkerManager } from '@cornerstonejs/core';
import { volumeHistogramChunks, streamVolumeHistogram } from './streamVolumeHistogram';

const workerManager = getWebWorkerManager();

const WorkerOptions = {
  maxWorkerInstances: 1,
  autoTerminateOnIdle: {
    enabled: true,
    idleTimeThreshold: 1000,
  },
};

// Register the task
const workerFn = () => {
  return new Worker(new URL('./histogramWorker.js', import.meta.url), {
    name: 'histogram-worker', // name used by the browser to name the worker
  });
};

// Register worker once at module load time
workerManager.registerWorker('histogram-worker', workerFn, WorkerOptions);

const getViewportVolumeHistogram = async (viewport, volume, options?) => {
  const volumeImageData = viewport.getImageData(volume.volumeId);

  if (!volumeImageData) {
    return undefined;
  }

  const chunks = volumeHistogramChunks(volume, id => cache.getImage(id));
  return streamVolumeHistogram(chunks, (task, args) =>
    workerManager.executeTask('histogram-worker', task, args), options,
    () => cache.getVolume(volume.volumeId) === volume);
};

export { getViewportVolumeHistogram };
