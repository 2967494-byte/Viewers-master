import { gpuStartupProfile } from './gpuStartupProfile';
import { initializeAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';

describe('GPU context profile before the rendering engine is created', () => {
  const base = { preference: 'auto' as const, standalone: false, defaultContextCount: 7 };
  beforeEach(() => { localStorage.clear(); initializeAutomaticGpuProfile({}); });
  afterEach(() => initializeAutomaticGpuProfile({}));
  it('selects one context for automatic constrained hardware and explicit economy mode', () => {
    initializeAutomaticGpuProfile({ renderer: 'Intel HD Graphics (0x0f31)' });
    expect(gpuStartupProfile(base)).toEqual({ webGlContextCount: 1, preference: 'auto', reason: 'automatic' });
    expect(gpuStartupProfile({ ...base, preference: 'economy' }).webGlContextCount).toBe(1);
  });
  it('uses one shared context for ORBITAL MPR even before a study is opened', () => {
    expect(gpuStartupProfile({ ...base, standalone: true })).toEqual({
      webGlContextCount: 1,
      preference: 'auto',
      reason: 'orbital-mpr',
    });
  });
  it('also starts compatibility mode with one context outside the standalone profile', () => {
    expect(gpuStartupProfile({ ...base, preference: 'compatibility' })).toEqual({
      webGlContextCount: 1,
      preference: 'compatibility',
      reason: 'compatibility',
    });
  });
  it('keeps the library default in other viewer profiles and ignores unrelated or obsolete CPU flags', () => {
    for (const search of [
      '',
      '?render=cpu',
      '?gpuContexts=7',
      '?gpuContexts=0',
      '?gpuContexts=100',
    ]) {
      expect(gpuStartupProfile({ ...base, search })).toEqual({
        webGlContextCount: 7,
        preference: 'auto',
        reason: 'library-default',
      });
    }
  });
  it('allows a test URL to reduce the pool, never to increase resource usage', () => {
    expect(gpuStartupProfile({ ...base, search: '?gpuContexts=1' })).toEqual({
      webGlContextCount: 1,
      preference: 'auto',
      reason: 'test-url',
    });
  });
});
