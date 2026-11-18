import { GraphicsContextRecovery } from './graphicsContextRecovery';
const ids = ['mpr-coronal', 'mpr-sagittal', 'mpr-axial'];
function setup() {
  const hooks = { alive: jest.fn(() => true), phase: jest.fn(), started: jest.fn(),
    rebuild: jest.fn(() => ids), completed: jest.fn(), failed: jest.fn() };
  return { hooks, recovery: new GraphicsContextRecovery(hooks), canvas: {} };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
it('keeps one incident across pooled contexts and requires three fresh frames after restore', () => {
  const { hooks, recovery, canvas } = setup(); const other = {};
  recovery.lose(canvas); recovery.lose(canvas); recovery.lose(other);
  recovery.frame(ids[0]); expect(hooks.completed).not.toHaveBeenCalled();
  recovery.restore(canvas); jest.runAllTicks(); expect(hooks.rebuild).not.toHaveBeenCalled();
  recovery.restore(other); jest.runAllTicks(); expect(hooks.rebuild).toHaveBeenCalledTimes(1);
  recovery.frame('mpr-3d'); recovery.frame(ids[0]); recovery.frame(ids[1]);
  expect(hooks.completed).not.toHaveBeenCalled();
  recovery.frame(ids[2]); expect(hooks.completed).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(20000); expect(hooks.failed).not.toHaveBeenCalled();
  recovery.lose(canvas); expect(hooks.failed).toHaveBeenCalledWith(20002);
  recovery.restore(canvas); jest.runAllTicks(); expect(hooks.rebuild).toHaveBeenCalledTimes(1);
});
it('bounds both restore waiting and incomplete rendering; late restoration cannot restart', () => {
  for (const restore of [false, true]) {
    const { hooks, recovery, canvas } = setup(); recovery.lose(canvas);
    if (restore) { recovery.restore(canvas); jest.runAllTicks(); recovery.frame(ids[0]); }
    jest.advanceTimersByTime(15000); expect(hooks.failed).toHaveBeenCalledWith(20003);
    recovery.restore(canvas); jest.runAllTicks(); recovery.frame(ids[1]); recovery.frame(ids[2]);
    expect(hooks.completed).not.toHaveBeenCalled();
  }
});
it('ignores released engines and turns rebuild exceptions into a terminal failure', () => {
  const { hooks, recovery, canvas } = setup(); hooks.alive.mockReturnValueOnce(false);
  recovery.lose(canvas); expect(hooks.started).not.toHaveBeenCalled();
  hooks.rebuild.mockImplementation(() => { throw new Error('GPU failed'); });
  recovery.lose(canvas); recovery.restore(canvas); jest.runAllTicks();
  expect(hooks.failed).toHaveBeenCalledWith(20005);
});

it('does not show a late failure on a different page after the engine was disposed', () => {
  const { hooks, recovery, canvas } = setup(); recovery.lose(canvas);
  hooks.alive.mockReturnValue(false); jest.advanceTimersByTime(15000);
  expect(recovery.phase).toBe('idle'); expect(hooks.failed).not.toHaveBeenCalled();
});
