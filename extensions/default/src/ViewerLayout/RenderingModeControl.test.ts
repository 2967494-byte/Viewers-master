import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import RenderingModeControl from './RenderingModeControl';
import { getRenderingPreference, setRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { initializeAutomaticGpuProfile, rememberGpuRecovery, GPU_RECOVERY_KEY, getAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';
import { beginGpuDiagnosticSession, GPU_DIAGNOSTIC_PROFILE_KEY } from '@ohif/core/src/constants/orbitalGpuDiagnostics';

beforeEach(() => { localStorage.clear(); beginGpuDiagnosticSession(); initializeAutomaticGpuProfile({}); setRenderingPreference('auto'); });
afterEach(() => { act(() => setRenderingPreference('auto')); localStorage.clear(); beginGpuDiagnosticSession(); initializeAutomaticGpuProfile({}); jest.restoreAllMocks(); });

it('shows the automatic low-memory profile and allows explicit quality/automatic choices', () => {
  initializeAutomaticGpuProfile({ renderer: 'Intel HD Graphics (0x0f31)' });
  const view = render(React.createElement(RenderingModeControl));
  fireEvent.click(view.getByRole('button', { name: /Режим графики: Автоматический режим · 256 МиБ/ }));
  expect(view.getByRole('menuitemradio', { name: 'Автоматически · 256 МиБ' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Максимальная детализация' }));
  expect(getRenderingPreference()).toBe('quality');
  expect(view.queryByRole('menu')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: /Максимальная детализация/ }));
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Автоматически · 256 МиБ' }));
  expect(getRenderingPreference()).toBe('auto');
  view.unmount();
});

it('closes on Escape/outside and offers only supported profiles, without economy or diagnostic overrides', () => {
  const view = render(React.createElement(RenderingModeControl));
  const trigger = view.getByRole('button');
  fireEvent.click(trigger); fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(view.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.pointerDown(document.body);
  expect(view.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger); expect(view.queryByRole('menuitemradio', { name: /Щадящий/ })).toBeNull(); fireEvent.click(view.getByRole('menuitemradio', { name: 'Облегчённый · 256 МиБ' }));
  expect(getRenderingPreference()).toBe('compatibility');
  expect(localStorage.getItem(GPU_DIAGNOSTIC_PROFILE_KEY)).toBeNull();
  view.unmount();
});

it('ignores retired diagnostic flags and still permits an explicit quality selection', () => {
  jest.spyOn(console,'info').mockImplementation(()=>{});
  localStorage.setItem(GPU_DIAGNOSTIC_PROFILE_KEY,'64');beginGpuDiagnosticSession();
  const view=render(React.createElement(RenderingModeControl));
  fireEvent.click(view.getByRole('button'));
  expect(view.queryByText(/64 МиБ/)).toBeNull();
  fireEvent.click(view.getByRole('menuitemradio',{name:'Максимальная детализация'}));
  expect(getRenderingPreference()).toBe('quality');view.unmount();
});

it('can reset the next opening without reallocating a running study', () => {
  const device = { renderer: 'Intel UHD Graphics 730', deviceMemory: 16 };
  initializeAutomaticGpuProfile(device); rememberGpuRecovery(384 * 1024 ** 2); initializeAutomaticGpuProfile(device);
  const view = render(React.createElement(RenderingModeControl));
  fireEvent.click(view.getByRole('button'));
  fireEvent.click(view.getByRole('menuitem', { name: 'Сбросить ограничение после сбоя' }));
  expect(localStorage.getItem(GPU_RECOVERY_KEY)).toBeNull();
  expect(getAutomaticGpuProfile().budgetBytes).toBe(384 * 1024 ** 2);
  expect(view.getByRole('status').textContent).toContain('откройте снимок заново');
  view.unmount();
});
