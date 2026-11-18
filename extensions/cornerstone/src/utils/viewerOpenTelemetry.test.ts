import { ViewerOpenTracker } from '@ohif/core/src/constants/orbitalOpenTelemetry';
import { installViewerOpenTelemetry } from './viewerOpenTelemetry';
import { getViewerOpenTracker } from '@ohif/core/src/constants/orbitalOpenTelemetry';

jest.mock('@ohif/core/src/constants/orbitalOpenTelemetry', () => ({
  ...jest.requireActual('@ohif/core/src/constants/orbitalOpenTelemetry'), getViewerOpenTracker: jest.fn(),
}));
jest.mock('@cornerstonejs/core', () => ({ cache: { getVolume: () => ({ vtkOpenGLTexture: { get: () => ({ context: { isContextLost: () => false } }) } }) } }));

const ids = ['mpr-coronal', 'mpr-sagittal', 'mpr-axial'];
it('requires all loaded frames plus a fresh confirmed draw in each plane; completion alone is not success', () => {
  let time = 0; const tracker = new ViewerOpenTracker(() => time);
  tracker.progress(1, 3, 0); time = 100;
  ids.forEach(id => tracker.frame(id));
  expect(tracker.state.firstSliceMs).toBe(100); expect(tracker.state.readyMs).toBeNull();
  time = 500; expect(tracker.progress(3, 3, 0)).toBe(true);
  tracker.frame(ids[0]); tracker.frame(ids[1]); tracker.frame('mpr-3d');
  expect(tracker.state.status).toBe('loading');
  tracker.frame(ids[2]);
  expect(tracker.state).toMatchObject({ status: 'ready', readyMs: 500, rendered: ids });
});

it('cannot mark failed/incomplete frames ready and preserves the successful opening profile after a later switch or error', () => {
  const tracker = new ViewerOpenTracker(() => 100);
  tracker.update({ requestedMode: 'auto', budgetMiB: 64 });
  tracker.progress(2, 3, 1); ids.forEach(id => tracker.frame(id));
  expect(tracker.state.readyMs).toBeNull();
  tracker.progress(3, 3, 0); ids.forEach(id => tracker.frame(id));
  tracker.update({ requestedMode: 'quality', budgetMiB: null });
  tracker.progress(1, 12, 0); tracker.fail('context-lost');
  expect(tracker.state).toMatchObject({ status: 'error', errorCode: 'context-lost', readyMode: 'auto', readyBudgetMiB: 64, loaded: 3, total: 3 });
});

it('records early failures and closing an unfinished tab without inventing success or an error', () => {
  const tracker = new ViewerOpenTracker(() => 0);
  tracker.close(); expect(tracker.state.status).toBe('interrupted');
  tracker.frame(ids[0]); expect(tracker.state.firstSliceMs).toBeNull();
  tracker.fail('webgl2-unavailable'); expect(tracker.state.errorCode).toBe('webgl2-unavailable');
});

it('allows confirmed recovery of missing slices but never clears a lost GPU context through progress events', () => {
  const tracker = new ViewerOpenTracker(() => 0);
  tracker.progress(2, 3, 1); tracker.fail('slice-load-failed');
  tracker.progress(3, 3, 0); ids.forEach(id => tracker.frame(id));
  expect(tracker.state.status).toBe('ready');
  const broken = new ViewerOpenTracker(() => 0); broken.fail('context-lost');
  broken.progress(3, 3, 0); ids.forEach(id => broken.frame(id));
  expect(broken.state.status).toBe('error');
});

