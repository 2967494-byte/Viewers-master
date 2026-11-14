import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getRenderingPreference, setRenderingPreference, subscribeRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import type { RenderingPreference } from '@ohif/core/src/constants/orbitalRendering';
import { getAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';
import { getGpuDiagnosticBudget } from '@ohif/core/src/constants/orbitalGpuDiagnostics';

export default function RenderingModeControl() {
  const mode = useSyncExternalStore(subscribeRenderingPreference, getRenderingPreference, getRenderingPreference);
  const [open, setOpen] = useState(false);
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
  const diagnostic = Number.isFinite(getGpuDiagnosticBudget());
  const autoBudget = getAutomaticGpuProfile().budgetBytes;
  const budget = diagnostic || mode === 'economy' ? 64 : mode === 'compatibility' ? 256 : mode === 'auto' ? autoBudget / 1024 ** 2 : Infinity;
  const light = Number.isFinite(budget);
  const description = mode === 'auto' ? `Автоматический режим${light ? ` · ${budget} МиБ` : ''}` : mode === 'quality' ? 'Максимальная доступная детализация' : `Облегчённый режим · ${budget} МиБ`;
  const options: { value: RenderingPreference; label: string }[] = [
    { value: 'auto', label: `Автоматически${Number.isFinite(autoBudget) ? ` · ${autoBudget / 1024 ** 2} МиБ` : ''}` },
    { value: 'economy', label: 'Щадящий · 64 МиБ' },
    { value: 'compatibility', label: 'Облегчённый · 256 МиБ' },
    { value: 'quality', label: 'Максимальная детализация' },
  ];
  return (
    <div className="dental-tool-group" ref={root}>
    <button ref={trigger} type="button" className="dental-header-tool"
      aria-label={diagnostic ? 'Диагностика GPU: лимит 64 МиБ' : `Режим графики: ${description}`}
      aria-haspopup={diagnostic ? undefined : 'menu'} aria-expanded={diagnostic ? undefined : open}
      aria-pressed={light}
      title={diagnostic ? 'Тестовый режим 64 МиБ: детализация снижена. Нажмите, чтобы открыть настройки диагностики. После отключения откройте исследование заново.' : `${description}. При ограничении памяти детализация отображения снижается. Исходные данные сохраняются.`}
      onClick={() => diagnostic ? window.open('/3dviewer/gpu-check.html', '_blank', 'noopener') : setOpen(value => !value)}>
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="5" width="26" height="18" rx="2" />
        <path d="M16 23v5 M10 28h12 M7 18l5-5 4 3 8-7" />
        {light && <path d="m21 15-4 5h4l-2 5 7-8h-4l2-2" fill="#c79cff" stroke="#c79cff" />}
      </svg>
      <span className="dental-tool-badge">{diagnostic ? '64' : mode === 'auto' ? `А${light ? budget : ''}` : light ? budget : 'HD'}</span>
    </button>
    {open && !diagnostic && <div className="dental-tool-menu" role="menu" aria-label="Режим графики" style={{ minWidth: 270, right: 0, left: 'auto' }}>
      {options.map(option => <button type="button" role="menuitemradio" aria-checked={mode === option.value} key={option.value}
        onClick={() => { setRenderingPreference(option.value); setOpen(false); trigger.current?.focus(); }}>{option.label}</button>)}
      <p style={{ maxWidth: 270, padding: '8px 12px', fontSize: 12, color: '#b8bec9' }}>Щадящие режимы снижают детализацию отображения. Исходный снимок сохраняется.</p>
    </div>}
    </div>
  );
}
