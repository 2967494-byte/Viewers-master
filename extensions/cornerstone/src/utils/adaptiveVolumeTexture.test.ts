import { createAdaptiveTextureContext, configureAdaptiveVolumeTexture, COMPATIBILITY_TEXTURE_BYTES, MOBILE_TEXTURE_BYTES, getDeviceTextureBudget, installRenderingPreferenceControl } from './adaptiveVolumeTexture';
import { getGraphicsError, setRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { beginGpuDiagnosticSession, getGpuDiagnosticBudget, GPU_DIAGNOSTIC_PROFILE_KEY, GPU_DIAGNOSTIC_REPORT_KEY } from '@ohif/core/src/constants/orbitalGpuDiagnostics';
import { initializeAutomaticGpuProfile, GPU_RECOVERY_KEY, rememberGpuRecovery, getAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';
import { ViewerDiagnostics, setViewerDiagnostics } from '@ohif/core/src/constants/orbitalViewerDiagnostics';
import * as telemetry from '@ohif/core/src/constants/orbitalOpenTelemetry';
import { cache, getRenderingEngines } from '@cornerstonejs/core';

jest.mock('@cornerstonejs/core', () => ({ cache: { getVolume: jest.fn() }, getRenderingEngines: jest.fn(() => []) }));

function setup(limit = Infinity, dimensions = [600, 600, 300]) {
  let error = 0;
  const gl = { MAX_3D_TEXTURE_SIZE: 32883, OUT_OF_MEMORY: 1285, INVALID_VALUE: 1281,
    getParameter: () => 2048, getError: () => { const value = error; error = 0; return value; },
    isContextLost: () => false, deleteTexture: jest.fn(), receiver() { return this; },
    texStorage3D: jest.fn((...args) => { if (args[3] * args[4] * args[5] * 4 > limit) error = 1285; }),
    texImage3D: jest.fn(), texSubImage3D: jest.fn() };
  const model = { handle: {}, inputNumComps: 1 };
  const texture = { createTexture: jest.fn(() => { model.handle = {}; }), bind: jest.fn(), sendParameters: jest.fn() };
  const volume: any = { dimensions, voxelManager: { getScalarData: () => new Int16Array([-1000, 2000]) } };
  const context = createAdaptiveTextureContext(gl, volume, texture, model);
  return { gl, volume, model, texture, context };
}
beforeEach(() => { localStorage.removeItem(GPU_RECOVERY_KEY); initializeAutomaticGpuProfile({}); setRenderingPreference('auto'); });
afterEach(() => { setRenderingPreference('auto'); localStorage.removeItem(GPU_DIAGNOSTIC_PROFILE_KEY); beginGpuDiagnosticSession(); jest.restoreAllMocks(); });

it('retires the old 64 MiB profile without forcing a coarse texture', () => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  localStorage.setItem(GPU_DIAGNOSTIC_PROFILE_KEY, '64'); beginGpuDiagnosticSession();
  const { context, gl, volume } = setup();
  context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(getGpuDiagnosticBudget()).toBe(Infinity);
  expect(localStorage.getItem(GPU_DIAGNOSTIC_PROFILE_KEY)).toBeNull();
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([300]);
  expect(volume.orbitalDisplaySampling).toBeUndefined();
  expect(JSON.parse(localStorage.getItem(GPU_DIAGNOSTIC_REPORT_KEY)).textureBudgetBytes).toBeNull();
});

it('rejects a sparse display before allocating or uploading any texture', () => {
  const { context, gl, volume, texture, model } = setup(Infinity, [900, 900, 750]);
  const bounded = createAdaptiveTextureContext(gl, volume, texture, model, 64 * 1024 ** 2);
  bounded.texStorage3D(32879, 1, 36760, 900, 900, 750);
  expect(gl.texStorage3D).not.toHaveBeenCalled();
  expect(getGraphicsError()).toContain('чрезмерного снижения');
  bounded.texSubImage3D(32879, 0, 0, 0, 0, 900, 900, 1, 6403, 5126, new Float32Array(1));
  expect(gl.texSubImage3D).not.toHaveBeenCalled();
});

it('recognizes Android, iPhone and iPad desktop identity without limiting ordinary desktops', () => {
  expect(getDeviceTextureBudget({ userAgent: 'Mozilla Android Chrome', platform: 'Linux', maxTouchPoints: 5 } as Navigator)).toBe(MOBILE_TEXTURE_BYTES);
  expect(getDeviceTextureBudget({ userAgent: 'Mozilla iPhone', platform: 'iPhone', maxTouchPoints: 5 } as Navigator)).toBe(MOBILE_TEXTURE_BYTES);
  expect(getDeviceTextureBudget({ userAgent: 'Mozilla Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 } as Navigator)).toBe(MOBILE_TEXTURE_BYTES);
  expect(getDeviceTextureBudget({ userAgent: 'Mozilla Windows Chrome', platform: 'Win32', maxTouchPoints: 10 } as Navigator)).toBe(Infinity);
});

it('limits a mobile allocation before the driver can kill its process, retaining source frames and geometry', () => {
  const agent = jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla Android Chrome');
  try {
    const { context, gl, volume } = setup();
    const dimensions = volume.dimensions;
    context.texStorage3D(32879, 1, 33326, 600, 600, 300);
    expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([186]);
    expect(volume.dimensions).toBe(dimensions);
    expect(volume.orbitalDisplaySampling).toEqual({ sourceDepth: 300, displayDepth: 186, reason: 'mobile' });
    for (let z = 0; z < 300; z++) context.texSubImage3D(32879, 0, 0, 0, z, 600, 600, 1, 6403, 5126, new Float32Array(1));
    expect(gl.texSubImage3D).toHaveBeenCalledTimes(186);
  } finally { agent.mockRestore(); }
});

it('keeps normal dimensions and native GL receivers when the allocation succeeds', () => {
  const { context, gl, volume } = setup();
  context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(gl.texStorage3D).toHaveBeenCalledTimes(1);
  expect(gl.texStorage3D.mock.calls[0][5]).toBe(300);
  expect(context.receiver()).toBe(gl);
  expect(volume.orbitalDisplaySampling).toBeUndefined();
});

it('automatically selects the supported 256 MiB profile before the first allocation, with no diagnostic flag', () => {
  initializeAutomaticGpuProfile({ renderer: 'Intel HD Graphics (0x0f31)', deviceMemory: 4 });
  const { context, gl, volume } = setup();
  context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([186]);
  expect(volume.orbitalDisplaySampling.reason).toBe('automatic');
  expect(getGpuDiagnosticBudget()).toBe(Infinity);
});

it('persists a lower startup budget after an active context loss, ignoring disposed engines', () => {
  initializeAutomaticGpuProfile({ deviceMemory: 4 });
  const { gl, volume, texture, model } = setup();
  const canvas = document.createElement('canvas');
  Object.assign(gl, { canvas });
  const context = createAdaptiveTextureContext(gl, volume, texture, model);
  context.texStorage3D(32879, 1, 36760, 600, 600, 300);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  expect(localStorage.getItem(GPU_RECOVERY_KEY)).toBeNull();
  (getRenderingEngines as jest.Mock).mockReturnValueOnce([{ contextPool: {
    getAllContexts: () => [{ getOpenGLRenderWindow: () => ({ getCanvas: () => canvas }) }] } }]);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  expect(JSON.parse(localStorage.getItem(GPU_RECOVERY_KEY)).budgetMiB).toBe(256);
  expect(initializeAutomaticGpuProfile({ deviceMemory: 4 }).budgetBytes).toBe(256 * 1024 ** 2);
});

it('lets an explicit quality preference override hardware hints, and an legacy economy preference migrate to 256 MiB', () => {
  initializeAutomaticGpuProfile({ renderer: 'Intel HD Graphics 4000' });
  setRenderingPreference('quality');
  const full = setup(); full.context.texStorage3D(32879, 1, 36760, 600, 600, 300);
  expect(full.gl.texStorage3D.mock.calls[0][5]).toBe(300);
  setRenderingPreference('economy');
  const light = setup(); light.context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(light.gl.texStorage3D.mock.calls[0][5]).toBe(186);
});

it('automatically retries a failed 756 MiB allocation within 256 MiB, preserving source geometry', () => {
  const { context, gl, volume, texture } = setup(COMPATIBILITY_TEXTURE_BYTES);
  const dimensions = volume.dimensions, pixels = volume.voxelManager.getScalarData();
  context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([300, 186]);
  expect(texture.createTexture).toHaveBeenCalledTimes(1);
  expect(volume.dimensions).toBe(dimensions);
  expect(volume.voxelManager.getScalarData()).toEqual(pixels);
  expect(volume.orbitalDisplaySampling).toEqual({ sourceDepth: 300, displayDepth: 186, reason: 'memory' });
  for (let z = 549; z >= 0; z--) context.texSubImage3D(32879, 0, 0, 0, z, 600, 600, 1, 6403, 5126, new Float32Array(1));
  expect(gl.texSubImage3D).toHaveBeenCalledTimes(186);
  expect(new Set(gl.texSubImage3D.mock.calls.map(args => args[4])).size).toBe(186);
});

it('applies the manual budget before attempting an oversized allocation', () => {
  setRenderingPreference('compatibility');
  const { context, gl, volume } = setup();
  context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([186]);
  expect(volume.orbitalDisplaySampling.reason).toBe('manual');
});

it('stops rather than continuing to a retired 128/64 MiB profile', () => {
  const { context, gl, volume } = setup(128 * 1024 ** 2);
  context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([300, 186]);
  expect(getGraphicsError()).toContain('графическую память');
});

it('handles an initial texImage3D allocation and remaps a batch upload', () => {
  setRenderingPreference('compatibility');
  const { context, gl } = setup(Infinity, [600, 600, 300]);
  context.texImage3D(32879, 0, 33326, 600, 600, 300, 0, 6403, 5126, null);
  expect(gl.texImage3D.mock.calls[0][5]).toBe(186);
  const data = new Float32Array([1, 2, 3, 4]);
  context.texSubImage3D(32879, 0, 0, 0, 0, 1, 1, 4, 6403, 5126, data);
  expect(gl.texSubImage3D.mock.calls.every(args => args[7] === 1)).toBe(true);
  expect(gl.texSubImage3D.mock.calls.map(args => [...args[10]])).toEqual([[1], [3]]);
});

it('stops after bounded attempts and reports an explicit error instead of accepting black windows', () => {
  const { context, gl } = setup(1);
  context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(gl.texStorage3D).toHaveBeenCalledTimes(2);
  expect(getGraphicsError()).toContain('графическую память');
  context.texSubImage3D(32879, 0, 0, 0, 0, 600, 600, 1, 6403, 5126, null);
  expect(gl.texSubImage3D).not.toHaveBeenCalled();
});

it('opens the reported 750x750x626 study within 384 MiB after a persisted GPU failure', () => {
  const device = { renderer: 'Intel UHD Graphics 730', deviceMemory: 16 };
  initializeAutomaticGpuProfile(device); rememberGpuRecovery(256 * 1024 ** 2); initializeAutomaticGpuProfile(device);
  const { gl, context, volume } = setup(Infinity, [750, 750, 626]);
  context.texStorage3D(32879, 1, 36760, 750, 750, 626);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([357]);
  expect(volume.orbitalDisplaySampling.displayDepth).toBeGreaterThanOrEqual(313);
  expect(getAutomaticGpuProfile().budgetBytes).toBe(384 * 1024 ** 2);
});

it('selects a valid recovery size after losing the reported full-size context', () => {
  const device = { renderer: 'Intel UHD Graphics 730', deviceMemory: 16 };
  initializeAutomaticGpuProfile(device);
  const { gl, volume, model, texture } = setup(Infinity, [750, 750, 626]);
  const canvas = document.createElement('canvas'); Object.assign(gl, { canvas });
  const context = createAdaptiveTextureContext(gl, volume, texture, model, 768 * 1024 ** 2);
  context.texStorage3D(32879, 1, 36760, 750, 750, 626);
  (getRenderingEngines as jest.Mock).mockReturnValueOnce([{ contextPool: {
    getAllContexts: () => [{ getOpenGLRenderWindow: () => ({ getCanvas: () => canvas }) }] } }]);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  expect(initializeAutomaticGpuProfile(device).budgetBytes).toBe(384 * 1024 ** 2);
});

it('marks a quality-policy rejection separately without pretending the GPU allocated a texture', () => {
  const tracker = { update: jest.fn(), fail: jest.fn() };
  jest.spyOn(telemetry, 'getViewerOpenTracker').mockReturnValue(tracker as any);
  setRenderingPreference('compatibility');
  const { gl, context } = setup(Infinity, [750, 750, 626]);
  context.texStorage3D(32879, 1, 36760, 750, 750, 626);
  expect(gl.texStorage3D).not.toHaveBeenCalled();
  expect(tracker.update).toHaveBeenCalledWith(expect.objectContaining({ profileReason: 'detail-policy-limit' }), false);
  expect(getGraphicsError()).toContain('чрезмерного снижения');
});

it('accounts for releasing and reallocating GPU textures without accumulating live bytes', () => {
  const diagnostic = new ViewerDiagnostics(); setViewerDiagnostics(diagnostic);
  try {
    const { gl, context, model } = setup();
    for (let opening = 0; opening < 3; opening++) {
      model.handle = {};
      context.texStorage3D(32879, 1, 36760, 600, 600, 300);
      expect(diagnostic.resources.textures).toBe(1);
      context.deleteTexture(model.handle);
      expect(diagnostic.resources.textures).toBe(0);
      expect(diagnostic.resources.textureBytes).toBe(0);
    }
    expect(gl.deleteTexture).toHaveBeenCalledTimes(3);
    expect(diagnostic.resources.allocations).toBe(3);
    expect(diagnostic.resources.releases).toBe(3);
  } finally { setViewerDiagnostics(null); }
});

it('uses supported nearest sampling when float texture interpolation is unavailable, preventing black textures', () => {
  const { gl, context, volume } = setup();
  Object.assign(gl, { getExtension: () => null, texParameteri: jest.fn(), TEXTURE_3D: 32879,
    TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, LINEAR: 9729, NEAREST: 9728 });
  context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  context.texParameteri(32879, 10241, 9729);
  expect(gl.texParameteri).toHaveBeenLastCalledWith(32879, 10241, 9728);
  expect(volume.orbitalDisplaySampling).toEqual({ sourceDepth: 300, displayDepth: 300, reason: 'filtering' });
});

it('recovers when allocation succeeds but the driver runs out of memory on the first upload', async () => {
  const { gl, volume, model, texture } = setup();
  Object.assign(model, { context: gl });
  volume.vtkOpenGLTexture = { ...texture, get: () => model,
    releaseGraphicsResources: jest.fn(), modified: jest.fn() };
  configureAdaptiveVolumeTexture(volume);
  model.context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  gl.getError = jest.fn().mockReturnValueOnce(1285).mockReturnValue(0);
  model.context.texSubImage3D(32879, 0, 0, 0, 0, 600, 600, 1, 6403, 5126, new Float32Array(1));
  await Promise.resolve();
  expect(volume.vtkOpenGLTexture.releaseGraphicsResources).toHaveBeenCalledTimes(1);
  expect(volume.vtkOpenGLTexture.modified).toHaveBeenCalledTimes(1);
  model.context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([300, 186]);
  expect(volume.orbitalDisplaySampling.reason).toBe('memory');
});

it('makes quality bypass the common large-texture cap and stale fallback, with no reduced badge', () => {
  setRenderingPreference('quality');
  const { gl, volume, texture, model } = setup(Infinity, [900, 900, 750]);
  volume.orbitalGPUFallbackBudget = 64 * 1024 ** 2;
  const context = createAdaptiveTextureContext(gl, volume, texture, model, 768 * 1024 ** 2);
  context.texStorage3D(32879, 1, 36760, 900, 900, 750);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([750]);
  expect(volume.orbitalDisplaySampling).toBeUndefined();
});

it('never silently reduces a rejected quality request and avoids a persistent failure on reopening', () => {
  setRenderingPreference('quality');
  const { context, gl } = setup(COMPATIBILITY_TEXTURE_BYTES);
  context.texStorage3D(32879, 1, 33326, 600, 600, 300);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([300]);
  expect(getGraphicsError()).toContain('максимальную детализацию');
  expect(localStorage.getItem('orbital:rendering-preference:v1')).toBeNull();
});

it('does not trap subsequent openings in a rejected compatibility profile either', () => {
  setRenderingPreference('compatibility');
  const {context,gl}=setup(Infinity,[900,900,750]);
  context.texStorage3D(32879,1,36760,900,900,750);
  expect(gl.texStorage3D).not.toHaveBeenCalled();
  expect(localStorage.getItem('orbital:rendering-preference:v1')).toBeNull();
});

it('clears the actual memory fallback and rebuilds the same cached texture on a quality switch', () => {
  const { gl, volume, model, texture } = setup(Infinity, [900, 900, 750]);
  Object.assign(model, { context: gl });
  volume.volumeId='test';volume.orbitalGPUFallbackBudget=256 * 1024 ** 2;
  volume.vtkOpenGLTexture={...texture,get:()=>model,releaseGraphicsResources:jest.fn(),modified:jest.fn()};
  configureAdaptiveVolumeTexture(volume,768 * 1024 ** 2);installRenderingPreferenceControl();
  (cache.getVolume as jest.Mock).mockReturnValue(volume);
  (getRenderingEngines as jest.Mock).mockReturnValue([{getViewports:()=>[{getVolumeId:()=> 'test'}],render:jest.fn()}]);
  setRenderingPreference('quality');
  expect(volume.orbitalGPUFallbackBudget).toBeUndefined();
  expect(volume.vtkOpenGLTexture.releaseGraphicsResources).toHaveBeenCalledTimes(1);
  model.context.texStorage3D(32879,1,36760,900,900,750);
  expect(gl.texStorage3D.mock.calls[0][5]).toBe(750);expect(volume.orbitalDisplaySampling).toBeUndefined();
  (getRenderingEngines as jest.Mock).mockReturnValue([]);
});
