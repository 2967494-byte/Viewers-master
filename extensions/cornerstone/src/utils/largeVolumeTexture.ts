import { Enums, eventTarget } from '@cornerstonejs/core';
import { configureAdaptiveVolumeTexture, installRenderingPreferenceControl, getDeviceTextureBudget } from './adaptiveVolumeTexture';
import { getRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { getAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';

const FLOAT_TEXTURE_BUDGET = 1024 ** 3;
const COMPACT_TEXTURE_BUDGET = 768 * 1024 ** 2;
const configured = new WeakSet<object>();
let installed = false;

/** Limit only the display texture's Z samples; retain all source frames on CPU. */
export function createDepthLimitedTextureContext(context: any, dimensions: number[]) {
  const [width, height, depth] = dimensions;
  const displayDepth = Math.min(depth, Math.max(1,
    Math.floor(COMPACT_TEXTURE_BUDGET / (width * height * 2))));
  if (displayDepth === depth) return context;
  const sourceToDisplay = new Map<number, number>();
  for (let z = 0; z < displayDepth; z++) {
    // Preserve the physical outer bounds and texel centers. Order-independent:
    // every output slice has exactly one original slice supplying its pixels.
    sourceToDisplay.set(Math.round((z + 0.5) * depth / displayDepth - 0.5), z);
  }
  const methods = new Map();
  return new Proxy(context, {
    get(target, key) {
      if (methods.has(key)) return methods.get(key);
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      let method = value.bind(target);
      if (key === 'texStorage3D') {
        method = (...args: any[]) => {
          if (args[3] === width && args[4] === height && args[5] === depth) {
            args[5] = displayDepth;
          }
          return value.apply(target, args);
        };
      } else if (key === 'texSubImage3D') {
        method = (...args: any[]) => {
          if (args[5] === width && args[6] === height && args[7] === 1) {
            const z = sourceToDisplay.get(args[4]);
            if (z === undefined) return;
            args[4] = z;
          }
          return value.apply(target, args);
        };
      }
      methods.set(key, method);
      return method;
    },
  });
}

/** Compact signed source voxels before considering any spatial reduction. */
export function configureLargeVolumeTexture(volume: any): boolean {
  if (!volume || configured.has(volume) || volume.dataType !== 'Int16Array') return false;
  const dimensions = volume.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length !== 3 ||
      !dimensions.every(value => Number.isSafeInteger(value) && value > 0)) return false;
  const texture = volume.vtkOpenGLTexture;
  if (typeof texture?.useHalfFloat !== 'function' || typeof texture.getOglNorm16Ext !== 'function' ||
      typeof texture.get !== 'function') return false;
  const model = texture.get();
  if (!model || !['enableUseHalfFloat', 'canUseHalfFloat'].every(key =>
    Object.getOwnPropertyDescriptor(model, key)?.configurable !== false)) return false;

  // Cornerstone's streaming mapper disables half-float even when a single R32F
  // texture exceeds ANGLE's allocation limit. VTK already handles R16F upload
  // and conversion. Prefer exact normalized signed 16-bit if supported; otherwise
  // signed Int16's entire range fits finite half-float. Never change voxel data.
  // VTK freezes its public API. get() exposes the mutable model;
  // pin these two per-texture flags so the streaming mapper cannot disable R16F.
  // Keep accessors configurable for VTK's normal delete() lifecycle.
  const large = dimensions.reduce((size, value) => size * value, 4) > FLOAT_TEXTURE_BUDGET;
  const constrained = () => getRenderingPreference() === 'compatibility' || Number.isFinite(getDeviceTextureBudget()) ||
    (getRenderingPreference() === 'auto' && Number.isFinite(getAutomaticGpuProfile().budgetBytes));
  Object.defineProperties(model, {
    enableUseHalfFloat: { configurable: true, enumerable: true,
      get: () => !texture.getOglNorm16Ext() && getRenderingPreference() !== 'quality' && (large || constrained()), set: () => {} },
    canUseHalfFloat: { configurable: true, enumerable: true,
      get: () => true, set: () => {} },
  });
  // Publish sampling metadata only after a real successful allocation. A chosen
  // quality profile must not inherit this normal-mode cap or an earlier label.
  configureAdaptiveVolumeTexture(volume, COMPACT_TEXTURE_BUDGET);
  configured.add(volume);
  return true;
}

export function installLargeVolumeTextureSupport(): void {
  if (installed) return;
  installed = true;
  installRenderingPreferenceControl();
  eventTarget.addEventListener(Enums.Events.VOLUME_LOADED, (event: any) => {
    const volume = event.detail?.volume;
    if (configureLargeVolumeTexture(volume)) {
      console.info('[orbital-rendering] GPU scalar storage configured', {
        dimensions: event.detail.volume.dimensions,
        cpuDataType: event.detail.volume.dataType,
      });
    } else configureAdaptiveVolumeTexture(volume);
  });
}
