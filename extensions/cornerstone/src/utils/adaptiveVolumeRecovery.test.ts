import { cache, getRenderingEngines } from '@cornerstonejs/core';
import { configureAdaptiveVolumeTexture, graphicsContextRecovery } from './adaptiveVolumeTexture';
import { getGraphicsRecovery } from '@ohif/core/src/constants/orbitalGraphicsRecovery';
import { getGraphicsError, setRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { ViewerOpenTracker, getViewerOpenTracker } from '@ohif/core/src/constants/orbitalOpenTelemetry';
jest.mock('@cornerstonejs/core', () => ({ cache: { getVolume: jest.fn() }, getRenderingEngines: jest.fn(() => []) }));
jest.mock('@ohif/core/src/constants/orbitalOpenTelemetry', () => ({
  ...jest.requireActual('@ohif/core/src/constants/orbitalOpenTelemetry'), getViewerOpenTracker: jest.fn(),
}));
it('rebuilds frozen VTK APIs from cached voxels, preserves explicit quality and stops after a second loss', () => {
  jest.useFakeTimers();
  const canvas = document.createElement('canvas');
  const gl = { canvas, isContextLost: () => false, getError: () => 0, depthMask: jest.fn(), blendFuncSeparate: jest.fn(), depthFunc: jest.fn(), enable: jest.fn() };
  const model: any = { context: gl, _openGLRenderWindow: {} };
  const texture = Object.freeze({ get: () => model, releaseGraphicsResources: jest.fn(), modified: jest.fn() });
  const voxels = new Int16Array([100, 200]);
  const volume: any = { dimensions: [600, 600, 300], vtkOpenGLTexture: texture, voxelManager: { getScalarData: () => voxels } };
  const ids = ['mpr-coronal', 'mpr-sagittal', 'mpr-axial'];
  const window = Object.freeze({ getCanvas: () => canvas, releaseGraphicsResources: jest.fn(),
    prepareNodes: jest.fn(), removeUnusedNodes: jest.fn(), get: () => ({ _textureResourceIds: new Map() }),
    setActiveFramebuffer: jest.fn(), setRenderPasses: jest.fn(), setInitialized: jest.fn(), initialize: jest.fn(), getContext: () => gl });
  const engine = { contextPool: { getAllContexts: () => [{ getOpenGLRenderWindow: () => window }, { getOpenGLRenderWindow: () => ({ getCanvas: () => ({}), getContext: () => null }) }] },
    getViewports: () => ids.map(id => ({ id, canvas: { width: 200, height: 200 }, getVolumeId: () => 'volume' })), render: jest.fn() };
  (getRenderingEngines as jest.Mock).mockReturnValue([engine]);
  (cache.getVolume as jest.Mock).mockReturnValue(volume);
  const tracker = new ViewerOpenTracker(); tracker.progress(2, 2, 0); ids.forEach(id => tracker.frame(id));
  (getViewerOpenTracker as jest.Mock).mockReturnValue(tracker);
  setRenderingPreference('quality');
  configureAdaptiveVolumeTexture(volume); void model.context;
  const loss = new Event('webglcontextlost', { cancelable: true }); canvas.dispatchEvent(loss);
  expect(loss.defaultPrevented).toBe(true); expect(getGraphicsRecovery()).toBe('waiting');
  expect(getGraphicsError()).toBeNull(); expect(tracker.state.status).toBe('error');
  canvas.dispatchEvent(new Event('webglcontextrestored')); jest.runAllTicks();
  expect(getGraphicsRecovery()).toBe('rebuilding'); expect(window.releaseGraphicsResources).toHaveBeenCalledTimes(1);
  expect(texture.releaseGraphicsResources).toHaveBeenCalledTimes(1); expect(texture.modified).toHaveBeenCalledTimes(1);
  expect(engine.render).toHaveBeenCalledTimes(1); expect(volume.voxelManager.getScalarData()).toBe(voxels);
  expect(volume.orbitalGPUFallbackBudget).toBeUndefined(); expect(tracker.state.status).toBe('loading');
  ids.forEach(id => { tracker.frame(id); graphicsContextRecovery.frame(id); });
  expect(getGraphicsRecovery()).toBe('idle'); expect(tracker.state.status).toBe('ready');
  canvas.dispatchEvent(new Event('webglcontextlost')); jest.runAllTicks();
  expect(getGraphicsError()).toContain('потерял доступ'); expect(tracker.state.status).toBe('error');
  expect(engine.render).toHaveBeenCalledTimes(1);
  jest.clearAllTimers(); jest.useRealTimers();
});