it('observes the native renderer without changing receiver/results and ignores hidden 3D frames', () => {
  const tracker = new ViewerOpenTracker(() => 0);
  (getViewerOpenTracker as jest.Mock).mockReturnValue(tracker);
  tracker.progress(3, 3, 0);
  const draw = jest.fn(function(viewport) { expect(this).toBe(engine); return viewport.skip ? undefined : { element: {} }; });
  const engine = { renderViewportUsingCustomOrVtkPipeline: draw };
  installViewerOpenTelemetry(engine); installViewerOpenTelemetry(engine);
  for (const id of ids) engine.renderViewportUsingCustomOrVtkPipeline({ id, canvas: { width: 100, height: 100 }, getVolumeId: () => 'v' });
  expect(tracker.state.status).toBe('ready'); expect(draw).toHaveBeenCalledTimes(3);
  const result = engine.renderViewportUsingCustomOrVtkPipeline({ id: 'mpr-3d', skip: true });
  expect(result).toBeUndefined();
  (getViewerOpenTracker as jest.Mock).mockReturnValue(null);
});

it('boots reporting asynchronously with CSRF, same-origin credentials and no token in Referer/URLs', async () => {
  jest.useFakeTimers();
  const originalFetch = global.fetch;
  const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ csrfToken: 'csrf-test' }) });
  global.fetch = fetch;
  let api;
  jest.isolateModules(() => { api = jest.requireActual('@ohif/core/src/constants/orbitalOpenTelemetry'); });
  const stop = api.startViewerOpenTelemetry('test-launch-token-123456');
  for (let i = 0; i < 12; i++) await Promise.resolve();
  jest.advanceTimersByTime(1000);
  await Promise.resolve(); await Promise.resolve();
  expect(fetch.mock.calls[0][0]).toBe('/api/viewer/telemetry/config');
  expect(fetch.mock.calls[0][1].referrerPolicy).toBe('no-referrer');
  const post = fetch.mock.calls.find(call => call[1]?.method === 'POST');
  expect(post[0]).toBe('/api/viewer/telemetry/sessions');
  expect(post[1]).toMatchObject({ credentials: 'same-origin', referrerPolicy: 'origin', headers: { 'X-CSRFToken': 'csrf-test' } });
  expect(JSON.parse(post[1].body as string)).toMatchObject({ launchToken: 'test-launch-token-123456', snapshot: { status: 'loading' } });
  api.getViewerOpenTracker().progress(1, 1, 0);
  ids.forEach(id => api.getViewerOpenTracker().frame(id));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  jest.advanceTimersByTime(1000);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const update = fetch.mock.calls.find(call => call[1]?.method === 'POST' && call[0].startsWith('/api/viewer/telemetry/sessions/'));
  expect(update).toBeDefined();
  expect(update[1]).toMatchObject({ referrerPolicy: 'origin', headers: { 'X-CSRFToken': 'csrf-test' } });
  expect(JSON.parse(update[1].body as string)).toMatchObject({ snapshot: { status: 'ready' } });
  expect(update[1].body).not.toContain('test-launch-token-123456');
  stop(); global.fetch = originalFetch; jest.clearAllTimers(); jest.useRealTimers();
});

it('resumes only through explicit context restoration, requiring all planes to redraw', () => {
  const tracker = new ViewerOpenTracker(() => 100);
  tracker.progress(3, 3, 0); ids.forEach(id => tracker.frame(id));
  tracker.fail('context-lost'); tracker.resumeAfterContextRestore();
  expect(tracker.state.status).toBe('loading'); expect(tracker.state.readyMs).toBeNull();
  tracker.frame(ids[0]); tracker.frame(ids[1]); expect(tracker.state.status).toBe('loading');
  tracker.frame(ids[2]); expect(tracker.state.status).toBe('ready');
});

it('retains the original opening time and profile after a later context recovery', () => {
  let time = 0; const tracker = new ViewerOpenTracker(() => time);
  tracker.update({ requestedMode: 'auto', budgetMiB: 768 }); tracker.progress(3, 3, 0);
  time = 100; ids.forEach(id => tracker.frame(id));
  time = 600000; tracker.fail('context-lost'); tracker.resumeAfterContextRestore();
  tracker.update({ budgetMiB: 640 }); time += 4000; ids.forEach(id => tracker.frame(id));
  expect(tracker.state.status).toBe('ready'); expect(tracker.state.readyMs).toBe(100);
  expect(tracker.state.readyBudgetMiB).toBe(768); expect(tracker.state.budgetMiB).toBe(640);
});
