/** Bound the whole fetch/parse/decode pipeline, not only the worker count. */
export function createBoundedImageTasks(limit = 4) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', cancel);
        active++;
        resolve();
      };
      const cancel = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      if (active < limit) start();
      else {
        waiting.push(start);
        signal.addEventListener('abort', cancel, { once: true });
      }
    });
    try {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
