import { startupRendering } from './startupRendering';
describe('GPU/CPU startup selection', () => {
  it('automatically enters CPU mode for absent WebGL 2 or a failed texture allocation', () => {
    expect(
      startupRendering('', () => ({ supported: false, reason: 'webgl2-unavailable' }))
    ).toEqual({ kind: 'cpu' });
    expect(
      startupRendering('', () => ({ supported: false, reason: 'texture-unavailable' }))
    ).toEqual({ kind: 'cpu' });
  });
  it('keeps the GPU route and exact device limit when preflight succeeds', () => {
    expect(startupRendering('', () => ({ supported: true, max3DTextureSize: 2048 }))).toEqual({
      kind: 'gpu',
      max3DTextureSize: 2048,
    });
  });
  it('allows explicitly testing CPU on a capable device without creating graphics contexts', () => {
    const probe = jest.fn();
    expect(startupRendering('?render=cpu', probe)).toEqual({ kind: 'cpu' });
    expect(probe).not.toHaveBeenCalled();
  });
});
