import { ViewerDiagnostics, setViewerDiagnostics, recordViewerEvent } from '@ohif/core/src/constants/orbitalViewerDiagnostics';
import { startDiagnosticRuntime } from '@ohif/core/src/constants/orbitalDiagnosticRuntime';

const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const ids = ['mpr-coronal', 'mpr-sagittal', 'mpr-axial'];
const originalFetch = global.fetch;
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.(); stop = undefined; setViewerDiagnostics(null);
  global.fetch = originalFetch; window.history.replaceState(null, '', '/');
  jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers();
});

it('keeps a bounded retroactive history, sends no actions in basic reports and rejects free-form data', () => {
  let time = 0;
  const c = new ViewerDiagnostics(() => time);
  for (let i = 0; i < 100; i++) { time += 1000; c.event('tool', { value: i % 2 ? 'pan' : 'navigate' }); }
  c.event('filter', { value: 'patient-secret-url', bytes: Infinity, ...({ patientName: 'secret' } as any) });
  c.event('invalid' as any, { value: 'secret' });
  expect(c.snapshot()).toMatchObject({ level: 'basic', events: [], memory: null });
  c.event('error', { value: 'context-lost' });
  const report = c.snapshot();
  expect(report).toMatchObject({ level: 'detailed', reason: 'error', eventsTotal: 103 });
  expect(report.events).toHaveLength(40);
  expect(report.events[39]).toMatchObject({ type: 'error', value: 'context-lost' });
  expect(JSON.stringify(report)).not.toMatch(/secret|Infinity|patientName/);
  expect(new Blob([JSON.stringify(report)]).size).toBeLessThan(24 * 1024);
  report.events[0].type = 'error';
  expect(c.snapshot().events[0].type).toBe('tool'); // Returned metadata is detached.
});

it('tracks known allocations without retaining buffers and does not count replacement or double-free twice', () => {
  const c = new ViewerDiagnostics(() => 0);
  const first = {}, second = {};
  c.allocate(first, 100, 1000, [10, 10, 1]); c.allocate(first, 200, 1000, [10, 10, 2]);
  c.allocate(second, 300, 1000, [10, 10, 3]);
  expect(c.resources).toMatchObject({ textures: 2, textureBytes: 500, texturePeakBytes: 500, sourceBytes: 1000 });
  c.release(first); c.release(first); c.release({});
  expect(c.resources).toMatchObject({ textures: 1, textureBytes: 300, releases: 1, allocations: 3 });
  c.release(second); expect(c.resources.textureBytes).toBe(0);
});

it('counts physical transfers, decode errors and canvas changes without measuring basic draw times or memory', () => {
  const c = new ViewerDiagnostics(() => 0);
  c.network(1000, 10, true); c.network(0, 20, false);
  c.decode(50, true); c.decode(10, false);
  c.draw('mpr-axial', 100, 200, 5); c.draw('mpr-axial', 100, 200, 5);
  c.draw('mpr-coronal', 100, 100, 5); c.draw('mpr-axial', 200, 200, 5);
  c.draw('unrelated', 1000, 1000, 100); c.sampleMemory(1000); c.longTask(300);
  expect(c.snapshot()).toMatchObject({
    resources: { canvasPixels: 50000 },
    work: { fetches: 2, fetchBytes: 1000, fetchMs: 30, fetchFailures: 1, decodes: 2, decodeMs: 60, decodeFailures: 1 },
    render: { draws: 4, drawMs: null, longTasks: null }, memory: null,
  });
  const deep = new ViewerDiagnostics(() => 100, true);
  deep.draw('mpr-axial', 100, 100, 12); deep.longTask(300); deep.sampleMemory(5000);
  expect(deep.snapshot()).toMatchObject({ level: 'detailed', reason: 'manual', memory: { bytes: 5000 },
    render: { draws: 1, drawMs: 12, longTasks: 1, longestTaskMs: 300 } });
});

