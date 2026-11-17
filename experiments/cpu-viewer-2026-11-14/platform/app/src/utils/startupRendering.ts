import { checkVolumeRenderingSupport } from './volumeRenderingSupport';

/** CPU mode starts before appInit, which otherwise initializes GPU-only viewports. */
export function startupRendering(search: string, probe = checkVolumeRenderingSupport) {
  if (new URLSearchParams(search).get('render') === 'cpu') return { kind: 'cpu' as const };
  const support = probe();
  return support.supported
    ? { kind: 'gpu' as const, max3DTextureSize: support.max3DTextureSize }
    : { kind: 'cpu' as const };
}
