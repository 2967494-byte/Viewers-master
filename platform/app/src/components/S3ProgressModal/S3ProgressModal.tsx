import React, { useEffect, useState } from 'react';
import { s3FileService } from '../../utils/S3FileService';
import { processS3DicomObject } from '../../utils/processS3Dicom';
import { registerOrbitalS3ImageLoader } from '../../utils/orbitalS3ImageLoader';
import { Typography } from '@ohif/ui';
import { Icons } from '@ohif/ui-next';

interface S3ProgressModalProps {
  fileKeys: string[];
  hide: () => void;
  onComplete?: (uids: string[]) => void;
  onError?: (message: string) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const S3ProgressModal: React.FC<S3ProgressModalProps> = ({
  fileKeys,
  hide,
  onComplete,
  onError,
}) => {
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [startTime] = useState(Date.now());
  const [eta, setEta] = useState<string | null>(null);
  const [speedLabel, setSpeedLabel] = useState('—');
  const [phase, setPhase] = useState('Индексация…');
  const [firstError, setFirstError] = useState<string | null>(null);
  const [rangeCount, setRangeCount] = useState(0);
  const [fullCount, setFullCount] = useState(0);
  const total = fileKeys.length;
  const concurrency = Math.min(s3FileService.getDownloadConcurrency(), 32);

  useEffect(() => {
    let active = true;
    const studyUIDs = new Set<string>();
    let doneCount = 0;
    let errorCount = 0;
    let byteCount = 0;
    let rangeOk = 0;
    let fullOk = 0;
    let capturedFirstError: string | null = null;

    const updateStats = () => {
      const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000);
      setSpeedLabel(`${formatBytes(byteCount / elapsed)}/s`);
      const remaining = total - (doneCount + errorCount);
      const rate = (doneCount + errorCount) / elapsed;
      if (rate > 0 && remaining > 0) {
        setEta(`Осталось ~${Math.ceil(remaining / rate)} сек.`);
      } else if (remaining <= 0) {
        setEta('Завершение...');
      }
    };

    const run = async () => {
      registerOrbitalS3ImageLoader();
      setPhase('Индексация метаданных (префикс)…');
      let next = 0;

      const worker = async () => {
        while (active) {
          const i = next++;
          if (i >= fileKeys.length) return;
          const key = fileKeys[i];
          try {
            const result = await processS3DicomObject(key);
            if (result.uid) studyUIDs.add(result.uid);
            byteCount += result.bytes;
            doneCount += 1;
            if (result.mode === 'range') rangeOk += 1;
            else fullOk += 1;
            if (active) {
              setDone(doneCount);
              setBytes(byteCount);
              setRangeCount(rangeOk);
              setFullCount(fullOk);
              if (doneCount % 5 === 0) updateStats();
            }
          } catch (err: any) {
            console.error('S3 index failed:', key, err);
            errorCount += 1;
            if (active) {
              if (!capturedFirstError) {
                capturedFirstError = err?.message || String(err);
                setFirstError(capturedFirstError);
              }
              setErrors(errorCount);
              updateStats();
            }
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, fileKeys.length) }, () => worker())
      );

      if (!active) return;
      updateStats();

      const uids = Array.from(studyUIDs);
      if (uids.length === 0) {
        const msg =
          errorCount > 0
            ? `Не удалось прочитать DICOM из S3 (${errorCount} ошибок).`
            : 'Не удалось определить StudyInstanceUID';
        hide();
        onError?.(msg);
        return;
      }

      setTimeout(() => {
        if (!active) return;
        hide();
        onComplete?.(uids);
      }, 300);
    };

    run().catch(err => {
      console.error('S3 progress pipeline failed:', err);
      setPhase(`Ошибка: ${err?.message || err}`);
      onError?.(err?.message || String(err));
    });

    return () => {
      active = false;
    };
  }, [fileKeys, hide, onComplete, onError, startTime, total, concurrency]);

  const progress = Math.round(((done + errors) / Math.max(1, total)) * 100);

  return (
    <div
      className="flex flex-col bg-gray-900 text-white p-8 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10"
      style={{ minWidth: '480px' }}
    >
      <div className="flex items-center justify-between mb-8">
        <Typography
          variant="h6"
          color="primary"
          component="h2"
          className="font-bold tracking-wide text-purple-400 uppercase"
        >
          Загрузка S3
        </Typography>
        <div className="px-3 py-1 bg-white/5 rounded-full border border-white/10">
          <Typography
            variant="subtitle"
            className="text-purple-400 font-mono text-sm"
            component="span"
          >
            {progress}%
          </Typography>
        </div>
      </div>

      <div className="w-full bg-white/5 rounded-full h-2.5 mb-6 overflow-hidden p-0.5 border border-white/5">
        <div
          className="bg-gradient-to-r from-purple-600 to-blue-500 h-full rounded-full transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex justify-between items-start text-xs tracking-tight gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-gray-400 uppercase font-semibold">{phase}</span>
          <span className="text-white font-mono">
            {done + errors} / {total} · {formatBytes(bytes)}
          </span>
          <span className="text-blue-300 font-mono">{speedLabel}</span>
          <span className="text-gray-400 font-mono">
            prefix {rangeCount} · full {fullCount}
          </span>
          {eta && progress < 100 && (
            <span className="text-purple-400/80">{eta}</span>
          )}
          {errors > 0 && (
            <span className="text-red-400 font-bold">{errors} ошибок</span>
          )}
          {firstError && (
            <span className="text-red-300/90 text-[10px] break-all max-w-[320px]">
              Пример: {firstError}
            </span>
          )}
        </div>
        {progress === 100 ? (
          <div className="flex items-center gap-2 text-green-400 font-bold bg-green-400/10 px-3 py-2 rounded-lg border border-green-400/20">
            <Icons.StatusSuccess className="h-4 w-4" />
            Готово
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1 text-gray-500 italic">
            <span>{concurrency} потоков</span>
            <span>только заголовки</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default S3ProgressModal;
