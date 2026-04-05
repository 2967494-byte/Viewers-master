import React, { useState, useCallback, useRef } from 'react';
import { generatePanorama as runGenerator, DEFAULT_CONFIG, type PanoramaConfig } from './panoramaGenerator';

type PanoramaStatus =
  | 'idle'
  | 'capturing'
  | 'stitching'
  | 'done'
  | 'error';

interface PanoramaModalProps {
  onClose: () => void;
  generatePanorama: (config?: Partial<PanoramaConfig>) => Promise<string>;
}

const PanoramaModal: React.FC<PanoramaModalProps> = ({ onClose, generatePanorama }) => {
  const [status, setStatus]               = useState<PanoramaStatus>('idle');
  const [progress, setProgress]           = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [resultUrl, setResultUrl]         = useState<string | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const abortRef = useRef(false);

  // ─── Параметры генерации ─────────────────────────────────────────────────
  const [stripWidth, setStripWidth]     = useState(0);   // 0 = авто-расчёт
  const [stepDeg, setStepDeg]           = useState(DEFAULT_CONFIG.stepDeg);
  const [startAngle, setStartAngle]     = useState(DEFAULT_CONFIG.startAngleDeg);
  const [endAngle, setEndAngle]         = useState(DEFAULT_CONFIG.endAngleDeg);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enableClipping, setEnableClipping] = useState(true); // срезать заднюю часть

  const totalFrames = Math.round((endAngle - startAngle) / stepDeg) + 1;

  const startGeneration = useCallback(async () => {
    abortRef.current = false;
    (window as any).__panoramaAbort = false;
    setStatus('capturing');
    setProgress(0);
    setProgressLabel('Подготовка...');
    setError(null);
    setResultUrl(null);

    // Очищаем стрип превью
    const strip = document.getElementById('panorama-frame-strip');
    if (strip) strip.innerHTML = '';

    (window as any).__panoramaProgressCallback = (pct: number, label: string) => {
      if (abortRef.current) return;
      setProgress(pct);
      setProgressLabel(label);
      if (pct >= 88) setStatus('stitching');
    };

    try {
      const config: Partial<PanoramaConfig> = {
        startAngleDeg: startAngle,
        endAngleDeg:   endAngle,
        stepDeg:       stepDeg,
        stripWidth:    stripWidth,
        enableClipping,
      };
      const dataUrl = await generatePanorama(config);
      if (!abortRef.current) {
        setResultUrl(dataUrl);
        setStatus('done');
        setProgress(100);
        setProgressLabel('Готово!');
      }
    } catch (e: any) {
      if (!abortRef.current) {
        setError(e.message || 'Неизвестная ошибка');
        setStatus('error');
      }
    } finally {
      delete (window as any).__panoramaProgressCallback;
    }
  }, [generatePanorama, stripWidth, stepDeg, startAngle, endAngle]);

  const handleAbort = () => {
    abortRef.current = true;
    (window as any).__panoramaAbort = true;
    setStatus('idle');
    setProgress(0);
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = `panorama_sw${stripWidth}_step${stepDeg}_${new Date().toISOString().slice(0, 10)}.jpg`;
    a.click();
  };

  const isProcessing = status === 'capturing' || status === 'stitching';

  return (
    <div className="flex flex-col bg-primary-dark text-white rounded-lg overflow-hidden"
         style={{ width: '620px', maxHeight: '90vh' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-secondary-dark border-b border-secondary-light">
        <div className="flex items-center gap-3">
          <span className="text-xl">🦷</span>
          <div>
            <h3 className="text-base font-bold leading-tight">Панорамный снимок</h3>
            <p className="text-xs text-gray-400">Генерация из 3D объёма</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700"
          disabled={isProcessing}
        >✕</button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ─── Параметры генерации ──────────────────────────────────────── */}
        {!isProcessing && (
          <div className="px-5 pt-4 pb-2 border-b border-secondary-light space-y-3">
            {/* Ширина сегмента — главный параметр */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-semibold text-gray-200">
                  Ширина сегмента
                  <span className="ml-2 text-gray-400 font-normal text-xs">
                    (ширина полосы из каждого кадра, px)
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={40}
                    step={0.1}
                    value={stripWidth}
                    onChange={e => setStripWidth(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-16 text-center rounded border border-gray-600 bg-gray-800 text-white text-sm py-0.5 px-1"
                  />
                  <span className="text-xs text-gray-400">px</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                step={0.1}
                value={stripWidth}
                onChange={e => setStripWidth(parseFloat(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                <span>0 = авто (формула)</span>
                <span className="text-blue-400">
                  {stripWidth === 0
                    ? '← рекомендуется'
                    : `${stripWidth}px × ${totalFrames} кадров = ~${stripWidth * totalFrames}px ширина`}
                </span>
                <span>30px</span>
              </div>
            </div>

            {/* Срезать заднюю часть черепа */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableClipping}
                onChange={e => setEnableClipping(e.target.checked)}
                className="w-4 h-4 accent-blue-500"
              />
              <div>
                <span className="text-sm text-gray-200">Срезать заднюю часть черепа</span>
                <p className="text-xs text-gray-400">
                  Добавляет плоскость отсечения через центр черепа — убирает структуры сзади
                </p>
              </div>
            </label>

            {/* Кнопка расширенных параметров */}
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
            >
              {showAdvanced ? '▲' : '▼'} Расширенные параметры
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-3 gap-3 pt-1">
                {/* Шаг угла */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Шаг (градусы)</label>
                  <input
                    type="number"
                    min={0.5}
                    max={5}
                    step={0.5}
                    value={stepDeg}
                    onChange={e => setStepDeg(parseFloat(e.target.value) || 1)}
                    className="w-full rounded border border-gray-600 bg-gray-800 text-white text-sm py-1 px-2"
                  />
                  <p className="text-xs text-gray-500 mt-0.5">{totalFrames} кадров</p>
                </div>
                {/* Начальный угол */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Начало (°)</label>
                  <input
                    type="number"
                    min={-90}
                    max={0}
                    value={startAngle}
                    onChange={e => setStartAngle(parseInt(e.target.value) || -50)}
                    className="w-full rounded border border-gray-600 bg-gray-800 text-white text-sm py-1 px-2"
                  />
                </div>
                {/* Конечный угол */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Конец (°)</label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={endAngle}
                    onChange={e => setEndAngle(parseInt(e.target.value) || 50)}
                    className="w-full rounded border border-gray-600 bg-gray-800 text-white text-sm py-1 px-2"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="p-5 space-y-4">
          {/* Состояние: ожидание */}
          {status === 'idle' && !resultUrl && (
            <div className="text-center py-2">
              <div className="text-4xl mb-3">🦷</div>
              <p className="text-sm text-gray-300 max-w-md mx-auto">
                Настройте <strong>ширину сегмента</strong> выше и нажмите «Создать».
                Значение <strong>0</strong> = автоматический расчёт из параметров камеры.
              </p>
              <p className="text-xs text-gray-500 mt-2">
                ⏱ Время: ~{Math.round(totalFrames * 0.5)}–{Math.round(totalFrames * 1.5)}с
              </p>
            </div>
          )}

          {/* Прогресс */}
          {isProcessing && (
            <div className="space-y-3">
              <div className="text-center">
                <div className="text-3xl mb-1 animate-pulse">
                  {status === 'stitching' ? '🔧' : '📸'}
                </div>
                <p className="text-xs text-gray-300">{progressLabel}</p>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-right text-xs text-gray-400">{progress}%</div>
              {/* Preview strip */}
              <div
                id="panorama-frame-strip"
                className="flex gap-px overflow-hidden rounded bg-black"
                style={{ height: '55px' }}
              />
            </div>
          )}

          {/* Результат */}
          {status === 'done' && resultUrl && (
            <div className="space-y-2">
              <div className="text-center text-green-400 font-semibold text-sm">
                ✅ Готово!
                {stripWidth > 0
                  ? ` Сегмент: ${stripWidth}px`
                  : ' Сегмент: авто'}
              </div>
              <div className="rounded overflow-hidden border border-gray-600 bg-black">
                <img
                  src={resultUrl}
                  alt="Dental Panorama"
                  className="w-full object-contain"
                  style={{ maxHeight: '380px', imageRendering: 'crisp-edges' }}
                />
              </div>
              <p className="text-xs text-gray-500 text-center">
                Параметры: шаг {stepDeg}°, диапазон {startAngle}°…{endAngle}°, сегмент {stripWidth || 'авто'}px
              </p>
            </div>
          )}

          {/* Ошибка */}
          {status === 'error' && error && (
            <div className="bg-red-900/30 border border-red-700 rounded p-3">
              <div className="text-red-400 font-semibold text-sm mb-1">❌ Ошибка</div>
              <div className="text-xs text-red-300 font-mono whitespace-pre-wrap">{error}</div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-secondary-dark border-t border-secondary-light flex justify-between items-center">
        <div className="text-xs text-gray-500">
          {status === 'done' && 'Сгенерировано в браузере'}
        </div>
        <div className="flex gap-2">
          {isProcessing && (
            <button
              onClick={handleAbort}
              className="px-3 py-1.5 rounded text-sm font-medium bg-red-700 hover:bg-red-600 text-white"
            >
              Стоп
            </button>
          )}
          {status === 'done' && (
            <>
              <button
                onClick={() => { setStatus('idle'); setResultUrl(null); }}
                className="px-3 py-1.5 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white"
              >
                🔄 Пересоздать
              </button>
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 rounded text-sm font-medium bg-green-700 hover:bg-green-600 text-white"
              >
                ⬇ Скачать JPEG
              </button>
            </>
          )}
          {!isProcessing && status !== 'done' && (
            <button
              onClick={startGeneration}
              className="px-4 py-1.5 rounded text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white"
            >
              🦷 Создать
            </button>
          )}
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-3 py-1.5 rounded text-sm font-medium bg-transparent hover:bg-gray-700 text-gray-300 disabled:opacity-40"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};

export default PanoramaModal;
