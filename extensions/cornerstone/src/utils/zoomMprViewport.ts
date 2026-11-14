/** Zoom one camera around a physical point without moving any image plane. */
export default function zoomMprViewport(viewport: any, factor: number, point?: number[]): boolean {
  if (!viewport || !Number.isFinite(factor) || factor <= 0 || factor === 1) return false;
  const camera = viewport.getCamera();
  const zoom = viewport.getZoom();
  if (!(camera.parallelScale > 0) || !(zoom > 0)) return false;
  const nextZoom = Math.max(0.25, Math.min(12, zoom * factor));
  // Manual mouse zoom can exceed the button limits. Never make + zoom out or
  // − zoom in when bringing such a camera back into the supported range.
  if ((factor > 1 && nextZoom <= zoom) || (factor < 1 && nextZoom >= zoom)) return false;
  if (Math.abs(nextZoom - zoom) < 1e-8) return false;
  const anchor = point?.length === 3 && point.every(Number.isFinite) ? point : camera.focalPoint;
  const before = viewport.worldToCanvas(anchor);
  viewport.setCamera({ parallelScale: camera.parallelScale * zoom / nextZoom });
  const after = viewport.worldToCanvas(anchor);
  const pan = viewport.getPan();
  viewport.setPan([pan[0] + before[0] - after[0], pan[1] + before[1] - after[1]]);
  viewport.render();
  return true;
}
