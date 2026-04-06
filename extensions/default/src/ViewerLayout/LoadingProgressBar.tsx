import React, { useEffect, useRef, useState, useCallback } from 'react';
import { eventTarget, EVENTS as csEvents } from '@cornerstonejs/core';
import { useSystem } from '@ohif/core';

/**
 * LoadingProgressBar — красивая полоска загрузки в шапке вьювера.
 *
 * Тактика:
 * 1. При монтировании — сразу подписываемся на IMAGE_LOADED.
 * 2. Появляемся при первом IMAGE_LOADED (значит загрузка уже идёт).
 * 3. Считаем total из displaySetService.activeDisplaySets (уже заполнены к моменту монтирования).
 * 4. По IMAGE_VOLUME_LOADING_COMPLETED — фиксируем 100%.
 */
function LoadingProgressBar() {
  const { servicesManager } = useSystem();
  const [percent, setPercent] = useState(0);
  const [done, setDone] = useState(false);
  const [visible, setVisible] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  const totalRef = useRef(0);
  const loadedRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  const markDone = useCallback(() => {
    setPercent(100);
    setDone(true);
    setRemainingSec(0);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), 3500);
  }, []);

  // Инициализируем total из уже загруженных displaySets
  const initTotal = useCallback(() => {
    if (initializedRef.current) return;
    const { displaySetService } = servicesManager.services;
    if (!displaySetService) return;

    const activeSets = displaySetService.getActiveDisplaySets?.() ?? displaySetService.activeDisplaySets ?? [];
    const total = activeSets.reduce((acc: number, ds: any) => {
      return acc + (ds.numImageFrames || ds.images?.length || 0);
    }, 0);

    if (total > 0) {
      totalRef.current = total;
      initializedRef.current = true;
    }
  }, [servicesManager]);

  // Горячий путь — считаем каждый загруженный кадр
  const handleImageLoaded = useCallback(() => {
    // При первом образе — показываем бар и инициализируем total
    if (!visible) {
      initTotal();
      startTimeRef.current = Date.now();
      setVisible(true);
    }

    loadedRef.current += 1;
    const total = totalRef.current;
    if (total <= 0) return;

    const pct = Math.min(Math.round((loadedRef.current / total) * 100), 99);
    setPercent(pct);

    if (startTimeRef.current && pct > 3) {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const totalEst = (elapsed / pct) * 100;
      const remaining = Math.round(totalEst - elapsed);
      setRemainingSec(remaining > 0 ? remaining : 0);
    }
  }, [visible, initTotal]);

  // Финальный сигнал от Cornerstone — том загружен
  const handleVolumeComplete = useCallback(() => {
    setVisible(true); // на случай если мало кадров и бар не успел появиться
    markDone();
  }, [markDone]);

  // Также подписываемся на DISPLAY_SETS_ADDED для случая если будущие displaySets добавятся позже
  useEffect(() => {
    const { displaySetService } = servicesManager.services;
    if (!displaySetService) return;

    // Пробуем инициализировать total сразу (для уже имеющихся displaySets)
    initTotal();

    const { unsubscribe } = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      ({ displaySetsAdded }: { displaySetsAdded: any[] }) => {
        const extra = displaySetsAdded.reduce((acc: number, ds: any) => {
          return acc + (ds.numImageFrames || ds.images?.length || 0);
        }, 0);
        if (extra > 0) {
          totalRef.current += extra;
          if (!initializedRef.current) {
            initializedRef.current = true;
          }
        }
      }
    );

    return () => unsubscribe();
  }, [servicesManager, initTotal]);

  useEffect(() => {
    eventTarget.addEventListener(csEvents.IMAGE_LOADED, handleImageLoaded);
    eventTarget.addEventListener(csEvents.IMAGE_VOLUME_LOADING_COMPLETED, handleVolumeComplete);
    return () => {
      eventTarget.removeEventListener(csEvents.IMAGE_LOADED, handleImageLoaded);
      eventTarget.removeEventListener(csEvents.IMAGE_VOLUME_LOADING_COMPLETED, handleVolumeComplete);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [handleImageLoaded, handleVolumeComplete]);

  if (!visible) return null;

  const formatTime = (sec: number): string => {
    if (sec <= 0) return '0 с';
    if (sec < 60) return `${sec} с`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m} м ${s} с`;
  };

  return (
    <div
      className="flex items-center gap-2 ml-4"
      style={{ minWidth: 260, maxWidth: 360 }}
    >
      {/* Процент */}
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: done ? '#4ade80' : '#a78bfa',
          minWidth: 34,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          transition: 'color 0.5s ease',
          letterSpacing: '0.03em',
          fontFamily: 'monospace',
        }}
      >
        {percent}%
      </span>

      {/* Полоска прогресса */}
      <div
        style={{
          flex: 1,
          height: 5,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.07)',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0, left: 0, bottom: 0,
            width: `${percent}%`,
            borderRadius: 999,
            background: done
              ? 'linear-gradient(90deg, #4ade80, #22d3ee)'
              : 'linear-gradient(90deg, #6d28d9, #8b5cf6, #38bdf8)',
            transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1), background 0.6s ease',
            boxShadow: done
              ? '0 0 10px rgba(74,222,128,0.5)'
              : '0 0 10px rgba(139,92,246,0.4)',
          }}
        />
        {/* Бегущий блик shimmer */}
        {!done && percent > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0, bottom: 0,
              width: 60,
              left: `calc(${percent}% - 40px)`,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
              borderRadius: 999,
              animation: 'ohif-shimmer 1.8s ease infinite',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Оставшееся время */}
      <span
        style={{
          fontSize: 11,
          color: done ? '#4ade80' : 'rgba(255,255,255,0.4)',
          minWidth: 52,
          textAlign: 'left',
          fontVariantNumeric: 'tabular-nums',
          transition: 'color 0.5s ease',
          whiteSpace: 'nowrap',
        }}
      >
        {done ? '✓ Готово' : remainingSec !== null ? `~${formatTime(remainingSec)}` : '⏳ ...'}
      </span>

      <style>{`
        @keyframes ohif-shimmer {
          0%   { opacity: 0; transform: translateX(-20px); }
          40%  { opacity: 1; }
          100% { opacity: 0; transform: translateX(20px); }
        }
      `}</style>
    </div>
  );
}

export default LoadingProgressBar;
