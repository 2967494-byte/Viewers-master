import React from 'react';
import { act, render } from '@testing-library/react';
import LivePanoramaSection from './LivePanoramaSection';
import { reconstructSection } from './reconstruction';

jest.mock('./reconstruction', () => ({ reconstructSection: jest.fn(({ distance }) => ({ marker: distance })) }));
jest.mock('./RasterView', () => ({ __esModule: true, default: ({ raster }) =>
  require('react').createElement('div', { 'data-testid': 'frame', 'data-distance': raster.marker }) }));

it('keeps the previous frame during rapid input, samples only the latest position per frame, and cancels on unmount', () => {
  const previousRAF = global.requestAnimationFrame, previousCancel = global.cancelAnimationFrame;
  const frames = new Map(); let id = 0;
  global.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  global.cancelAnimationFrame = id => frames.delete(id);
  const flush = () => act(() => { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback()); });
  const props = { seed: { distance: 5, raster: { marker: 5 } }, curve: {}, up: [0, 0, 1], sample: () => 0,
    distance: 5, heightMm: 80, range: {}, editing: false, label: 'Сечение' };
  const view = render(React.createElement(LivePanoramaSection, props));
  try {
    expect(reconstructSection).not.toHaveBeenCalled();
    for (const distance of [5.2, 5.4, 5.6]) view.rerender(React.createElement(LivePanoramaSection, { ...props, distance }));
    expect(view.getByTestId('frame').getAttribute('data-distance')).toBe('5');
    expect(frames.size).toBe(1);
    flush();
    expect(reconstructSection).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('frame').getAttribute('data-distance')).toBe('5.6');
    view.rerender(React.createElement(LivePanoramaSection, { ...props, distance: 5.6, range: { lower: 0 } }));
    flush(); expect(reconstructSection).toHaveBeenCalledTimes(1);
    view.rerender(React.createElement(LivePanoramaSection, { ...props, distance: 6 }));
    view.unmount(); flush(); expect(reconstructSection).toHaveBeenCalledTimes(1);
  } finally { view.unmount(); global.requestAnimationFrame = previousRAF; global.cancelAnimationFrame = previousCancel; }
});
