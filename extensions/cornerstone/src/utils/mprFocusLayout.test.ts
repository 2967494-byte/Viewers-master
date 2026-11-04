import {
  getFocusedMprViewport,
  MPR_VIEWPORT_IDS,
  mprFocusRectangles,
  setMprFocus,
} from './mprFocusLayout';

describe('MPR expanded viewport with three live side panes', () => {
  it.each(MPR_VIEWPORT_IDS)('expands %s and keeps a non-overlapping sidebar', id => {
    const rectangles = mprFocusRectangles(id);
    expect(rectangles[MPR_VIEWPORT_IDS.indexOf(id)]).toEqual({
      x: 0,
      y: 0,
      width: 0.75,
      height: 1,
    });
    expect(rectangles.reduce((sum, rect) => sum + rect.width * rect.height, 0)).toBeCloseTo(1);
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const a = rectangles[i],
          b = rectangles[j];
        const overlap =
          Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        expect(overlap).toBeCloseTo(0);
      }
  });
  it('restores a regular 2×2 grid with the same viewport instances/options', async () => {
    const viewports = new Map(
      MPR_VIEWPORT_IDS.map((id, index) => [
        id,
        {
          viewportId: id,
          isReady: true,
          viewportOptions: { viewportId: id },
          displaySetInstanceUIDs: ['same-study'],
          ...mprFocusRectangles('mpr-axial')[index],
        },
      ])
    );
    const state = { viewports, activeViewportId: 'mpr-axial', isHangingProtocolLayout: true };
    expect(getFocusedMprViewport(state)).toBe('mpr-axial');
    const service = { getState: () => state, set: jest.fn() };
    await setMprFocus(service, null);
    const layout = service.set.mock.calls[0][0];
    MPR_VIEWPORT_IDS.forEach((id, index) => {
      const moved = layout.viewports.get(id);
      expect({ x: moved.x, y: moved.y, width: moved.width, height: moved.height }).toEqual(
        mprFocusRectangles(null)[index]
      );
      expect(moved.isReady).toBe(true);
      expect(moved.viewportId).toBe(id);
      expect(moved.viewportOptions).toBe(viewports.get(id).viewportOptions);
      expect(moved.displaySetInstanceUIDs).toBe(viewports.get(id).displaySetInstanceUIDs);
    });
  });
  it('leaves unrelated layouts unchanged', async () => {
    const service = {
      getState: () => ({ viewports: new Map([['other', {}]]) }),
      set: jest.fn(),
    };
    await setMprFocus(service, 'mpr-3d');
    expect(service.set).not.toHaveBeenCalled();
  });
});