it('makes optional instrumentation errors harmless to the renderer', () => {
  const c = new ViewerDiagnostics(); setViewerDiagnostics(c);
  jest.spyOn(c, 'event').mockImplementation(() => { throw new Error('diagnostics-only failure'); });
  expect(() => recordViewerEvent('mode', { value: 'auto' })).not.toThrow();
});

it('never starts expensive browser measurements in basic mode; hidden tabs do not send heartbeat reports', () => {
  jest.useFakeTimers();
  const memory = jest.fn();
  Object.defineProperty(performance, 'measureUserAgentSpecificMemory', { configurable: true, value: memory });
  Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value: true });
  const c = new ViewerDiagnostics(); const heartbeat = jest.fn();
  stop = startDiagnosticRuntime(c, '11111111-1111-4111-8111-111111111111', heartbeat);
  jest.advanceTimersByTime(60000); expect(heartbeat).toHaveBeenCalledTimes(1);
  const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  jest.advanceTimersByTime(300000);
  expect(heartbeat).toHaveBeenCalledTimes(1); expect(memory).not.toHaveBeenCalled();
  visibility.mockRestore(); stop(); stop = undefined;
  jest.advanceTimersByTime(60000); expect(heartbeat).toHaveBeenCalledTimes(1);
  delete (performance as any).measureUserAgentSpecificMemory;
});

it('limits opt-in asynchronous memory measurement to five minutes and ignores completion after disposal', async () => {
  jest.useFakeTimers();
  let finish;
  const memory = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  Object.defineProperty(performance, 'measureUserAgentSpecificMemory', { configurable: true, value: memory });
  Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value: true });
  const c = new ViewerDiagnostics(() => 0, true);
  stop = startDiagnosticRuntime(c, '11111111-1111-4111-8111-111111111111', jest.fn());
  jest.advanceTimersByTime(60000); expect(memory).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(300000); expect(memory).toHaveBeenCalledTimes(1); // Still in flight.
  finish({ bytes: 1234 }); await drain(); expect(c.memory?.bytes).toBe(1234);
  jest.advanceTimersByTime(60000); expect(memory).toHaveBeenCalledTimes(2);
  stop(); stop = undefined; finish({ bytes: 9999 }); await drain();
  expect(c.memory?.bytes).toBe(1234);
  delete (performance as any).measureUserAgentSpecificMemory;
});

it('counts only well-formed same-origin viewer peers and closes its channel', () => {
  jest.useFakeTimers();
  const original = global.BroadcastChannel;
  let channel;
  (global as any).BroadcastChannel = class {
    onmessage; postMessage = jest.fn(); close = jest.fn();
    constructor() { channel = this; }
  };
  const c = new ViewerDiagnostics();
  stop = startDiagnosticRuntime(c, '11111111-1111-4111-8111-111111111111', jest.fn());
  channel.onmessage({ data: { id: 'arbitrary-private-data', kind: 'hello' } });
  expect(c.peerViewers).toBe(1);
  channel.onmessage({ data: { id: '22222222-2222-4222-8222-222222222222', kind: 'hello' } });
  expect(c.peerViewers).toBe(2);
  channel.onmessage({ data: { id: '22222222-2222-4222-8222-222222222222', kind: 'bye' } });
  expect(c.peerViewers).toBe(1);
  stop(); stop = undefined; expect(channel.close).toHaveBeenCalledTimes(1);
  (global as any).BroadcastChannel = original;
});

async function transport(mode: string, capability = true, postResponse = { ok: true, status: 204 }) {
  jest.useFakeTimers();
  window.history.replaceState(null, '', '/?viewerDiagnostics=' + mode);
  const fetch = jest.fn(async (url: string) => url.endsWith('/config') ?
    { ok: true, json: async () => ({ csrfToken: 'test', ...(capability ? { diagnosticsVersion: 1 } : {}) }) } : postResponse);
  global.fetch = fetch as any;
  let api, diagnostics;
  jest.isolateModules(() => {
    api = jest.requireActual('@ohif/core/src/constants/orbitalOpenTelemetry');
    diagnostics = jest.requireActual('@ohif/core/src/constants/orbitalViewerDiagnostics');
  });
  stop = api.startViewerOpenTelemetry('synthetic-launch-token-123456');
  await drain(); jest.advanceTimersByTime(0); await drain();
  return { api, diagnostics, fetch, posts: () => fetch.mock.calls.filter(call => (call[1] as any)?.method === 'POST') };
}

