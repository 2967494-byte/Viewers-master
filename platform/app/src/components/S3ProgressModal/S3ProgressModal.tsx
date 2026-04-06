import React, { useEffect, useState } from 'react';
import { s3FileService } from '../../utils/S3FileService';
import { processFile } from '../../routes/Local/filesToStudies';
import { Typography } from '@ohif/ui';
import { Icons } from '@ohif/ui-next';

interface S3ProgressModalProps {
  fileKeys: string[];
  hide: () => void;
  onComplete?: (uids: string[]) => void;
}

const S3ProgressModal: React.FC<S3ProgressModalProps> = ({ fileKeys, hide, onComplete }) => {
  const [downloaded, setDownloaded] = useState(0);
  const [errors, setErrors] = useState(0);
  const [startTime] = useState(Date.now());
  const [eta, setEta] = useState<string | null>(null);
  const total = fileKeys.length;

  useEffect(() => {
    let active = true;
    let nextIndex = 0;
    const CONCURRENCY = 8;
    const studyUIDs = new Set<string>();

    const worker = async () => {
      while (active) {
        const i = nextIndex++;
        if (i >= fileKeys.length) return;

        const key = fileKeys[i];
        try {
          const blob = await s3FileService.getObjectAsBlob(key);
          const filename = key.split('/').pop() || `s3-file-${i}.dcm`;
          const file = new File([blob], filename, { type: 'application/dicom' });
          const uid = await processFile(file);
          
          if (uid) {
            studyUIDs.add(uid);
          }
          
          if (active) {
            setDownloaded(prev => {
              const current = prev + 1;
              const elapsed = (Date.now() - startTime) / 1000;
              const speed = current / elapsed;
              const remaining = (total - (current + errors)) / speed;
              
              if (current % 5 === 0) {
                setEta(remaining > 0 ? `Осталось ~${Math.ceil(remaining)} сек.` : 'Завершение...');
              }
              return current;
            });
          }
        } catch (err) {
          console.error('Failed to download/process S3 file:', key, err);
          if (active) {
            setErrors(prev => prev + 1);
          }
        }
      }
    };

    const runDownload = async () => {
      const workers = Array.from({ length: Math.min(CONCURRENCY, fileKeys.length) }, () => worker());
      await Promise.all(workers);

      if (active) {
        setTimeout(() => {
          if (active) {
            hide();
            if (onComplete) {
              onComplete(Array.from(studyUIDs));
            }
          }
        }, 1500);
      }
    };

    runDownload();

    return () => {
      active = false;
    };
  }, [fileKeys, hide, onComplete, startTime, total, errors]);

  const progress = Math.round(((downloaded + errors) / total) * 100);

  return (
    <div className="flex flex-col bg-gray-900 text-white p-8 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10" style={{ minWidth: '450px' }}>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Typography variant="h6" color="primary" component="h2" className="font-bold tracking-wide text-purple-400 uppercase">
            Синхронизация S3
          </Typography>
        </div>
        <div className="flex flex-col items-end gap-1">
          {errors > 0 && (
            <span className="text-[10px] text-red-400 font-bold uppercase animate-pulse">
              {errors} ошибок
            </span>
          )}
          <div className="px-3 py-1 bg-white/5 rounded-full border border-white/10">
            <Typography variant="subtitle" className="text-purple-400 font-mono text-sm" component="span">
              {progress}%
            </Typography>
          </div>
        </div>
      </div>

      <div className="w-full bg-white/5 rounded-full h-2.5 mb-6 overflow-hidden p-0.5 border border-white/5">
        <div 
          className="bg-gradient-to-r from-purple-600 to-blue-500 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_15px_rgba(147,51,234,0.6)]" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      <div className="flex justify-between items-center text-xs tracking-tight">
        <div className="flex flex-col gap-1">
          <span className="text-gray-400 uppercase font-semibold">Прогресс загрузки</span>
          <span className="text-white font-mono">{downloaded + errors} из {total} снимков</span>
          {eta && progress < 100 && (
            <span className="text-purple-400/80 animate-pulse">{eta}</span>
          )}
        </div>
        {progress === 100 ? (
          <div className="flex items-center gap-2 text-green-400 font-bold bg-green-400/10 px-3 py-2 rounded-lg border border-green-400/20">
             <Icons.StatusSuccess className="h-4 w-4" />
             Готово
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1 text-gray-500 italic">
            <span>Идет обработка...</span>
            <span className="text-[10px] text-purple-400/70">15 потоков активно</span>
          </div>
        )}
      </div>
      
    </div>
  );
};

export default S3ProgressModal;
