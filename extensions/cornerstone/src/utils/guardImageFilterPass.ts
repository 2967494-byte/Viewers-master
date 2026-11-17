/** Contain failures in optional post-processing, including silent incomplete FBOs.
 * The ordinary slice pass still runs when the context is usable. Context loss
 * itself is handled by the viewer's existing context-loss recovery UI.
 */
export default function guardImageFilterPass(pass, forward, onFailure: () => void) {
  // VTK freezes public API objects. Wrap, never replace methods on the instance.
  const guarded = { ...pass };
  const traverse = pass.traverse.bind(pass);
  let failed = false;
  let checkedFramebuffer;
  let validate = true;
  const delegate = {
    traverse(viewNode, parent) {
      const gl = viewNode.getContext();
      const framebuffer = pass.getFramebuffer()?.getGLFramebuffer();
      if (framebuffer && framebuffer !== checkedFramebuffer) {
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error('Slice filter framebuffer is incomplete');
        }
        checkedFramebuffer = framebuffer;
      }
      forward.traverse(viewNode, parent);
    },
  };
  pass.setDelegates([delegate]);
  guarded.traverse = viewNode => {
    const gl = viewNode.getContext();
    if (!gl || gl.isContextLost()) {
      if (!failed) { failed = true; onFailure(); }
      return;
    }
    if (failed) { forward.traverse(viewNode, pass); return; }
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const activeFramebuffer = viewNode.getActiveFramebuffer();
    const viewport = gl.getParameter(gl.VIEWPORT);
    const scissor = gl.getParameter(gl.SCISSOR_BOX);
    let error = false;
    try {
      traverse(viewNode);
      // Check once per strength change, rather than synchronizing GPU errors on
      // every slice scroll. WebGL allocation/draw errors need not throw in JS.
      if (validate) {
        validate = false;
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Slice filter GPU error');
      }
    } catch {
      failed = true;
      error = true;
    } finally {
      if (!gl.isContextLost()) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        viewNode.setActiveFramebuffer(activeFramebuffer);
        gl.viewport(...viewport);
        gl.scissor(...scissor);
      }
    }
    if (error || gl.isContextLost()) {
      failed = true;
      onFailure();
      if (!gl.isContextLost()) forward.traverse(viewNode, pass);
    }
  };
  return { pass: guarded, validate: () => { validate = true; } };
}
