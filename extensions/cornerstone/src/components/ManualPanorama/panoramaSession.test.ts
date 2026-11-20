import { cache } from '@cornerstonejs/core';
import { detectDentalArch } from './automaticArch';
import { reconstructPanorama } from './reconstruction';
import { getPanoramaSession, matchesPanorama, releasePanoramaSessions } from './panoramaSession';

jest.mock('@cornerstonejs/core', () => ({ cache: { getImage: jest.fn() } }));
jest.mock('./automaticArch', () => ({
  ...jest.requireActual('./automaticArch'),
  detectDentalArch: jest.fn(),
}));
jest.mock('./reconstruction', () => ({
  ...jest.requireActual('./reconstruction'),
  reconstructPanorama: jest.fn(),
}));

describe('A shared panorama per decoded volume', () => {
  let viewport, volume;
  const points = [
    [10, 20, 7],
    [20, 10, 7],
    [30, 20, 7],
  ];
  beforeEach(() => {
    jest.clearAllMocks();
    volume = {
      volumeId: 'same-id',
      loadStatus: { loaded: true },
      imageIds: ['a', 'b'],
      metadata: {},
      voxelManager: { numberOfComponents: 1 },
      isDynamicVolume: () => false,
    };
    viewport = {
      getImageData: () => ({
        dimensions: [2, 2, 2],
        imageData: {
          getWorldToIndex: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          indexToWorld: p => p,
        },
      }),
      getProperties: () => ({ voiRange: { lower: -300, upper: 2000 } }),
    };
    (cache.getImage as jest.Mock).mockReturnValue({ voxelManager: { getAtIndex: () => 0 } });
    (detectDentalArch as jest.Mock).mockResolvedValue({ points, sliceZ: 7, support: 0.9 });
    (reconstructPanorama as jest.Mock).mockResolvedValue({
      width: 2,
      height: 2,
      widthMm: 20,
      heightMm: 20,
      pixels: new Float32Array(4),
    });
  });
  it('coalesces startup requests and returns the exact raster and control points on reuse', async () => {
    const session = getPanoramaSession(volume);
    const first = session.ensure(viewport, volume);
    expect(session.ensure(viewport, volume)).toBe(first);
    const value = await first;
    expect(await session.ensure(viewport, volume)).toBe(value);
    expect(value.heightMm).toBe(140);
    expect(value.points).toBe(points);
    expect(value.raster).toBe(await (reconstructPanorama as jest.Mock).mock.results[0].value);
    expect(value.range).toEqual({ lower: -300, upper: 2000 });
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
  });
  it('does not share results between new volume objects even if their ID is the same', async () => {
    const first = getPanoramaSession(volume);
    await first.ensure(viewport, volume);
    const other = getPanoramaSession({ ...volume });
    expect(other).not.toBe(first);
    expect(other.state.snapshot).toBe(null);
  });
  it('rejects incomplete input before analysis and does not repeatedly retry failed analysis', async () => {
    volume.loadStatus.loaded = false;
    expect(() => getPanoramaSession(volume).ensure(viewport, volume)).toThrow('Дождитесь');
    expect(detectDentalArch).not.toHaveBeenCalled();
    volume.loadStatus.loaded = true;
    (detectDentalArch as jest.Mock).mockRejectedValueOnce(new Error('No arch'));
    const session = getPanoramaSession(volume);
    await expect(session.ensure(viewport, volume)).rejects.toThrow('No arch');
    expect(session.state.status).toBe('error');
    expect(reconstructPanorama).not.toHaveBeenCalled();
  });
  it('cancels an obsolete job and never publishes its late result into the new attempt', async () => {
    let finish;
    (detectDentalArch as jest.Mock).mockImplementationOnce(
      ({ signal }) =>
        new Promise((resolve, reject) => {
          finish = resolve;
          signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        })
    );
    const session = getPanoramaSession(volume);
    const old = session.ensure(viewport, volume);
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const signal = (detectDentalArch as jest.Mock).mock.calls[0][0].signal;
    session.invalidate();
    expect(signal.aborted).toBe(true);
    const fresh = await session.ensure(viewport, volume);
    finish({ points, sliceZ: 7 });
    await rejected;
    expect(session.state.snapshot).toBe(fresh);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
  });
  it('invalidates geometry/parameters while allowing display-only changes to reuse the raster', async () => {
    const session = getPanoramaSession(volume);
    const value = await session.ensure(viewport, volume);
    expect(matchesPanorama(value, value.points, value.up, value)).toBe(true);
    expect(matchesPanorama(value, [...value.points], value.up, value)).toBe(false);
    expect(matchesPanorama(value, value.points, value.up, { ...value, thickness: 30 })).toBe(false);
    expect(matchesPanorama(value, value.points, value.up, { ...value, heightMm: 80 })).toBe(false);
    expect(matchesPanorama(value, value.points, [0, 1, 0], value)).toBe(false);
    session.publish({ ...value, sharpness: 10, range: { lower: 0, upper: 1000 } });
    expect(matchesPanorama(session.state.snapshot, value.points, value.up, value)).toBe(true);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
  });
  it('releases editor work and computed rasters on study exit', async () => {
    const session = getPanoramaSession(volume);
    await session.ensure(viewport, volume);
    const editor = new AbortController(); session.reserveEditor(editor);
    releasePanoramaSessions();
    expect(editor.signal.aborted).toBe(true);
    expect(session.state.snapshot).toBeNull();
    expect(session.sections).toBeNull();
    expect(getPanoramaSession(volume)).not.toBe(session);
  });
});
