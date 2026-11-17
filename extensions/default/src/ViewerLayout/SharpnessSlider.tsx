import React, { useEffect, useRef, useState } from 'react';
import { useImageFilterStrength } from '@ohif/core/src/hooks/useImageFilter';
import { setImageFilterStrength } from '@ohif/core/src/constants/orbitalImageFilters';
import { getRenderingPreference, subscribeRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';

export default function SharpnessSlider() {
  const strength = useImageFilterStrength();
  const [draft, setDraft] = useState(strength);
  const [open, setOpen] = useState(false);
  const [preference, setPreference] = useState(getRenderingPreference);
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef(null);
  const timer = useRef(null);
  const flush = () => {
    clearTimeout(timer.current); timer.current = null;
    if (pending.current !== null) { setImageFilterStrength(pending.current); pending.current = null; }
  };
  useEffect(() => { setDraft(strength); }, [strength]);
  useEffect(() => subscribeRenderingPreference(() => setPreference(getRenderingPreference())), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) { flush(); setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const disabled = preference === 'compatibility';
  return <div ref={root} className="dental-tool-group dental-sharpness-control"
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); flush(); setOpen(false); root.current?.querySelector('button')?.focus(); } }}>
    <button type="button" className="dental-header-tool" aria-label="Резкость" aria-haspopup="dialog"
      aria-expanded={open} data-active={strength > 0}
      title={disabled ? 'Резкость недоступна в режиме совместимости' : `Резкость трёх 2D-окон: ${strength.toFixed(2)}×`}
      onClick={() => { flush(); setOpen(value => !value); }}>
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 20 12 4l8 16H4Z"/><path d="M12 4v16" fill="currentColor"/><path d="M12 4 20 20h-8Z" fill="currentColor" opacity=".5"/></svg>
      <span className="dental-tool-chevron">▾</span>
    </button>
    {open && <div className="dental-tool-menu dental-sharpness-popup" role="dialog" aria-label="Настройка резкости">
      <label>Резкость <output>{draft.toFixed(2)}×</output>
        <input autoFocus type="range" min="0" max="3" step="0.05" value={draft} disabled={disabled}
          aria-label="Резкость 2D" aria-valuetext={`${draft.toFixed(2)}×`}
          onChange={event => {
            const value = Number(event.target.value); setDraft(value); pending.current = value;
            if (timer.current === null) timer.current = setTimeout(flush, 50);
          }} onPointerUp={flush} onPointerCancel={flush} onBlur={flush} onKeyUp={flush} />
      </label>
      <div className="dental-sharpness-scale"><span>Без усиления</span><span>3×</span></div>
      {disabled && <small>Недоступно в режиме совместимости</small>}
    </div>}
  </div>;
}
