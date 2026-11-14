import type { GpuDevice } from '@ohif/core/src/constants/orbitalGpuProfile';

export const WEBGL2_UNAVAILABLE = 'На вашем компьютере, к сожалению, не получится открыть исследование: браузер не предоставляет WebGL 2.';
export const WEBGL2_HELP = 'Включите аппаратное ускорение в настройках браузера и полностью перезапустите его. Если оно уже включено, обновите браузер и драйвер видеокарты либо откройте исследование на другом компьютере.';

export type VolumeRenderingSupport =
  | { supported: true; max3DTextureSize: number; gpuDevice: GpuDevice }
  | { supported: false; reason: 'webgl2-unavailable' | 'texture-unavailable' };

/** Probe the actual 3D texture API, not just a browser name or an acceleration checkbox. */
export function checkVolumeRenderingSupport(): VolumeRenderingSupport {
  let gl: WebGL2RenderingContext | null = null;
  let texture: WebGLTexture | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
    if (!gl || typeof gl.texImage3D !== 'function' || typeof gl.texStorage3D !== 'function' ||
        typeof gl.texSubImage3D !== 'function') {
      return { supported: false, reason: 'webgl2-unavailable' };
    }
    const max3DTextureSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    if (!Number.isFinite(max3DTextureSize) || max3DTextureSize < 1 || gl.isContextLost()) {
      return { supported: false, reason: 'texture-unavailable' };
    }
    texture = gl.createTexture();
    if (!texture) return { supported: false, reason: 'texture-unavailable' };
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, 1, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([127]));
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) {
      return { supported: false, reason: 'texture-unavailable' };
    }
    // Reuse the tiny preflight context; no additional benchmark or large allocations.
    let renderer = '';
    try {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      if (debug?.UNMASKED_RENDERER_WEBGL) renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) || '');
    } catch { /* Privacy policies may hide the adapter. */ }
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ||
      (/Mac/i.test(navigator.platform || '') && navigator.maxTouchPoints > 1);
    return { supported: true, max3DTextureSize, gpuDevice: { renderer, mobile,
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory, max3DTextureSize } };
  } catch {
    return { supported: false, reason: gl ? 'texture-unavailable' : 'webgl2-unavailable' };
  } finally {
    if (gl) {
      try {
        if (texture) gl.deleteTexture(texture);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* A lost context has nothing left to release. */ }
    }
  }
}
