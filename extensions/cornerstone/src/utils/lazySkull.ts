/** The diagnostic volume is shared; only the optional 3D actor is deferred. */
import { runVolumeBackgroundWork } from './volumeBackgroundWork';
type Setup = {
  volumeId: string;
  ready: () => boolean;
  initialize: () => Promise<void>;
  cancelled: boolean;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
  controller: AbortController;
};
const setups = new Map<object, Setup>();

export function deferSkull(viewport: any, volumeId: string, ready: () => boolean, initialize: () => Promise<void>) {
  releaseSkull(viewport);
  setups.set(viewport, { volumeId, ready, initialize, cancelled: false, running: false, controller: new AbortController() });
}

export function skullVolumeId(viewport: any): string | undefined {
  return setups.get(viewport)?.volumeId || viewport?.getVolumeId?.();
}

export function isSkullDeferred(viewport: any) { return setups.has(viewport); }

export function requestSkull(viewport: any) {
  const setup = setups.get(viewport);
  if (!setup || setup.cancelled || setup.running || setup.timer) return;
  const notify = (state: string) => viewport.element?.dispatchEvent(new CustomEvent('orbital:skull-state', { detail: state }));
  notify('waiting');
  const start = async () => {
    setup.timer = undefined;
    if (setup.cancelled || setups.get(viewport) !== setup) return;
    const covered = !document.body.classList.contains('manual-panorama-active') &&
      viewport.element?.parentElement?.querySelector('.automatic-panorama-pane');
    if (covered) return;
    if (!setup.ready()) {
      // Do not overlap actor preparation with loading or panorama calculations.
      setup.timer = setTimeout(start, 100);
      return;
    }
    setup.running = true;
    try {
      await runVolumeBackgroundWork(setup.initialize, setup.controller.signal);
      if (!setup.cancelled && setups.get(viewport) === setup) {
        setups.delete(viewport);
        viewport.render();
        notify('ready');
      }
    } catch (error) {
      // Keep this optional pane failed, without throwing into the slice loader.
      if (!setup.cancelled) {
        console.warn('[orbital-skull] optional 3D setup failed', error);
        notify('error');
      }
    }
  };
  // Give React and the visible slices a frame before preparing the actor.
  setup.timer = setTimeout(start, 32);
}

export function releaseSkull(viewport: any) {
  const setup = setups.get(viewport);
  if (!setup) return;
  setup.cancelled = true;
  setup.controller.abort();
  clearTimeout(setup.timer);
  setups.delete(viewport);
}

export function releaseAllSkulls() {
  [...setups.keys()].forEach(releaseSkull);
}
