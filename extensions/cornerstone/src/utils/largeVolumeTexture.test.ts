import { configureLargeVolumeTexture, installLargeVolumeTextureSupport, createDepthLimitedTextureContext } from './largeVolumeTexture';
import { eventTarget } from '@cornerstonejs/core';
import { setRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';

beforeEach(() => setRenderingPreference('auto'));
afterEach(() => setRenderingPreference('auto'));

jest.mock('@cornerstonejs/core', () => ({
  getRenderingEngines: () => [],
  Enums: { Events: { VOLUME_LOADED: 'volume-created' } },
  eventTarget: { addEventListener: jest.fn() },
}));

function makeVolume(dimensions = [900, 900, 750], dataType = 'Int16Array') {
  let norm16 = null;
  const pixels = new Int16Array([-32768, -1000, 0, 2000, 32767]);
  const model = { enableUseHalfFloat: false, canUseHalfFloat: false };
  const original = jest.fn(() => model.enableUseHalfFloat && model.canUseHalfFloat);
  return {
    volume: { dimensions, dataType, voxelManager: { getScalarData: () => pixels },
      vtkOpenGLTexture: Object.freeze({ useHalfFloat: original, getOglNorm16Ext: () => norm16, get: () => model }) },
    pixels, original, model, supportNorm16: () => { norm16 = {}; },
  };
}

it('avoids the oversized 900x900x750 float texture without changing CPU data or geometry', () => {
  const { volume, pixels, model } = makeVolume();
  const dimensions = volume.dimensions;
  const before = [...pixels];
  expect(configureLargeVolumeTexture(volume)).toBe(true);
  expect(volume.vtkOpenGLTexture.useHalfFloat()).toBe(true);
  model.enableUseHalfFloat = false; model.canUseHalfFloat = false;
  expect(volume.vtkOpenGLTexture.useHalfFloat()).toBe(true);
  expect(volume.dimensions).toBe(dimensions);
  expect(volume.dataType).toBe('Int16Array');
  expect(volume.voxelManager.getScalarData()).toBe(pixels);
  expect([...pixels]).toEqual(before);
});

it('prefers exact normalized 16-bit on supported GPUs', () => {
  const { volume, supportNorm16, original } = makeVolume();
  configureLargeVolumeTexture(volume);
  supportNorm16();
  expect(volume.vtkOpenGLTexture.useHalfFloat()).toBe(false);
  expect(original).toHaveBeenCalledTimes(1);
});

it('uses exact float values in quality mode when normalized signed 16-bit is unavailable', () => {
  const { volume } = makeVolume(); configureLargeVolumeTexture(volume);
  setRenderingPreference('quality');
  expect(volume.vtkOpenGLTexture.useHalfFloat()).toBe(false);
  setRenderingPreference('auto');
  expect(volume.vtkOpenGLTexture.useHalfFloat()).toBe(true);
});

it.each([
  [[900, 900, 750], 'Float32Array'],
  [[900, 900, 750], 'Uint16Array'],
  [[0, 900, 750], 'Int16Array'],
])('preserves the existing path for dimensions %j, type %s', (dimensions, type) => {
  const { volume, original } = makeVolume(dimensions, type);
  expect(configureLargeVolumeTexture(volume)).toBe(false);
  expect(volume.vtkOpenGLTexture.useHalfFloat).toBe(original);
});

it('configures each volume once and installs before viewport rendering', () => {
  const { volume } = makeVolume();
  expect(configureLargeVolumeTexture(volume)).toBe(true);
  expect(configureLargeVolumeTexture(volume)).toBe(false);
  installLargeVolumeTextureSupport(); installLargeVolumeTextureSupport();
  expect(eventTarget.addEventListener).toHaveBeenCalledTimes(1);
  expect(eventTarget.addEventListener).toHaveBeenCalledWith('volume-created', expect.any(Function));
});

it('bounds GPU allocation and maps every selected frame once in any arrival order', () => {
  const gl = { texStorage3D: jest.fn(), texSubImage3D: jest.fn() };
  const context = createDepthLimitedTextureContext(gl, [900, 900, 750]);
  context.texStorage3D(32879, 1, 33325, 900, 900, 750);
  const displayDepth = gl.texStorage3D.mock.calls[0][5];
  expect(displayDepth).toBe(497);
  expect(900 * 900 * displayDepth * 2).toBeLessThanOrEqual(768 * 1024 ** 2);
  const pixels = new Uint16Array(900 * 900);
  for (let z = 749; z >= 0; z--) context.texSubImage3D(32879, 0, 0, 0, z, 900, 900, 1, 6403, 5131, pixels);
  expect(gl.texSubImage3D).toHaveBeenCalledTimes(displayDepth);
  const uploads = gl.texSubImage3D.mock.calls;
  expect(new Set(uploads.map(args => args[4])).size).toBe(displayDepth);
  expect(Math.min(...uploads.map(args => args[4]))).toBe(0);
  expect(Math.max(...uploads.map(args => args[4]))).toBe(displayDepth - 1);
  expect(uploads.every(args => args[10] === pixels)).toBe(true);
});

it('does not wrap textures that already fit and preserves native GL receivers', () => {
  const gl = { texStorage3D: jest.fn(), receiver() { return this; } };
  expect(createDepthLimitedTextureContext(gl, [600, 600, 550])).toBe(gl);
  const wrapped = createDepthLimitedTextureContext(gl, [900, 900, 750]);
  expect(wrapped.receiver()).toBe(gl);
});

it('compacts small signed studies too, without publishing a speculative reduced-resolution badge', () => {
  const {volume}=makeVolume([600,600,550]);
  expect(configureLargeVolumeTexture(volume)).toBe(true);
  expect(volume.vtkOpenGLTexture.useHalfFloat()).toBe(false);
  setRenderingPreference('compatibility');
  expect(volume.vtkOpenGLTexture.useHalfFloat()).toBe(true);
  expect(volume.orbitalDisplaySampling).toBeUndefined();
});
