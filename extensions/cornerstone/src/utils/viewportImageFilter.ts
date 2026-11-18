import { Enums, getEnabledElement } from '@cornerstonejs/core';
import vtkConvolution2DPass from '@kitware/vtk.js/Rendering/OpenGL/Convolution2DPass';
import vtkForwardPass from '@kitware/vtk.js/Rendering/OpenGL/ForwardPass';
import { disableImageFilterAfterFailure, getImageFilter, getImageFilterStrength, imageFilterKernel, subscribeImageFilter } from '@ohif/core/src/constants/orbitalImageFilters';
import { getRenderingPreference, subscribeRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import guardImageFilterPass from './guardImageFilterPass';

const resets = new WeakMap<object, () => void>();
export const resetViewportImageFilter = (viewport: object) => resets.get(viewport)?.();

/** Filter the rendered slice on the GPU, before DOM annotations and without touching the volume. */
export default function installViewportImageFilter(element: HTMLElement) {
  const viewport = getEnabledElement(element)?.viewport;
  if (!viewport || (viewport.type !== Enums.ViewportType.ORTHOGRAPHIC && viewport.type !== Enums.ViewportType.STACK)) return;
  const previous = viewport.getRenderPasses;
  let disposed = false;
  let pass, forward;
  let guardedPass;
  let activeKernel: number[];
  let validatePass: (() => void) | undefined;
  const resetPass = () => {
    const framebuffer = pass?.getFramebuffer();
    framebuffer?.getColorTexture()?.delete();
    framebuffer?.releaseGraphicsResources();
    framebuffer?.delete();
    pass?.delete();
    forward?.delete();
    pass = forward = guardedPass = activeKernel = validatePass = undefined;
  };
  resets.set(viewport, resetPass);
  const update = () => {
    const kernel = getRenderingPreference() === 'compatibility' ? null : imageFilterKernel(getImageFilter(), getImageFilterStrength());
    if (kernel) {
      if (!pass) {
        forward = vtkForwardPass.newInstance();
        pass = vtkConvolution2DPass.newInstance();
        pass.setKernelDimension(5);
        activeKernel = kernel;
        pass.setKernel(activeKernel);
        const guard = guardImageFilterPass(pass, forward, () => {
          // Do not change render passes or recursively render during a traversal.
          queueMicrotask(() => { if (!disposed) disableImageFilterAfterFailure(); });
        });
        guardedPass = guard.pass;
        validatePass = guard.validate;
      }
      // VTK rebuilds its screen quad when setKernel modifies the pass. Only the
      // uniform coefficients change here; keep the quad/shader and array alive.
      kernel.forEach((weight, index) => { activeKernel[index] = weight; });
      validatePass();
    }
    viewport.render();
  };
  const renderPasses = () => getRenderingPreference() === 'compatibility' || getImageFilter() === 'none' ? previous.call(viewport) : [guardedPass];
  viewport.getRenderPasses = renderPasses;
  const unsubscribe = subscribeImageFilter(update);
  const unsubscribePreference = subscribeRenderingPreference(update);
  update();
  return () => {
    disposed = true;
    unsubscribe();
    unsubscribePreference();
    if (viewport.getRenderPasses === renderPasses) viewport.getRenderPasses = previous;
    resets.delete(viewport);
    resetPass();
  };
}
