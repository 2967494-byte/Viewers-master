import React, { useEffect, useRef, useState } from 'react';
import { useImageFilterStrength } from '@ohif/core/src/hooks/useImageFilter';
import { setImageFilterStrength } from '@ohif/core/src/constants/orbitalImageFilters';
import { getRenderingPreference, subscribeRenderingPreference } from '@ohif/core/src/constants/orbitalRendering';

export default function SharpnessSlider() {
  const strength = useImageFilterStrength();
  const [draft, setDraft] = useState(strength * 100);
  const [preference, setPreference] = useState(getRenderingPreference);
  const pending = useRef(null);
  const timer = useRef(null);
  const flush = () => {
    clearTimeout(timer.current); timer.current = null;
    if (pending.current !== null) { setImageFilterStrength(pending.current / 100); pending.current = null; }
  };
  useEffect(() => { setDraft(strength * 100); }, [strength]);
  useEffect(() => subscribeRenderingPreference(() => setPreference(getRenderingPreference())), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const disabled = preference === 'compatibility';
  return <label className="dental-sharpness-slider" title={disabled ? 'Резкость недоступна в режиме совместимости' : 'Резкость всех 2D-окон · 0 — без усиления'}>
    <span>Резкость</span>
    <input type="range" min="0" max="100" step="1" value={draft} disabled={disabled}
      aria-label="Резкость 2D" aria-valuetext={`${Math.round(draft)}%`}
      onChange={event => {
        const value = Number(event.target.value); setDraft(value); pending.current = value;
        if (timer.current === null) timer.current = setTimeout(flush, 50);
      }}
      onPointerUp={flush} onPointerCancel={flush} onBlur={flush}
      onKeyUp={flush} />
  </label>;
}
