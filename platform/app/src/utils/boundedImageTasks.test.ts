import { createBoundedImageTasks } from './boundedImageTasks';

it('caps overlapping pipelines, cancels queued work, and frees slots after errors', async () => {
  const run = createBoundedImageTasks(2);
  const releases: Array<() => void> = [];
  let active = 0, peak = 0;
  const task = () => new Promise<void>(resolve => {
    peak = Math.max(peak, ++active);
    releases.push(() => { active--; resolve(); });
  });
  const controller = new AbortController();
  const first = run(task, new AbortController().signal);
  const second = run(task, new AbortController().signal);
  const cancelled = run(task, controller.signal);
  const rejected = expect(cancelled).rejects.toHaveProperty('name', 'AbortError');
  controller.abort();
  const third = run(task, new AbortController().signal);
  await Promise.resolve();
  expect(releases).toHaveLength(2);
  releases[0](); await first; await Promise.resolve();
  expect(releases).toHaveLength(3);
  releases[1](); releases[2]();
  await Promise.all([second, third, rejected]);
  expect(peak).toBe(2);
  await expect(run(async () => { throw new Error('decode'); }, new AbortController().signal)).rejects.toThrow('decode');
  await expect(run(async () => 42, new AbortController().signal)).resolves.toBe(42);
});
