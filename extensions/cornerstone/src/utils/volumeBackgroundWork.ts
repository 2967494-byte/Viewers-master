/** Serialize optional calculations; visible MPR rendering never waits on this queue. */
export function createVolumeBackgroundQueue() {
  let active = false;
  const waiting: Array<() => void> = [];
  return function run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    return new Promise<T>((resolve, reject) => {
      const done = () => { active = false; waiting.shift()?.(); };
      const start = () => {
        signal.removeEventListener('abort', cancel);
        active = true;
        if (signal.aborted) { done(); reject(new DOMException('Cancelled', 'AbortError')); return; }
        try { Promise.resolve(task()).then(resolve, reject).finally(done); }
        catch (error) { done(); reject(error); }
      };
      const cancel = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      if (!active) start();
      else { waiting.push(start); signal.addEventListener('abort', cancel, { once: true }); }
    });
  };
}
export const runVolumeBackgroundWork = createVolumeBackgroundQueue();
