import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import CpuViewport from './CpuViewport';
import { IDENTITY_BASIS, planePoint } from './cpuGeometry';

describe('CPU viewport input and displayed physical geometry', () => {
  let context;
  beforeEach(() => {
    global.ResizeObserver = class {
      observe() {}
      disconnect() {}
    } as any;
    context = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: jest.fn(),
    } as any);
    HTMLElement.prototype.setPointerCapture = jest.fn();
    HTMLElement.prototype.hasPointerCapture = jest.fn(() => false);
  });
  afterEach(() => context.mockRestore());
  function setup(axes = true) {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const request = jest.fn(async (_kind, { plane }) => ({
      plane,
      pixels: new Uint8ClampedArray(plane.width * plane.height * 4),
    }));
    const props = {
      id: 'axial' as const,
      geometry: {
        dimensions: [11, 11, 11] as [number, number, number],
        indexToWorld: identity,
        worldToIndex: identity,
        bounds: [0, 10, 0, 10, 0, 10],
        center: [5, 5, 5] as [number, number, number],
        step: 1,
        invert: false,
      },
      worker: { request } as any,
      revision: 1,
      point: [5, 5, 5] as [number, number, number],
      basis: IDENTITY_BASIS,
      window: { center: 1000, width: 3000 },
      setWindow: jest.fn(),
      onPoint: jest.fn(),
      tool: 'crosshair' as const,
      axes,
      active: true,
      onActive: jest.fn(),
      onFocus: jest.fn(),
      thickness: 0,
      projection: 'mean' as const,
      measurements: [],
      onMeasure: jest.fn(),
      archPoints: [],
      onArchPoint: jest.fn(),
      onError: jest.fn(),
      onRotate: jest.fn(),
    };
    const view = render(React.createElement(CpuViewport, props));
    const stage = view.container.querySelector('.cpu-stage') as HTMLElement;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
    return { view, stage, props, request };
  }
  it('picks from the actually displayed zoomed plane and transfers focus from toolbar for Enter', async () => {
    const { view, stage, props, request } = setup();
    await waitFor(() => expect(view.container.querySelector('svg')).toBeTruthy());
    const zoom = view.getByLabelText('Увеличить axial');
    zoom.focus();
    fireEvent.click(zoom);
    await waitFor(() => expect(request.mock.calls.length).toBe(2));
    await waitFor(() => expect(view.container.textContent).toContain('1.3×'));
    const displayed = request.mock.calls[1][1].plane;
    fireEvent(stage, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 210, clientY: 140 }));
    expect(document.activeElement).toBe(stage);
    const expected = planePoint(displayed, 210 / 400, 140 / 300);
    expected.forEach((value, axis) => expect(props.onPoint.mock.calls[0][0][axis]).toBeCloseTo(value, 5));
    expect(props.onFocus).not.toHaveBeenCalled();
    view.unmount();
  });
  it('removes both coordinate lines without leaving a central marker', async () => {
    const { view } = setup(false);
    await waitFor(() => expect(view.container.querySelector('svg')).toBeTruthy());
    expect(view.container.querySelectorAll('line')).toHaveLength(1); // Physical scale only.
    expect(view.container.querySelectorAll('circle')).toHaveLength(0);
    view.unmount();
  });
});
