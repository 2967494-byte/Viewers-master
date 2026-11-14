const planarIds = new Set(['mpr-coronal', 'mpr-sagittal', 'mpr-axial']);

/** Keep the physical slice, relative zoom and normalized crosshair anchor on resize. */
export default function preserveMprResize(viewports: any[], getCenter: (id: string) => number[], resize: () => void) {
  const ratio = window.devicePixelRatio || 1;
  const snapshots = viewports.filter(viewport => planarIds.has(viewport.id)).flatMap(viewport => {
    if (typeof viewport.getVolumeId !== 'function') return [];
    const point = getCenter(viewport.id);
    const { width, height } = viewport.canvas;
    if (!point?.every(Number.isFinite) || point.length !== 3 || width <= 0 || height <= 0 || !viewport.getVolumeId()) return [];
    const canvasPoint = viewport.worldToCanvas(point);
    const zoom = viewport.getZoom();
    if (!Number.isFinite(zoom) || zoom <= 0 || !canvasPoint.every(Number.isFinite)) return [];
    return [{ viewport, point: [...point], camera: viewport.getCamera(), zoom,
      volumeId: viewport.getVolumeId(), suppressEvents: viewport.suppressEvents,
      // Intrinsic canvas size still describes the OLD renderer. DOM clientWidth
      // already describes the NEW layout when ResizeObserver invokes this code.
      anchor: [canvasPoint[0] * ratio / width, canvasPoint[1] * ratio / height] }];
  });
  snapshots.forEach(({ viewport }) => { viewport.suppressEvents = true; });
  try {
    resize();
    snapshots.forEach(({ viewport, camera, zoom, point, anchor, volumeId }) => {
      if (viewport.getVolumeId() !== volumeId || viewport.canvas.width <= 0 || viewport.canvas.height <= 0) return;
      viewport.setCameraNoEvent(camera);
      viewport.setZoom(zoom);
      const current = viewport.canvasToWorld(viewport.worldToCanvas(point));
      const target = viewport.canvasToWorld([
        anchor[0] * viewport.canvas.width / ratio,
        anchor[1] * viewport.canvas.height / ratio,
      ]);
      const moved = viewport.getCamera();
      const normal = moved.viewPlaneNormal;
      const delta = current.map((value, i) => value - target[i]);
      const along = delta.reduce((sum, value, i) => sum + value * normal[i], 0);
      const pan = delta.map((value, i) => value - along * normal[i]);
      viewport.setCameraNoEvent({
        focalPoint: moved.focalPoint.map((value, i) => value + pan[i]),
        position: moved.position.map((value, i) => value + pan[i]),
      });
    });
  } finally {
    snapshots.forEach(({ viewport, suppressEvents }) => { viewport.suppressEvents = suppressEvents; });
  }
  // Refresh native annotation camera metadata only after every plane is restored.
  // No temporary fit-to-volume camera may change the shared physical crosshair.
  snapshots.forEach(({ viewport }) => viewport.setCamera(viewport.getCamera()));
}
