import { createVolumeBackgroundQueue } from './volumeBackgroundWork';

it('runs only one heavy calculation, discards cancelled queued work and continues after a failure', async () => {
  const run = createVolumeBackgroundQueue(), controller = new AbortController(), events: string[] = [];
  let finish: () => void;
  const first = run(() => new Promise<void>(resolve => { events.push('panorama'); finish = resolve; }), new AbortController().signal);
  const cancelled = run(async () => { events.push('obsolete sections'); }, controller.signal);
  const rejected = expect(cancelled).rejects.toHaveProperty('name', 'AbortError');
  const last = run(async () => { events.push('skull'); }, new AbortController().signal);
  controller.abort(); await rejected;
  expect(events).toEqual(['panorama']); finish(); await first; await last;
  expect(events).toEqual(['panorama', 'skull']);
  await expect(run(async () => { throw Error('failed'); }, new AbortController().signal)).rejects.toThrow('failed');
  await expect(run(async () => 42, new AbortController().signal)).resolves.toBe(42);
});
