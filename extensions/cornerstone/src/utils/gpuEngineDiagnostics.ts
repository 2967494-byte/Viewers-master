import { isGpuDiagnosticSession, recordGpuDiagnostic } from '@ohif/core/src/constants/orbitalGpuDiagnostics';

const watchedContexts = new WeakSet<object>();
const watchedEngines = new WeakSet<object>();

/** Observe native calls without reading voxels, consuming GL errors or forcing synchronization. */
export function installGpuContextDiagnostics(gl: any) {
  if (!gl || !isGpuDiagnosticSession() || watchedContexts.has(gl)) return;
  watchedContexts.add(gl);
  const frame = () => ({ canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight] });
  const counts = new Map<string, number>();
  const wrapped = [];
  const describe: Record<string, (args: any[]) => object> = {
    texImage2D: a => ({ target: a[0], internalFormat: a[2], overload: a.length,
      width: a.length >= 9 && typeof a[3] === 'number' ? a[3] : a[5]?.width || a[5]?.naturalWidth || null,
      height: a.length >= 9 && typeof a[4] === 'number' ? a[4] : a[5]?.height || a[5]?.naturalHeight || null }),
    texStorage2D: a => ({ target: a[0], levels: a[1], internalFormat: a[2], width: a[3], height: a[4] }),
    renderbufferStorage: a => ({ internalFormat: a[1], width: a[2], height: a[3] }),
    renderbufferStorageMultisample: a => ({ samples: a[1], internalFormat: a[2], width: a[3], height: a[4] }),
    bufferData: a => ({ target: a[0], bytes: typeof a[1] === 'number' ? a[1] : a[1]?.byteLength || 0 }),
    shaderSource: a => ({ characters: typeof a[1] === 'string' ? a[1].length : 0 }),
    compileShader: () => ({}),
    linkProgram: () => ({}),
    drawArrays: a => ({ mode: a[0], first: a[1], count: a[2] }),
    drawElements: a => ({ mode: a[0], count: a[1], type: a[2] }),
  };
  for (const [name, details] of Object.entries(describe)) {
    const original = gl[name];
    if (typeof original !== 'function') continue;
    try {
      gl[name] = function (...args) {
        const count = (counts.get(name) || 0) + 1;
        counts.set(name, count);
        // Keep the first allocations/compilations and draws; never journal every animation frame.
        const trace = count <= (name.startsWith('draw') ? 12 : 32);
        const started = Date.now();
        if (trace) recordGpuDiagnostic('gl-call-start', { operation: name, call: count, ...frame(), ...details(args) });
        try {
          const result = original.apply(gl, args);
          if (trace) recordGpuDiagnostic('gl-call-return', { operation: name, call: count,
            elapsedMs: Date.now() - started, contextLost: Boolean(gl.isContextLost?.()) });
          return result;
        } catch (error) {
          recordGpuDiagnostic('gl-call-threw', { operation: name, call: count, errorType: error?.name || 'Error' });
          throw error;
        }
      };
      wrapped.push(name);
    } catch { /* A browser may disallow overriding a native method; skip diagnostics for it. */ }
  }
  recordGpuDiagnostic('gl-observer-installed', { ...frame(), operations: wrapped });
}

/** Attach only to the real implementation returned by core's engine registry. */
export function installGpuEngineDiagnostics(engine: any) {
  if (!engine || !isGpuDiagnosticSession() || watchedEngines.has(engine)) return;
  watchedEngines.add(engine);
  for (const context of engine.contextPool?.getAllContexts?.() || []) {
    installGpuContextDiagnostics(context.getOpenGLRenderWindow?.()?.get3DContext?.());
  }
  const original = engine.renderViewportUsingCustomOrVtkPipeline;
  if (typeof original !== 'function') return;
  const rendered = new WeakMap<object, number>();
  engine.renderViewportUsingCustomOrVtkPipeline = function (viewport, ...args) {
    const count = (rendered.get(viewport) || 0) + 1;
    rendered.set(viewport, count);
    const trace = count <= 4;
    if (trace) {
      const details: Record<string, unknown> = { render: count, type: viewport.type,
        canvas: [viewport.canvas?.width, viewport.canvas?.height] };
      try {
        details.slabThickness = viewport.getSlabThickness?.();
        details.mappers = (viewport.getActors?.() || []).slice(0, 4).map(entry => {
          const mapper = entry.actor?.getMapper?.();
          return { sampleDistance: mapper?.getSampleDistance?.(), maximumSamplesPerRay: mapper?.getMaximumSamplesPerRay?.(),
            colorTextureWidth: mapper?.getColorTextureWidth?.(), opacityTextureWidth: mapper?.getOpacityTextureWidth?.(),
            clippingPlanes: mapper?.getClippingPlanes?.()?.length };
        });
      } catch { /* Optional metadata must not prevent rendering. */ }
      recordGpuDiagnostic('viewport-render-start', details);
    }
    const started = Date.now();
    try {
      return original.call(this, viewport, ...args);
    } finally {
      if (trace) recordGpuDiagnostic('viewport-render-return', { render: count, elapsedMs: Date.now() - started });
    }
  };
}
