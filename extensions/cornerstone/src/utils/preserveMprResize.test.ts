import preserveMprResize from './preserveMprResize';
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(id = 'mpr-axial') {
  let camera = { focalPoint: [25, 40, 20], position: [25, 40, 120],
    viewPlaneNormal: [0, 0, 1], viewUp: [0, -1, 0], parallelScale: 40 };
  let initialScale = 80;
  const viewport = {
    id, canvas: { width: 800, height: 400 }, suppressEvents: false,
    getVolumeId: () => 'same-volume',
    getCamera: () => clone(camera),
    setCameraNoEvent: update => { camera = { ...camera, ...clone(update) }; },
    setCamera: jest.fn(update => { camera = { ...camera, ...clone(update) }; }),
    getZoom: () => initialScale / camera.parallelScale,
    setZoom: zoom => { camera.parallelScale = initialScale / zoom; },
    worldToCanvas: point => [
      viewport.canvas.width / 2 + (point[0] - camera.focalPoint[0]) * viewport.canvas.height / (2 * camera.parallelScale),
      viewport.canvas.height / 2 + (point[1] - camera.focalPoint[1]) * viewport.canvas.height / (2 * camera.parallelScale),
    ],
    canvasToWorld: point => [
      camera.focalPoint[0] + (point[0] - viewport.canvas.width / 2) * (2 * camera.parallelScale) / viewport.canvas.height,
      camera.focalPoint[1] + (point[1] - viewport.canvas.height / 2) * (2 * camera.parallelScale) / viewport.canvas.height,
      camera.focalPoint[2],
    ],
    resize: (width, height) => {
      viewport.canvas = { width, height }; initialScale = 100;
      viewport.setCameraNoEvent({ focalPoint: [50, 50, 50], position: [50, 50, 150], parallelScale: 100 });
    },
  };
  return viewport;
}

it('keeps an off-center physical point and relative zoom through expand, collapse and repeated resizes', () => {
  const viewport = fixture(), point = Object.freeze([45, 30, 20]);
  const normalized = () => viewport.worldToCanvas(point).map((v, i) => v / [viewport.canvas.width, viewport.canvas.height][i]);
  const before = normalized(), camera = viewport.getCamera(), zoom = viewport.getZoom();
  for (const size of [[1200, 800], [800, 400], [1200, 800], [800, 400]]) {
    preserveMprResize([viewport], () => point as any, () => {
      expect(viewport.suppressEvents).toBe(true);
      viewport.resize(size[0], size[1]);
      viewport.resize(size[0], size[1]);
    });
    normalized().forEach((value, i) => expect(value).toBeCloseTo(before[i], 8));
    expect(viewport.getZoom()).toBe(zoom);
    expect(viewport.getCamera().focalPoint[2]).toBe(camera.focalPoint[2]);
    expect(viewport.getCamera().viewPlaneNormal).toEqual(camera.viewPlaneNormal);
    expect(viewport.suppressEvents).toBe(false);
  }
});

it('restores event suppression on failure and leaves unrelated viewports alone', () => {
  const viewport = fixture(), other = fixture('other');
  expect(() => preserveMprResize([viewport, other], () => [45, 30, 20], () => {
    expect(other.suppressEvents).toBe(false);
    throw Error('resize interrupted');
  })).toThrow('resize interrupted');
  expect(viewport.suppressEvents).toBe(false);
  expect(other.setCamera).not.toHaveBeenCalled();
});

it('skips unloaded volumes rather than resetting their camera', () => {
  const viewport = fixture(); viewport.getVolumeId = () => undefined;
  const stack = { ...fixture('mpr-sagittal'), getVolumeId: undefined };
  const resize = jest.fn();
  preserveMprResize([viewport, stack], () => [45, 30, 20], resize);
  expect(resize).toHaveBeenCalledTimes(1);
  expect(viewport.setCamera).not.toHaveBeenCalled();
  expect(stack.setCamera).not.toHaveBeenCalled();
});