it('negotiates diagnostics, sends no requests per tool action, and includes retroactive history on a late GPU loss', async () => {
  const { api, diagnostics, posts } = await transport('');
  expect(JSON.parse((posts()[0][1] as any).body).diagnostics).toMatchObject({ level: 'basic', events: [] });
  for (let i = 0; i < 100; i++) diagnostics.recordViewerEvent('tool', { value: i % 2 ? 'pan' : 'navigate' });
  jest.advanceTimersByTime(10000); await drain(); expect(posts()).toHaveLength(1);
  const tracker = api.getViewerOpenTracker(); tracker.progress(1, 1, 0); ids.forEach(id => tracker.frame(id));
  jest.advanceTimersByTime(1000); await drain();
  tracker.fail('context-lost'); jest.advanceTimersByTime(1000); await drain();
  const last = JSON.parse((posts().slice(-1)[0][1] as any).body);
  expect(last).toMatchObject({ snapshot: { status: 'error', readyMs: expect.any(Number) }, diagnostics: { reason: 'error' } });
  expect(last.diagnostics.events).toHaveLength(40);
  expect(last.diagnostics.events.slice(-1)[0]).toMatchObject({ type: 'error', value: 'context-lost' });
});

it('remains compatible with the existing server, and off disables all new collection', async () => {
  const legacy = await transport('', false);
  expect(JSON.parse((legacy.posts()[0][1] as any).body).diagnostics).toBeUndefined();
  expect(legacy.diagnostics.getViewerDiagnostics()).toBeNull();
  stop(); stop = undefined; jest.clearAllTimers();
  const off = await transport('off');
  expect(JSON.parse((off.posts()[0][1] as any).body).diagnostics).toBeUndefined();
  expect(off.diagnostics.getViewerDiagnostics()).toBeNull();
});

it('bounds retries when the log server fails while independently allowing every study plane to become ready', async () => {
  const { api, diagnostics, posts } = await transport('', true, { ok: false, status: 503 });
  const tracker = api.getViewerOpenTracker();
  tracker.progress(1, 1, 0); ids.forEach(id => tracker.frame(id));
  expect(tracker.state.status).toBe('ready');
  jest.advanceTimersByTime(29000); await drain(); expect(posts()).toHaveLength(1);
  jest.advanceTimersByTime(1000); await drain(); expect(posts()).toHaveLength(2);
  jest.advanceTimersByTime(120000); await drain(); expect(posts()).toHaveLength(3);
  jest.advanceTimersByTime(300000); await drain(); expect(posts()).toHaveLength(4);
  jest.advanceTimersByTime(3600000); await drain(); expect(posts()).toHaveLength(4);
  expect(tracker.state.status).toBe('ready');
  expect(diagnostics.getViewerDiagnostics()).toBeNull();
});

it('does not await an unresponsive config server and aborts its request after five seconds', async () => {
  jest.useFakeTimers(); let signal: AbortSignal;
  global.fetch = jest.fn((_url, options: any) => { signal = options.signal; return new Promise(() => {}); }) as any;
  let api;
  jest.isolateModules(() => { api = jest.requireActual('@ohif/core/src/constants/orbitalOpenTelemetry'); });
  stop = api.startViewerOpenTelemetry('synthetic-launch-token-123456');
  api.getViewerOpenTracker().progress(1, 1, 0); ids.forEach(id => api.getViewerOpenTracker().frame(id));
  expect(api.getViewerOpenTracker().state.status).toBe('ready');
  jest.advanceTimersByTime(5000); expect(signal.aborted).toBe(true);
});
