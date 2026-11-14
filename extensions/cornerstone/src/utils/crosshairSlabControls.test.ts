import installCrosshairSlabControls from './crosshairSlabControls';
import { setAxesVisible } from '@ohif/core/src/constants/orbitalAxes';
import { Enums } from '@cornerstonejs/tools';

jest.mock('@cornerstonejs/core', () => ({ Enums: { ViewportType: {} } }));
jest.mock('@cornerstonejs/tools', () => ({ state: { isInteractingWithTool: false },
  Enums: { Events: { MOUSE_DOWN: 'tool-down', MOUSE_DOWN_ACTIVATE: 'tool-activate', MOUSE_CLICK: 'tool-click', MOUSE_UP: 'tool-up' } },
}));

describe('Slab wheel priority over ordinary slice scrolling', () => {
  let element, tool, resolve, cleanup, scroll;
  const wheel = (deltaY, extra = {}) => {
    const event = new WheelEvent('wheel', { deltaY, clientX: 50, clientY: 40, bubbles: true, cancelable: true, ...extra });
    element.dispatchEvent(event);
    return event;
  };
  const pointer = (type, x = 50, y = 40) => element.dispatchEvent(new MouseEvent(type, {
    clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true,
  }));
  beforeEach(() => {
    setAxesVisible(true);
    element = document.createElement('div');
    document.body.append(element);
    tool = { getSlabHandleAtPoint: jest.fn(() => ({ target: { id: 'coronal' } })), changeSlabThickness: jest.fn(() => true) };
    tool.updateDentalHover = jest.fn();
    resolve = jest.fn(() => tool);
    cleanup = installCrosshairSlabControls(element, resolve);
    scroll = jest.fn();
    element.addEventListener('wheel', scroll);
  });
  afterEach(() => { cleanup(); element.remove(); setAxesVisible(true); });
  it('expands away, narrows towards the user, and keeps the chosen plane while the pointer stays still', () => {
    expect(wheel(-120).defaultPrevented).toBe(true);
    expect(tool.changeSlabThickness).toHaveBeenLastCalledWith({ id: 'coronal' }, 1);
    tool.getSlabHandleAtPoint.mockReturnValue(undefined);
    wheel(-120);
    wheel(120);
    expect(tool.changeSlabThickness).toHaveBeenLastCalledWith({ id: 'coronal' }, -1);
    expect(scroll).not.toHaveBeenCalled();
    pointer('pointermove', 100, 100);
    expect(wheel(-120).defaultPrevented).toBe(false);
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('resets on a click but preserves a real drag', () => {
    pointer('pointerdown');
    pointer('click');
    expect(tool.changeSlabThickness).toHaveBeenLastCalledWith({ id: 'coronal' }, 'reset');
    tool.changeSlabThickness.mockClear();
    pointer('pointerdown');
    pointer('pointermove', 50, 60);
    pointer('pointermove', 50, 40);
    pointer('click');
    expect(tool.changeSlabThickness).not.toHaveBeenCalled();
  });
  it('consumes a reset click when Cornerstone replays the original down/up after double-click detection', () => {
    jest.useFakeTimers();
    const navigate = jest.fn();
    const down = new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: 40, bubbles: true });
    const up = new MouseEvent('mouseup', { button: 0, clientX: 50, clientY: 40, bubbles: true });
    const dispatch = (name, original) => {
      const event = new CustomEvent(name, { detail: { event: original }, cancelable: true, bubbles: true });
      element.dispatchEvent(event);
      return event;
    };
    Object.values(Enums.Events).forEach(name => element.addEventListener(name, navigate));
    try {
      pointer('pointerdown');
      element.dispatchEvent(down);
      element.dispatchEvent(up);
      setTimeout(() => {
        expect(dispatch(Enums.Events.MOUSE_DOWN, down).defaultPrevented).toBe(true);
        expect(dispatch(Enums.Events.MOUSE_DOWN_ACTIVATE, down).defaultPrevented).toBe(true);
        expect(dispatch(Enums.Events.MOUSE_CLICK, up).defaultPrevented).toBe(true);
        expect(dispatch(Enums.Events.MOUSE_UP, up).defaultPrevented).toBe(true);
      }, 400);
      pointer('click');
      jest.advanceTimersByTime(600);
      expect(tool.changeSlabThickness).toHaveBeenCalledWith({ id: 'coronal' }, 'reset');
      expect(navigate).not.toHaveBeenCalled();
      // A new unrelated gesture still reaches ordinary navigation.
      dispatch(Enums.Events.MOUSE_DOWN, new MouseEvent('mousedown'));
      expect(navigate).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });
  it('keeps the wheel through mouse jitter and movement along the reference axis after the slab grip moves away', () => {
    wheel(-120);
    tool.getSlabHandleAtPoint.mockReturnValue(undefined);
    pointer('pointermove', 54, 43);
    wheel(-120, { clientX: 54, clientY: 43 });
    expect(tool.changeSlabThickness).toHaveBeenCalledTimes(2);
    tool.getSlabWheelTarget = jest.fn(() => ({ id: 'coronal' }));
    pointer('pointermove', 90, 40);
    wheel(-120, { clientX: 90, clientY: 40 });
    expect(tool.changeSlabThickness).toHaveBeenCalledTimes(3);
    expect(scroll).not.toHaveBeenCalled();
    tool.getSlabWheelTarget.mockReturnValue(undefined);
    pointer('pointermove', 90, 90);
    wheel(-120, { clientX: 90, clientY: 90 });
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('updates grip hover and clears it when leaving the pane', () => {
    pointer('pointermove', 50, 40);
    expect(tool.updateDentalHover).toHaveBeenLastCalledWith(element, [50, 40]);
    pointer('pointerleave');
    expect(tool.updateDentalHover).toHaveBeenLastCalledWith(element, null);
  });
  it('resets at the original wheel position after a boundary moves away without starting slice navigation', () => {
    wheel(-120);
    tool.getSlabHandleAtPoint.mockReturnValue(undefined);
    pointer('pointerdown');
    const navigate = jest.fn();
    element.addEventListener('mousedown', navigate);
    pointer('mousedown');
    pointer('click');
    expect(navigate).not.toHaveBeenCalled();
    expect(tool.changeSlabThickness).toHaveBeenLastCalledWith({ id: 'coronal' }, 'reset');
  });
  it('leaves wheel scrolling alone off grips, with axes hidden, in another tool, and for browser zoom', () => {
    tool.getSlabHandleAtPoint.mockReturnValue(undefined);
    wheel(-120);
    tool.getSlabHandleAtPoint.mockReturnValue({ target: { id: 'coronal' } });
    setAxesVisible(false);
    wheel(-120);
    setAxesVisible(true);
    wheel(-120, { ctrlKey: true });
    resolve.mockReturnValue(undefined);
    wheel(-120);
    pointer('pointerdown');
    pointer('click');
    expect(tool.changeSlabThickness).not.toHaveBeenCalled();
    expect(scroll).toHaveBeenCalledTimes(4);
  });
  it('removes listeners when the viewport unmounts', () => {
    cleanup();
    wheel(-120);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(tool.changeSlabThickness).not.toHaveBeenCalled();
  });
});
