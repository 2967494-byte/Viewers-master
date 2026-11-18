import { MINIMUM_TEXTURE_BUDGET, TEXTURE_BUDGET_STEPS } from './orbitalRenderingPolicy';
// Browser-local policy, selected before any study or rendering engine is loaded.
export type GpuDevice = { renderer?: string; deviceMemory?: number; mobile?: boolean; max3DTextureSize?: number };
export type GpuProfile = { budgetBytes: number; reason: string };
export const GPU_RECOVERY_KEY = 'orbital:gpu-recovery:v1';
const MiB = 1024 ** 2;
export const GPU_RECOVERY_AGE = 2 * 60 * 60 * 1000;
let automatic: GpuProfile = { budgetBytes: Infinity, reason: 'desktop' };
let identity = '';
const listeners = new Set<() => void>();
export const subscribeAutomaticGpuProfile = (listener: () => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
};
const notify = () => listeners.forEach(listener => listener());
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
    if (saved?.identity === identity && [64, 128, 256, 384, 512, 640, 768].includes(saved.budgetMiB) &&
        Number.isFinite(saved.at) && saved.at <= now && now - saved.at < GPU_RECOVERY_AGE) {
      // Legacy 256 MiB recovery must not keep large studies in a rejected profile.
      // Hardware/mobile limits below remain independent and are never raised here.
      const recovered = (saved.version === 2 ? Math.max(256, saved.budgetMiB) : Math.max(384, saved.budgetMiB)) * MiB;
      if (recovered < automatic.budgetBytes) {
        automatic = { budgetBytes: recovered, reason: 'previous-graphics-error' };
      }
    }
  } catch { /* No storage or invalid data: use the hardware hints only. */ }
  notify();
  return automatic;
}

export const getAutomaticGpuProfile = () => automatic;

/** Only soft desktop hints may grow to the study's minimum acceptable size. */
export function fitAutomaticGpuProfile(minimum: number, ceiling: number) {
  if (['previous-graphics-error', 'limited-memory'].includes(automatic.reason) &&
      automatic.budgetBytes < minimum && minimum <= ceiling && Number.isFinite(minimum)) {
    automatic = { ...automatic, budgetBytes: minimum };
    notify();
  }
  return automatic;
}

/** Reset the next opening only; never increase allocations in a running engine. */
export function clearGpuRecovery() {
  try { localStorage.removeItem(GPU_RECOVERY_KEY); return true; }
  catch { return false; }
}

/** Remember the next startup budget, without changing a live engine or reloading the study. */
export function rememberGpuRecovery(budgetBytes: number, now = Date.now()) {
  if (!identity || !Number.isFinite(budgetBytes)) return;
  const budgetMiB = TEXTURE_BUDGET_STEPS.find(value => value >= budgetBytes) / MiB;
  if (!budgetMiB) return;
  try {
    // The latest series determines a usable recovery size. Do not retain the
    // minimum of unrelated failures and silently lock every later series down.
    localStorage.setItem(GPU_RECOVERY_KEY, JSON.stringify({ version: 2, identity, budgetMiB, at: now }));
  } catch { /* Recovery hints must never break rendering. */ }
}
