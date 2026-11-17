import { getRenderingPreference } from './orbitalRendering';
import { getAutomaticGpuProfile } from './orbitalGpuProfile';
import type { GpuDevice } from './orbitalGpuProfile';
import { getGpuDiagnosticBudget } from './orbitalGpuDiagnostics';
import { ViewerDiagnostics, getViewerDiagnostics, setViewerDiagnostics, recordViewerEvent, DIAGNOSTIC_BODY_LIMIT } from './orbitalViewerDiagnostics';
import { startDiagnosticRuntime } from './orbitalDiagnosticRuntime';

export const MPR_TELEMETRY_IDS = ['mpr-coronal', 'mpr-sagittal', 'mpr-axial'];
export type OpenSnapshot = {
  sequence: number; status: 'loading' | 'ready' | 'error' | 'interrupted'; elapsedMs: number;
  firstSliceMs: number | null; readyMs: number | null; errorCode: string | null;
  loaded: number; total: number; failed: number; rendered: string[];
  requestedMode: string; budgetMiB: number | null; profileReason: string;
  renderer: string; deviceMemory: number | null; max3DTextureSize: number | null;
  sourceDimensions: number[] | null; displayDimensions: number[] | null; textureBytes: number | null;
  bundle: string;
  readyMode: string | null; readyBudgetMiB: number | null;
};

/** One opening, including errors after initial success. No pixels, URLs or clinical identifiers. */
export class ViewerOpenTracker {
  private started: number;
  private confirmed = new Set<string>();
  private allLoaded = false;
  readonly state: OpenSnapshot;
  constructor(private now = () => performance.now(), private changed: () => void = () => {}) {
    this.started = now();
    this.state = { sequence: 0, status: 'loading', elapsedMs: 0, firstSliceMs: null, readyMs: null,
      errorCode: null, loaded: 0, total: 0, failed: 0, rendered: [], requestedMode: 'auto', budgetMiB: null,
      profileReason: 'unknown', renderer: '', deviceMemory: null, max3DTextureSize: null,
      sourceDimensions: null, displayDimensions: null, textureBytes: null, bundle: '', readyMode: null, readyBudgetMiB: null };
  }
  update(fields: Partial<OpenSnapshot>, notify = true) {
    Object.assign(this.state, fields);
    this.state.elapsedMs = Math.max(0, Math.round(this.now() - this.started));
    this.state.sequence++;
    if (notify) this.changed();
  }
  progress(loaded: number, total: number, failed: number) {
    if (this.state.readyMs !== null) return false; // Keep the opening's completed series, not later navigation.
    const complete = total > 0 && loaded >= total && failed === 0;
    const firstComplete = complete && !this.allLoaded;
    if (firstComplete) { this.confirmed.clear(); this.state.rendered = []; }
    if (firstComplete && this.state.errorCode === 'slice-load-failed') this.update({ status: 'loading', errorCode: null }, false);
    this.allLoaded = complete;
    this.update({ loaded, total, failed }, false);
    // Per-slice progress stays in memory; only milestones are transmitted.
    if (firstComplete || failed > 0) this.changed();
    return firstComplete;
  }
  frame(viewportId: string) {
    if (!MPR_TELEMETRY_IDS.includes(viewportId) || this.state.status === 'error' || this.state.status === 'interrupted' || !this.state.loaded) return;
    const elapsed = Math.max(0, Math.round(this.now() - this.started));
    if (this.state.firstSliceMs === null) this.update({ firstSliceMs: elapsed });
    if (!this.allLoaded || this.state.readyMs !== null) return;
    this.confirmed.add(viewportId);
    this.update({ rendered: [...this.confirmed] }, false);
    if (MPR_TELEMETRY_IDS.every(id => this.confirmed.has(id))) {
      recordViewerEvent('ready');
      this.update({ status: 'ready', readyMs: elapsed, errorCode: null,
        readyMode: this.state.requestedMode, readyBudgetMiB: this.state.budgetMiB });
    }
  }
  fail(code: string) { recordViewerEvent('error', { value: code }); this.update({ status: 'error', errorCode: code }); }
  close() { if (this.state.status === 'loading') this.update({ status: 'interrupted' }); }
}

let active: ViewerOpenTracker | null = null;
let device: GpuDevice = {};
export const getViewerOpenTracker = () => active;

export function reportViewerProfile(nextDevice?: GpuDevice) {
  if (!active) return;
  if (nextDevice) device = nextDevice;
  const requestedMode = getRenderingPreference();
  const diagnostic = getGpuDiagnosticBudget();
  const profile = getAutomaticGpuProfile();
  const budget = Number.isFinite(diagnostic) ? diagnostic : requestedMode === 'economy' ? 64 * 1024 ** 2 :
    requestedMode === 'compatibility' ? 256 * 1024 ** 2 : requestedMode === 'auto' ? profile.budgetBytes : Infinity;
  active.update({ requestedMode: Number.isFinite(diagnostic) ? 'diagnostic' : requestedMode,
    budgetMiB: Number.isFinite(budget) ? budget / 1024 ** 2 : null,
    profileReason: Number.isFinite(diagnostic) ? 'diagnostic' : requestedMode === 'auto' ? profile.reason : 'manual',
    renderer: String(device.renderer || '').slice(0, 240), deviceMemory: device.deviceMemory > 0 ? device.deviceMemory : null,
    max3DTextureSize: device.max3DTextureSize || null });
}

