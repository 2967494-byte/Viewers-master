import { Enums, getEnabledElement } from '@cornerstonejs/core';
import vtkConvolution2DPass from '@kitware/vtk.js/Rendering/OpenGL/Convolution2DPass';
import vtkForwardPass from '@kitware/vtk.js/Rendering/OpenGL/ForwardPass';
import { getImageFilter, getImageFilterStrength, imageFilterKernel, subscribeImageFilter } from '@ohif/core/src/constants/orbitalImageFilters';
import { getRenderingPreference, subscribeRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';

/** Filter the rendered slice on the GPU, before DOM annotations and without touching the volume. */
export default function installViewportImageFilter(element: HTMLElement) {
  const viewport = getEnabledElement(element)?.viewport;
  if (!viewport || (viewport.type !== Enums.ViewportType.ORTHOGRAPHIC && viewport.type !== Enums.ViewportType.STACK)) return;
  const previous = viewport.getRenderPasses;
  let pass, forward;
  const update = () => {
    const kernel = getRenderingPreference() === 'compatibility' ? null : imageFilterKernel(getImageFilter(), getImageFilterStrength());
    if (kernel) {
      if (!pass) {
        forward = vtkForwardPass.newInstance();
        pass = vtkConvolution2DPass.newInstance();
        pass.setKernelDimension(5);
        pass.setDelegates([forward]);
      }
      pass.setKernel(kernel);
    }
    viewport.render();
  };
  const renderPasses = () => getRenderingPreference() === 'compatibility' || getImageFilter() === 'none' ? previous.call(viewport) : [pass];
  viewport.getRenderPasses = renderPasses;
  const unsubscribe = subscribeImageFilter(update);
  const unsubscribePreference = subscribeRenderingPreference(update);
  update();
  return () => {
    unsubscribe();
    unsubscribePreference();
    if (viewport.getRenderPasses === renderPasses) viewport.getRenderPasses = previous;
    const framebuffer = pass?.getFramebuffer();
    framebuffer?.getColorTexture()?.delete();
    framebuffer?.releaseGraphicsResources();
    framebuffer?.delete();
    pass?.delete();
    forward?.delete();
  };
}
