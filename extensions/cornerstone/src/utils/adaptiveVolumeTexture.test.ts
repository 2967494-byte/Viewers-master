import { createAdaptiveTextureContext, configureAdaptiveVolumeTexture, COMPATIBILITY_TEXTURE_BYTES, MOBILE_TEXTURE_BYTES, getDeviceTextureBudget } from './adaptiveVolumeTexture';
import { getGraphicsError, setRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { beginGpuDiagnosticSession, getGpuDiagnosticBudget, GPU_DIAGNOSTIC_PROFILE_KEY, GPU_DIAGNOSTIC_REPORT_KEY } from '@ohif/core/src/constants/orbitalGpuDiagnostics';
import { initializeAutomaticGpuProfile, GPU_RECOVERY_KEY } from '@ohif/core/src/constants/orbitalGpuProfile';
import { getRenderingEngines } from '@cornerstonejs/core';

jest.mock('@cornerstonejs/core', () => ({ cache: {}, getRenderingEngines: jest.fn(() => []) }));

function setup(limit = Infinity, dimensions = [600, 600, 550]) {
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

it('caps the first allocation at 64 MiB in the opt-in profile and journals real upload completion', () => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  localStorage.setItem(GPU_DIAGNOSTIC_PROFILE_KEY, '64'); beginGpuDiagnosticSession();
  const { context, gl, volume } = setup();
  const dimensions = volume.dimensions, pixels = volume.voxelManager.getScalarData();
  context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([46]);
  expect(600 * 600 * 46 * 4).toBeLessThanOrEqual(64 * 1024 ** 2);
  expect(volume.dimensions).toBe(dimensions);
  expect(volume.voxelManager.getScalarData()).toEqual(pixels);
  expect(volume.orbitalDisplaySampling.reason).toBe('diagnostic');
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 549; z >= 0; z--) context.texSubImage3D(32879, 0, 0, 0, z, 600, 600, 1, 6403, 5126, new Float32Array(1));
  }
  const events = JSON.parse(localStorage.getItem(GPU_DIAGNOSTIC_REPORT_KEY)).events;
  expect(events.find(event => event.stage === 'allocation-start')).toEqual(expect.objectContaining({
    sourceDimensions: [600, 600, 550], displayDimensions: [600, 600, 46], internalFormat: 33326 }));
  expect(events.filter(event => event.stage === 'upload-complete')).toHaveLength(1);
  expect(events.find(event => event.stage === 'upload-complete').uploadedSlices).toBe(46);
});

it('does not escalate allocations above the diagnostic cap after out-of-memory', () => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  localStorage.setItem(GPU_DIAGNOSTIC_PROFILE_KEY, '64'); beginGpuDiagnosticSession();
  const { context, gl } = setup(1);
  context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([46]);
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
    context.texStorage3D(32879, 1, 33326, 600, 600, 550);
    expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([93]);
    expect(volume.dimensions).toBe(dimensions);
    expect(volume.orbitalDisplaySampling).toEqual({ sourceDepth: 550, displayDepth: 93, reason: 'mobile' });
    for (let z = 0; z < 550; z++) context.texSubImage3D(32879, 0, 0, 0, z, 600, 600, 1, 6403, 5126, new Float32Array(1));
    expect(gl.texSubImage3D).toHaveBeenCalledTimes(93);
  } finally { agent.mockRestore(); }
});

it('keeps normal dimensions and native GL receivers when the allocation succeeds', () => {
  const { context, gl, volume } = setup();
  context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  expect(gl.texStorage3D).toHaveBeenCalledTimes(1);
  expect(gl.texStorage3D.mock.calls[0][5]).toBe(550);
  expect(context.receiver()).toBe(gl);
  expect(volume.orbitalDisplaySampling).toBeUndefined();
});

it('automatically selects the tested 64 MiB profile before the first allocation, with no diagnostic flag', () => {
  initializeAutomaticGpuProfile({ renderer: 'Intel HD Graphics (0x0f31)', deviceMemory: 4 });
  const { context, gl, volume } = setup();
  context.texStorage3D(32879, 1, 36760, 600, 600, 550);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([93]);
  expect(volume.orbitalDisplaySampling.reason).toBe('automatic');
  expect(getGpuDiagnosticBudget()).toBe(Infinity);
});

it('persists a lower startup budget after an active context loss, ignoring disposed engines', () => {
  initializeAutomaticGpuProfile({ deviceMemory: 4 });
  const { gl, volume, texture, model } = setup();
  const canvas = document.createElement('canvas');
  Object.assign(gl, { canvas });
  const context = createAdaptiveTextureContext(gl, volume, texture, model);
  context.texStorage3D(32879, 1, 36760, 600, 600, 550);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  expect(localStorage.getItem(GPU_RECOVERY_KEY)).toBeNull();
  (getRenderingEngines as jest.Mock).mockReturnValueOnce([{ contextPool: {
    getAllContexts: () => [{ getOpenGLRenderWindow: () => ({ getCanvas: () => canvas }) }] } }]);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  expect(JSON.parse(localStorage.getItem(GPU_RECOVERY_KEY)).budgetMiB).toBe(64);
  expect(initializeAutomaticGpuProfile({ deviceMemory: 4 }).budgetBytes).toBe(64 * 1024 ** 2);
});

