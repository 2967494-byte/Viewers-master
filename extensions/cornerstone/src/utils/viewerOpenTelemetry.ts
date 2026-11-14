import { cache } from '@cornerstonejs/core';
import { getViewerOpenTracker, MPR_TELEMETRY_IDS } from '@ohif/core/src/constants/orbitalOpenTelemetry';

const installed = new WeakSet<object>();
/** Observe completed native MPR draws, not React mounting or the hidden 3D viewport. */
export function installViewerOpenTelemetry(engine: any) {
  if (!engine || installed.has(engine) || typeof engine.renderViewportUsingCustomOrVtkPipeline !== 'function') return;
  installed.add(engine);
  const original = engine.renderViewportUsingCustomOrVtkPipeline;
  engine.renderViewportUsingCustomOrVtkPipeline = function(viewport, ...args) {
    const result = original.call(this, viewport, ...args);
    const tracker = getViewerOpenTracker();
    if (tracker && result?.element && MPR_TELEMETRY_IDS.includes(viewport.id)) {
      const volume = cache.getVolume(viewport.getVolumeId?.());
      const gl = volume?.vtkOpenGLTexture?.get?.()?.context;
      if (gl && !gl.isContextLost?.() && viewport.canvas?.width > 0 && viewport.canvas?.height > 0) tracker.frame(viewport.id);
    }
    return result;
  };
}
