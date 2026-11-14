import React from 'react';
import { render, act } from '@testing-library/react';
import { cache, getEnabledElement, eventTarget } from '@cornerstonejs/core';
import { annotation } from '@cornerstonejs/tools';
import { getPanoramaSession } from './panoramaSession';
import { buildCurve } from './reconstruction';
import * as projection from './panoramaImplantGeometry';
import PanoramaImplants from './PanoramaImplants';

jest.mock('@cornerstonejs/core', () => ({
  getEnabledElement: jest.fn(),
  cache: { getVolume: jest.fn() },
  eventTarget: new EventTarget(),
  Enums: {
    Events: {
      VOLUME_CACHE_VOLUME_REMOVED: 'volume-removed',
      VOLUME_VIEWPORT_NEW_VOLUME: 'new-volume',
    },
  },
}));
jest.mock('@cornerstonejs/tools', () => ({
  annotation: {
    state: { getAnnotations: jest.fn() },
    visibility: { isAnnotationVisible: jest.fn() },
    selection: { isAnnotationSelected: jest.fn() },
  },
  Enums: {
    Events: {
      ANNOTATION_ADDED: 'added',
      ANNOTATION_COMPLETED: 'completed',
      ANNOTATION_MODIFIED: 'modified',
      ANNOTATION_REMOVED: 'removed',
      ANNOTATION_VISIBILITY_CHANGE: 'visibility',
      ANNOTATION_SELECTION_CHANGE: 'selection',
    },
  },
}));
jest.mock('./panoramaSession', () => ({ getPanoramaSession: jest.fn() }));

function setup() {
  let items: any[] = [
    {
      annotationUID: 'one',
      metadata: {
        toolName: 'DentalImplant',
        dentalVolumeId: 'volume-a',
        FrameOfReferenceUID: 'frame-a',
      },
      data: {
        visible: true,
        implant: { name: 'Demo implant', dimensions: { diameter: 4, length: 8 }, color: '#f0dc45' },
        handles: {
          points: [
            [8, 0, -4],
            [8, 0, 4],
          ],
        },
      },
    },
  ];
  const element = document.createElement('div');
  const source = {
    element: document.createElement('div'),
    getVolumeId: () => 'volume-a',
    getFrameOfReferenceUID: () => 'frame-a',
  };
  const volume = {};
  let snapshot: any = {
    curve: buildCurve([
      [-20, 0, 0],
      [0, 0, 0],
      [20, 0, 0],
    ]),
    up: [0, 0, 1],
    thickness: 8,
    raster: { width: 401, height: 201, widthMm: 40, heightMm: 20, pixels: new Float32Array(0) },
  };
  const session = { state: { snapshot } };
  (getEnabledElement as jest.Mock).mockReturnValue({
    viewport: { getVolumeId: () => 'volume-a' },
    renderingEngine: { getViewport: () => source },
  });
  (cache.getVolume as jest.Mock).mockReturnValue(volume);
  (getPanoramaSession as jest.Mock).mockReturnValue(session);
  (annotation.state.getAnnotations as jest.Mock).mockImplementation(() => items);
  (annotation.visibility.isAnnotationVisible as jest.Mock).mockReturnValue(true);
  (annotation.selection.isAnnotationSelected as jest.Mock).mockReturnValue(true);
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++next, callback);
    return next;
  });
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
    frames.delete(id);
  });
  const view = render(
    React.createElement(
      'svg',
      null,
      React.createElement(PanoramaImplants, { element, sourceViewportId: 'mpr-axial', snapshot })
    )
  );
  const flush = () =>
    act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(0));
    });
  const signal = (name = 'modified') =>
    act(() => {
      eventTarget.dispatchEvent(new Event(name));
    });
  const points = () => view.container.querySelector('polygon')?.getAttribute('points');
  return {
    ...view,
    items,
    source,
    session,
    element,
    frames,
    flush,
    signal,
    points,
    setItems: value => {
      items = value;
    },
    setSnapshot: value => {
      snapshot = value;
      session.state.snapshot = value;
      view.rerender(
        React.createElement(
          'svg',
          null,
          React.createElement(PanoramaImplants, {
            element,
            sourceViewportId: 'mpr-axial',
            snapshot,
          })
        )
      );
    },
    dispose: () => {
      view.unmount();
      raf.mockRestore();
      cancel.mockRestore();
    },
  };
}

