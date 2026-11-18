import { resetViewportImageFilter } from './viewportImageFilter';
import vtkForwardPass from '@kitware/vtk.js/Rendering/OpenGL/ForwardPass';
import { GraphicsContextRecovery } from './graphicsContextRecovery';
import { setGraphicsRecovery } from '@ohif/core/src/constants/orbitalGraphicsRecovery';
import { MPR_TELEMETRY_IDS } from '@ohif/core/src/constants/orbitalOpenTelemetry';
import { cache, getRenderingEngines } from '@cornerstonejs/core';
import { getRenderingPreference, reportGraphicsError, subscribeRenderingPreference, forgetFailedRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { setImageFilter } from '@ohif/core/src/constants/orbitalImageFilters';
import { getGpuDiagnosticBudget, recordGpuDiagnostic } from '@ohif/core/src/constants/orbitalGpuDiagnostics';
import { fitAutomaticGpuProfile, rememberGpuRecovery } from '@ohif/core/src/constants/orbitalGpuProfile';
import { getViewerOpenTracker, reportViewerAllocation, reportViewerProfile } from '@ohif/core/src/constants/orbitalOpenTelemetry';
import { MINIMUM_TEXTURE_BUDGET, MAXIMUM_Z_DECIMATION, minimumDisplayBudget, TEXTURE_BUDGET_STEPS } from '@ohif/core/src/constants/orbitalRenderingPolicy';
import { recordViewerEvent, recordViewerTexture, releaseViewerTexture } from '@ohif/core/src/constants/orbitalViewerDiagnostics';

export const COMPATIBILITY_TEXTURE_BYTES = 256 * 1024 ** 2;
export const MOBILE_TEXTURE_BYTES = MINIMUM_TEXTURE_BUDGET;

export function getDeviceTextureBudget(device = typeof navigator === 'undefined' ? undefined : navigator) {
  const mobile = device && (/Android|iPhone|iPad|iPod|Mobile/i.test(device.userAgent || '') ||
    (/Mac/i.test(device.platform || '') && device.maxTouchPoints > 1));
  // Mobile drivers can trigger an OS process kill instead of returning GL_OUT_OF_MEMORY.
  // Reserve a conservative budget before the first allocation, even in automatic mode.
  return mobile ? MOBILE_TEXTURE_BYTES : Infinity;
}
const configured = new WeakSet<object>();
const controllers = new WeakMap<object, { reset: () => void }>();
const watchedCanvases = new WeakSet<object>();
const recoveryBudgets = new WeakMap<object, () => number>();
const canvasBudgets = new WeakMap<object, number>();
let subscribed = false;

const failureMessage = 'Не удалось отобразить исследование без чрезмерного снижения детализации. Сильно прореженное изображение не показывается. Закройте другие вкладки и программы, использующие видеокарту, и откройте исследование заново. Если ошибка повторится, обновите драйвер видеокарты или используйте другой компьютер.';
const resourceFailureMessage = 'Браузер не смог выделить графическую память для исследования. Закройте другие вкладки просмотрщика и программы, использующие видеокарту, затем откройте исследование заново. Если ошибка повторяется, полностью перезапустите браузер.';
const contextFailureMessage = 'Браузер потерял доступ к видеокарте во время отображения исследования. Закройте другие вкладки и программы, использующие графику, и откройте исследование заново из личного кабинета.';
const qualityFailureMessage = 'Не удалось включить максимальную детализацию на этом устройстве. Качество автоматически не снижалось. Закройте другие вкладки и программы, использующие видеокарту, и откройте исследование заново из личного кабинета. Следующее открытие начнётся в автоматическом режиме.';

const activeCanvas = (canvas: object) => getRenderingEngines().some((engine: any) =>
  engine.contextPool?.getAllContexts().some(window => window.getOpenGLRenderWindow().getCanvas() === canvas));
const pendingBudgets = new Map<object, number>();
export const graphicsContextRecovery = new GraphicsContextRecovery({
  alive: activeCanvas,
  phase: setGraphicsRecovery,
  started: () => getViewerOpenTracker()?.fail('context-lost'),
  rebuild: () => {
    // No reload, engine recreation, camera reset or network access. VTK has released render passes.
    setImageFilter('none');
    for (const engine of getRenderingEngines()) {
      engine.getViewports().forEach(resetViewportImageFilter);
      for (const window of engine.contextPool?.getAllContexts() || []) {
        const view = window.getOpenGLRenderWindow();
        const gl = view.getContext();
        if (!gl) continue; // A pool can contain slots that have never created a context.
        if (gl.isContextLost?.()) throw new Error('Context has not returned');
        view.releaseGraphicsResources();
        // VTK's Release traversal does not rebuild mapper VAOs/VBOs after context loss.
        // Drop GPU view nodes, retaining the core renderers, actors, cameras and annotations.
        view.prepareNodes();
        view.removeUnusedNodes();
        view.get()._textureResourceIds.clear();
        view.setActiveFramebuffer(null);
        view.setRenderPasses([vtkForwardPass.newInstance()]);
        // The native context object is the same. Restore VTK's initial GL state
        // without initialize(), which would count a second physical context.
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
        gl.depthMask(true); // Refresh VTK's cached GL state after the browser reset.
        for (let i = 0; i < 8 && gl.getError() !== 0; i++) { /* discard cleanup errors only */ }
      }
    }
    const seen = new Set();
    const ids = new Set<string>();
    const budget = Math.min(...pendingBudgets.values());
    for (const engine of getRenderingEngines()) {
      for (const viewport of engine.getViewports()) {
        const rect = viewport.element?.getBoundingClientRect?.();
        if (MPR_TELEMETRY_IDS.includes(viewport.id) && viewport.canvas?.width > 0 && viewport.canvas?.height > 0 &&
            (!rect || (rect.width > 0 && rect.height > 0))) ids.add(viewport.id);
        const id = viewport.getVolumeId?.();
        const volume = id && cache.getVolume(id);
        if (!volume || seen.has(volume)) continue;
        seen.add(volume);
        if (getRenderingPreference() === 'auto' && Number.isFinite(budget)) volume.orbitalGPUFallbackBudget = budget;
        controllers.get(volume)?.reset();
      }
    }
    pendingBudgets.clear();
    getViewerOpenTracker()?.resumeAfterContextRestore();
    // render() schedules the next animation frame, after expected IDs have been installed.
    getRenderingEngines().forEach(engine => engine.render());
    return [...ids];
  },
  cancelled: () => pendingBudgets.clear(),
  completed: () => recordViewerEvent('context-restored', { value: 'ready', count: 1 }),
  failed: code => {
    pendingBudgets.clear();
    recordViewerEvent('allocation-error', { value: 'context-lost', code });
    getViewerOpenTracker()?.fail('context-lost');
    forgetFailedRenderingPreference();
    reportGraphicsError(contextFailureMessage);
  },
});
function recoverLostContext(canvas: object) {
  if (!activeCanvas(canvas)) return;
  if (graphicsContextRecovery.phase !== 'rebuilding') {
    const budget = recoveryBudgets.get(canvas)?.();
    if (Number.isFinite(budget)) { pendingBudgets.set(canvas, budget); rememberGpuRecovery(budget); }
  }
  // Upload failure may detect the loss before the DOM event arrives. Do not count that event twice.
  graphicsContextRecovery.lose(canvas);
}

/** Intercept only this volume's scalar texture; keep its CPU voxels and world geometry intact. */
export function createAdaptiveTextureContext(gl, volume, texture, model, baseBudget = Infinity) {
  const [width, height, sourceDepth] = volume.dimensions;
  let displayDepth = sourceDepth;
  let sourceToDisplay = new Map<number, number>();
  let failed = false;
  let nearestFiltering = false;
  let retryQueued = false;
  let allocatedBytes = 0;
  let activeBudget = Infinity;
  const nextRecoveryBudget = bytes => {
    const bytesPerVoxel = allocatedBytes ? allocatedBytes / (width * height * displayDepth) : 2 * (model.inputNumComps || 1);
    const minimum = minimumDisplayBudget(width, height, sourceDepth, bytesPerVoxel);
    return TEXTURE_BUDGET_STEPS.find(size => size >= Math.max(minimum, bytes / 2)) ?? minimum;
  };
  if (gl.canvas?.addEventListener) {
    recoveryBudgets.set(gl.canvas, () => nextRecoveryBudget(canvasBudgets.get(gl.canvas) ?? (allocatedBytes || activeBudget)));
    if (!watchedCanvases.has(gl.canvas)) {
      watchedCanvases.add(gl.canvas);
      gl.canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        recordGpuDiagnostic('context-lost', { message: event.statusMessage || '' });
        recoverLostContext(gl.canvas);
      });
      gl.canvas.addEventListener('webglcontextrestored', () => {
        recordViewerEvent('context-restored');
        graphicsContextRecovery.restore(gl.canvas);
      });
    }
  }
  let uploadedSlices = 0;
  let uploadMilestone = -1;
  const uploadedPositions = new Set<number>();
  const methods = new Map();
  const error = () => typeof gl.getError === 'function' ? gl.getError() : 0;
  const fail = (policy = false) => { failed = true; const lost = targetLost();
    if (lost && gl.canvas) { recoverLostContext(gl.canvas); return; }
    recordViewerEvent('allocation-error', { bytes: allocatedBytes, ...(policy && !lost ? { code: 10001 } : {}) });
    recordGpuDiagnostic('texture-failed', { contextLost: targetLost(), allocatedBytes, uploadedSlices });
    const tracker = getViewerOpenTracker();
    // Keep the existing wire error code accepted by older CRM deployments.
    // profileReason distinguishes policy rejection from an actual GPU failure.
    if (policy && !lost) tracker?.update({ profileReason: 'detail-policy-limit', sourceDimensions: [width, height, sourceDepth] }, false);
    tracker?.fail(lost ? 'context-lost' : 'texture-unavailable');
    const quality = getRenderingPreference() === 'quality';
    forgetFailedRenderingPreference();
    reportGraphicsError(lost ? contextFailureMessage : quality ? qualityFailureMessage : policy ? failureMessage : resourceFailureMessage);
  };
  const upload = args => {
    if (failed || retryQueued) return;
    // Journal before the first actual upload: drivers can crash before returning an error.
    const milestone = Math.min(16, Math.floor(uploadedSlices * 16 / displayDepth));
    if (milestone !== uploadMilestone) {
      uploadMilestone = milestone;
      recordViewerEvent('index', { value: 'volume', code: 20010, count: uploadedSlices, depth: displayDepth });
      recordGpuDiagnostic('upload-progress', { uploadedSlices, displayDepth, allocatedBytes, nextZ: args[4] });
    }
    gl.texSubImage3D(...args);
    const code = error();
    if (targetLost()) { fail(); return; }
    if (!code) {
      if (uploadedPositions) {
        const previousCount = uploadedSlices;
        for (let z = args[4]; z < args[4] + args[7]; z++) uploadedPositions.add(z);
        uploadedSlices = uploadedPositions.size;
        if (previousCount < displayDepth && uploadedSlices === displayDepth) {
          recordGpuDiagnostic('upload-complete', { uploadedSlices, displayDepth, allocatedBytes });
        }
      }
      return;
    }
    recordGpuDiagnostic('upload-error', { code, allocatedBytes, uploadedSlices });
    recordViewerEvent('allocation-error', { code, bytes: allocatedBytes });
    const bytesPerVoxel = allocatedBytes / (width * height * displayDepth);
    const minimum = minimumDisplayBudget(width, height, sourceDepth, bytesPerVoxel);
    const next = getRenderingPreference() === 'quality' ? undefined : [minimum].find(bytes => bytes < allocatedBytes);
    if (code !== (gl.OUT_OF_MEMORY || 1285) || !next || !controllers.has(volume) ||
        Math.floor(displayDepth * next / allocatedBytes) < Math.ceil(sourceDepth / MAXIMUM_Z_DECIMATION)) { fail(); return; }
    retryQueued = true;
    volume.orbitalGPUFallbackBudget = next;
    rememberGpuRecovery(next);
    // Some drivers commit texture memory only on upload. Re-upload cached source
    // frames after releasing the old GPU allocation, without downloading again.
    queueMicrotask(() => {
      controllers.get(volume).reset();
      getRenderingEngines().forEach(engine => engine.render());
    });
  };
  const targetLost = () => Boolean(gl.isContextLost?.());
  const setDepth = (depth: number, reason: string) => {
    displayDepth = depth;
    sourceToDisplay = new Map();
    for (let z = 0; z < depth; z++) {
      sourceToDisplay.set(Math.round((z + 0.5) * sourceDepth / depth - 0.5), z);
    }
    if (depth < sourceDepth || nearestFiltering) {
      volume.orbitalDisplaySampling = { sourceDepth, displayDepth: depth, reason };
    } else {
      delete volume.orbitalDisplaySampling;
    }
    queueMicrotask(() => {
      if (reason === 'memory') setImageFilter('none');
      if (typeof document !== 'undefined') document.dispatchEvent(new Event('orbital:volume-display-mode'));
    });
  };
  const replaceHandle = () => {
    if (model.handle) { releaseViewerTexture(typeof model.handle === 'object' ? model.handle : texture); gl.deleteTexture(model.handle); }
    model.handle = 0;
    texture.createTexture();
    texture.bind();
    texture.sendParameters();
  };
  return new Proxy(gl, {
    get(target, key) {
      if (methods.has(key)) return methods.get(key);
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      let method = value.bind(target);
      if (key === 'texStorage3D' || key === 'texImage3D') {
        method = (...args) => {
          if (args[3] !== width || args[4] !== height || args[5] !== sourceDepth) return value.apply(target, args);
          if (target.isContextLost?.()) { fail(); return; }
          // Limits are per texture dimension; free VRAM itself is not exposed by WebGL.
          const maximum = target.getParameter?.(target.MAX_3D_TEXTURE_SIZE) || Infinity;
          if (width > maximum || height > maximum) { fail(true); return; }
          const bytes = ([33321].includes(args[2]) ? 1 : [33322, 33325, 36760, 36762].includes(args[2]) ? 2 : 4)
            * (model.inputNumComps || 1);
          const manual = getRenderingPreference() === 'compatibility';
          nearestFiltering = args[2] === 33326 && typeof target.getExtension === 'function' &&
            !target.getExtension('OES_texture_float_linear');
          const deviceBudget = getDeviceTextureBudget();
          const diagnosticBudget = getGpuDiagnosticBudget();
          const preference = getRenderingPreference();
          const quality = preference === 'quality';
          const minimum = minimumDisplayBudget(width, height, sourceDepth, bytes);
          const automaticBudget = preference === 'auto' ? fitAutomaticGpuProfile(minimum,
            Math.min(baseBudget, deviceBudget, diagnosticBudget)).budgetBytes : Infinity;
          let budget = quality ? Infinity : Math.min(baseBudget, deviceBudget, diagnosticBudget, automaticBudget,
            manual ? COMPATIBILITY_TEXTURE_BYTES : Infinity, volume.orbitalGPUFallbackBudget || Infinity);
          activeBudget = budget;
          if (gl.canvas) canvasBudgets.set(gl.canvas, budget);
          const depthForBudget = size => Math.min(sourceDepth, maximum, Math.max(1, Math.floor(size / (width * height * bytes))));
          let depth = depthForBudget(budget);
          const acceptable = count => count >= Math.ceil(sourceDepth / MAXIMUM_Z_DECIMATION);
          // Refuse a coarse texture before displaying it. Explicit quality has
          // one meaning: native Z resolution, or a clear failure, never silent fallback.
          if ((quality && (depth !== sourceDepth || width * height * sourceDepth * bytes > deviceBudget)) || !acceptable(depth)) { fail(true); return; }
          let reason = volume.orbitalGPUFallbackBudget ? 'memory' : Number.isFinite(diagnosticBudget) ? 'diagnostic' : manual || preference === 'economy' ? 'manual' :
            Number.isFinite(automaticBudget) ? 'automatic' :
            depth < sourceDepth ? (deviceBudget < Infinity ? 'mobile' : 'size') : 'normal';
          const fallbackBudgets = quality ? [] : [minimum];
          for (let attempt = 0; attempt < 4; attempt++) {
            // Drain earlier errors so only this allocation decides whether to retry.
            for (let i = 0; i < 8 && error() !== 0; i++) { /* bounded */ }
            const actual = [...args];
            actual[5] = depth;
            if (key === 'texImage3D' && args[9] != null && depth !== sourceDepth) {
              const data = args[9];
              if (!ArrayBuffer.isView(data) || data instanceof DataView) { fail(); return; }
              const stride = width * height * (model.inputNumComps || 1);
              const reduced = new data.constructor(depth * stride);
              for (let z = 0; z < depth; z++) {
                const source = Math.round((z + 0.5) * sourceDepth / depth - 0.5);
                reduced.set(data.subarray(source * stride, (source + 1) * stride), z * stride);
              }
              actual[9] = reduced;
            }
            uploadedSlices = 0;
            uploadMilestone = -1;
            uploadedPositions?.clear();
            recordGpuDiagnostic('allocation-start', { operation: key, sourceDimensions: [width, height, sourceDepth],
              displayDimensions: [width, height, depth], internalFormat: args[2], bytesPerVoxel: bytes,
              textureBytes: width * height * depth * bytes, budgetBytes: Number.isFinite(budget) ? budget : null,
              max3DTextureSize: Number.isFinite(maximum) ? maximum : null, attempt, reason });
            try { value.apply(target, actual); }
            catch (cause) { recordGpuDiagnostic('allocation-exception', { message: String(cause) }); throw cause; }
            const code = error();
            recordGpuDiagnostic('allocation-result', { code, contextLost: target.isContextLost?.() || false });
            if (!code && !target.isContextLost?.()) {
              failed = false;
              allocatedBytes = width * height * depth * bytes;
              const sourceBytes = width * height * sourceDepth * (/8/.test(volume.dataType || '') ? 1 : /16/.test(volume.dataType || '') ? 2 : /64/.test(volume.dataType || '') ? 8 : 4);
              recordViewerTexture(typeof model.handle === 'object' && model.handle ? model.handle : texture,
                allocatedBytes, sourceBytes, [width, height, depth], args[2]);
              reportViewerAllocation([width, height, sourceDepth], [width, height, depth], allocatedBytes, budget, reason);
              if (gl.canvas) canvasBudgets.set(gl.canvas, allocatedBytes);
              if (reason === 'memory') rememberGpuRecovery(budget);
              if (nearestFiltering) {
                target.texParameteri(args[0], target.TEXTURE_MIN_FILTER, target.NEAREST);
                target.texParameteri(args[0], target.TEXTURE_MAG_FILTER, target.NEAREST);
              }
              setDepth(depth, reason === 'normal' && nearestFiltering ? 'filtering' : reason);
              return;
            }
            if (![target.OUT_OF_MEMORY || 1285, target.INVALID_VALUE || 1281].includes(code) || target.isContextLost?.()) {
              fail(); return;
            }
            const next = fallbackBudgets.find(size => size < budget && depthForBudget(size) < depth);
            if (!next || !acceptable(depthForBudget(next))) { fail(); return; }
            budget = next;
            activeBudget = budget;
            depth = depthForBudget(budget);
            reason = 'memory';
            replaceHandle();
          }
          fail();
        };
      } else if (key === 'deleteTexture') {
        method = (...args) => {
          const result = value.apply(target, args);
          releaseViewerTexture(typeof args[0] === 'object' && args[0] ? args[0] : texture);
          return result;
        };
      } else if (key === 'texParameteri') {
        method = (...args) => {
          if (nearestFiltering && args[0] === target.TEXTURE_3D &&
              [target.TEXTURE_MIN_FILTER, target.TEXTURE_MAG_FILTER].includes(args[1]) && args[2] === target.LINEAR) {
            args[2] = target.NEAREST;
          }
          return value.apply(target, args);
        };
      } else if (key === 'texSubImage3D') {
        method = (...args) => {
          if (failed || retryQueued) return;
          if (displayDepth === sourceDepth) return upload(args);
          const zOffset = args[4], count = args[7];
          for (let source = zOffset; source < zOffset + count; source++) {
            const z = sourceToDisplay.get(source);
            if (z === undefined) continue;
            const actual = [...args];
            actual[4] = z;
            actual[7] = 1;
            if (count > 1) {
              const stride = args[5] * args[6] * (model.inputNumComps || 1);
              if (!args[10]?.subarray) { fail(); return; }
              actual[10] = args[10].subarray((source - zOffset) * stride, (source - zOffset + 1) * stride);
            }
            upload(actual);
          }
        };
      }
      methods.set(key, method);
      return method;
    },
  });
}

