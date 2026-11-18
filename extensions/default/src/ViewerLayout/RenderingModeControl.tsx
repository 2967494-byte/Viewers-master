import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getRenderingPreference, setRenderingPreference, subscribeRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import type { RenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { clearGpuRecovery, getAutomaticGpuProfile, subscribeAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';

export default function RenderingModeControl() {
  const mode = useSyncExternalStore(subscribeRenderingPreference, getRenderingPreference, getRenderingPreference);
  const [open, setOpen] = useState(false);
  const [reset, setReset] = useState(false);
  const profile = useSyncExternalStore(subscribeAutomaticGpuProfile, getAutomaticGpuProfile, getAutomaticGpuProfile);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const autoBudget = profile.budgetBytes;
  const budget = mode === 'compatibility' ? 256 : mode === 'auto' ? autoBudget / 1024 ** 2 : Infinity;
  const light = Number.isFinite(budget);
  const description = mode === 'auto' ? `Автоматический режим${light ? ` · ${budget} МиБ` : ''}` : mode === 'quality' ? 'Максимальная детализация · исходное разрешение' : `Облегчённый режим · ${budget} МиБ`;
  const options: { value: RenderingPreference; label: string }[] = [
    { value: 'auto', label: `Автоматически${Number.isFinite(autoBudget) ? ` · ${autoBudget / 1024 ** 2} МиБ` : ''}` },
    { value: 'compatibility', label: 'Облегчённый · 256 МиБ' },
    { value: 'quality', label: 'Максимальная детализация' },
  ];
  return (
    <div className="dental-tool-group" ref={root}>
    <button ref={trigger} type="button" className="dental-header-tool"
      aria-label={`Режим графики: ${description}`}
      aria-haspopup="menu" aria-expanded={open}
      aria-pressed={light}
      title={mode === 'quality' ? 'Исходное пространственное разрешение без автоматического прореживания слоёв.' : `${description}. Чрезмерное снижение детализации запрещено. Исходные данные сохраняются.`}
      onClick={() => setOpen(value => !value)}>
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="5" width="26" height="18" rx="2" />
        <path d="M16 23v5 M10 28h12 M7 18l5-5 4 3 8-7" />
        {light && <path d="m21 15-4 5h4l-2 5 7-8h-4l2-2" fill="#c79cff" stroke="#c79cff" />}
      </svg>
      <span className="dental-tool-badge">{mode === 'auto' ? `А${light ? budget : ''}` : light ? budget : 'HD'}</span>
    </button>
    {open && <div className="dental-tool-menu" role="menu" aria-label="Режим графики" style={{ minWidth: 270, right: 0, left: 'auto' }}>
      {options.map(option => <button type="button" role="menuitemradio" aria-checked={mode === option.value} key={option.value}
        onClick={() => { setRenderingPreference(option.value); setOpen(false); trigger.current?.focus(); }}>{option.label}</button>)}
      {profile.reason === 'previous-graphics-error' && <>
        <button type="button" role="menuitem" disabled={reset} onClick={() => setReset(clearGpuRecovery())}>Сбросить ограничение после сбоя</button>
        {reset && <p role="status" style={{ padding: '8px 12px', maxWidth: 270 }}>Ограничение сброшено. Закройте просмотрщик и откройте снимок заново из кабинета.</p>}
      </>}
      <p style={{ maxWidth: 270, padding: '8px 12px', fontSize: 12, color: '#b8bec9' }}>Максимальная детализация сохраняет исходное разрешение. При нехватке ресурсов качество незаметно не снижается.</p>
    </div>}
    </div>
  );
}
