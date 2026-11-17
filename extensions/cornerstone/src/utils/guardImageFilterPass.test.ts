import guardImageFilterPass from './guardImageFilterPass';

function fixture() {
  const gl = {
    FRAMEBUFFER: 1, FRAMEBUFFER_BINDING: 2, VIEWPORT: 3, SCISSOR_BOX: 4,
    FRAMEBUFFER_COMPLETE: 5, NO_ERROR: 0,
    isContextLost: jest.fn(() => false),
    getParameter: jest.fn(key => key === 2 ? 'original-fbo' : [10, 20, 100, 200]),
    bindFramebuffer: jest.fn(), viewport: jest.fn(), scissor: jest.fn(),
    checkFramebufferStatus: jest.fn(() => 5), getError: jest.fn(() => 0),
  };
  const node = { getContext: () => gl, getActiveFramebuffer: () => 'original-vtk-fbo', setActiveFramebuffer: jest.fn() };
  const forward = { traverse: jest.fn() };
  const handle = {};
  let delegate;
  const original = jest.fn(() => delegate.traverse(node));
  const pass = {
    traverse: original, setKernel: jest.fn(),
    setDelegates: jest.fn(values => { [delegate] = values; }),
    getFramebuffer: () => ({ getGLFramebuffer: () => handle }),
  };
  const failure = jest.fn();
  Object.freeze(pass);
  const guard = guardImageFilterPass(pass, forward, failure);
  return { gl, node, forward, pass: guard.pass, nativePass: pass, original, failure, validate: guard.validate };
}

it('restores shared rendering state and validates only a new framebuffer/kernel', () => {
  const f = fixture();
  f.pass.traverse(f.node); f.pass.traverse(f.node);
  expect(f.failure).not.toHaveBeenCalled();
  expect(f.gl.checkFramebufferStatus).toHaveBeenCalledTimes(1);
  expect(f.gl.getError).toHaveBeenCalledTimes(1);
  expect(f.gl.bindFramebuffer).toHaveBeenLastCalledWith(1, 'original-fbo');
  expect(f.node.setActiveFramebuffer).toHaveBeenLastCalledWith('original-vtk-fbo');
  expect(f.gl.viewport).toHaveBeenLastCalledWith(10, 20, 100, 200);
  expect(f.gl.scissor).toHaveBeenLastCalledWith(10, 20, 100, 200);
  f.validate(); f.pass.traverse(f.node);
  expect(f.gl.getError).toHaveBeenCalledTimes(2);
});

it.each(['throw', 'incomplete', 'gl-error'])('falls back without repeatedly executing a failed filter: %s', kind => {
  const f = fixture();
  if (kind === 'throw') f.original.mockImplementation(() => { throw new Error('shader'); });
  if (kind === 'incomplete') f.gl.checkFramebufferStatus.mockReturnValue(99);
  if (kind === 'gl-error') f.gl.getError.mockReturnValue(1285);
  f.pass.traverse(f.node);
  expect(f.failure).toHaveBeenCalledTimes(1);
  expect(f.forward.traverse).toHaveBeenLastCalledWith(f.node, f.nativePass);
  expect(f.gl.bindFramebuffer).toHaveBeenLastCalledWith(1, 'original-fbo');
  f.pass.traverse(f.node);
  expect(f.original).toHaveBeenCalledTimes(1);
  expect(f.failure).toHaveBeenCalledTimes(1);
});

it('does not issue more GPU work after context loss', () => {
  const f = fixture();
  f.gl.isContextLost.mockReturnValue(true);
  f.pass.traverse(f.node); f.pass.traverse(f.node);
  expect(f.failure).toHaveBeenCalledTimes(1);
  expect(f.original).not.toHaveBeenCalled();
  expect(f.forward.traverse).not.toHaveBeenCalled();
});
