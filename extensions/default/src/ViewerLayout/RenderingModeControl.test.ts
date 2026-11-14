import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import RenderingModeControl from './RenderingModeControl';
import { getRenderingPreference, setRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { initializeAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';
import { beginGpuDiagnosticSession, GPU_DIAGNOSTIC_PROFILE_KEY } from '@ohif/core/src/constants/orbitalGpuDiagnostics';

beforeEach(() => { localStorage.clear(); beginGpuDiagnosticSession(); initializeAutomaticGpuProfile({}); setRenderingPreference('auto'); });
afterEach(() => { act(() => setRenderingPreference('auto')); localStorage.clear(); beginGpuDiagnosticSession(); initializeAutomaticGpuProfile({}); jest.restoreAllMocks(); });

it('shows the automatic low-memory profile and allows explicit quality/automatic choices', () => {
  initializeAutomaticGpuProfile({ renderer: 'Intel HD Graphics (0x0f31)' });
  const view = render(React.createElement(RenderingModeControl));
  fireEvent.click(view.getByRole('button', { name: /Режим графики: Автоматический режим · 64 МиБ/ }));
  expect(view.getByRole('menuitemradio', { name: 'Автоматически · 64 МиБ' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Максимальная детализация' }));
  expect(getRenderingPreference()).toBe('quality');
  expect(view.queryByRole('menu')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: /Максимальная доступная детализация/ }));
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Автоматически · 64 МиБ' }));
  expect(getRenderingPreference()).toBe('auto');
  view.unmount();
});

it('closes on Escape/outside and selects economy without turning on diagnostic logging', () => {
  const view = render(React.createElement(RenderingModeControl));
  const trigger = view.getByRole('button');
  fireEvent.click(trigger); fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(view.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.pointerDown(document.body);
  expect(view.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger); fireEvent.click(view.getByRole('menuitemradio', { name: 'Щадящий · 64 МиБ' }));
  expect(getRenderingPreference()).toBe('economy');
  expect(localStorage.getItem(GPU_DIAGNOSTIC_PROFILE_KEY)).toBeNull();
  view.unmount();
});

it('keeps the explicit diagnostic override visible and linked to its settings', () => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  localStorage.setItem(GPU_DIAGNOSTIC_PROFILE_KEY, '64'); beginGpuDiagnosticSession();
  const view = render(React.createElement(RenderingModeControl));
  fireEvent.click(view.getByRole('button', { name: 'Диагностика GPU: лимит 64 МиБ' }));
  expect(open).toHaveBeenCalledWith('/3dviewer/gpu-check.html', '_blank', 'noopener');
  expect(view.queryByRole('menu')).toBeNull();
  view.unmount();
});
