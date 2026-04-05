import React, { useEffect, useState } from 'react';
import { s3FileService } from '../../utils/S3FileService';
import { processFile } from '../../routes/Local/filesToStudies';
import { Typography } from '@ohif/ui';
import { Icons } from '@ohif/ui-next';

interface S3ProgressModalProps {
  fileKeys: string[];
  hide: () => void;
}

const S3ProgressModal: React.FC<S3ProgressModalProps> = ({ fileKeys, hide }) => {
  const [downloaded, setDownloaded] = useState(0);
  const total = fileKeys.length;

  useEffect(() => {
    let active = true;

    const runDownload = async () => {
      const BATCH_SIZE = 15;
      for (let i = 0; i < fileKeys.length; i += BATCH_SIZE) {
        if (!active) break;

        const batch = fileKeys.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (key, idx) => {
            try {
              const blob = await s3FileService.getObjectAsBlob(key);
              const file = blob as any;
              file.name = key.split('/').pop() || `s3-file-${i + idx}.dcm`;
              await processFile(file);
            } catch (err) {
              console.error('Failed to download/process S3 file:', key, err);
            }
          })
        );
        
        if (active) {
          setDownloaded(prev => Math.min(prev + batch.length, total));
        }
      }

      if (active) {
        // Даем секунду пользователю увидеть 100%
        setTimeout(() => {
          if (active) hide();
        }, 1500);
      }
    };

    runDownload();

    return () => {
      active = false;
    };
  }, [fileKeys, hide]);

  const progress = Math.round((downloaded / total) * 100);

  return (
    <div className="flex flex-col bg-gray-900 text-white p-6 rounded-lg shadow-2xl" style={{ minWidth: '400px' }}>
      <div className="flex items-center justify-between mb-6">
        <Typography variant="h6" color="primary" component="h2" className="flex items-center gap-2">
          <Icons.LoadingOHIFMark className="h-6 w-6 animate-pulse" />
          Загрузка данных из S3
        </Typography>
        <Typography variant="subtitle" className="text-gray-400">
          {progress}%
        </Typography>
      </div>

      <div className="w-full bg-gray-800 rounded-full h-3 mb-4 overflow-hidden border border-gray-700">
        <div 
          className="bg-purple-600 h-full rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(147,51,234,0.5)]" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      <div className="flex justify-between items-center text-sm text-gray-400">
        <span>Файлов: {downloaded} / {total}</span>
        {progress === 100 ? (
          <span className="text-green-400 flex items-center gap-1 font-bold">
            Готово!
          </span>
        ) : (
          <span className="animate-pulse italic">Обработка слоев...</span>
        )}
      </div>
      
      <div className="mt-4 pt-4 border-t border-gray-800">
        <p className="text-xs text-gray-500 italic text-center">
          Исследование уже открыто. Вы можете начинать просмотр, пока остальные снимки загружаются.
        </p>
      </div>
    </div>
  );
};

export default S3ProgressModal;
