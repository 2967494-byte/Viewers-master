import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { cache, Enums, eventTarget, getEnabledElement } from '@cornerstonejs/core';
import { annotation, Enums as ToolEnums, ToolGroupManager } from '@cornerstonejs/tools';
import AutomaticPanoramaPane from './AutomaticPanoramaPane';
import MprFocusButton from '../../Viewport/MprFocusButton';
import { mprFocusRectangles, MPR_VIEWPORT_IDS } from '../../utils/mprFocusLayout';
import { detectDentalArch } from './automaticArch';
import { buildCurve, reconstructPanorama } from './reconstruction';
import { getPanoramaSession } from './panoramaSession';

jest.mock('@cornerstonejs/core', () => ({
  cache: { getVolume: jest.fn(), getImage: jest.fn() },
  getEnabledElement: jest.fn(),
  eventTarget: new EventTarget(),
  Enums: {
    Events: {
      IMAGE_RENDERED: 'rendered',
      CAMERA_MODIFIED: 'camera',
      VOLUME_VIEWPORT_NEW_VOLUME: 'volume',
      IMAGE_VOLUME_LOADING_COMPLETED: 'loaded',
      IMAGE_VOLUME_MODIFIED: 'modified',
      VOLUME_CACHE_VOLUME_REMOVED: 'removed',
    },
  },
}));
jest.mock('./ManualPanorama', () => ({ START_AUTOMATIC_PANORAMA: 'open-auto-editor' }));
jest.mock('@cornerstonejs/tools', () => ({
  Enums: { Events: { CROSSHAIR_TOOL_CENTER_CHANGED: 'crosshair-center' } },
  ToolGroupManager: { getToolGroupForViewport: jest.fn() },
  annotation: { state: { getAnnotations: jest.fn() } },
}));
jest.mock('./RasterView', () => ({
  __esModule: true,
  default: ({ label, position, slicePosition }) =>
    require('react').createElement('div', {
      'aria-label': label,
      'data-position': position,
      'data-slice-position': slicePosition,
    }),
}));
jest.mock('./automaticArch', () => ({
  ...jest.requireActual('./automaticArch'),
  detectDentalArch: jest.fn(),
}));
jest.mock('./reconstruction', () => ({
  ...jest.requireActual('./reconstruction'),
  reconstructPanorama: jest.fn(),
}));

