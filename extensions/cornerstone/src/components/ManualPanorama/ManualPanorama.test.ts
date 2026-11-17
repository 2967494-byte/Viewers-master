import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { cache, eventTarget, Enums, getEnabledElement, utilities } from '@cornerstonejs/core';
import ManualPanorama, { START_MANUAL_PANORAMA, START_AUTOMATIC_PANORAMA } from './ManualPanorama';
import { detectDentalArch } from './automaticArch';
import { getPanoramaSession } from './panoramaSession';
import DentalPanoramaButton from '../../../../default/src/ViewerLayout/DentalPanoramaButton';
import { buildCurve, reconstructPanorama, reconstructSections, reconstructSection } from './reconstruction';
import {
  getFocusedMprViewport,
  MPR_VIEWPORT_IDS,
  mprFocusRectangles,
} from '../../utils/mprFocusLayout';

jest.mock('@cornerstonejs/core', () => ({
  cache: { getVolume: jest.fn(), getImage: jest.fn() },
  getEnabledElement: jest.fn(),
  eventTarget: new EventTarget(),
  utilities: { scroll: jest.fn(), jumpToSlice: jest.fn() },
  Enums: {
    OrientationAxis: { AXIAL: 'axial' },
    Events: {
      IMAGE_RENDERED: 'rendered',
      CAMERA_MODIFIED: 'camera',
      VOLUME_VIEWPORT_NEW_VOLUME: 'volume',
      ELEMENT_ENABLED: 'element-enabled',
      ELEMENT_DISABLED: 'element-disabled',
    },
  },
}));
jest.mock('./reconstruction', () => ({
  ...jest.requireActual('./reconstruction'),
  reconstructPanorama: jest.fn(),
  reconstructSections: jest.fn(),
  reconstructSection: jest.fn(jest.requireActual('./reconstruction').reconstructSection),
}));
jest.mock('./automaticArch', () => ({
  ...jest.requireActual('./automaticArch'),
  detectDentalArch: jest.fn(),
}));