describe('live implants in the panorama', () => {
  afterEach(() => jest.restoreAllMocks());
  it('shows only visible implants belonging to the actual volume and frame of reference', () => {
    const v = setup(),
      base = v.items[0];
    v.setItems([
      base,
      {
        ...base,
        annotationUID: 'other-volume',
        metadata: { ...base.metadata, dentalVolumeId: 'other' },
      },
      {
        ...base,
        annotationUID: 'other-frame',
        metadata: { ...base.metadata, FrameOfReferenceUID: 'other' },
      },
      { ...base, annotationUID: 'hidden', data: { ...base.data, visible: false } },
    ]);
    v.signal('added');
    v.flush();
    expect(v.container.querySelectorAll('[data-panorama-implant]')).toHaveLength(1);
    expect(v.container.querySelector('polygon').getAttribute('stroke')).toBe('#f0dc45');
    (annotation.visibility.isAnnotationVisible as jest.Mock).mockReturnValue(false);
    v.signal('visibility');
    v.flush();
    expect(v.points()).toBeUndefined();
    v.dispose();
  });
  it('updates position, tilt and diameter during drag, and coalesces unchanged events', () => {
    const spy = jest.spyOn(projection, 'projectImplantToPanorama'),
      v = setup();
    const before = v.points();
    expect(spy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) v.signal();
    expect(v.frames.size).toBe(1);
    v.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    v.items[0].data.handles.points = [
      [2, 0, -4],
      [5, 0, 4],
    ];
    act(() => window.dispatchEvent(new Event('orbital:implant-drag')));
    v.flush();
    expect(v.points()).not.toBe(before);
    expect(spy).toHaveBeenCalledTimes(2);
    const moved = v.points();
    v.items[0].data.implant.dimensions.diameter = 6;
    act(() => window.dispatchEvent(new Event('orbital:implant-updated')));
    v.flush();
    expect(v.points()).not.toBe(moved);
    v.dispose();
  });
  it('reprojects only the implant that changed when several implants are present', () => {
    const spy = jest.spyOn(projection, 'projectImplantToPanorama'),
      v = setup();
    const second = {
      ...v.items[0],
      annotationUID: 'two',
      data: {
        ...v.items[0].data,
        handles: {
          points: [
            [-8, 0, -4],
            [-8, 0, 4],
          ],
        },
      },
    };
    v.setItems([...v.items, second]);
    v.signal('added');
    v.flush();
    expect(spy).toHaveBeenCalledTimes(2);
    v.items[0].data.handles.points = [
      [5, 0, -4],
      [5, 0, 4],
    ];
    v.signal();
    v.flush();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(v.container.querySelectorAll('[data-panorama-implant]')).toHaveLength(2);
    v.dispose();
  });
  it('removes the overlay on deletion and restores it on undo/add', () => {
    const v = setup(),
      items = [...v.items];
    expect(v.points()).toBeTruthy();
    v.setItems([]);
    v.signal('removed');
    v.flush();
    expect(v.points()).toBeUndefined();
    v.setItems(items);
    v.signal('added');
    v.flush();
    expect(v.points()).toBeTruthy();
    v.dispose();
    v.signal();
    expect(v.frames.size).toBe(0);
  });
  it('reprojects existing implants after arch editing and stops using a stale snapshot', () => {
    const v = setup(),
      before = v.points();
    v.setSnapshot({
      ...v.session.state.snapshot,
      curve: buildCurve([
        [20, 0, 0],
        [0, 0, 0],
        [-20, 0, 0],
      ]),
    });
    expect(v.points()).not.toBe(before);
    v.session.state.snapshot = null;
    v.signal('new-volume');
    v.flush();
    // The new-volume event normally originates at a viewport element and is captured by document.
    act(() => document.dispatchEvent(new Event('new-volume')));
    v.flush();
    expect(v.points()).toBeUndefined();
    v.dispose();
  });
  it('retains read-only hit behavior and clears an implant moved beyond the slab', () => {
    const v = setup();
    expect(
      v.container.querySelector('[data-panorama-implants]').getAttribute('pointer-events')
    ).toBe('none');
    v.items[0].data.handles.points = [
      [8, 20, -4],
      [8, 20, 4],
    ];
    v.signal();
    v.flush();
    expect(v.points()).toBeUndefined();
    v.dispose();
  });
});
