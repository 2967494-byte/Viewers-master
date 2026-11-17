import { getEnabledElement } from '@cornerstonejs/core';
import vtkConvolution2DPass from '@kitware/vtk.js/Rendering/OpenGL/Convolution2DPass';
import { filterImagePixels, imageFilterKernel, setImageFilterStrength, setImageFilter } from '@ohif/core/src/constants/orbitalImageFilters';
import installViewportImageFilter from './viewportImageFilter';

jest.mock('@cornerstonejs/core', () => ({
  getEnabledElement: jest.fn(), Enums: { ViewportType: { ORTHOGRAPHIC: 'mpr', STACK: 'stack' } },
}));
jest.mock('@kitware/vtk.js/Rendering/OpenGL/Convolution2DPass', () => ({
  __esModule: true, default: { newInstance: jest.fn(() => ({
    setKernelDimension: jest.fn(), setDelegates: jest.fn(), setKernel: jest.fn(),
    getFramebuffer: jest.fn(), delete: jest.fn(),
  })) },
}));
jest.mock('@kitware/vtk.js/Rendering/OpenGL/ForwardPass', () => ({
  __esModule: true, default: { newInstance: () => ({ delete: jest.fn() }) },
}));

describe('Shared display filters and GPU render pass lifecycle', () => {
  afterEach(() => { setImageFilter('none'); jest.clearAllMocks(); });
  it('preserves uniform brightness, keeps source bytes and distinguishes smoothing and both sharpening modes', () => {
    for (const mode of ['smooth', 'sharpen', 'unsharp'] as const) {
      expect(imageFilterKernel(mode).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
      const uniform = new Uint8ClampedArray(49).fill(80);
      expect([...filterImagePixels(uniform, 7, 7, mode)]).toEqual([...uniform]);
    }
    const image = new Uint8ClampedArray(49).fill(64);
    image[24] = 128;
    const source = image.slice();
    const smooth = filterImagePixels(image, 7, 7, 'smooth');
    const sharpen = filterImagePixels(image, 7, 7, 'sharpen');
    const unsharp = filterImagePixels(image, 7, 7, 'unsharp');
    expect(smooth[24]).toBeLessThan(image[24]);
    expect(smooth[23]).toBeGreaterThan(image[23]);
    expect(sharpen[24]).toBeGreaterThan(image[24]);
    expect(unsharp[24]).toBeGreaterThan(image[24]);
    expect([...unsharp]).not.toEqual([...sharpen]);
    expect(image).toEqual(source);
    expect(filterImagePixels(image, 7, 7, 'none')).toBe(image);
  });
  it('shares the selected filter across viewports, reuses the GPU pass, and restores the renderer on cleanup', () => {
    const original = jest.fn(() => null);
    const viewport = { type: 'mpr', getRenderPasses: original, render: jest.fn() };
    (getEnabledElement as jest.Mock).mockReturnValue({ viewport });
    const cleanup = installViewportImageFilter(document.createElement('div'));
    expect(viewport.getRenderPasses()).toBeNull();
    setImageFilter('smooth');
    const [pass] = viewport.getRenderPasses();
    expect(pass.setKernel).toHaveBeenLastCalledWith(imageFilterKernel('smooth'));
    setImageFilter('unsharp');
    expect(viewport.getRenderPasses()[0]).toBe(pass);
    expect(vtkConvolution2DPass.newInstance).toHaveBeenCalledTimes(1);
    const second = { type: 'mpr', getRenderPasses: jest.fn(() => null), render: jest.fn() };
    (getEnabledElement as jest.Mock).mockReturnValue({ viewport: second });
    const cleanupSecond = installViewportImageFilter(document.createElement('div'));
    expect(second.getRenderPasses()[0].setKernel).toHaveBeenLastCalledWith(imageFilterKernel('unsharp'));
    const secondPass = second.getRenderPasses()[0];
    setImageFilterStrength(.35);
    expect(viewport.getRenderPasses()[0]).toBe(pass);
    expect(second.getRenderPasses()[0]).toBe(secondPass);
    expect(pass.setKernel).toHaveBeenLastCalledWith(imageFilterKernel('unsharp', .35));
    setImageFilter('none');
    expect(viewport.getRenderPasses()).toBeNull();
    expect(second.getRenderPasses()).toBeNull();
    cleanup(); cleanupSecond();
    expect(viewport.getRenderPasses).toBe(original);
    expect(pass.delete).toHaveBeenCalledTimes(1);
    const renders = viewport.render.mock.calls.length;
    setImageFilter('sharpen');
    expect(viewport.render).toHaveBeenCalledTimes(renders);
  });
  it('leaves the 3D renderer untouched', () => {
    const original = jest.fn();
    const viewport = { type: '3d', getRenderPasses: original, render: jest.fn() };
    (getEnabledElement as jest.Mock).mockReturnValue({ viewport });
    expect(installViewportImageFilter(document.createElement('div'))).toBeUndefined();
    setImageFilter('sharpen');
    expect(viewport.getRenderPasses).toBe(original);
    expect(viewport.render).not.toHaveBeenCalled();
    expect(vtkConvolution2DPass.newInstance).not.toHaveBeenCalled();
  });
});

it('blends sharpening continuously, preserves a uniform image and bypasses at zero', () => {
  const full = imageFilterKernel('unsharp');
  const half = imageFilterKernel('unsharp', .5);
  expect(half[12]).toBeCloseTo(1 + (full[12]-1)*.5);
  expect(half[6]).toBeCloseTo(full[6]*.5);
  expect(half.reduce((sum,v) => sum+v,0)).toBeCloseTo(1);
  const pixels = new Uint8ClampedArray(49).fill(110);
  expect([...filterImagePixels(pixels,7,7,'unsharp',.37)]).toEqual([...pixels]);
  expect(filterImagePixels(pixels,7,7,'unsharp',0)).toBe(pixels);
});
