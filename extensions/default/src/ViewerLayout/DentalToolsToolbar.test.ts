import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import DentalToolsToolbar from './DentalToolsToolbar';
import { getAxesVisible, setAxesVisible } from '@ohif/core/src/constants/orbitalAxes';
import { getImageFilter, setImageFilter, IMAGE_FILTER_OPTIONS } from '@ohif/core/src/constants/orbitalImageFilters';

describe('Russian dental toolbar', () => {
  afterEach(() => act(() => { setAxesVisible(true); setImageFilter('none'); }));
  it('selects the hand, shows its instructions and returns to slice navigation on Escape', () => {
    const commandsManager = { run: jest.fn() };
    const view = render(React.createElement(DentalToolsToolbar, { commandsManager }));
    fireEvent.click(view.getByRole('button', { name: 'Перемещение', exact: true }));
    expect(commandsManager.run).toHaveBeenLastCalledWith('activateDentalTool', { tool: 'pan' });
    act(() => window.dispatchEvent(new CustomEvent('orbital:dental-tool-changed', { detail: { tool: 'pan' } })));
    expect(view.getByRole('button', { name: 'Перемещение', exact: true }).getAttribute('aria-pressed')).toBe('true');
    expect(view.getByRole('status').textContent).toContain('Тяните изображение');
    expect(document.body.classList.contains('dental-pan-active')).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(commandsManager.run).toHaveBeenLastCalledWith('activateDentalTool', { tool: 'navigate' });
    act(() => window.dispatchEvent(new CustomEvent('orbital:dental-tool-changed', { detail: { tool: 'navigate' } })));
    expect(document.body.classList.contains('dental-pan-active')).toBe(false);
    view.unmount();
  });
  it('selects the global 2D filter without changing the active navigation or measurement tool', () => {
    const commandsManager = { run: jest.fn() };
    const view = render(React.createElement(DentalToolsToolbar, { commandsManager }));
    for (const option of [...IMAGE_FILTER_OPTIONS.slice(1), IMAGE_FILTER_OPTIONS[0]]) {
      fireEvent.click(view.getByRole('button', { name: 'Фильтры 2D' }));
      fireEvent.click(view.getByRole('menuitemradio', { name: new RegExp(option.title.split(' — ')[0]) }));
      expect(getImageFilter()).toBe(option.id);
      expect(view.getByRole('button', { name: 'Фильтры 2D' }).getAttribute('data-active')).toBe(String(option.id !== 'none'));
    }
    expect(commandsManager.run).not.toHaveBeenCalled();
  });
  it('toggles axes with the button and Enter in a viewport without swallowing form or tool input', () => {
    const commandsManager = { run: jest.fn((name) => {
      if (name === 'toggleDentalAxes') { setAxesVisible(!getAxesVisible()); return true; }
    }) };
    const view = render(React.createElement(DentalToolsToolbar, { commandsManager }));
    fireEvent.click(view.getByRole('button', { name: 'Скрыть оси координат' }));
    expect(view.getByRole('button', { name: 'Показать оси координат' }).getAttribute('aria-pressed')).toBe('false');
    const viewport = document.createElement('div');
    viewport.dataset.viewportid = 'mpr-axial';
    document.body.append(viewport);
    const hotkey = event => event.stopPropagation();
    document.addEventListener('keydown', hotkey);
    fireEvent.pointerDown(viewport);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(commandsManager.run).toHaveBeenLastCalledWith('toggleDentalAxes', { fromKeyboard: true });
    expect(getAxesVisible()).toBe(true);
    const input = document.createElement('input');
    viewport.append(input);
    commandsManager.run.mockClear();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(viewport, { key: 'Enter', repeat: true });
    fireEvent.keyDown(viewport, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(viewport, { key: 'Enter', isComposing: true });
    expect(commandsManager.run).not.toHaveBeenCalled();
    commandsManager.run.mockReturnValue(false);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    viewport.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(getAxesVisible()).toBe(true);
    document.removeEventListener('keydown', hotkey);
    fireEvent.pointerDown(document.body);
    commandsManager.run.mockClear();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(commandsManager.run).not.toHaveBeenCalled();
    viewport.remove();
  });
  it('selects loupe magnification and returns to crosshair navigation with Escape', () => {
    const commandsManager = { run: jest.fn() };
    const view = render(React.createElement(DentalToolsToolbar, { commandsManager }));
    for (const zoom of [2, 3, 4, 6]) {
      fireEvent.click(view.getByRole('button', { name: 'Лупа', exact: true }));
      fireEvent.click(view.getByRole('menuitemradio', { name: `Лупа ${zoom}×` }));
      expect(commandsManager.run).toHaveBeenLastCalledWith('activateDentalTool', { tool: 'magnify', magnification: zoom });
      act(() => window.dispatchEvent(new CustomEvent('orbital:dental-tool-changed', { detail: { tool: 'magnify', magnification: zoom } })));
      expect(view.getByRole('status').textContent).toContain(`Лупа ${zoom}×`);
    }
    const documentHotkey = event => event.stopPropagation();
    document.addEventListener('keydown', documentHotkey);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    document.removeEventListener('keydown', documentHotkey);
    expect(commandsManager.run).toHaveBeenLastCalledWith('activateDentalTool', { tool: 'navigate' });
  });
  it('opens measurement variants and activates the selected command', () => {
    const commandsManager = { run: jest.fn() };
    const view = render(React.createElement(DentalToolsToolbar, { commandsManager }));
    fireEvent.click(view.getByRole('button', { name: 'Линейка' }));
    expect(view.getByRole('menu', { name: 'Линейка' })).toBeTruthy();
    fireEvent.click(view.getByRole('menuitem', { name: /Линейка 3D/ }));
    expect(commandsManager.run).toHaveBeenCalledWith('activateDentalTool', { tool: 'length3d' });
    expect(view.queryByRole('menu')).toBe(null);
    act(() =>
      window.dispatchEvent(
        new CustomEvent('orbital:dental-tool-changed', { detail: { tool: 'length3d' } })
      )
    );
    expect(view.getByRole('status').textContent).toContain('разных MPR-срезах');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(commandsManager.run).toHaveBeenLastCalledWith('activateDentalTool', {
      tool: 'navigate',
    });
  });
  it('offers both tape variants and the implant library without English labels', () => {
    const commandsManager = { run: jest.fn() };
    const view = render(React.createElement(DentalToolsToolbar, { commandsManager }));
    fireEvent.click(view.getByRole('button', { name: 'Измерительная лента' }));
    fireEvent.click(view.getByRole('menuitem', { name: /плавная кривая/ }));
    expect(commandsManager.run).toHaveBeenCalledWith('activateDentalTool', { tool: 'tapeCurve' });
    fireEvent.click(view.getByRole('button', { name: 'Нарисовать канал' }));
    expect(commandsManager.run).toHaveBeenCalledWith('activateDentalTool', { tool: 'canal' });
    fireEvent.click(view.getByRole('button', { name: 'Библиотека имплантов' }));
    expect(commandsManager.run).toHaveBeenLastCalledWith('openImplantLibrary');
  });
  it('explains drag-out deletion and removes the hint after deleting', () => {
    const view = render(
      React.createElement(DentalToolsToolbar, { commandsManager: { run: jest.fn() } })
    );
    act(() => window.dispatchEvent(new Event('orbital:implant-placed')));
    expect(view.getByRole('status').textContent).toContain('Перетащите имплант');
    act(() =>
      window.dispatchEvent(
        new CustomEvent('orbital:implant-drag', { detail: { dragging: true, outside: true } })
      )
    );
    expect(view.getByRole('status').textContent).toContain('Отпустите, чтобы удалить');
    act(() =>
      window.dispatchEvent(
        new CustomEvent('orbital:implant-drag', { detail: { dragging: true, outside: false } })
      )
    );
    expect(view.getByRole('status').textContent).toContain('Перетащите имплант');
    act(() =>
      window.dispatchEvent(
        new CustomEvent('orbital:implant-drag', {
          detail: { dragging: false, outside: false, deleted: true },
        })
      )
    );
    expect(view.queryByRole('status')).toBe(null);
  });
});
