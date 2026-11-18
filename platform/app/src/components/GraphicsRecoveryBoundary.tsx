import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { getGraphicsRecovery, subscribeGraphicsRecovery } from '@ohif/core/src/constants/orbitalGraphicsRecovery';
import { getGraphicsError, subscribeGraphicsError } from '@ohif/core/src/constants/orbitalRendering';
import { clearGpuRecovery, getAutomaticGpuProfile } from '@ohif/core/src/constants/orbitalGpuProfile';
import StudyLoadingScreen from './StudyLoadingScreen/StudyLoadingScreen';

/** Its subscriptions must not rerender App or remount the viewer's providers. */
export default function GraphicsRecoveryBoundary({ children }: { children: React.ReactNode }) {
  const phase = useSyncExternalStore(subscribeGraphicsRecovery, getGraphicsRecovery, getGraphicsRecovery);
  const error = useSyncExternalStore(subscribeGraphicsError, getGraphicsError, getGraphicsError);
  const overlay = useRef<HTMLDivElement>(null);
  const blocked = phase !== 'idle' || !!error;
  useEffect(() => {
    if (phase === 'idle' || error) return;
    const previous = document.activeElement as HTMLElement;
    overlay.current?.focus();
    // Block document-level viewer shortcuts as well as pointer interactions.
    const stop = (event: KeyboardEvent) => { event.stopImmediatePropagation(); event.preventDefault(); };
    document.addEventListener('keydown', stop, true);
    return () => { document.removeEventListener('keydown', stop, true); if (previous?.isConnected) previous.focus(); };
  }, [phase, error]);
  const recovery = getAutomaticGpuProfile().reason === 'previous-graphics-error';
  return <>
    <div style={{ display: 'contents' }} {...(blocked ? { inert: '' } : {})} aria-hidden={blocked || undefined}>{!error && children}</div>
    {error ? <StudyLoadingScreen accessGranted={false} progress={{ text: '', percent: 0 }} error={error}
      errorTitle="Не удалось открыть исследование"
      errorIntro="Причина остановки указана ниже. Исходные данные исследования сохранены."
      backLabel={recovery ? 'Сбросить ограничение и вернуться в кабинет' : 'Вернуться в личный кабинет'}
      onBack={() => { if (recovery) clearGpuRecovery(); window.location.assign('/'); }} /> :
      phase !== 'idle' && <div ref={overlay} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="graphics-recovery-title"
        style={{ position: 'fixed', inset: 0, zIndex: 2147483646, background: 'rgba(10,13,20,.94)', display: 'grid', placeItems: 'center', color: '#f5f3ff', outline: 'none' }}>
        <div style={{ maxWidth: 510, padding: 32, textAlign: 'center' }}>
          <div style={{ color: '#b88aff', fontSize: 28, marginBottom: 18 }}>↻</div>
          <h2 id="graphics-recovery-title" style={{ fontSize: 23, fontWeight: 600, marginBottom: 16 }}>Восстанавливаем отображение</h2>
          <p style={{ color: '#c4c6d0', lineHeight: 1.6 }}>Браузер потерял доступ к видеокарте. Подождите немного — пробуем восстановить окна без повторной загрузки снимка.</p>
          <p style={{ color: '#999dab', fontSize: 14, marginTop: 16 }}>Попытка 1 из 1</p>
        </div>
      </div>}
  </>;
}
