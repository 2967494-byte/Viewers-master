import zoomMprViewport from './zoomMprViewport';

function fixture() {
  let scale = 100, pan = [0, 0];
  const camera = { focalPoint: [50, 50, 20], viewPlaneNormal: [0, 0, -1], parallelScale: scale };
  return {
    getCamera: () => ({ ...camera, parallelScale: scale }), getZoom: () => 100 / scale,
    setCamera: jest.fn(update => { scale = update.parallelScale; }),
    worldToCanvas: p => [(p[0] - 50) * 100 / scale + 200 + pan[0], (p[1] - 50) * 100 / scale + 150 + pan[1]],
    getPan: () => [...pan], setPan: jest.fn(p => { pan = p; }), render: jest.fn(),
  };
}

it('zooms only the chosen viewport, keeping an off-center crosshair at the same screen point', () => {
  const viewport = fixture(), other = fixture(), point = [75, 30, 20];
  const before = viewport.worldToCanvas(point), camera = viewport.getCamera();
  expect(zoomMprViewport(viewport, 1.25, point)).toBe(true);
  expect(viewport.getZoom()).toBeCloseTo(1.25);
  expect(viewport.worldToCanvas(point)).toEqual(before);
  expect(viewport.getCamera().focalPoint).toEqual(camera.focalPoint);
  expect(viewport.getCamera().viewPlaneNormal).toEqual(camera.viewPlaneNormal);
  expect(other.getZoom()).toBe(1);
  expect(zoomMprViewport(viewport, 0.8, point)).toBe(true);
  expect(viewport.getZoom()).toBeCloseTo(1);
  expect(viewport.worldToCanvas(point)).toEqual(before);
});

it('bounds zoom and ignores invalid factors', () => {
  const viewport = fixture();
  expect(zoomMprViewport(viewport, Infinity)).toBe(false);
  expect(zoomMprViewport(viewport, -1)).toBe(false);
  zoomMprViewport(viewport, 100);
  expect(viewport.getZoom()).toBe(12);
  expect(zoomMprViewport(viewport, 1.25)).toBe(false);
  zoomMprViewport(viewport, 0.00001);
  expect(viewport.getZoom()).toBe(0.25);
  viewport.setCamera({ parallelScale: 5 });
  expect(zoomMprViewport(viewport, 1.25)).toBe(false);
  expect(viewport.getZoom()).toBe(20);
  viewport.setCamera({ parallelScale: 1000 });
  expect(zoomMprViewport(viewport, 0.8)).toBe(false);
  expect(viewport.getZoom()).toBe(0.1);
});
