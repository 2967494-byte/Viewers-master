import { recordGpuDiagnostic } from '@ohif/core/src/constants/orbitalGpuDiagnostics';

const installed = new WeakSet<object>();

/** The panorama covers the existing skull canvas; do not ray-cast an invisible volume. */
export default function installHiddenPanoramaRenderGuard(engine: any) {
  if (!engine || installed.has(engine) || typeof engine.renderViewportUsingCustomOrVtkPipeline !== 'function') return;
  installed.add(engine);
  const original = engine.renderViewportUsingCustomOrVtkPipeline;
  const reported = new WeakSet<object>();
  engine.renderViewportUsingCustomOrVtkPipeline = function (viewport, ...args) {
    const wrapper = viewport.element?.parentElement;
    const covered = !document.body.classList.contains('manual-panorama-active') &&
      viewport.id === 'mpr-3d' && wrapper?.classList.contains('viewport-wrapper') &&
      Array.from(wrapper.children).some((child: Element) => child.classList.contains('automatic-panorama-pane'));
    if (covered) {
      if (!reported.has(viewport)) {
        reported.add(viewport);
        recordGpuDiagnostic('hidden-volume-render-skipped');
      }
      // No IMAGE_RENDERED event: a frame was deliberately not rendered.
      return;
    }
    reported.delete(viewport);
    return original.call(this, viewport, ...args);
  };
}
