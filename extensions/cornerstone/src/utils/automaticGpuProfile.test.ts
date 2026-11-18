import { chooseGpuProfile, initializeAutomaticGpuProfile, getAutomaticGpuProfile, rememberGpuRecovery,
  GPU_RECOVERY_KEY, GPU_RECOVERY_AGE, clearGpuRecovery, fitAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';

const MiB = 1024 ** 2;
const laptop = { renderer: 'ANGLE (Intel, Intel(R) HD Graphics (0x00000F31) Direct3D11)', deviceMemory: 4, max3DTextureSize: 2048 };
const desktop = { renderer: 'ANGLE (NVIDIA GeForce RTX 4060 Direct3D11)', deviceMemory: 8, max3DTextureSize: 2048 };
beforeEach(() => { localStorage.clear(); initializeAutomaticGpuProfile({}); });
afterEach(() => { jest.restoreAllMocks(); localStorage.clear(); initializeAutomaticGpuProfile({}); });

it.each([laptop, { renderer: 'ANGLE (Intel(R) HD Graphics 4000 Direct3D11)' },
  { renderer: 'ANGLE (Intel(R) HD Graphics Direct3D11)' }, { renderer: 'llvmpipe' }, { renderer: 'Google SwiftShader' }])(
  'starts a known constrained adapter at 256 MiB without a stress test: %j', device => {
    expect(chooseGpuProfile(device).budgetBytes).toBe(256 * MiB);
  });

it.each(['Intel(R) UHD Graphics 620', 'Intel(R) Iris Xe Graphics', 'Intel(R) HD Graphics 530',
  'Intel(R) HD Graphics 5000', 'AMD Radeon RX 6600', desktop.renderer, '', 'WebKit WebGL']) (
  'does not classify a modern or masked adapter as obsolete: %s', renderer => {
    expect(chooseGpuProfile({ renderer, deviceMemory: 8 }).budgetBytes).toBe(Infinity);
  });

it('uses memory/mobile hints conservatively and tolerates unavailable hints', () => {
  expect(chooseGpuProfile({ mobile: true }).budgetBytes).toBe(256 * MiB);
  expect(chooseGpuProfile({ mobile: true, deviceMemory: 4 }).budgetBytes).toBe(256 * MiB);
  expect(chooseGpuProfile({ deviceMemory: 4 }).budgetBytes).toBe(256 * MiB);
  expect(chooseGpuProfile({ deviceMemory: 2 }).budgetBytes).toBe(256 * MiB);
  for (const deviceMemory of [undefined, NaN, 0, -1]) expect(chooseGpuProfile({ deviceMemory }).budgetBytes).toBe(Infinity);
});

it('remembers only stricter recovery for this graphics device, without changing a live profile', () => {
  initializeAutomaticGpuProfile(desktop, 1000);
  rememberGpuRecovery(256 * MiB, 1000);
  rememberGpuRecovery(256 * MiB, 1100);
  expect(getAutomaticGpuProfile().budgetBytes).toBe(Infinity);
  expect(initializeAutomaticGpuProfile(desktop, 1200)).toEqual({ budgetBytes: 256 * MiB, reason: 'previous-graphics-error' });
  expect(initializeAutomaticGpuProfile({ ...desktop, renderer: 'different GPU' }, 1200).budgetBytes).toBe(Infinity);
  expect(initializeAutomaticGpuProfile(desktop, 32 * 24 * 60 * 60 * 1000).budgetBytes).toBe(Infinity);
});

it('never revives a retired hardware budget based on a prior recovery record', () => {
  initializeAutomaticGpuProfile(laptop, 1000);
  rememberGpuRecovery(256 * MiB, 1000);
  expect(initializeAutomaticGpuProfile(laptop, 1100)).toEqual({ budgetBytes: 256 * MiB, reason: 'legacy-intel' });
});

it('expires a recovery restriction after two hours and permits a reset without changing a live engine', () => {
  initializeAutomaticGpuProfile(desktop, 1000); rememberGpuRecovery(384 * MiB, 1000);
  expect(initializeAutomaticGpuProfile(desktop, 1100).budgetBytes).toBe(384 * MiB);
  clearGpuRecovery();
  expect(getAutomaticGpuProfile().budgetBytes).toBe(384 * MiB);
  expect(initializeAutomaticGpuProfile(desktop, 1200).budgetBytes).toBe(Infinity);
  rememberGpuRecovery(384 * MiB, 2000);
  expect(initializeAutomaticGpuProfile(desktop, 2000 + GPU_RECOVERY_AGE).budgetBytes).toBe(Infinity);
});

it('migrates an active legacy restriction and fits only soft desktop budgets to a study', () => {
  initializeAutomaticGpuProfile(desktop, 1000); rememberGpuRecovery(256 * MiB, 1000);
  const legacy = JSON.parse(localStorage.getItem(GPU_RECOVERY_KEY)); delete legacy.version;
  localStorage.setItem(GPU_RECOVERY_KEY, JSON.stringify(legacy));
  expect(initializeAutomaticGpuProfile(desktop, 1100).budgetBytes).toBe(384 * MiB);
  expect(fitAutomaticGpuProfile(512 * MiB, 768 * MiB).budgetBytes).toBe(512 * MiB);
  expect(fitAutomaticGpuProfile(Infinity, 768 * MiB).budgetBytes).toBe(512 * MiB);
  initializeAutomaticGpuProfile({ deviceMemory: 4 });
  expect(fitAutomaticGpuProfile(384 * MiB, 768 * MiB).budgetBytes).toBe(384 * MiB);
  initializeAutomaticGpuProfile(laptop);
  expect(fitAutomaticGpuProfile(384 * MiB, 768 * MiB).budgetBytes).toBe(256 * MiB);
  initializeAutomaticGpuProfile({ mobile: true });
  expect(fitAutomaticGpuProfile(384 * MiB, 256 * MiB).budgetBytes).toBe(256 * MiB);
});

it('ignores malformed, future, unbounded and storage-blocked recovery records', () => {
  initializeAutomaticGpuProfile(desktop, 1000); rememberGpuRecovery(256 * MiB, 1000);
  const saved = JSON.parse(localStorage.getItem(GPU_RECOVERY_KEY));
  for (const value of ['invalid json', JSON.stringify({ ...saved, budgetMiB: 4096 }), JSON.stringify({ ...saved, at: 5000 })]) {
    localStorage.setItem(GPU_RECOVERY_KEY, value);
    expect(initializeAutomaticGpuProfile(desktop, 1200).budgetBytes).toBe(Infinity);
  }
  localStorage.setItem(GPU_RECOVERY_KEY, 'broken'); rememberGpuRecovery(256 * MiB, 1200);
  expect(initializeAutomaticGpuProfile(desktop, 1300).budgetBytes).toBe(256 * MiB);
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(() => initializeAutomaticGpuProfile(laptop)).not.toThrow();
  expect(() => rememberGpuRecovery(256 * MiB)).not.toThrow();
  expect(getAutomaticGpuProfile().budgetBytes).toBe(256 * MiB);
});
