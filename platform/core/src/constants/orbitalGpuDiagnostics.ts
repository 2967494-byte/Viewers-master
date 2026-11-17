// Opt-in, browser-local diagnostics. Never include URLs, DICOM IDs or patient metadata.
export const GPU_DIAGNOSTIC_PROFILE_KEY = 'orbital:gpu-diagnostic-profile:v1';
export const GPU_DIAGNOSTIC_REPORT_KEY = 'orbital:gpu-render-report:v1';
export const GPU_DIAGNOSTIC_TEXTURE_BYTES = 64 * 1024 ** 2;
const MAX_EVENTS = 160;
let budget = Infinity;
let report: { version: string; startedAt: string; textureBudgetBytes: number | null; events: object[] } | null = null;

export function getGpuDiagnosticBudget() { return budget; }
export function isGpuDiagnosticSession() { return report !== null; }

/** Snapshot before engine initialization; changing the flag requires reopening the viewer. */
export function beginGpuDiagnosticSession() {
  budget = Infinity;
  report = null;
  try {
    if (localStorage.getItem(GPU_DIAGNOSTIC_PROFILE_KEY) !== '64') return;
    // The old diagnostic page may have left this flag behind. Keep its journal,
    // but never force a real patient study into the retired 64 MiB display mode.
    localStorage.removeItem(GPU_DIAGNOSTIC_PROFILE_KEY);
  } catch { return; /* Storage-disabled browsers retain their normal rendering configuration. */ }
  if (typeof localStorage === 'undefined') return;
  report = { version: 'orbital-gpu-render-20261114-v1', startedAt: new Date().toISOString(),
    textureBudgetBytes: null, events: [] };
  recordGpuDiagnostic('session-start', { textureBudgetBytes: null, legacyProfileRetired: true });
}

export function recordGpuDiagnostic(stage: string, details: Record<string, unknown> = {}) {
  if (!report) return;
  const event = { at: new Date().toISOString(), stage, ...details };
  report.events.push(event);
  if (report.events.length > MAX_EVENTS) report.events.shift();
  console.info('[orbital-gpu-diagnostic] ' + JSON.stringify(event));
  try { localStorage.setItem(GPU_DIAGNOSTIC_REPORT_KEY, JSON.stringify(report)); }
  catch { /* Console diagnostics still work if local persistence is unavailable. */ }
}
