import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DicomMetadataStore } from '@ohif/core';
import { useModal } from '@ohif/ui-next';
import { s3FileService } from './S3FileService';
import {
  registerOrbitalS3ImageLoader,
} from './orbitalS3ImageLoader';
import S3ProgressModal from '../components/S3ProgressModal/S3ProgressModal';
import { imageLoader } from '@cornerstonejs/core';
import { prepareS3Instances } from './s3MetadataIndex';
import { loadCompressedStudy } from './s3CompressedStudy';
import { getViewerOpenTracker } from '@ohif/core/src/constants/orbitalOpenTelemetry';

export const useS3Loader = (modePath: string = 'segmentation/dicomlocal') => {
  const navigate = useNavigate();
  const { show, hide } = useModal();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ text: 'Подготовка загрузки S3…', percent: 0 });

  const setInitProgress = (text: string, pct = 0) => {
    setProgress({ text, percent: Math.max(0, Math.min(100, pct)) });
  };

  const fail = useCallback((message: string) => {
    getViewerOpenTracker()?.fail('index-load-error');
    console.error('S3 Loader error:', message);
    setInitProgress(message, 0);
    setError(message);
    setLoading(false);
  }, []);

  const loadFromS3 = useCallback(
    async (prefix: string, options?: { sourceVersion?: string | number }) => {
      setLoading(true);
      setError(null);

      try {
        registerOrbitalS3ImageLoader();
        const normalized = s3FileService.normalizePrefix(prefix);

        const handleComplete = (uids?: string[]) => {
          try {
            const studies =
              uids && uids.length > 0
                ? uids
                : DicomMetadataStore.getStudyInstanceUIDs();
            const validUIDs = studies.filter(Boolean);
            const studyUID = validUIDs[validUIDs.length - 1];

            if (!studyUID) {
              fail('Не удалось определить StudyInstanceUID');
              return;
            }

            console.log('Navigating to study:', studyUID);
            const query = new URLSearchParams();
            query.append('StudyInstanceUIDs', studyUID);
            setLoading(false);
            navigate(`/${modePath}?${decodeURIComponent(query.toString())}`);
          } catch (err: any) {
            fail(err?.message || 'Ошибка перехода к исследованию');
          }
        };

        // Fast path first — do not list hundreds of DICOM keys if index exists.
        const compressedOnly = (window as any).config?.s3?.compressedOnly !== false;
        setInitProgress(compressedOnly ? 'Проверка готовности сжатой серии…' : 'Проверка ohif_metadata.json…', 20);
        const reportProgress = status => {
          if (status.phase === 'download') {
            const mb = (status.loadedBytes / (1024 * 1024)).toFixed(1);
            const total = status.totalBytes ? ` / ${(status.totalBytes / (1024 * 1024)).toFixed(1)} МБ` : ' МБ';
            setInitProgress(`Читаем индекс: ${mb}${total}`, status.totalBytes
              ? 20 + status.loadedBytes / status.totalBytes * 35 : 30);
          } else setInitProgress(`Поиск индекса: проверено ${status.completedCandidates} из ${status.totalCandidates}`, 20);
        };
        const metadataIndex = compressedOnly
          ? await loadCompressedStudy(normalized, (key, progress) => s3FileService.getJsonObject(key, progress), reportProgress, options?.sourceVersion)
          : await s3FileService.getMetadataIndex(normalized, reportProgress);

        if (metadataIndex) {
          console.log(
            'Fast Path: Using pre-generated metadata index',
            metadataIndex.indexKey
          );
          setInitProgress(
            `Быстрый путь: ${metadataIndex.instances.length} срезов…`,
            80
          );
          const preparedAt = performance.now();
          const instances = prepareS3Instances(metadataIndex.instances, metadataIndex.indexPrefix);
          const fastUIDs = new Set<string>();
          for (let i = 0; i < instances.length; i++) {
            const instance = instances[i];
            DicomMetadataStore.addInstance(instance);
            fastUIDs.add(instance.StudyInstanceUID);
            if (i && i % 200 === 0) {
              setInitProgress(`Индекс найден: подготовлено ${i} / ${instances.length} срезов`, 60 + i / instances.length * 30);
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
          console.info('[orbital-s3] metadata prepared', { instances: instances.length,
            elapsedMs: Math.round(performance.now() - preparedAt) });

          // Start the middle slice before background volume requests fill the queue.
          // It is the original full-resolution slice, not an interpolated substitute.
          const series = new Map<string, any[]>();
          const selectedStudy = [...fastUIDs][fastUIDs.size - 1];
          instances.filter(instance => instance.StudyInstanceUID === selectedStudy && (instance.Modality === 'CT' || instance.Modality === 'MR'))
            .forEach(instance => {
              const group = series.get(instance.SeriesInstanceUID) || [];
              group.push(instance);
              series.set(instance.SeriesInstanceUID, group);
            });
          const firstSeries = [...series.values()].sort((a, b) => b.length - a.length)[0];
          if (firstSeries?.length) {
            const ordered = [...firstSeries].sort((a, b) => Number(a.InstanceNumber || 0) - Number(b.InstanceNumber || 0));
            const middle = ordered[Math.floor(ordered.length / 2)];
            imageLoader.loadAndCacheImage(middle.url).catch(() => {
              // Normal viewport loading reports/retries this image if needed.
              console.warn('[orbital-s3] initial slice could not be prefetched');
            });
          }
          setInitProgress(`Индекс готов: ${instances.length} срезов. Открываем исследование…`, 100);

          if (fastUIDs.size === 0) {
            fail('ohif_metadata.json найден, но StudyInstanceUID пустой');
            return;
          }

          handleComplete(Array.from(fastUIDs));
          return;
        }

        if (compressedOnly) throw new Error('Сжатая серия ещё не подготовлена');
        setInitProgress('Индекс не найден — список объектов S3…', 30);
        const allKeys = await s3FileService.listAllObjects(normalized);
        setInitProgress(`Найдено ${allKeys.length} объектов…`, 50);

        const fileKeys = allKeys
          .filter(key => {
            if (key.endsWith('/')) return false;
            const lowerKey = key.toLowerCase();
            if (lowerKey.includes('/_viewer/')) return false;
            if (lowerKey.endsWith('ohif_metadata.json')) return false;
            if (lowerKey.endsWith('.json')) return false;
            if (lowerKey.endsWith('.txt')) return false;
            if (lowerKey.endsWith('.png') || lowerKey.endsWith('.jpg')) return false;
            if (lowerKey.includes('thumbs.db')) return false;
            return true;
          })
          .sort();

        if (fileKeys.length === 0) {
          fail('Папка пуста или не содержит DICOM файлов');
          return;
        }

        setInitProgress(`Индексация ${fileKeys.length} DICOM…`, 70);
        show({
          content: S3ProgressModal,
          contentProps: {
            fileKeys,
            hide,
            onComplete: (uids: string[]) => handleComplete(uids),
            onError: (message: string) => fail(message),
          },
        });
      } catch (err: any) {
        fail(err?.message || 'Ошибка при загрузке');
      }
    },
    [navigate, show, hide, modePath, fail]
  );

  return { loadFromS3, loading, error, setError, progress };
};
