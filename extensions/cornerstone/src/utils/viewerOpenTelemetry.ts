import { cache } from '@cornerstonejs/core';
import { getViewerOpenTracker, MPR_TELEMETRY_IDS } from '@ohif/core/src/constants/orbitalOpenTelemetry';
import { getViewerDiagnostics, recordViewerDraw } from '@ohif/core/src/constants/orbitalViewerDiagnostics';

const installed = new WeakSet<object>();
/** Observe completed native MPR draws, not React mounting or the hidden 3D viewport. */
export function installViewerOpenTelemetry(engine: any) {
  if (!engine || installed.has(engine) || typeof engine.renderViewportUsingCustomOrVtkPipeline !== 'function') return;
  installed.add(engine);
  const original = engine.renderViewportUsingCustomOrVtkPipeline;
  engine.renderViewportUsingCustomOrVtkPipeline = function(viewport, ...args) {
    const timed = getViewerDiagnostics()?.manual;
    const before = timed ? performance.now() : 0;
    const result = original.call(this, viewport, ...args);
    if (result?.element) recordViewerDraw(viewport.id, viewport.canvas?.width || 0, viewport.canvas?.height || 0,
      timed ? performance.now() - before : undefined);
    const tracker = getViewerOpenTracker();
    if (tracker && result?.element && MPR_TELEMETRY_IDS.includes(viewport.id)) {
      const volume = cache.getVolume(viewport.getVolumeId?.());
      const gl = volume?.vtkOpenGLTexture?.get?.()?.context;
      if (gl && !gl.isContextLost?.() && viewport.canvas?.width > 0 && viewport.canvas?.height > 0) tracker.frame(viewport.id);
    }
    return result;
  };
}
