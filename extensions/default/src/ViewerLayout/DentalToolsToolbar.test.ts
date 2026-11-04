import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import DentalToolsToolbar from './DentalToolsToolbar';

describe('Russian dental toolbar', () => {
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
