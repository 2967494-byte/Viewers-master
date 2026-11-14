import React from 'react';
import { fireEvent, render, within, waitFor } from '@testing-library/react';
import ImplantLibraryModal from './ImplantLibraryModal';

describe('Implant library selection', () => {
  let saved: string[];
  let account: string;
  beforeEach(() => {
    saved = [];
    account = '12:0';
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body);
        if (body.accountKey !== account)
          return { ok: false, status: 409, json: async () => ({ error: 'account_changed' }) };
        saved = body.favorite
          ? [...new Set([...saved, body.modelId])]
          : saved.filter(id => id !== body.modelId);
      }
      return {
        ok: true,
        json: async () => ({ accountKey: account, favoriteIds: saved, csrfToken: 'csrf-test' }),
      };
    });
  });
  async function loaded(view) {
    await waitFor(() => expect(view.queryByText('Синхронизация избранного…')).toBeNull());
  }
  it('filters valid sizes and returns the selected model, clearing stale selection after filtering', async () => {
    const onSelect = jest.fn(),
      onClose = jest.fn();
    const view = render(React.createElement(ImplantLibraryModal, { onSelect, onClose }));
    await loaded(view);
    const add = view.getByRole('button', { name: 'Установить имплант' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(view.getByLabelText('Диаметр импланта'), { target: { value: '3.3' } });
    fireEvent.change(view.getByLabelText('Длина импланта'), { target: { value: '10' } });
    expect(view.getAllByRole('option', { selected: false }).length).toBeGreaterThan(0);
    fireEvent.click(view.getByRole('button', { name: /^Выбрать Straumann.*BLT.*3.3.*10/ }));
    fireEvent.click(add);
    expect(onSelect.mock.calls[0][0].id).toBe('BLT-3.3-10');
    fireEvent.change(view.getByLabelText('Поиск импланта'), {
      target: { value: 'no such implant' },
    });
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole('button', { name: /^Osstem/ }));
    expect(view.getByLabelText('Диаметр импланта').getAttribute('value')).not.toBe('3.3');
    expect(view.getAllByRole('option', { selected: false }).length).toBeGreaterThan(0);
  });

  it('stars a size without selecting/installing it, restores it after reopening, and lists it before the rest', async () => {
    const onSelect = jest.fn();
    let view = render(React.createElement(ImplantLibraryModal, { onSelect, onClose: () => {} }));
    await loaded(view);
    fireEvent.click(view.getByRole('button', { name: /^Dentium/ }));
    fireEvent.change(view.getByLabelText('Поиск импланта'), { target: { value: 'SOFX483810S' } });
    fireEvent.click(view.getByRole('button', { name: /^Добавить в избранное:/ }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      (view.getByRole('button', { name: 'Установить имплант' }) as HTMLButtonElement).disabled
    ).toBe(true);
    await loaded(view);
    expect(saved).toEqual(['SOFX483810S']);
    view.unmount();
    view = render(React.createElement(ImplantLibraryModal, { onSelect, onClose: () => {} }));
    await loaded(view);
    expect(view.getAllByRole('listitem')[0].textContent).toContain('SOFX483810S');
    const favorites = view.getByRole('list', { name: 'Избранные типоразмеры имплантов' });
    fireEvent.click(within(favorites).getByRole('button', { name: /^Выбрать Dentium/ }));
    fireEvent.click(view.getByRole('button', { name: 'Установить имплант' }));
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      id: 'SOFX483810S',
      platformDiameter: 4.8,
      gingivalHeight: 1.6,
    });
    fireEvent.click(view.getByRole('button', { name: /★ Избранное/ }));
    fireEvent.click(view.getByRole('button', { name: /^Убрать из избранного:/ }));
    await loaded(view);
    expect(view.getByText(/Добавьте нужные типоразмеры/)).toBeDefined();
    expect(saved).toEqual([]);
  });

  it('filters SimpleLine II by actual body diameter and gingival height and shows the matching source', async () => {
    const view = render(
      React.createElement(ImplantLibraryModal, { onSelect: () => {}, onClose: () => {} })
    );
    await loaded(view);
    fireEvent.click(view.getByRole('button', { name: /^Dentium/ }));
    fireEvent.change(view.getByLabelText('Диаметр импланта'), { target: { value: '3.4' } });
    fireEvent.change(view.getByLabelText('Высота шейки импланта'), { target: { value: '1.6' } });
    expect(view.queryAllByRole('listitem')).toHaveLength(0);
    fireEvent.change(view.getByLabelText('Высота шейки импланта'), { target: { value: '2.2' } });
    expect(view.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(
      view.getByRole('button', { name: /^Выбрать Dentium SimpleLine II Ø 3.4 × 8 мм/ })
    );
    expect(view.getByRole('link', { name: /Открыть каталог/ }).getAttribute('href')).toMatch(
      /#page=11$/
    );
  });
  it('does not carry another account favorites across reopening and rejects writes from an old tab', async () => {
    saved = ['SOFX483810S'];
    let view = render(
      React.createElement(ImplantLibraryModal, { onSelect: () => {}, onClose: () => {} })
    );
    await loaded(view);
    expect(view.getAllByRole('listitem')[0].textContent).toContain('SOFX483810S');
    account = '99:0';
    saved = [];
    fireEvent.click(view.getByRole('button', { name: /^Убрать из избранного:/ }));
    await loaded(view);
    expect(view.getByText(/Учётная запись изменилась/)).toBeDefined();
    expect(saved).toEqual([]);
    view.unmount();
    view = render(
      React.createElement(ImplantLibraryModal, { onSelect: () => {}, onClose: () => {} })
    );
    await loaded(view);
    expect(view.queryByRole('list', { name: 'Избранные типоразмеры имплантов' })).toBeNull();
  });

  it('keeps implant selection available when favorites cannot be loaded', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('Network unavailable'));
    const onSelect = jest.fn();
    const view = render(React.createElement(ImplantLibraryModal, { onSelect, onClose: () => {} }));
    await loaded(view);
    expect(view.getByText(/Избранное недоступно/)).toBeDefined();
    fireEvent.change(view.getByLabelText('Поиск импланта'), { target: { value: 'SOFX483810S' } });
    expect(
      (view.getByRole('button', { name: /^Добавить в избранное:/ }) as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(view.getByRole('button', { name: /^Выбрать Dentium/ }));
    fireEvent.click(view.getByRole('button', { name: 'Установить имплант' }));
    expect(onSelect.mock.calls[0][0].id).toBe('SOFX483810S');
  });
});
