import { cache } from '@cornerstonejs/core';
import { runVolumeBackgroundWork } from '../../utils/volumeBackgroundWork';
import { detectDentalArch, volumeWorldBounds } from './automaticArch';
import {
  buildCurve,
  createTrilinearSampler,
  reconstructPanorama,
  type Curve,
  type Point3,
  type Raster,
  type Sampler,
} from './reconstruction';

export type PanoramaSettings = { thickness: number; heightMm: number; projection: 'mean' | 'mip' };
export type PanoramaSnapshot = PanoramaSettings & {
  points: Point3[];
  curve: Curve;
  up: Point3;
  raster: Raster;
  range: { lower: number; upper: number };
  sharpness: number;
  center: number;
  step: number;
  coverageWarning: string;
};
type SectionResult = Awaited<ReturnType<typeof import('./reconstruction').reconstructSections>>;
type SessionState = {
  status: 'idle' | 'working' | 'ready' | 'error';
  progress: number;
  snapshot: PanoramaSnapshot | null;
  error: string;
};

export function matchesPanorama(
  value: PanoramaSnapshot | null,
  points: Point3[],
  up: Point3,
  settings: PanoramaSettings
) {
  return (
    !!value &&
    value.points === points &&
    value.up.every((v, i) => v === up[i]) &&
    value.thickness === settings.thickness &&
    value.heightMm === settings.heightMm &&
    value.projection === settings.projection
  );
}

/** Read existing decoded slices; retain no second full-volume voxel buffer. */
export function panoramaInput(viewport, volume) {
  if (!volume?.loadStatus.loaded) throw new Error('Дождитесь полной загрузки исследования.');
  if (
    volume.isDynamicVolume?.() ||
    volume.voxelManager?.numberOfComponents > 1 ||
    volume.metadata?.SamplesPerPixel > 1
  )
    throw new Error('Выберите обычную серию КТ / КЛКТ.');
  const data = viewport.getImageData();
  const slices = volume.imageIds.map(id => cache.getImage(id)?.voxelManager);
  if (slices.length !== data.dimensions[2] || slices.some(slice => !slice))
    throw new Error('Не все срезы доступны. Дождитесь полной загрузки.');
  const sample: Sampler = createTrilinearSampler(
    data.dimensions,
    data.imageData.getWorldToIndex(),
    (i, j, k) => slices[k].getAtIndex(j * data.dimensions[0] + i) as number
  );
  return {
    sample,
    bounds: volumeWorldBounds(data.dimensions, p => data.imageData.indexToWorld(p)),
  };
}

/** One in-memory result per actual cached volume object, released with that volume. */
export class PanoramaSession {
  state: SessionState = { status: 'idle', progress: 0, snapshot: null, error: '' };
  pending: Promise<PanoramaSnapshot> | null = null;
  private controller: AbortController | null = null;
  private editorController: AbortController | null = null;
  private releaseEditor = () => {};
  private listeners = new Set<() => void>();
  sections: {
    points: Point3[];
    up: Point3;
    heightMm: number;
    center: number;
    step: number;
    result: SectionResult;
  } | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(state: SessionState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
  publish(snapshot: PanoramaSnapshot) {
    this.releaseEditor();
    this.emit({ status: 'ready', progress: 100, snapshot, error: '' });
  }
  cancel() {
    this.editorController?.abort();
    this.releaseEditor();
    if (!this.controller) return;
    this.controller?.abort();
    this.controller = null;
    this.pending = null;
    if (this.state.status === 'working')
      this.emit({ ...this.state, status: this.state.snapshot ? 'ready' : 'idle', progress: 0 });
  }
  invalidate() {
    this.cancel();
    this.sections = null;
    this.emit({ status: 'idle', progress: 0, snapshot: null, error: '' });
  }
  reserveEditor(controller: AbortController) {
    this.releaseEditor();
    this.editorController = controller;
    const abort = () => {
      this.releaseEditor();
      this.emit({ ...this.state, status: this.state.snapshot ? 'ready' : 'idle', progress: 0 });
    };
    controller.signal.addEventListener('abort', abort, { once: true });
    this.releaseEditor = () => {
      controller.signal.removeEventListener('abort', abort);
      this.editorController = null;
      this.releaseEditor = () => {};
    };
    this.emit({ ...this.state, status: 'working', progress: 0, error: '' });
  }
  reportEditor(controller: AbortController, progress: number) {
    if (this.editorController === controller) this.emit({ ...this.state, progress });
  }
  ensure(viewport, volume): Promise<PanoramaSnapshot> {
    if (this.pending) return this.pending;
    if (this.state.snapshot) return Promise.resolve(this.state.snapshot);
    // Validation precedes the working state so callers can wait for the remaining slices.
    let input: ReturnType<typeof panoramaInput>;
    try {
      input = panoramaInput(viewport, volume);
    } catch (error) {
      this.emit({ status: 'error', progress: 0, snapshot: null, error: error.message });
      throw error;
    }
    return this.start(viewport,
      options => detectDentalArch({ ...input, ...options }),
      options => reconstructPanorama({ ...options, sample: input.sample }));
  }
  private start(viewport, findArch, render): Promise<PanoramaSnapshot> {
    if (this.pending) return this.pending;
    if (this.state.snapshot) return Promise.resolve(this.state.snapshot);
    const controller = new AbortController();
    this.controller = controller;
    const current = () => this.controller === controller && !controller.signal.aborted;
    this.emit({ status: 'working', progress: 0, snapshot: null, error: '' });
    const report = (progress: number) => {
      if (current()) this.emit({ ...this.state, progress: Math.round(progress) });
    };
    this.pending = runVolumeBackgroundWork(async () => {
      try {
        const arch = await findArch({
          signal: controller.signal,
          onProgress: percent => report(percent * 0.6),
        });
        if (!current()) throw new DOMException('Cancelled', 'AbortError');
        const curve = buildCurve(arch.points);
        const up: Point3 = [0, 0, 1];
        const settings: PanoramaSettings = { thickness: 20, heightMm: 140, projection: 'mean' };
        const raster = await render({
          curve,
          up,
          ...settings,
          mode: settings.projection,
          signal: controller.signal,
          onProgress: percent => report(60 + percent * 0.4),
        });
        if (!current()) throw new DOMException('Cancelled', 'AbortError');
        const voi = viewport.getProperties()?.voiRange;
        const snapshot: PanoramaSnapshot = {
          ...settings,
          points: arch.points,
          curve,
          up,
          raster,
          range: voi && voi.upper > voi.lower ? { ...voi } : { lower: -500, upper: 2500 },
          sharpness: 5,
          center: curve.length / 2,
          step: 2,
          coverageWarning: arch.coverageWarning || '',
        };
        this.publish(snapshot);
        return snapshot;
      } catch (error) {
        if (current())
          this.emit({ status: 'error', progress: 0, snapshot: null, error: error.message });
        throw error;
      } finally {
        if (this.controller === controller) {
          this.pending = null;
          this.controller = null;
        }
      }
    }, controller.signal);
    return this.pending;
  }
}

let sessions = new WeakMap<object, PanoramaSession>();
const liveSessions = new Set<PanoramaSession>();
export function releasePanoramaSessions() {
  liveSessions.forEach(session => session.invalidate());
  liveSessions.clear();
  sessions = new WeakMap();
}
export function getPanoramaSession(volume: object): PanoramaSession {
  let session = sessions.get(volume);
  if (!session) {
    session = new PanoramaSession();
    sessions.set(volume, session);
    liveSessions.add(session);
  }
  return session;
}
