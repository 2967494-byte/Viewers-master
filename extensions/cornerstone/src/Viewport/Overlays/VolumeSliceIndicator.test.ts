import React from 'react';
import { setAxesVisible } from '@ohif/core/src/constants/orbitalAxes';
import { render, act } from '@testing-library/react';
import { getEnabledElement } from '@cornerstonejs/core';
import VolumeSliceIndicator from './VolumeSliceIndicator';

jest.mock('@cornerstonejs/core', () => ({
  getEnabledElement: jest.fn(),
  Enums: {
    ViewportType: { VOLUME_3D: 'volume3d', ORTHOGRAPHIC: 'orthographic' },
    Events: {
      CAMERA_MODIFIED: 'camera',
      IMAGE_RENDERED: 'rendered',
      VOLUME_VIEWPORT_NEW_VOLUME: 'volume',
    },
  },
}));

describe('VolumeSliceIndicator synchronization and lifecycle', () => {
  let source;
  let target;
  let frames;
  let disconnect;
  let nextFrame;
  let originalResizeObserver;
  let originalRAF;
  let originalCancel;
  const flush = () =>
    act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback());
    });

  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    disconnect = jest.fn();
    originalResizeObserver = global.ResizeObserver;
    originalRAF = global.requestAnimationFrame;
    originalCancel = global.cancelAnimationFrame;
    global.ResizeObserver = jest.fn(() => ({ observe: jest.fn(), disconnect })) as any;
    global.requestAnimationFrame = jest.fn(callback => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    global.cancelAnimationFrame = jest.fn(id => frames.delete(id));
    source = {
      element: document.createElement('div'),
      type: 'orthographic',
      getVolumeId: () => 'study-a',
      getFrameOfReferenceUID: () => 'frame-a',
      getImageData: () => ({ dimensions: [2, 2, 2], imageData: { indexToWorld: p => p } }),
      getCamera: () => ({ focalPoint: [0, 0, 0.5], viewPlaneNormal: [0, 0, 1] }),
    };
    target = {
      element: document.createElement('div'),
      type: 'volume3d',
      getVolumeId: () => 'study-a',
      getFrameOfReferenceUID: () => 'frame-a',
      worldToCanvas: ([x, y, z]) => [x * 100, z * 100],
    };
    document.body.append(source.element, target.element);
    (getEnabledElement as jest.Mock).mockReturnValue({
      viewport: target,
      renderingEngine: { getViewport: () => source },
    });
  });

  afterEach(() => {
    act(() => setAxesVisible(true));
    source.element.remove();
    target.element.remove();
    global.ResizeObserver = originalResizeObserver;
    global.requestAnimationFrame = originalRAF;
    global.cancelAnimationFrame = originalCancel;
  });

  it('hides and restores the projected plane without discarding its position', () => {
    const view = render(React.createElement(VolumeSliceIndicator, { element: target.element, sourceViewportId: 'mpr-axial' }));
    flush();
    const path = view.container.querySelector('path');
    const position = path.getAttribute('d');
    act(() => setAxesVisible(false));
    expect(view.container.querySelector('svg').style.visibility).toBe('hidden');
    expect(path.getAttribute('d')).toBe(position);
    act(() => setAxesVisible(true));
    expect(view.container.querySelector('svg').style.visibility).toBe('visible');
    expect(path.getAttribute('d')).toBe(position);
    view.unmount();
  });

  it('follows non-bubbling MPR events and 3D projection changes, coalescing redraws', () => {
    const view = render(
      React.createElement(VolumeSliceIndicator, {
        element: target.element,
        sourceViewportId: 'mpr-axial',
      })
    );
    const path = view.container.querySelector('path');
    flush();
    const initial = path.getAttribute('d');
    source.getCamera = () => ({ focalPoint: [0, 0, 0.7], viewPlaneNormal: [0, 0, 1] });
    source.element.dispatchEvent(new CustomEvent('camera'));
    source.element.dispatchEvent(new CustomEvent('rendered'));
    expect(frames.size).toBe(1);
    flush();
    expect(path.getAttribute('d')).not.toBe(initial);
    const moved = path.getAttribute('d');
    target.worldToCanvas = ([x, y, z]) => [y * 100, (z + x) * 100];
    target.element.dispatchEvent(new CustomEvent('camera'));
    flush();
    expect(path.getAttribute('d')).not.toBe(moved);
    view.unmount();
  });

  it('hides an old reference when another volume or frame is displayed', () => {
    const view = render(
      React.createElement(VolumeSliceIndicator, {
        element: target.element,
        sourceViewportId: 'mpr-axial',
      })
    );
    flush();
    const path = view.container.querySelector('path');
    expect(path.getAttribute('d')).toContain('M ');
    target.getVolumeId = () => 'study-b';
    target.element.dispatchEvent(new CustomEvent('volume'));
    flush();
    expect(path.getAttribute('d')).toBe('');
    target.getVolumeId = () => 'study-a';
    target.getFrameOfReferenceUID = () => 'frame-b';
    target.element.dispatchEvent(new CustomEvent('volume'));
    flush();
    expect(path.getAttribute('d')).toBe('');
    view.unmount();
  });

  it('removes subscriptions, observer and pending redraw on unmount', () => {
    const view = render(
      React.createElement(VolumeSliceIndicator, {
        element: target.element,
        sourceViewportId: 'mpr-axial',
      })
    );
    expect(frames.size).toBe(1);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    source.element.dispatchEvent(new CustomEvent('camera'));
    target.element.dispatchEvent(new CustomEvent('rendered'));
    expect(frames.size).toBe(0);
  });
});
