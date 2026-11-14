import { checkVolumeRenderingSupport } from './volumeRenderingSupport';

describe('WebGL 2 preflight before study access', () => {
  let context, spy, loseContext;
  beforeEach(() => {
    loseContext = jest.fn();
    context = { MAX_3D_TEXTURE_SIZE: 32883, TEXTURE_3D: 32879, R8: 33321, RED: 6403,
      UNSIGNED_BYTE: 5121, NO_ERROR: 0, getParameter: jest.fn(() => 2048),
      texImage3D: jest.fn(), texStorage3D: jest.fn(), texSubImage3D: jest.fn(),
      createTexture: jest.fn(() => ({})), bindTexture: jest.fn(), deleteTexture: jest.fn(),
      getError: jest.fn(() => 0), isContextLost: jest.fn(() => false),
      getExtension: jest.fn(() => ({ loseContext })) };
    spy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  });
  afterEach(() => spy.mockRestore());
  it('requires an actual WebGL 2 context; never silently accepts WebGL 1', () => {
    spy.mockReturnValue(null);
    expect(checkVolumeRenderingSupport()).toEqual({ supported: false, reason: 'webgl2-unavailable' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('webgl2');
  });
  it('rejects a context with a missing 3D texture API and releases the probe', () => {
    context.texImage3D = undefined;
    expect(checkVolumeRenderingSupport()).toEqual({ supported: false, reason: 'webgl2-unavailable' });
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
  it('checks a real minimal texture allocation and returns the device limit', () => {
    expect(checkVolumeRenderingSupport()).toMatchObject({ supported: true, max3DTextureSize: 2048, gpuDevice: { renderer: '', mobile: false } });
    expect(context.texImage3D).toHaveBeenCalledWith(32879, 0, 33321, 1, 1, 1, 0, 6403, 5121, new Uint8Array([127]));
    expect(context.deleteTexture).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
  it.each(['allocation', 'lost', 'missingTexture'])('rejects unusable WebGL 2: %s', reason => {
    if (reason === 'allocation') context.getError.mockReturnValue(1285);
    if (reason === 'lost') context.isContextLost.mockReturnValue(true);
    if (reason === 'missingTexture') context.createTexture.mockReturnValue(null);
    expect(checkVolumeRenderingSupport()).toEqual({ supported: false, reason: 'texture-unavailable' });
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
  it('handles browser policy exceptions without a technical crash', () => {
    spy.mockImplementation(() => { throw new Error('Browser policy'); });
    expect(checkVolumeRenderingSupport()).toEqual({ supported: false, reason: 'webgl2-unavailable' });
  });
  it('captures the adapter using the same preflight context and tolerates hidden renderer information', () => {
    context.getExtension.mockImplementation(name => name === 'WEBGL_debug_renderer_info'
      ? { UNMASKED_RENDERER_WEBGL: 37446 } : { loseContext });
    context.getParameter.mockImplementation(parameter => parameter === 37446 ? 'Intel HD Graphics (0x0f31)' : 2048);
    expect(checkVolumeRenderingSupport()).toMatchObject({ supported: true, gpuDevice: { renderer: 'Intel HD Graphics (0x0f31)' } });
    expect(spy).toHaveBeenCalledTimes(1);
    context.getExtension.mockImplementation(name => { if (name === 'WEBGL_debug_renderer_info') throw new Error('privacy'); return { loseContext }; });
    expect(checkVolumeRenderingSupport()).toMatchObject({ supported: true, gpuDevice: { renderer: '' } });
  });
});
