import { MINIMUM_TEXTURE_BUDGET } from './orbitalRenderingPolicy';
// Browser-local policy, selected before any study or rendering engine is loaded.
export type GpuDevice = { renderer?: string; deviceMemory?: number; mobile?: boolean; max3DTextureSize?: number };
export type GpuProfile = { budgetBytes: number; reason: string };
export const GPU_RECOVERY_KEY = 'orbital:gpu-recovery:v1';
const MiB = 1024 ** 2;
const RECOVERY_AGE = 30 * 24 * 60 * 60 * 1000;
let automatic: GpuProfile = { budgetBytes: Infinity, reason: 'desktop' };
let identity = '';
const readRecovery = () => {
  try { return JSON.parse(localStorage.getItem(GPU_RECOVERY_KEY) || 'null'); }
  catch { return null; }
};

/** Hints, not a VRAM measurement. Hidden/unknown adapters are not treated as obsolete. */
export function chooseGpuProfile(device: GpuDevice): GpuProfile {
  const renderer = device.renderer || '';
  const ram = device.deviceMemory;
  if (/SwiftShader|llvmpipe|Software (?:Rasterizer|Adapter)|Microsoft Basic Render/i.test(renderer)) {
    return { budgetBytes: MINIMUM_TEXTURE_BUDGET, reason: 'software-webgl' };
  }
  // Includes the tested Bay Trail 0x0f31; do not match modern UHD/Iris/HD 5000+.
  if (/Intel/i.test(renderer) && (/0x0*0f31\b/i.test(renderer) ||
      /\bHD(?:\s+Graphics)?\s*(?:2000|2500|3000|4000)\b/i.test(renderer) ||
      /\bHD Graphics\s*(?:\(|Direct3D|$)/i.test(renderer))) {
    return { budgetBytes: MINIMUM_TEXTURE_BUDGET, reason: 'legacy-intel' };
  }
  if (device.mobile) return { budgetBytes: MINIMUM_TEXTURE_BUDGET, reason: 'mobile' };
  if (ram > 0 && ram <= 2) return { budgetBytes: MINIMUM_TEXTURE_BUDGET, reason: 'low-memory' };
  if (ram > 0 && ram <= 4) return { budgetBytes: MINIMUM_TEXTURE_BUDGET, reason: 'limited-memory' };
  return { budgetBytes: Infinity, reason: 'desktop' };
}

export function initializeAutomaticGpuProfile(device: GpuDevice, now = Date.now()) {
  automatic = chooseGpuProfile(device);
  identity = JSON.stringify([String(device.renderer || '').slice(0, 240), device.deviceMemory || 0,
    Boolean(device.mobile), device.max3DTextureSize || 0]);
  try {
    const saved = readRecovery();
    if (saved?.identity === identity && [64, 128, 256].includes(saved.budgetMiB) &&
        Number.isFinite(saved.at) && saved.at <= now && now - saved.at < RECOVERY_AGE) {
      const recovered = Math.max(MINIMUM_TEXTURE_BUDGET, saved.budgetMiB * MiB);
      if (recovered < automatic.budgetBytes) {
        automatic = { budgetBytes: recovered, reason: 'previous-graphics-error' };
      }
    }
  } catch { /* No storage or invalid data: use the hardware hints only. */ }
  return automatic;
}

export const getAutomaticGpuProfile = () => automatic;

/** Remember the next startup budget, without changing a live engine or reloading the study. */
export function rememberGpuRecovery(budgetBytes: number, now = Date.now()) {
  if (!identity || !Number.isFinite(budgetBytes)) return;
  const budgetMiB = [256].find(value => value * MiB >= budgetBytes);
  if (!budgetMiB) return;
  try {
    const saved = readRecovery();
    const previous = saved?.identity === identity && [64, 128, 256].includes(saved.budgetMiB) &&
      Number.isFinite(saved.at) && saved.at <= now && now - saved.at < RECOVERY_AGE ? Math.max(256, saved.budgetMiB) : Infinity;
    localStorage.setItem(GPU_RECOVERY_KEY, JSON.stringify({ identity, budgetMiB: Math.min(previous, budgetMiB), at: now }));
  } catch { /* Recovery hints must never break rendering. */ }
}
