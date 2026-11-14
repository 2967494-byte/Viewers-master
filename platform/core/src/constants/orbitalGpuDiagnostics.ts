// Opt-in, browser-local diagnostics. Never include URLs, DICOM IDs or patient metadata.
export const GPU_DIAGNOSTIC_PROFILE_KEY = 'orbital:gpu-diagnostic-profile:v1';
export const GPU_DIAGNOSTIC_REPORT_KEY = 'orbital:gpu-render-report:v1';
export const GPU_DIAGNOSTIC_TEXTURE_BYTES = 64 * 1024 ** 2;
const MAX_EVENTS = 160;
let budget = Infinity;
let report: { version: string; startedAt: string; textureBudgetBytes: number; events: object[] } | null = null;

export function getGpuDiagnosticBudget() { return budget; }

/** Snapshot before engine initialization; changing the flag requires reopening the viewer. */
export function beginGpuDiagnosticSession() {
  budget = Infinity;
  report = null;
  try {
    if (localStorage.getItem(GPU_DIAGNOSTIC_PROFILE_KEY) === '64') budget = GPU_DIAGNOSTIC_TEXTURE_BYTES;
  } catch { /* Storage-disabled browsers retain their normal rendering configuration. */ }
  if (!Number.isFinite(budget)) return;
  report = { version: 'orbital-gpu-render-20261114-v1', startedAt: new Date().toISOString(),
    textureBudgetBytes: budget, events: [] };
  recordGpuDiagnostic('session-start', { textureBudgetBytes: budget });
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