it('lets an explicit quality preference override hardware hints, and an economy preference cap at 64 MiB', () => {
  initializeAutomaticGpuProfile({ renderer: 'Intel HD Graphics 4000' });
  setRenderingPreference('quality');
  const full = setup(); full.context.texStorage3D(32879, 1, 36760, 600, 600, 550);
  expect(full.gl.texStorage3D.mock.calls[0][5]).toBe(550);
  setRenderingPreference('economy');
  const light = setup(); light.context.texStorage3D(32879, 1, 36760, 600, 600, 550);
  expect(light.gl.texStorage3D.mock.calls[0][5]).toBe(93);
});

it('automatically retries a failed 756 MiB allocation within 256 MiB, preserving source geometry', () => {
  const { context, gl, volume, texture } = setup(COMPATIBILITY_TEXTURE_BYTES);
  const dimensions = volume.dimensions, pixels = volume.voxelManager.getScalarData();
  context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([550, 186]);
  expect(texture.createTexture).toHaveBeenCalledTimes(1);
  expect(volume.dimensions).toBe(dimensions);
  expect(volume.voxelManager.getScalarData()).toEqual(pixels);
  expect(volume.orbitalDisplaySampling).toEqual({ sourceDepth: 550, displayDepth: 186, reason: 'memory' });
  for (let z = 549; z >= 0; z--) context.texSubImage3D(32879, 0, 0, 0, z, 600, 600, 1, 6403, 5126, new Float32Array(1));
  expect(gl.texSubImage3D).toHaveBeenCalledTimes(186);
  expect(new Set(gl.texSubImage3D.mock.calls.map(args => args[4])).size).toBe(186);
});

it('applies the manual budget before attempting an oversized allocation', () => {
  setRenderingPreference('compatibility');
  const { context, gl, volume } = setup();
  context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([186]);
  expect(volume.orbitalDisplaySampling.reason).toBe('manual');
});

it('continues down to a smaller budget when the first fallback still cannot allocate', () => {
  const { context, gl, volume } = setup(128 * 1024 ** 2);
  context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([550, 186, 93]);
  expect(volume.orbitalDisplaySampling.displayDepth).toBe(93);
});

it('handles an initial texImage3D allocation and remaps a batch upload', () => {
  setRenderingPreference('compatibility');
  const { context, gl } = setup(Infinity, [600, 600, 550]);
  context.texImage3D(32879, 0, 33326, 600, 600, 550, 0, 6403, 5126, null);
  expect(gl.texImage3D.mock.calls[0][5]).toBe(186);
  const data = new Float32Array([1, 2, 3, 4]);
  context.texSubImage3D(32879, 0, 0, 0, 0, 1, 1, 4, 6403, 5126, data);
  expect(gl.texSubImage3D.mock.calls.every(args => args[7] === 1)).toBe(true);
  expect(gl.texSubImage3D.mock.calls.map(args => [...args[10]])).toEqual([[2]]);
});

it('stops after bounded attempts and reports an explicit error instead of accepting black windows', () => {
  const { context, gl } = setup(1);
  context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  expect(gl.texStorage3D).toHaveBeenCalledTimes(4);
  expect(getGraphicsError()).toContain('даже в облегчённом режиме');
  context.texSubImage3D(32879, 0, 0, 0, 0, 600, 600, 1, 6403, 5126, null);
  expect(gl.texSubImage3D).not.toHaveBeenCalled();
});

it('uses supported nearest sampling when float texture interpolation is unavailable, preventing black textures', () => {
  const { gl, context, volume } = setup();
  Object.assign(gl, { getExtension: () => null, texParameteri: jest.fn(), TEXTURE_3D: 32879,
    TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, LINEAR: 9729, NEAREST: 9728 });
  context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  context.texParameteri(32879, 10241, 9729);
  expect(gl.texParameteri).toHaveBeenLastCalledWith(32879, 10241, 9728);
  expect(volume.orbitalDisplaySampling).toEqual({ sourceDepth: 550, displayDepth: 550, reason: 'filtering' });
});

it('recovers when allocation succeeds but the driver runs out of memory on the first upload', async () => {
  const { gl, volume, model, texture } = setup();
  Object.assign(model, { context: gl });
  volume.vtkOpenGLTexture = { ...texture, get: () => model,
    releaseGraphicsResources: jest.fn(), modified: jest.fn() };
  configureAdaptiveVolumeTexture(volume);
  model.context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  gl.getError = jest.fn().mockReturnValueOnce(1285).mockReturnValue(0);
  model.context.texSubImage3D(32879, 0, 0, 0, 0, 600, 600, 1, 6403, 5126, new Float32Array(1));
  await Promise.resolve();
  expect(volume.vtkOpenGLTexture.releaseGraphicsResources).toHaveBeenCalledTimes(1);
  expect(volume.vtkOpenGLTexture.modified).toHaveBeenCalledTimes(1);
  model.context.texStorage3D(32879, 1, 33326, 600, 600, 550);
  expect(gl.texStorage3D.mock.calls.map(args => args[5])).toEqual([550, 186]);
  expect(volume.orbitalDisplaySampling.reason).toBe('memory');
});
