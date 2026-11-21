/** Bound the whole fetch/parse/decode pipeline, not only the worker count. */
export function createBoundedImageTasks(limit: number | (() => number) = 4) {
  let active = 0;
  let peakActive = 0, completed = 0, cancelled = 0;
  const waiting: Array<() => void> = [];
  const currentLimit = () => {
    const value = typeof limit === 'function' ? limit() : limit;
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  };
  const drain = () => { while (waiting.length && active < currentLimit()) waiting.shift()!(); };
  async function run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', cancel);
        active++;
        peakActive = Math.max(peakActive, active);
        resolve();
      };
      const cancel = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        cancelled++;
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      if (!waiting.length && active < currentLimit()) start();
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
      completed++;
      drain();
    }
  }
  return Object.assign(run, { getStats: () => ({ active, queued: waiting.length, peakActive, completed, cancelled }) });
}
