import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import ImplantLibraryModal from './ImplantLibraryModal';

describe('Implant library selection', () => {
  it('filters valid sizes and returns the selected model, clearing stale selection after filtering', () => {
    const onSelect = jest.fn(),
      onClose = jest.fn();
    const view = render(React.createElement(ImplantLibraryModal, { onSelect, onClose }));
    const add = view.getByRole('button', { name: 'Установить имплант' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(view.getByLabelText('Диаметр импланта'), { target: { value: '3.3' } });
    fireEvent.change(view.getByLabelText('Длина импланта'), { target: { value: '10' } });
    expect(view.getAllByRole('option', { selected: false }).length).toBeGreaterThan(0);
    fireEvent.click(view.getByRole('option', { name: /BLT.*3.3.*10/ }));
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
});