describe('Manual panorama from an expanded axial viewport', () => {
  let element;
  let state;
  let service;
  let frames;
  let originalRAF;
  let originalCancel;
  let originalObserver;
  let contextSpy;
  let canvasRectSpy;
  const flushFrames = async () =>
    act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(0));
      await Promise.resolve();
    });
  const markArch = view => {
    const overlay = view.getByLabelText('Зубная дуга: точки можно перетаскивать');
    for (const [clientX, clientY] of [
      [10, 20],
      [20, 10],
      [30, 20],
    ]) {
      fireEvent.click(overlay, { clientX, clientY, button: 0, detail: 1 });
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    state = {
      layout: { numRows: 2, numCols: 2 },
      activeViewportId: 'mpr-axial',
      viewports: new Map(
        MPR_VIEWPORT_IDS.map((id, i) => [
          id,
          {
            viewportId: id,
            viewportOptions: { viewportId: id },
            isReady: true,
            ...mprFocusRectangles('mpr-axial')[i],
          },
        ])
      ),
    };
    service = {
      getState: () => state,
      set: jest.fn(next => {
        state = next;
      }),
    };
    element = document.createElement('div');
    document.body.append(element);
    Object.defineProperties(element, {
      clientWidth: { get: () => (getFocusedMprViewport(state) === 'mpr-axial' ? 900 : 600) },
      clientHeight: { get: () => (getFocusedMprViewport(state) === 'mpr-axial' ? 600 : 300) },
    });
    const viewport = {
      element,
      canvas: document.createElement('canvas'),
      getVolumeId: () => 'volume-a',
      getNumberOfSlices: () => 2,
      getCurrentImageIdIndex: () => 0,
      getImageData: () => ({
        dimensions: [2, 2, 2],
        imageData: {
          getWorldToIndex: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          indexToWorld: p => p,
        },
      }),
      getCamera: () => ({
        focalPoint: [0, 0, 0],
        position: [0, 0, 100],
        viewPlaneNormal: [0, 0, -1],
      }),
      setOrientation: jest.fn(),
      setCamera: jest.fn(),
      render: jest.fn(),
      getProperties: () => ({ voiRange: { lower: -500, upper: 2500 } }),
      canvasToWorld: ([x, y]) => [x, y, 0],
      worldToCanvas: p => [p[0], p[1]],
    };
    (getEnabledElement as jest.Mock).mockReturnValue({
      viewport,
      renderingEngine: {
        getViewport: id => ({
          element: {
            getBoundingClientRect: () =>
              id === 'mpr-coronal'
                ? { left: 0, top: 0, right: 600, bottom: 300 }
                : { left: 600, top: 300, right: 1200, bottom: 600 },
          },
        }),
      },
    });
    (cache.getVolume as jest.Mock).mockReturnValue({
      volumeId: 'volume-a',
      loadStatus: { loaded: true },
      isDynamicVolume: () => false,
      voxelManager: { numberOfComponents: 1 },
      metadata: {},
      imageIds: ['a', 'b'],
      spacing: [0.2, 0.2, 0.2],
    });
    (cache.getImage as jest.Mock).mockReturnValue({ voxelManager: { getAtIndex: () => 1 } });
    (detectDentalArch as jest.Mock).mockResolvedValue({
      points: [
        [10, 20, 7],
        [20, 10, 7],
        [30, 20, 7],
      ],
      sliceZ: 7,
      support: 0.9,
    });
    const raster = { width: 2, height: 2, widthMm: 20, heightMm: 20, pixels: new Float32Array(4) };
    (reconstructPanorama as jest.Mock).mockResolvedValue(raster);
    (reconstructSections as jest.Mock).mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({ distance: i, raster }))
    );
    originalRAF = global.requestAnimationFrame;
    originalCancel = global.cancelAnimationFrame;
    originalObserver = global.ResizeObserver;
    frames = new Map();
    let frameId = 0;
    global.requestAnimationFrame = jest.fn(callback => {
      frames.set(++frameId, callback);
      return frameId;
    });
    global.cancelAnimationFrame = jest.fn(id => frames.delete(id));
    global.ResizeObserver = jest.fn(() => ({ observe: jest.fn(), disconnect: jest.fn() })) as any;
    contextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fillText: jest.fn(),
      setTransform: jest.fn(),
      drawImage: jest.fn(),
    } as any);
    canvasRectSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ left: 0, top: 0, width: 600, height: 300 } as DOMRect);
  });
  afterEach(() => {
    element.remove();
    contextSpy.mockRestore();
    canvasRectSpy.mockRestore();
    global.requestAnimationFrame = originalRAF;
    global.cancelAnimationFrame = originalCancel;
    global.ResizeObserver = originalObserver;
  });

  it('puts the axial preview before sections and scrolls the existing source with synchronized position', async () => {
    const engine = getEnabledElement(element).renderingEngine;
    const getViewport = engine.getViewport;
    const renderSkull = jest.fn();
    engine.getViewport = id => ({ ...getViewport(id), render: id === 'mpr-3d' ? renderSkull : undefined });
    const viewport = getEnabledElement(element).viewport as any;
    let index = 0;
    viewport.getNumberOfSlices = () => 50;
    viewport.getCurrentImageIdIndex = () => index;
    const view = render(React.createElement(ManualPanorama, { element, viewportGridService: service }));
    await act(async () => { window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA)); });
    await flushFrames();
    expect(renderSkull).toHaveBeenCalled();
    await waitFor(() => expect(view.getByLabelText('Аксиальный срез с зубной дугой')).toBeTruthy());
    await flushFrames();
    const panels = document.querySelector('.manual-panorama-workspace').querySelectorAll(':scope > section');
    expect(panels[0].querySelector('header').textContent).toContain('Аксиальный срез');
    expect(panels[1].querySelector('header').textContent).toContain('Поперечные сечения');
    const scrollbar = view.getByRole('slider', { name: 'Прокрутка аксиальных слоёв' }) as HTMLInputElement;
    expect(scrollbar.max).toBe('49');
    fireEvent.change(scrollbar, { target: { value: '23' } });
    expect(utilities.jumpToSlice).toHaveBeenLastCalledWith(element, { imageIndex: 23, debounceLoading: true });
    index = 23;
    act(() => element.dispatchEvent(new Event(Enums.Events.IMAGE_RENDERED)));
    await flushFrames();
    expect(scrollbar.value).toBe('23');
    view.unmount();
  });

  it('expands any selected section without recentering or reconstructing and restores the editor on Escape', async () => {
    const view = render(React.createElement(ManualPanorama, { element, viewportGridService: service }));
    await act(async () => { window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA)); });
    await flushFrames();
    const expand = await view.findByRole('button', { name: 'Увеличить сечение 1' });
    const calls = (reconstructSections as jest.Mock).mock.calls.length;
    fireEvent.click(expand);
    const full = view.getByLabelText('Развёрнутое поперечное сечение');
    expect(full.parentElement.className).toBe('manual-panorama-workspace');
    expect(full.style.width).toBe('600px');
    expect(full.style.height).toBe('300px');
    expect(full.style.inset).toBe('0 0 auto auto');
    expect(view.getByLabelText('Увеличенное поперечное сечение 1')).toBeTruthy();
    const overlay = view.getByLabelText('Зубная дуга: точки можно перетаскивать');
    expect(overlay.querySelectorAll('line')).toHaveLength(1);
    expect(overlay.querySelectorAll('circle, text')).toHaveLength(0);
    expect(overlay.querySelectorAll('polyline')).toHaveLength(1);
    expect(full.querySelectorAll('[data-panorama-marker]')).toHaveLength(2);
    fireEvent.click(view.getByRole('button', { name:'Скрыть крест сечения', exact:true }));
    expect(full.querySelectorAll('[data-panorama-marker]')).toHaveLength(0);
    fireEvent.click(view.getByRole('button', { name:'Показать крест сечения', exact:true }));
    expect(full.querySelectorAll('[data-panorama-marker]')).toHaveLength(2);
    fireEvent.click(view.getByRole('button', { name:'Перемещение поперечного сечения', exact:true }));
    expect(view.getByRole('button', { name:'Перемещение поперечного сечения', exact:true }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(view.getByRole('button', { name: 'Увеличить масштаб сечения', exact: true }));
    expect(view.getByLabelText('Увеличенное поперечное сечение 1').closest('.manual-section-raster').getAttribute('style')).toContain('scale(1.25)');
    fireEvent.click(view.getByRole('button', { name: 'Уменьшить масштаб сечения', exact: true }));
    expect(view.getByLabelText('Увеличенное поперечное сечение 1').closest('.manual-section-raster').getAttribute('style')).toContain('scale(1)');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    expect(reconstructSections).toHaveBeenCalledTimes(calls);
    fireEvent.click(view.getByRole('button', { name: 'Вернуть сетку сечений' }));
    expect(view.queryByLabelText('Развёрнутое поперечное сечение')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Увеличить сечение 9' }));
    expect(view.getByLabelText('Увеличенное поперечное сечение 9')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(view.queryByLabelText('Развёрнутое поперечное сечение')).toBeNull();
    expect(document.body.classList.contains('manual-panorama-active')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.body.classList.contains('manual-panorama-active')).toBe(false);
    view.unmount();
  });

  it('navigates an enlarged off-center frame with wheel and scrollbar all the way to both arch endpoints', async () => {
    const raster = { width: 2, height: 2, widthMm: 20, heightMm: 20, pixels: new Float32Array(4) };
    (reconstructSections as jest.Mock).mockImplementation(async ({ center, step, curve }) =>
      Array.from({ length: 9 }, (_, i) => {
        const distance = center + (i - 4) * step;
        return { distance, raster: distance >= 0 && distance <= curve.length ? raster : null };
      }));
    const view = render(React.createElement(ManualPanorama, { element, viewportGridService: service }));
    await act(async () => { window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA)); });
    await flushFrames();
    fireEvent.click(await view.findByRole('button', { name: 'Увеличить сечение 9' }));
    const initialCenter = (reconstructSections as jest.Mock).mock.calls[0][0].center;
    const full = view.getByLabelText('Развёрнутое поперечное сечение');
    fireEvent.wheel(full, { deltaY: 100 });
    await flushFrames();
    expect((reconstructSection as jest.Mock).mock.calls.at(-1)[0].distance).toBeCloseTo(initialCenter + 8.2);
    act(() => { for (let i = 0; i < 3; i++) fireEvent.wheel(full, { deltaY: 100 }); });
    await flushFrames();
    expect((reconstructSection as jest.Mock).mock.calls.at(-1)[0].distance).toBeCloseTo(initialCenter + 8.8);
    await view.findByLabelText('Увеличенное поперечное сечение 5');
    const scrollbar = view.getByRole('slider', { name: 'Положение сечения по зубной дуге' }) as HTMLInputElement;
    const length = (reconstructSections as jest.Mock).mock.calls.at(-1)[0].curve.length;
    for (const value of [1000, 0, 400]) {
      fireEvent.change(scrollbar, { target: { value: String(value) } });
      await flushFrames();
      expect((reconstructSection as jest.Mock).mock.calls.at(-1)[0].distance).toBeCloseTo(value / 1000 * length);
      await view.findByLabelText('Увеличенное поперечное сечение 5');
      expect(Number(scrollbar.value)).toBe(value);
    }
    const tilt = view.getByRole('slider', { name: 'Наклон поперечного сечения' });
    for (const angle of [15, -15]) {
      fireEvent.change(tilt, { target: { value: String(angle) } });
      await flushFrames();
      const sampled = (reconstructSection as jest.Mock).mock.calls.at(-1)[0];
      expect(sampled.tilt).toBe(angle);
      expect(sampled.distance).toBeCloseTo(length * 0.4);
      expect(view.container.ownerDocument.querySelector('[data-panorama-marker="tilted-section"]')).toBeTruthy();
    }
    fireEvent.doubleClick(tilt);
    await flushFrames();
    expect((reconstructSection as jest.Mock).mock.calls.at(-1)[0].tilt).toBe(0);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    expect(reconstructSections).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(reconstructSections).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((reconstructSections as jest.Mock).mock.calls.at(-1)[0].center).toBeCloseTo(length * 0.4));
    view.unmount();
  });

  it('does not read voxel spacing from the cache until its source volume is assigned', () => {
    (getEnabledElement as jest.Mock).mockReturnValue(undefined);
    (cache.getVolume as jest.Mock).mockImplementation(id => {
      if (!id) throw new Error('volumeId must not be undefined');
      return undefined;
    });
    const view = render(React.createElement(ManualPanorama, { element, viewportGridService: service }));
    expect(view.getByRole('button', { name: 'Панорама' })).toBeTruthy();
    expect(cache.getVolume).not.toHaveBeenCalled();
    view.unmount();
  });

  it('starts drawing from the real header button without relying on the viewport ref prop', async () => {
    const view = render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { id: 'orbital-panorama-header-slot' },
          React.createElement(DentalPanoramaButton, {
            onClick: () => {
              window.dispatchEvent(new Event(START_MANUAL_PANORAMA));
            },
          })
        ),
        React.createElement(ManualPanorama, {
          element: undefined,
          getElement: () => element,
          externalLauncher: true,
          viewportGridService: service,
        })
      )
    );
    const launchers = view.getAllByRole('button', { name: 'Панорама' });
    expect(launchers).toHaveLength(1);
    expect(launchers[0].closest('#orbital-panorama-header-slot')).toBeTruthy();
    expect(launchers[0].style.height).toBe('100%');
    await act(async () => {
      fireEvent.click(launchers[0]);
    });
    expect(view.getByLabelText('Зубная дуга: точки можно перетаскивать')).toBeTruthy();
    view.unmount();
  });

  it('keeps the icon in the header while the axial viewport is still initializing', async () => {
    const ready = getEnabledElement(element);
    (getEnabledElement as jest.Mock).mockReturnValue(undefined);
    const slot = document.createElement('div');
    slot.id = 'orbital-panorama-header-slot';
    document.body.append(slot);
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    expect(slot.contains(view.getByRole('button', { name: 'Панорама' }))).toBe(true);
    (getEnabledElement as jest.Mock).mockReturnValue(ready);
    act(() => {
      eventTarget.dispatchEvent(
        new CustomEvent(Enums.Events.ELEMENT_ENABLED, { detail: { element } })
      );
    });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Панорама' }));
    });
    expect(view.getByLabelText('Зубная дуга: точки можно перетаскивать')).toBeTruthy();
    view.unmount();
    slot.remove();
  });

  it('keeps the launcher visible when a viewport is disabled and then re-enabled', async () => {
    const ready = getEnabledElement(element);
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    (getEnabledElement as jest.Mock).mockReturnValue(undefined);
    act(() => {
      eventTarget.dispatchEvent(
        new CustomEvent(Enums.Events.ELEMENT_DISABLED, { detail: { element } })
      );
    });
    expect(view.getByRole('button', { name: 'Панорама' })).toBeTruthy();
    (getEnabledElement as jest.Mock).mockReturnValue(ready);
    act(() => {
      eventTarget.dispatchEvent(
        new CustomEvent(Enums.Events.ELEMENT_ENABLED, { detail: { element } })
      );
    });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Панорама' }));
    });
    expect(view.getByLabelText('Зубная дуга: точки можно перетаскивать')).toBeTruthy();
    view.unmount();
  });

  it('previews section lines from the second point without intercepting new arch points', async () => {
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    const launcher = view.getByRole('button', { name: 'Панорама' });
    expect(launcher.textContent.trim()).toBe('');
    expect(launcher.querySelector('svg')).toBeTruthy();
    await act(async () => {
      fireEvent.click(launcher);
    });
    const overlay = view.getByLabelText('Зубная дуга: точки можно перетаскивать');
    fireEvent.click(overlay, { clientX: 10, clientY: 20, button: 0, detail: 1 });
    fireEvent.click(overlay, { clientX: 20, clientY: 10, button: 0, detail: 1 });
    const tick = overlay.querySelector('.manual-section-tick');
    expect(tick).toBeTruthy();
    expect(tick.getAttribute('pointer-events')).toBe('none');
    expect((view.getByRole('button', { name: 'Построить' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(reconstructPanorama).not.toHaveBeenCalled();
    fireEvent.click(tick.querySelector('line'), { clientX: 30, clientY: 20, button: 0, detail: 1 });
    expect(overlay.querySelectorAll('circle')).toHaveLength(3);
    expect((view.getByRole('button', { name: 'Построить' }) as HTMLButtonElement).disabled).toBe(
      false
    );
    fireEvent.click(view.getByRole('button', { name: 'Убрать точку' }));
    expect(overlay.querySelectorAll('circle')).toHaveLength(2);
    expect(overlay.querySelector('.manual-section-tick')).toBeTruthy();
    view.unmount();
  });

  it('keeps the expanded drawing area and its coordinate system until the arch is finished', async () => {
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Панорама' }));
    });
    expect(service.set).not.toHaveBeenCalled();
    expect(
      view.getByLabelText('Зубная дуга: точки можно перетаскивать').getAttribute('viewBox')
    ).toBe('0 0 900 600');
    markArch(view);
    fireEvent.click(view.getByRole('button', { name: 'Вернуться в MPR' }));
    expect(getFocusedMprViewport(state)).toBe('mpr-axial');
    expect(service.set).not.toHaveBeenCalled();
    view.unmount();
  });

  it('switches to four panels only after completion and preserves the world-space arch', async () => {
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Панорама' }));
    });
    markArch(view);
    await act(async () => {
      fireEvent.doubleClick(view.getByLabelText('Зубная дуга: точки можно перетаскивать'));
    });
    expect(service.set).toHaveBeenCalledTimes(1);
    await flushFrames();
    await waitFor(() => expect(reconstructPanorama).toHaveBeenCalled());
    expect(getFocusedMprViewport(state)).toBe(null);
    const reconstructed = (reconstructPanorama as jest.Mock).mock.calls[0][0].curve;
    expect(reconstructed.points[0]).toEqual([10, 20, 0]);
    expect(reconstructed.points[reconstructed.points.length - 1]).toEqual([30, 20, 0]);
    expect(view.getByRole('button', { name: 'Изменить дугу' })).toBeTruthy();
    view.unmount();
  });

  it('starts at 20 mm and 5×, allows 10× without reconstruction, and reconstructs a selected 30 mm slab', async () => {
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Панорама' }));
    });
    markArch(view);
    await act(async () => {
      fireEvent.doubleClick(view.getByLabelText('Зубная дуга: точки можно перетаскивать'));
    });
    await flushFrames();
    await waitFor(() => {
      expect(reconstructPanorama).toHaveBeenCalledTimes(1);
      expect(reconstructSections).toHaveBeenCalledTimes(1);
      expect(view.getByLabelText('Панорама: нажмите для выбора сечения')).toBeTruthy();
    });
    const slider = view.getByRole('slider', { name: 'Резкость панорамы' }) as HTMLInputElement;
    expect(
      (view.getByRole('combobox', { name: 'Толщина панорамы' }) as HTMLSelectElement).value
    ).toBe('20');
    expect((reconstructPanorama as jest.Mock).mock.calls[0][0].thickness).toBe(20);
    expect(slider.value).toBe('5');
    expect(view.getByLabelText('Усиление резкости').textContent).toBe('5×');
    expect(slider.max).toBe('10');
    fireEvent.change(slider, { target: { value: '10' } });
    expect(slider.value).toBe('10');
    expect(view.getByLabelText('Усиление резкости').textContent).toBe('10×');
    // Longer than both reconstruction debounce intervals: no hidden rebuild is scheduled.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    expect(reconstructSections).toHaveBeenCalledTimes(1);
    fireEvent.change(slider, { target: { value: '1' } });
    expect(view.getByLabelText('Усиление резкости').textContent).toBe('1×');
    fireEvent.change(view.getByRole('combobox', { name: 'Толщина панорамы' }), {
      target: { value: '30' },
    });
    await waitFor(() => expect(reconstructPanorama).toHaveBeenCalledTimes(2));
    expect((reconstructPanorama as jest.Mock).mock.calls[1][0].thickness).toBe(30);
    expect(reconstructSections).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('selects inside a proportionally fitted panorama and ignores margins as its height changes', async () => {
    (reconstructPanorama as jest.Mock).mockImplementation(async ({ heightMm }) => ({
      width: 200,
      height: heightMm,
      widthMm: 200,
      heightMm,
      pixels: new Float32Array(200 * heightMm),
    }));
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    await flushFrames();
    await waitFor(() => expect(reconstructPanorama).toHaveBeenCalledTimes(1));
    let canvas = (await view.findByLabelText(
      'Панорама: нажмите для выбора сечения'
    )) as HTMLCanvasElement;
    canvas.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 600, height: 300 }) as DOMRect;
    const viewport = getEnabledElement(element).viewport as any;
    viewport.setCamera.mockClear();
    fireEvent.change(view.getByRole('combobox', { name: 'Высота панорамы' }), { target: { value: '80' } });
    const bounds = canvas.getBoundingClientRect;
    canvas = await view.findByLabelText('Панорама: нажмите для выбора сечения') as HTMLCanvasElement;
    await waitFor(() => expect(canvas.height).toBe(80));
    canvas.getBoundingClientRect = bounds;
    // At 200 x 80 the image fits the width, with 30px margins above and below.
    fireEvent.click(canvas, { clientX: 310, clientY: 25 });
    expect(viewport.setCamera).not.toHaveBeenCalled();
    fireEvent.change(view.getByRole('combobox', { name: 'Высота панорамы' }), {
      target: { value: '140' },
    });
    const tallerCanvas = (await view.findByLabelText(
      'Панорама: нажмите для выбора сечения'
    )) as HTMLCanvasElement;
    await waitFor(() => expect(tallerCanvas.height).toBe(140));
    tallerCanvas.getBoundingClientRect = canvas.getBoundingClientRect;
    // The taller panorama fits the height, with horizontal margins. Click one,
    // then pick source pixel (30,35), accounting for the centered image bounds.
    fireEvent.click(tallerCanvas, { clientX: 25, clientY: 170 });
    expect(viewport.setCamera).not.toHaveBeenCalled();
    fireEvent.click(tallerCanvas, {
      clientX: 160,
      clientY: 95,
    });
    expect(viewport.setCamera).toHaveBeenCalledTimes(1);
    expect(viewport.setCamera.mock.calls[0][0].focalPoint[2]).toBeCloseTo(
      7 + (0.5 - 35 / 139) * 140
    );
    await waitFor(() => {
      const sectionCalls = (reconstructSections as jest.Mock).mock.calls;
      const { center, curve } = sectionCalls[sectionCalls.length - 1][0];
      expect(center / curve.length).toBeCloseTo(30 / 199);
    });
    view.unmount();
  });

  it('keeps the slice marker and click height aligned after unscanned panorama rows are removed', async () => {
    (reconstructPanorama as jest.Mock).mockResolvedValueOnce({
      width: 4,
      height: 5,
      widthMm: 30,
      heightMm: 40,
      topMm: 30,
      pixels: new Float32Array(20),
    });
    const makeContext = contextSpy.getMockImplementation();
    const contexts = new WeakMap();
    contextSpy.mockImplementation(function () {
      if (!contexts.has(this)) {
        contexts.set(this, {
          ...makeContext(),
          moveTo: jest.fn(),
          lineTo: jest.fn(),
        });
      }
      return contexts.get(this);
    });
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    await flushFrames();
    const canvas = (await view.findByLabelText(
      'Панорама: нажмите для выбора сечения'
    )) as HTMLCanvasElement;
    await waitFor(() => expect(canvas.height).toBe(5));
    // Camera Z=0 is 7mm below the arch. Cropped rows extend from +30 to -10mm.
    const markerY = ((30 + 7) / 40) * 4;
    const marker = canvas.parentElement.querySelector('[data-panorama-marker="horizontal"]');
    expect(Number(marker.getAttribute('y1'))).toBeCloseTo(markerY);
    const viewport = getEnabledElement(element).viewport as any;
    viewport.setCamera.mockClear();
    // Contain fit: 240 x 300px, left margin 180px. Pick the middle vertical pixel.
    fireEvent.click(canvas, { clientX: 240, clientY: 120 });
    expect(viewport.setCamera).toHaveBeenCalledTimes(1);
    expect(viewport.setCamera.mock.calls[0][0].focalPoint[2]).toBeCloseTo(17);
    await waitFor(() => {
      const sectionCalls = (reconstructSections as jest.Mock).mock.calls;
      const { center, curve } = sectionCalls[sectionCalls.length - 1][0];
      expect(center / curve.length).toBeCloseTo(1 / 3);
    });
    view.unmount();
  });

  it('does not reopen the workspace if Escape is pressed while the layout is resizing', async () => {
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Панорама' }));
    });
    markArch(view);
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Построить' }));
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    await flushFrames();
    expect(view.queryByRole('button', { name: 'Изменить дугу' })).toBe(null);
    expect(view.getByRole('button', { name: 'Панорама' })).toBeTruthy();
    expect(reconstructPanorama).not.toHaveBeenCalled();
    view.unmount();
  });

  it('opens the same workspace from the automatic header button and reconstructs the found editable arch', async () => {
    const view = render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          { id: 'orbital-panorama-header-slot' },
          React.createElement(DentalPanoramaButton, {
            automatic: true,
            onClick: () => window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA)),
          })
        ),
        React.createElement(ManualPanorama, {
          element,
          viewportGridService: service,
          externalLauncher: true,
        })
      )
    );
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Автоматическая панорама' }));
    });
    await flushFrames();
    await waitFor(() => expect(reconstructPanorama).toHaveBeenCalledTimes(1));
    expect(view.getByText('Поперечные сечения')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Редактирование', exact: true }).getAttribute('aria-pressed')).toBe('true');
    expect((reconstructPanorama as jest.Mock).mock.calls[0][0].heightMm).toBe(140);
    expect(
      view.getByLabelText('Зубная дуга: точки можно перетаскивать').querySelectorAll('circle')
    ).toHaveLength(3);
    expect(getFocusedMprViewport(state)).toBe(null);
    const viewport = getEnabledElement(element).viewport as any;
    expect(viewport.setOrientation).toHaveBeenCalledWith('axial');
    expect(viewport.setCamera.mock.calls[0][0].focalPoint[2]).toBe(7);
    expect((reconstructPanorama as jest.Mock).mock.calls[0][0].thickness).toBe(20);
    expect(
      (view.getByRole('slider', { name: 'Резкость панорамы' }) as HTMLInputElement).value
    ).toBe('5');
    expect((reconstructPanorama as jest.Mock).mock.calls[0][0].curve.points[0]).toEqual([
      10, 20, 7,
    ]);
    const overlay = view.getByLabelText('Зубная дуга: точки можно перетаскивать');
    const calls = (reconstructPanorama as jest.Mock).mock.calls.length;
    fireEvent.click(view.getByRole('button', { name: 'Без дуги', exact: true }));
    expect(overlay.querySelectorAll('line, circle, polyline, text')).toHaveLength(0);
    fireEvent.click(view.getByRole('button', { name: 'Автодуга', exact: true }));
    expect(overlay.querySelector('polyline')).toBeTruthy();
    expect(overlay.querySelector('line')).toBeTruthy();
    expect(overlay.querySelectorAll('circle')).toHaveLength(0);
    fireEvent.click(view.getByRole('button', { name: 'Редактирование', exact: true }));
    expect(overlay.querySelectorAll('circle')).toHaveLength(3);
    fireEvent.click(view.getByRole('button', { name: 'Увеличить масштаб сечений', exact: true }));
    expect(view.getAllByLabelText('Поперечное сечение')[0].closest('.manual-section-raster').getAttribute('style')).toContain('scale(1.25)');
    expect(reconstructPanorama).toHaveBeenCalledTimes(calls);
    fireEvent.click(view.getByRole('button', { name: 'Изменить дугу' }));
    expect(view.getByRole('button', { name: 'Построить' })).toBeTruthy();
    expect(
      view.getByLabelText('Зубная дуга: точки можно перетаскивать').querySelectorAll('circle')
    ).toHaveLength(3);
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('shows progress inside the workspace and offers manual drawing when no supported arch is found', async () => {
    let reject;
    (detectDentalArch as jest.Mock).mockImplementationOnce(({ onProgress }) => {
      onProgress(35);
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    });
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    expect(
      view.getAllByRole('status').some(item => item.textContent.includes('Ищем зубную дугу… 35%'))
    ).toBe(true);
    expect(view.getByText('Поперечные сечения')).toBeTruthy();
    expect(reconstructPanorama).not.toHaveBeenCalled();
    await act(async () => {
      reject(new Error('Не удалось уверенно найти зубную дугу.'));
    });
    expect(view.getByRole('alert').textContent).toContain('Не удалось');
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Построить вручную' }));
    });
    expect(view.getByRole('button', { name: 'Построить' })).toBeTruthy();
    expect(view.queryByRole('alert')).toBe(null);
    view.unmount();
  });
  it('retains every detected control for both the smooth drawn path and reconstruction', async () => {
    const points = Array.from({ length: 25 }, (_, i) => {
      const a = Math.PI + (i * Math.PI) / 24;
      return [200 + 120 * Math.cos(a), 150 + 70 * Math.sin(a), 7] as [number, number, number];
    });
    (detectDentalArch as jest.Mock).mockResolvedValueOnce({ points, sliceZ: 7, support: 0.9 });
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    await flushFrames();
    await waitFor(() => expect(reconstructPanorama).toHaveBeenCalledTimes(1));
    const handles = view
      .getByLabelText('Зубная дуга: точки можно перетаскивать')
      .querySelectorAll('circle');
    expect(handles.length).toBe(points.length);
    expect(Number(handles[0].getAttribute('cx'))).toBe(points[0][0]);
    expect(Number(handles[handles.length - 1].getAttribute('cx'))).toBe(points[24][0]);
    const vertices = [...handles].map(
      handle =>
        [Number(handle.getAttribute('cx')), Number(handle.getAttribute('cy')), 7] as [
          number,
          number,
          number,
        ]
    );
    const curve = (reconstructPanorama as jest.Mock).mock.calls[0][0].curve;
    expect(vertices).toEqual(points);
    expect(curve).toEqual(buildCurve(vertices));
    const drawn = view
      .getByLabelText('Зубная дуга: точки можно перетаскивать')
      .querySelector('polyline');
    expect(drawn.getAttribute('points')).toBe(curve.points.map(p => `${p[0]},${p[1]}`).join(' '));
    view.unmount();
  });
  it('keeps dragging through rerenders and capture loss, preserves the arch plane, and reconstructs after release', async () => {
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    await flushFrames();
    await waitFor(() => expect(reconstructPanorama).toHaveBeenCalledTimes(1));
    const overlay = view.getByLabelText(
      'Зубная дуга: точки можно перетаскивать'
    ) as unknown as SVGSVGElement;
    overlay.getBoundingClientRect = () =>
      ({ left: 600, top: 327, width: 600, height: 300 }) as DOMRect;
    overlay.setPointerCapture = jest.fn();
    overlay.hasPointerCapture = () => false;
    const viewport = getEnabledElement(element).viewport as any;
    viewport.canvasToWorld = ([x, y]) => [x, y, 33];
    const pointer = (target, type, extra = {}) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, button: 0, clientX: 620, clientY: 337, ...extra });
      fireEvent(target, event);
      return event;
    };
    const down = pointer(overlay.querySelectorAll('circle')[1], 'pointerdown');
    expect(down.defaultPrevented).toBe(true);
    pointer(window, 'pointermove', { clientX: 640, clientY: 317 });
    expect(overlay.querySelectorAll('circle')[1].getAttribute('cx')).toBe('40');
    pointer(overlay, 'lostpointercapture');
    viewport.canvasToWorld = ([x, y]) => [x, y, 46];
    pointer(window, 'pointermove', { clientX: 660, clientY: 297 });
    expect(overlay.querySelectorAll('circle')[1].getAttribute('cx')).toBe('60');
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 220));
    });
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    pointer(window, 'pointerup');
    await waitFor(() => expect(reconstructPanorama).toHaveBeenCalledTimes(2));
    const curve = (reconstructPanorama as jest.Mock).mock.calls[1][0].curve;
    expect(curve.points.every(p => Math.abs(p[2] - 7) < 1e-9)).toBe(true);
    pointer(window, 'pointermove', { clientX: 700 });
    expect(overlay.querySelectorAll('circle')[1].getAttribute('cx')).toBe('60');
    view.unmount();
  });
  it.each(['pointercancel', 'blur'])(
    'ends an active drag on %s and ignores later motion',
    async endEvent => {
      const view = render(
        React.createElement(ManualPanorama, { element, viewportGridService: service })
      );
      await act(async () => {
        window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
      });
      await flushFrames();
      const overlay = view.getByLabelText('Зубная дуга: точки можно перетаскивать');
      const pointer = (target, type, extra = {}) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { pointerId: 1, button: 0, clientX: 20, clientY: 10, ...extra });
        fireEvent(target, event);
      };
      pointer(overlay.querySelectorAll('circle')[1], 'pointerdown');
      pointer(window, 'pointermove', { pointerId: 2, clientX: 90 });
      expect(overlay.querySelectorAll('circle')[1].getAttribute('cx')).toBe('20');
      pointer(window, 'pointermove', { clientX: 40 });
      expect(overlay.querySelectorAll('circle')[1].getAttribute('cx')).toBe('40');
      pointer(window, endEvent);
      pointer(window, 'pointermove', { clientX: 60 });
      expect(overlay.querySelectorAll('circle')[1].getAttribute('cx')).toBe('40');
      view.unmount();
    }
  );
  it('explicitly reports unconfirmed posterior coverage instead of presenting a cropped arch as complete', async () => {
    (detectDentalArch as jest.Mock).mockResolvedValueOnce({
      points: [
        [10, 20, 7],
        [20, 10, 7],
        [30, 20, 7],
      ],
      sliceZ: 7,
      support: 0.9,
      coverageWarning: 'Проверьте моляры у границы поля.',
    });
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    expect(view.getByRole('alert').textContent).toContain('моляры');
    fireEvent.click(view.getByRole('button', { name: 'Вернуться в MPR' }));
    expect(view.queryByRole('alert')).toBe(null);
    view.unmount();
  });

  it.each(['Escape', 'manual', 'volume', 'unmount'])(
    'ignores an obsolete automatic result after %s',
    async action => {
      let resolve;
      (detectDentalArch as jest.Mock).mockImplementationOnce(
        () =>
          new Promise(done => {
            resolve = done;
          })
      );
      const view = render(
        React.createElement(ManualPanorama, { element, viewportGridService: service })
      );
      await act(async () => {
        window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
      });
      const signal = (detectDentalArch as jest.Mock).mock.calls[0][0].signal;
      if (action === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
      if (action === 'manual')
        await act(async () => {
          fireEvent.click(view.getByRole('button', { name: 'Построить вручную' }));
        });
      if (action === 'volume') {
        (getEnabledElement(element).viewport as any).getVolumeId = () => 'another-volume';
        act(() => {
          element.dispatchEvent(new Event(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME));
        });
      }
      if (action === 'unmount') view.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => {
        resolve({
          points: [
            [10, 20, 7],
            [20, 10, 7],
            [30, 20, 7],
          ],
          sliceZ: 7,
          support: 0.9,
        });
      });
      expect(reconstructPanorama).not.toHaveBeenCalled();
      expect((getEnabledElement(element).viewport as any).setCamera).not.toHaveBeenCalled();
      if (action !== 'unmount') view.unmount();
    }
  );

  it('reuses the startup raster in the editor, preserves edits on reopening, and rebuilds only for changed parameters', async () => {
    const viewport = getEnabledElement(element).viewport as any;
    const volume = cache.getVolume('volume-a');
    const session = getPanoramaSession(volume);
    const prepared = await session.ensure(viewport, volume);
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    const open = async () => {
      await act(async () => {
        window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
      });
      await flushFrames();
      await view.findByLabelText('Панорама: нажмите для выбора сечения');
    };
    await open();
    await waitFor(() => expect(reconstructSections).toHaveBeenCalledTimes(1));
    expect(session.state.snapshot.raster).toBe(prepared.raster);
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole('button', { name: 'Вернуться в MPR' }));
    await open();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 230));
    });
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    expect(reconstructSections).toHaveBeenCalledTimes(1);
    fireEvent.change(view.getByRole('combobox', { name: 'Толщина панорамы' }), {
      target: { value: '30' },
    });
    await waitFor(() => expect(session.state.snapshot.thickness).toBe(30));
    expect(reconstructPanorama).toHaveBeenCalledTimes(2);
    fireEvent.change(view.getByRole('slider', { name: 'Резкость панорамы' }), {
      target: { value: '10' },
    });
    expect(session.state.snapshot.sharpness).toBe(10);
    fireEvent.click(view.getByRole('button', { name: 'Вернуться в MPR' }));
    await open();
    expect(
      (view.getByRole('combobox', { name: 'Толщина панорамы' }) as HTMLSelectElement).value
    ).toBe('30');
    expect(
      (view.getByRole('slider', { name: 'Резкость панорамы' }) as HTMLInputElement).value
    ).toBe('10');
    expect(reconstructPanorama).toHaveBeenCalledTimes(2);
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole('button', { name: 'Найти дугу заново' }));
    await waitFor(() => expect(reconstructPanorama).toHaveBeenCalledTimes(3));
    expect(detectDentalArch).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('joins startup generation already in progress instead of launching a second search', async () => {
    let finish;
    (detectDentalArch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const session = getPanoramaSession(cache.getVolume('volume-a'));
    const pending = session.ensure(
      getEnabledElement(element).viewport,
      cache.getVolume('volume-a')
    );
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({
        points: [
          [10, 20, 7],
          [20, 10, 7],
          [30, 20, 7],
        ],
        sliceZ: 7,
      });
      await pending;
    });
    await flushFrames();
    await view.findByLabelText('Панорама: нажмите для выбора сечения');
    expect(detectDentalArch).toHaveBeenCalledTimes(1);
    expect(reconstructPanorama).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('requires all slices before starting automatic analysis', async () => {
    (cache.getVolume as jest.Mock).mockReturnValue({ loadStatus: { loaded: false } });
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    expect(view.getByRole('alert').textContent).toContain('Дождитесь полной загрузки');
    expect(detectDentalArch).not.toHaveBeenCalled();
    view.unmount();
  });
  it('keeps the newer automatic proposal when an earlier search finishes late', async () => {
    let firstDone;
    (detectDentalArch as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            firstDone = resolve;
          })
      )
      .mockResolvedValueOnce({
        points: [
          [12, 20, 8],
          [22, 10, 8],
          [32, 20, 8],
        ],
        sliceZ: 8,
        support: 0.9,
      });
    const view = render(
      React.createElement(ManualPanorama, { element, viewportGridService: service })
    );
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    await act(async () => {
      window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
    });
    await waitFor(() => expect(reconstructPanorama).toHaveBeenCalledTimes(1));
    await act(async () => {
      firstDone({
        points: [
          [10, 20, 7],
          [20, 10, 7],
          [30, 20, 7],
        ],
        sliceZ: 7,
        support: 0.9,
      });
    });
    expect((detectDentalArch as jest.Mock).mock.calls[0][0].signal.aborted).toBe(true);
    expect((reconstructPanorama as jest.Mock).mock.calls[0][0].curve.points[0]).toEqual([
      12, 20, 8,
    ]);
    expect((getEnabledElement(element).viewport as any).setCamera).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