export function configureAdaptiveVolumeTexture(volume, baseBudget = Infinity) {
  if (!volume || configured.has(volume) || volume.isDynamicVolume?.() || !Array.isArray(volume.dimensions) ||
      volume.dimensions.length !== 3 || !volume.dimensions.every(v => Number.isSafeInteger(v) && v > 0)) return false;
  const texture = volume.vtkOpenGLTexture;
  const model = texture?.get?.();
  if (!model || Object.getOwnPropertyDescriptor(model, 'context')?.configurable === false) return false;
  let context = model.context;
  recordGpuDiagnostic('volume-configured', { dimensions: [...volume.dimensions], dataType: volume.dataType,
    baseBudgetBytes: Number.isFinite(baseBudget) ? baseBudget : null });
  let contexts = new WeakMap<object, object>();
  Object.defineProperty(model, 'context', { configurable: true, enumerable: true,
    get: () => {
      if (!context) return context;
      if (!contexts.has(context)) contexts.set(context, createAdaptiveTextureContext(context, volume, texture, model, baseBudget));
      return contexts.get(context);
    },
    set: value => { context = value; },
  });
  controllers.set(volume, { reset: () => {
    texture.releaseGraphicsResources(model._openGLRenderWindow);
    // Streaming setTextureParameters uses ??=; undefined requests fresh original dimensions.
    model.width = model.height = model.depth = undefined;
    contexts = new WeakMap();
    texture.modified();
  } });
  configured.add(volume);
  return true;
}

export function installRenderingPreferenceControl() {
  if (subscribed) return;
  subscribed = true;
  subscribeRenderingPreference(() => {
    reportViewerProfile();
    if (getRenderingPreference() === 'compatibility') setImageFilter('none');
    const seen = new Set();
    for (const engine of getRenderingEngines()) {
      for (const viewport of engine.getViewports()) {
        const id = viewport.getVolumeId?.();
        const volume = id && cache.getVolume(id);
        if (volume && !seen.has(volume)) {
          seen.add(volume);
          delete volume.orbitalGPUFallbackBudget;
          controllers.get(volume)?.reset();
        }
      }
      engine.render();
    }
  });
}
