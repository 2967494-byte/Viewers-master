import { deferSkull, requestSkull, releaseAllSkulls, skullVolumeId, isSkullDeferred } from './lazySkull';

afterEach(() => { releaseAllSkulls(); jest.useRealTimers(); document.body.className = ''; });

it('keeps volume identity without preparing an actor, then waits for the loading and panorama work', async () => {
  jest.useFakeTimers();
  const viewport = { element: document.createElement('div'), render: jest.fn() };
  let ready = false;
  const initialize = jest.fn().mockResolvedValue(undefined);
  deferSkull(viewport, 'volume:1', () => ready, initialize);
  expect(skullVolumeId(viewport)).toBe('volume:1');
  expect(initialize).not.toHaveBeenCalled();
  requestSkull(viewport); requestSkull(viewport);
  jest.advanceTimersByTime(200);
  expect(initialize).not.toHaveBeenCalled();
  ready = true; jest.advanceTimersByTime(100); for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(viewport.render).toHaveBeenCalledTimes(1);
  expect(isSkullDeferred(viewport)).toBe(false);
});

it('cancels a queued skull when leaving or replacing a study', async () => {
  jest.useFakeTimers();
  const viewport = { render: jest.fn() }, initialize = jest.fn();
  deferSkull(viewport, 'old', () => true, initialize); requestSkull(viewport);
  releaseAllSkulls(); jest.advanceTimersByTime(200); await Promise.resolve();
  expect(initialize).not.toHaveBeenCalled();
  expect(viewport.render).not.toHaveBeenCalled();
});

it('does not prepare a covered skull and resumes when explicitly shown', async () => {
  jest.useFakeTimers();
  const wrapper = document.createElement('div'), element = document.createElement('div'), pane = document.createElement('div');
  pane.className = 'automatic-panorama-pane'; wrapper.append(element, pane);
  const viewport = { element, render: jest.fn() }, initialize = jest.fn().mockResolvedValue(undefined);
  deferSkull(viewport, 'volume', () => true, initialize); requestSkull(viewport);
  jest.advanceTimersByTime(200); expect(initialize).not.toHaveBeenCalled();
  pane.remove(); requestSkull(viewport); jest.advanceTimersByTime(40); await Promise.resolve();
  expect(initialize).toHaveBeenCalledTimes(1);
});
