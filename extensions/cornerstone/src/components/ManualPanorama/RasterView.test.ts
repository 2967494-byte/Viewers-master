import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { setAxesVisible } from '@ohif/core/src/constants/orbitalAxes';
import { setImageFilter, setImageFilterStrength } from '@ohif/core/src/constants/orbitalImageFilters';
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
  afterEach(() => { spy.mockRestore(); act(() => { setAxesVisible(true); setImageFilter('none'); }); });
  it('filters panorama pixels and restores them without altering the source raster or overlay', () => {
    const pixels = new Float32Array(200).fill(100);
    pixels[85] = 200;
    const source = pixels.slice();
    const view = render(React.createElement(RasterView, { raster: { ...raster, pixels },
      range: { lower: 0, upper: 255 }, position: .5, slicePosition: .5 }));
    const first = ctx.putImageData.mock.calls[0][0].data.slice();
    act(() => setImageFilter('smooth'));
    expect(ctx.putImageData.mock.calls[1][0].data).not.toEqual(first);
    expect(view.container.querySelectorAll('line')).toHaveLength(2);
    expect(pixels).toEqual(source);
    act(() => setImageFilter('none'));
    expect(ctx.putImageData.mock.calls[2][0].data).toEqual(first);
    const paints = ctx.putImageData.mock.calls.length;
    for (const strength of [.2,.5,.8]) act(() => setImageFilterStrength(strength));
    expect(ctx.putImageData).toHaveBeenCalledTimes(paints);
    view.unmount();
  });
  it('hides only coordinate lines, preserving implants, pixels and panorama navigation', () => {
    const onPosition = jest.fn();
    const view = render(React.createElement(RasterView, { raster, range, position: .25, slicePosition: .5,
      onPosition, overlay: React.createElement('polygon', { points: '1,1 5,1 5,5' }) }));
    const canvas = view.container.querySelector('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    act(() => setAxesVisible(false));
    expect(view.container.querySelectorAll('line')).toHaveLength(0);
    expect(view.container.querySelector('polygon')).toBeTruthy();
    fireEvent.click(canvas, { clientX: 50, clientY: 50 });
    expect(onPosition).toHaveBeenCalled();
    act(() => setAxesVisible(true));
    expect(view.container.querySelectorAll('line')).toHaveLength(2);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
    view.unmount();
  });
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
  it('updates implant overlays without repainting or resampling the grayscale image', () => {
    const view = render(
      React.createElement(RasterView, {
        raster,
        range,
        overlay: React.createElement('polygon', { points: '1,1 5,1 5,5' }),
      })
    );
    expect(view.container.querySelector('svg polygon').getAttribute('points')).toBe('1,1 5,1 5,5');
    view.rerender(
      React.createElement(RasterView, {
        raster,
        range,
        overlay: React.createElement('polygon', { points: '2,2 8,2 8,8' }),
      })
    );
    expect(view.container.querySelector('svg polygon').getAttribute('points')).toBe('2,2 8,2 8,8');
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
