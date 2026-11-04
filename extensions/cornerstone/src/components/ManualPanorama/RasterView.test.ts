import React from 'react';
import { render } from '@testing-library/react';
import RasterView from './RasterView';

describe('Panorama markers independent from the grayscale raster', () => {
  let spy, ctx;
  const raster = {
    width: 20,
    height: 10,
    widthMm: 40,
    heightMm: 20,
    pixels: new Float32Array(200),
  };
  const range = { lower: -500, upper: 2500 };
  beforeEach(() => {
    ctx = {
      createImageData: jest.fn((w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })),
      putImageData: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fillText: jest.fn(),
    };
    spy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  });
  afterEach(() => spy.mockRestore());
  it('shows both lines immediately and moves them without copying image pixels again', () => {
    const view = render(
      React.createElement(RasterView, {
        raster,
        range,
        position: 0.25,
        slicePosition: 0.5,
        orientation: ['R', 'L'],
        label: 'Панорама',
      })
    );
    const line = (axis: string) => view.container.querySelector(`[data-panorama-marker="${axis}"]`);
    expect(Number(line('vertical').getAttribute('x1'))).toBeCloseTo(19 * 0.25);
    expect(Number(line('horizontal').getAttribute('y1'))).toBeCloseTo(9 * 0.5);
    expect(view.container.querySelector('svg').getAttribute('preserveAspectRatio')).toBe(
      'xMidYMid meet'
    );
    view.rerender(
      React.createElement(RasterView, {
        raster,
        range,
        position: 0.8,
        slicePosition: 0.7,
        orientation: ['R', 'L'],
        label: 'Панорама',
      })
    );
    expect(Number(line('vertical').getAttribute('x1'))).toBeCloseTo(19 * 0.8);
    expect(Number(line('horizontal').getAttribute('y1'))).toBeCloseTo(9 * 0.7);
    expect(ctx.createImageData).toHaveBeenCalledTimes(1);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
    view.unmount();
  });
  it('keeps valid boundary markers and hides a crossbar outside the visible height', () => {
    const view = render(
      React.createElement(RasterView, { raster, range, position: 0, slicePosition: 1 })
    );
    expect(view.container.querySelectorAll('line')).toHaveLength(2);
    view.rerender(
      React.createElement(RasterView, { raster, range, position: 1, slicePosition: -0.1 })
    );
    expect(view.container.querySelector('[data-panorama-marker="vertical"]')).toBeTruthy();
    expect(view.container.querySelector('[data-panorama-marker="horizontal"]')).toBe(null);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
