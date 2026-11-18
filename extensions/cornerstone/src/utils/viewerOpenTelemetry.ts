import { getGraphicsRecovery } from '@ohif/core/src/constants/orbitalGraphicsRecovery';
import { graphicsContextRecovery } from './adaptiveVolumeTexture';
import { cache } from '@cornerstonejs/core';
import { getViewerOpenTracker, MPR_TELEMETRY_IDS } from '@ohif/core/src/constants/orbitalOpenTelemetry';
import { getViewerDiagnostics, recordViewerDraw, recordViewerEvent } from '@ohif/core/src/constants/orbitalViewerDiagnostics';

const installed = new WeakSet<object>();
/** Observe completed native MPR draws, not React mounting or the hidden 3D viewport. */
export function installViewerOpenTelemetry(engine: any) {
  if (!engine || installed.has(engine) || typeof engine.renderViewportUsingCustomOrVtkPipeline !== 'function') return;
  installed.add(engine);
  const original = engine.renderViewportUsingCustomOrVtkPipeline;
  engine.renderViewportUsingCustomOrVtkPipeline = function(viewport, ...args) {
    if (getGraphicsRecovery() === 'waiting') return;
    const timed = getViewerDiagnostics()?.manual;
    const before = timed ? performance.now() : 0;
    const result = original.call(this, viewport, ...args);
    if (result?.element) recordViewerDraw(viewport.id, viewport.canvas?.width || 0, viewport.canvas?.height || 0,
      timed ? performance.now() - before : undefined);
    const tracker = getViewerOpenTracker();
    if (result?.element && MPR_TELEMETRY_IDS.includes(viewport.id)) {
      const volume = cache.getVolume(viewport.getVolumeId?.());
      const gl = volume?.vtkOpenGLTexture?.get?.()?.context;
      if (gl && !gl.isContextLost?.() && viewport.canvas?.width > 0 && viewport.canvas?.height > 0) {
        const code = getGraphicsRecovery() === 'rebuilding' ? gl.getError?.() : 0;
        if (code) {
          recordViewerEvent('allocation-error', { code });
          graphicsContextRecovery.fail(20006);
          return result;
        }
        tracker?.frame(viewport.id);
        graphicsContextRecovery.frame(viewport.id);
      }
    }
    return result;
  };
}