export function reportViewerAllocation(sourceDimensions: number[], displayDimensions: number[], textureBytes: number, budget: number, reason: string) {
  reportViewerProfile();
  active?.update({ sourceDimensions: [...sourceDimensions], displayDimensions: [...displayDimensions], textureBytes,
    budgetMiB: Number.isFinite(budget) ? Math.round(budget / 1024 ** 2) : null,
    profileReason: reason === 'automatic' ? getAutomaticGpuProfile().reason : reason });
}

/** Optional reporting must never delay or reject a study. Only CRM token launches are tracked. */
export function startViewerOpenTelemetry(launchToken: string) {
  if (active || !launchToken || launchToken.length > 256) return;
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) return;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  const runId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  let csrf = '', initialized = false, sending = false, stopped = false, diagnosticsEnabled = false;
  let csrfAt = 0, retries = 0, retrying = false;
  let sentSequence = -1;
  let timer: ReturnType<typeof setTimeout>;
  let retryTimer: ReturnType<typeof setTimeout>;
  let stopRuntime: (() => void) | undefined;
  const tracker = new ViewerOpenTracker(() => performance.now(), () => schedule());
  active = tracker;
  const choice = new URLSearchParams(window.location.search).get('viewerDiagnostics');
  const collector = choice === 'off' ? null : new ViewerDiagnostics(() => performance.now(), choice === 'deep');
  setViewerDiagnostics(collector);
  const stopReporting = () => {
    stopped = true; clearTimeout(timer); clearTimeout(retryTimer); stopRuntime?.();
    if (getViewerDiagnostics() === collector) setViewerDiagnostics(null);
  };
  const script = document.querySelector<HTMLScriptElement>('script[src*="app.bundle."]');
  tracker.state.bundle = script?.src.match(/app\.bundle\.([a-f0-9]+)\.js/)?.[1] || '';
  const send = (url: string, options: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
  };
  const schedule = (immediate = false) => {
    if (stopped || retrying) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), immediate ? 0 : 1000);
  };
  const retry = (bootstrap: boolean) => {
    if (stopped) return;
    if (collector) collector.transport.failures++;
    if (retries >= 3) { stopReporting(); return; }
    retrying = true;
    const delay = [30000, 120000, 300000][retries++];
    retryTimer = setTimeout(() => {
      retrying = false;
      if (!stopped) void (bootstrap ? configure() : flush());
    }, delay);
  };
  const flush = async () => {
    if (!csrf || sending || stopped || retrying || sentSequence === tracker.state.sequence) return;
    if (performance.now() - csrfAt >= 50 * 60000) { void configure(); return; }
    sending = true;
    const sequence = tracker.state.sequence;
    try {
      const body: any = initialized ? { snapshot: tracker.state } : { runId, launchToken, snapshot: tracker.state };
      if (diagnosticsEnabled && collector) body.diagnostics = collector.snapshot();
      let payload = JSON.stringify(body);
      let bytes = new Blob([payload]).size;
      if (bytes > DIAGNOSTIC_BODY_LIMIT) {
        delete body.diagnostics; payload = JSON.stringify(body); bytes = new Blob([payload]).size;
      }
      if (collector) { collector.transport.posts++; collector.transport.bodyBytes += bytes; }
      const response = await send(initialized ? `/api/viewer/telemetry/sessions/${runId}` : '/api/viewer/telemetry/sessions', {
        // HTTPS CSRF validation requires a same-origin Referer. Send only the origin,
        // never the /v/<launchToken> path, while keeping the server's protection enabled.
        method: 'POST', credentials: 'same-origin', keepalive: true, referrerPolicy: 'origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: payload,
      });
      if (stopped) return;
      if (response.ok) { initialized = true; sentSequence = sequence; }
      else if (response.status >= 500 || response.status === 429) retry(false);
      else stopReporting();
    } catch (_error) { retry(false); }
    finally { sending = false; if (sentSequence !== tracker.state.sequence && !stopped && !retrying) schedule(); }
  };
  const onHide = () => { recordViewerEvent('visibility', { value: 'pagehide' }); tracker.close(); schedule(true); void flush(); };
  window.addEventListener('pagehide', onHide);
  const configure = async () => {
    try {
      // Never include the /v/<token> Referer in bootstrap.
      const response = await send('/api/viewer/telemetry/config', { credentials: 'same-origin', referrerPolicy: 'no-referrer' });
      if (stopped) return;
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) retry(true);
        else stopReporting();
        return;
      }
      const value = await response.json();
      if (stopped || typeof value?.csrfToken !== 'string') return;
      csrf = value.csrfToken; csrfAt = performance.now();
      diagnosticsEnabled = value.diagnosticsVersion === 1 && !!collector;
      if (!diagnosticsEnabled) setViewerDiagnostics(null);
      if (diagnosticsEnabled && !stopRuntime) {
        try {
          stopRuntime = startDiagnosticRuntime(collector, runId, () => {
            if (['loading', 'ready'].includes(tracker.state.status)) { tracker.update({}, false); schedule(true); }
          });
        } catch { /* Reporting continues even if optional browser APIs are unavailable. */ }
      }
      schedule(true);
    } catch (_error) { if (!stopped) retry(true); }
  };
  void configure();
  return () => {
    stopReporting(); window.removeEventListener('pagehide', onHide);
    if (active === tracker) active = null;
  };
}