describe('Default panorama in the existing lower-right viewport', () => {
  let volume, source, target, frames, previousRAF, previousCancel;
  const points = [
    [10, 20, 7],
    [20, 10, 7],
    [30, 20, 7],
  ];
  const flush = () =>
    act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback());
      await Promise.resolve();
    });
  beforeEach(() => {
    jest.clearAllMocks();
    (ToolGroupManager.getToolGroupForViewport as jest.Mock).mockReturnValue(undefined);
    (annotation.state.getAnnotations as jest.Mock).mockReturnValue([]);
    volume = {
      volumeId: 'a',
      loadStatus: { loaded: true },
      imageIds: ['a0', 'a1'],
      metadata: {},
      voxelManager: { numberOfComponents: 1 },
      isDynamicVolume: () => false,
    };
    source = {
      element: document.createElement('div'),
      getVolumeId: () => volume.volumeId,
      getImageData: () => ({
        dimensions: [2, 2, 2],
        imageData: {
          getWorldToIndex: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          indexToWorld: p => p,
        },
      }),
      getCamera: () => ({ focalPoint: [0, 0, 7] }),
      getProperties: () => ({ voiRange: { lower: -500, upper: 2500 } }),
    };
    target = { element: document.createElement('div'), getVolumeId: () => volume.volumeId };
    document.body.append(source.element, target.element);
    (getEnabledElement as jest.Mock).mockReturnValue({
      viewport: target,
      renderingEngine: { getViewport: () => source },
    });
    (cache.getVolume as jest.Mock).mockImplementation(() => volume);
    (cache.getImage as jest.Mock).mockReturnValue({ voxelManager: { getAtIndex: () => 0 } });
    (detectDentalArch as jest.Mock).mockResolvedValue({ points, sliceZ: 7, support: 0.9 });
    (reconstructPanorama as jest.Mock).mockResolvedValue({
      width: 2,
      height: 2,
      widthMm: 20,
      heightMm: 20,
      pixels: new Float32Array(4),
    });
    frames = new Map();
    let next = 0;
    previousRAF = global.requestAnimationFrame;
    previousCancel = global.cancelAnimationFrame;
    global.requestAnimationFrame = jest.fn(callback => {
      frames.set(++next, callback);
      return next;
    });
    global.cancelAnimationFrame = jest.fn(id => frames.delete(id));
  });
  afterEach(() => {
    source.element.remove();
    target.element.remove();
    global.requestAnimationFrame = previousRAF;
    global.cancelAnimationFrame = previousCancel;
  });

  it('waits for all slices, builds once and toggles the skull without rebuilding', async () => {
    volume.loadStatus.loaded = false;
    const view = render(React.createElement(AutomaticPanoramaPane, { element: target.element }));
    await flush();
    expect(detectDentalArch).not.toHaveBeenCalled();
    expect(view.getByRole('status').textContent).toContain('после загрузки');
    volume.loadStatus.loaded = true;
    eventTarget.dispatchEvent(new Event(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED));
    await flush();
    await waitFor(() => expect(view.getByLabelText('Автопанорама исследования')).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: 'Показать череп' }));
    expect(view.queryByLabelText('Окно автопанорамы')).toBe(null);
    fireEvent.click(view.getByRole('button', { name: 'Показать автопанораму' }));
    for (let i = 0; i < 10; i++)
      source.element.dispatchEvent(new Event(Enums.Events.IMAGE_RENDERED));
    await flush();
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    const open = jest.fn();
    window.addEventListener('open-auto-editor', open);
    fireEvent.click(view.getByRole('button', { name: 'Открыть редактор автопанорамы' }));
    expect(open).toHaveBeenCalledTimes(1);
    window.removeEventListener('open-auto-editor', open);
    view.unmount();
  });
  it('keeps the panorama when the existing focus button expands and restores the same viewport', async () => {
    let state = {
      layout: { numRows: 2, numCols: 2 },
      activeViewportId: 'mpr-axial',
      viewports: new Map(
        MPR_VIEWPORT_IDS.map((id, i) => [id, { ...mprFocusRectangles(null)[i], viewportId: id }])
      ),
    };
    let listener = () => {};
    const service = {
      EVENTS: { GRID_STATE_CHANGED: 'grid' },
      getState: () => state,
      subscribe: (_name, callback) => {
        listener = callback;
        return { unsubscribe: () => {} };
      },
      set: jest.fn(next => {
        state = next;
        listener();
      }),
    };
    const view = render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(AutomaticPanoramaPane, { element: target.element }),
        React.createElement(MprFocusButton, { viewportId: 'mpr-3d', viewportGridService: service })
      )
    );
    await flush();
    await waitFor(() => expect(view.getByLabelText('Автопанорама исследования')).toBeTruthy());
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Развернуть 3D-окно' }));
    });
    expect(state.viewports.get('mpr-3d').width).toBe(0.75);
    expect(view.getByLabelText('Автопанорама исследования')).toBeTruthy();
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Вернуть четыре окна' }));
    });
    expect(state.viewports.get('mpr-3d').width).toBe(0.5);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    view.unmount();
  });
  it('cancels a previous study and ignores its late result', async () => {
    let finish;
    (detectDentalArch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const view = render(React.createElement(AutomaticPanoramaPane, { element: target.element }));
    await flush();
    const signal = (detectDentalArch as jest.Mock).mock.calls[0][0].signal;
    volume = { ...volume, volumeId: 'b' };
    source.element.dispatchEvent(new Event(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME));
    await flush();
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(view.getByLabelText('Автопанорама исследования')).toBeTruthy());
    await act(async () => {
      finish({ points, sliceZ: 7 });
    });
    expect(detectDentalArch).toHaveBeenCalledTimes(2);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    view.unmount();
  });
  it('reports a failed search and keeps both controls available without retrying on render', async () => {
    (detectDentalArch as jest.Mock).mockRejectedValueOnce(new Error('Дуга не найдена.'));
    const view = render(React.createElement(AutomaticPanoramaPane, { element: target.element }));
    await flush();
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Дуга не найдена'));
    source.element.dispatchEvent(new Event(Enums.Events.IMAGE_RENDERED));
    await flush();
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    expect(view.getByRole('button', { name: 'Показать череп' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Открыть редактор автопанорамы' })).toBeTruthy();
    view.unmount();
  });

  it('follows the visible axial crosshair when camera planes differ, including after editing the arch', async () => {
    const cameras = {
      'mpr-coronal': { focalPoint: [99, 20, 99], viewPlaneNormal: [0, 1, 0] },
      'mpr-sagittal': { focalPoint: [10, 99, 99], viewPlaneNormal: [1, 0, 0] },
      'mpr-axial': { focalPoint: [99, 99, 9], viewPlaneNormal: [0, 0, 1] },
    };
    // CrosshairsTool renders this center, even when programmatic camera movement
    // leaves the three camera planes intersecting somewhere else: (10,20,9).
    const crosshairs = { toolCenter: [30, 20, 9] };
    (ToolGroupManager.getToolGroupForViewport as jest.Mock).mockReturnValue({
      getToolInstance: name => (name === 'Crosshairs' ? crosshairs : undefined),
    });
    (annotation.state.getAnnotations as jest.Mock).mockReturnValue([
      { data: { viewportId: 'mpr-axial' } },
    ]);
    (getEnabledElement as jest.Mock).mockReturnValue({
      viewport: target,
      renderingEngine: {
        id: 'engine-a',
        getViewport: id => ({ ...source, getCamera: () => cameras[id] }),
      },
    });
    const view = render(React.createElement(AutomaticPanoramaPane, { element: target.element }));
    await flush();
    await waitFor(() => expect(view.getByLabelText('Автопанорама исследования')).toBeTruthy());
    await flush();
    const marker = () => view.getByLabelText('Автопанорама исследования');
    expect(Number(marker().getAttribute('data-position'))).toBeCloseTo(1);
    expect(Number(marker().getAttribute('data-slice-position'))).toBeCloseTo(0.4);
    expect(ToolGroupManager.getToolGroupForViewport).toHaveBeenCalledWith('mpr-axial', 'engine-a');

    // The editor publishes a new path/raster into the existing shared session.
    const session = getPanoramaSession(volume);
    const editedPoints: [number, number, number][] = [
      [10, 20, 7],
      [30, 20, 7],
      [50, 20, 7],
    ];
    act(() =>
      session.publish({
        ...session.state.snapshot,
        points: editedPoints,
        curve: buildCurve(editedPoints),
        raster: { ...session.state.snapshot.raster, widthMm: 40 },
      })
    );
    await flush();
    expect(Number(marker().getAttribute('data-position'))).toBeCloseTo(0.5);

    // The visible point is the center projected onto the currently displayed
    // axial plane, not the tool center's possibly stale height in another plane.
    crosshairs.toolCenter = [40, 20, 500];
    cameras['mpr-axial'].focalPoint[2] = 11;
    eventTarget.dispatchEvent(new Event(ToolEnums.Events.CROSSHAIR_TOOL_CENTER_CHANGED));
    await flush();
    expect(Number(marker().getAttribute('data-position'))).toBeCloseTo(0.75);
    expect(Number(marker().getAttribute('data-slice-position'))).toBeCloseTo(0.3);
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('initializes both markers from all three MPR planes and follows crosshair movement without rebuilding', async () => {
    const cameras = {
      'mpr-coronal': { focalPoint: [99, 20, 99], viewPlaneNormal: [0, 1, 0] },
      'mpr-sagittal': { focalPoint: [10, 99, 99], viewPlaneNormal: [1, 0, 0] },
      'mpr-axial': { focalPoint: [99, 99, 9], viewPlaneNormal: [0, 0, 1] },
    };
    (getEnabledElement as jest.Mock).mockReturnValue({
      viewport: target,
      renderingEngine: {
        getViewport: id => ({ ...source, getCamera: () => cameras[id] }),
      },
    });
    const view = render(React.createElement(AutomaticPanoramaPane, { element: target.element }));
    await flush();
    await waitFor(() => expect(view.getByLabelText('Автопанорама исследования')).toBeTruthy());
    // The initial intersection is (10,20,9): the start of the path at Z=7, plus 2mm.
    await flush();
    const marker = () => view.getByLabelText('Автопанорама исследования');
    expect(Number(marker().getAttribute('data-position'))).toBeCloseTo(0);
    expect(Number(marker().getAttribute('data-slice-position'))).toBeCloseTo(0.4);
    cameras['mpr-sagittal'].focalPoint[0] = 30;
    cameras['mpr-axial'].focalPoint[2] = 11;
    for (let i = 0; i < 10; i++)
      eventTarget.dispatchEvent(new Event(ToolEnums.Events.CROSSHAIR_TOOL_CENTER_CHANGED));
    expect(frames.size).toBe(1);
    await flush();
    expect(Number(marker().getAttribute('data-position'))).toBeCloseTo(1);
    expect(Number(marker().getAttribute('data-slice-position'))).toBeCloseTo(0.3);
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    const rasterValue = marker().getAttribute('data-position');
    view.unmount();
    eventTarget.dispatchEvent(new Event(ToolEnums.Events.CROSSHAIR_TOOL_CENTER_CHANGED));
    expect(frames.size).toBe(0);
    expect(rasterValue).toBe('1');
  });

  it.each([
    ['uninitialized', []],
    ['another viewport', [{ data: { viewportId: 'other-axial' } }]],
  ])('ignores a tool center belonging to %s annotations', async (_name, annotations) => {
    const cameras = {
      'mpr-coronal': { focalPoint: [99, 20, 99], viewPlaneNormal: [0, 1, 0] },
      'mpr-sagittal': { focalPoint: [30, 99, 99], viewPlaneNormal: [1, 0, 0] },
      'mpr-axial': { focalPoint: [99, 99, 9], viewPlaneNormal: [0, 0, 1] },
    };
    (ToolGroupManager.getToolGroupForViewport as jest.Mock).mockReturnValue({
      getToolInstance: () => ({ toolCenter: [0, 0, 0] }),
    });
    (annotation.state.getAnnotations as jest.Mock).mockReturnValue(annotations);
    (getEnabledElement as jest.Mock).mockReturnValue({
      viewport: target,
      renderingEngine: {
        id: 'engine-a',
        getViewport: id => ({ ...source, getCamera: () => cameras[id] }),
      },
    });
    const view = render(React.createElement(AutomaticPanoramaPane, { element: target.element }));
    await flush();
    await waitFor(() => expect(view.getByLabelText('Автопанорама исследования')).toBeTruthy());
    await flush();
    expect(
      Number(view.getByLabelText('Автопанорама исследования').getAttribute('data-position'))
    ).toBeCloseTo(1);
    view.unmount();
  });
});
