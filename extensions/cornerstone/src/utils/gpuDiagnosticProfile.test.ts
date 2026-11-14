import { beginGpuDiagnosticSession, getGpuDiagnosticBudget, recordGpuDiagnostic,
  GPU_DIAGNOSTIC_PROFILE_KEY, GPU_DIAGNOSTIC_REPORT_KEY } from '@ohif/core/src/constants/orbitalGpuDiagnostics';

beforeEach(() => { localStorage.clear(); beginGpuDiagnosticSession(); });
afterEach(() => { localStorage.clear(); beginGpuDiagnosticSession(); jest.restoreAllMocks(); });

it('keeps diagnostics off unless the explicit fixed 64 MiB profile is selected', () => {
  for (const value of ['', '0', '256', 'cpu', '64.0']) {
    localStorage.setItem(GPU_DIAGNOSTIC_PROFILE_KEY, value);
    beginGpuDiagnosticSession(); recordGpuDiagnostic('ignored');
    expect(getGpuDiagnosticBudget()).toBe(Infinity);
    expect(localStorage.getItem(GPU_DIAGNOSTIC_REPORT_KEY)).toBeNull();
  }
});

it('snapshots the profile before startup and persists a bounded journal without remote requests', () => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  localStorage.setItem(GPU_DIAGNOSTIC_PROFILE_KEY, '64');
  beginGpuDiagnosticSession();
  localStorage.removeItem(GPU_DIAGNOSTIC_PROFILE_KEY);
  expect(getGpuDiagnosticBudget()).toBe(64 * 1024 ** 2);
  for (let index = 0; index < 180; index++) recordGpuDiagnostic('upload-progress', { index });
  const report = JSON.parse(localStorage.getItem(GPU_DIAGNOSTIC_REPORT_KEY));
  expect(report.events).toHaveLength(160);
  expect(report.events.at(-1)).toEqual(expect.objectContaining({ stage: 'upload-progress', index: 179 }));
  beginGpuDiagnosticSession();
  expect(getGpuDiagnosticBudget()).toBe(Infinity);
  expect(JSON.parse(localStorage.getItem(GPU_DIAGNOSTIC_REPORT_KEY))).toEqual(report);
});

it('does not break normal startup when browser storage is blocked', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(beginGpuDiagnosticSession).not.toThrow();
  expect(getGpuDiagnosticBudget()).toBe(Infinity);
});
