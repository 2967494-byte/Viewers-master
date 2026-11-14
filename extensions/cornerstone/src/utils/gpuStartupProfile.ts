import type { RenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { getAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';

/** Choose before constructing any RenderingEngine; a running pool cannot be resized by a flag. */
export function gpuStartupProfile({
  preference,
  standalone,
  search = '',
  defaultContextCount,
}: {
  preference: RenderingPreference;
  standalone: boolean;
  search?: string;
  defaultContextCount: number;
}) {
  const forced = new URLSearchParams(search).get('gpuContexts') === '1';
  const compact = preference === 'compatibility' || preference === 'economy' ||
    (preference === 'auto' && Number.isFinite(getAutomaticGpuProfile().budgetBytes));
  return {
    webGlContextCount:
      standalone || compact || forced ? 1 : defaultContextCount,
    reason: forced
      ? 'test-url'
      : compact
        ? preference === 'auto' ? 'automatic' : preference
        : standalone
          ? 'orbital-mpr'
          : 'library-default',
    preference,
  };
}
