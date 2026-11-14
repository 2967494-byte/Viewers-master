import { crosshairHandles, hoveredCrosshairTargets, pointInCrosshairHandle } from './dentalCrosshairHandles';

it('rotates thin slab grips along oblique lines and tests their actual rectangular area', () => {
  const annotation = { data: { handles: {
    slabThicknessPoints: [[[50, 50, 0], { id: 'coronal' }, [0, 0], [100, 100]]],
  } } };
  const [handle] = crosshairHandles({ worldToCanvas: p => p.slice(0, 2) }, annotation);
  expect(handle.width).toBe(36);
  expect(handle.height).toBe(6);
  expect(handle.angle).toBeCloseTo(Math.PI / 4);
  expect(pointInCrosshairHandle(handle, [62, 62], 0)).toBe(true);
  expect(pointInCrosshairHandle(handle, [56, 44], 0)).toBe(false);
});

it('reveals equal-length rotation and slab grips when hovering their line, including slab edges', () => {
  const target = { id: 'axial' };
  const annotation = { data: { handles: {
    slabThicknessPoints: [[[50, 20, 0], target, [0, 20], [100, 20]]],
    rotationPoints: [[[80, 40, 0], target, [0, 40], [100, 40]]],
  } } };
  const handles = crosshairHandles({ worldToCanvas: p => p.slice(0, 2) }, annotation);
  expect(handles.map(handle => handle.width)).toEqual([36, 36]);
  expect([...hoveredCrosshairTargets(annotation, handles, [10, 40])]).toEqual(['axial']);
  expect([...hoveredCrosshairTargets(annotation, handles, [10, 20])]).toEqual(['axial']);
  expect([...hoveredCrosshairTargets(annotation, handles, [10, 70])]).toEqual([]);
  expect([...hoveredCrosshairTargets(annotation, handles)]).toEqual([]);
});

it('avoids overlapping slab grips at minimum thickness and retains distinct thick slab boundaries', () => {
  const entries = [0.05, -0.05, 20, -20].map(y => [[50, y, 0], { id: 'axial' }, [0, y], [100, y]]);
  const handles = crosshairHandles({ worldToCanvas: p => p.slice(0, 2) }, {
    data: { handles: { slabThicknessPoints: entries } },
  });
  expect(handles).toHaveLength(3);
});
