import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DicomMetadataStore } from '@ohif/core';
import { useModal } from '@ohif/ui-next';
import { s3FileService } from './S3FileService';
import { processFile } from '../routes/Local/filesToStudies';
import S3ProgressModal from '../components/S3ProgressModal/S3ProgressModal';

export const useS3Loader = (modePath: string = 'segmentation/dicomlocal') => {
  const navigate = useNavigate();
  const { show, hide } = useModal();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFromS3 = useCallback(async (prefix: string) => {
    setLoading(true);
    setError(null);

    try {
      const allKeys = await s3FileService.listAllObjects(prefix);
      
      const fileKeys = allKeys.filter(key => {
        if (key.endsWith('/')) return false;
        
        const lowerKey = key.toLowerCase();
        if (lowerKey.endsWith('ohif_metadata.json')) return false;
        if (lowerKey.endsWith('.json')) return false;
        if (lowerKey.endsWith('.txt')) return false;
        if (lowerKey.endsWith('.png') || lowerKey.endsWith('.jpg')) return false;
        if (lowerKey.includes('thumbs.db')) return false;
        
        return true;
      }).sort();

      if (fileKeys.length === 0) {
        throw new Error('Папка пуста или не содержит DICOM файлов');
      }

      const handleComplete = (uids?: string[]) => {
        const studies = (uids && uids.length > 0) ? uids : DicomMetadataStore.getStudyInstanceUIDs();
        const validUIDs = studies.filter(Boolean);
        const studyUID = validUIDs[validUIDs.length - 1];

        if (studyUID) {
          console.log('Navigating to study:', studyUID);
          const query = new URLSearchParams();
          query.append('StudyInstanceUIDs', studyUID);
          navigate(`/${modePath}?${decodeURIComponent(query.toString())}`);
        } else {
          throw new Error('Не удалось определить StudyInstanceUID');
        }
      };

      // Fast Path
      const metadataIndex = await s3FileService.getMetadataIndex(prefix);
      
      if (metadataIndex && Array.isArray(metadataIndex)) {
        console.log('Fast Path: Using pre-generated metadata index');
        const fastUIDs = new Set<string>();

        metadataIndex.forEach(instance => {
          if (instance._url && !instance.url) instance.url = instance._url;
          
          if (instance.url) {
            DicomMetadataStore.addInstance(instance);
            const uid = instance.StudyInstanceUID || 
                        instance.studyInstanceUid || 
                        (instance['0020000D'] && instance['0020000D'].Value && instance['0020000D'].Value[0]);
            if (uid) fastUIDs.add(uid);
          }
        });

        handleComplete(Array.from(fastUIDs));
        return;
      }

      // Slow Path with Modal
      show({
        content: S3ProgressModal,
        contentProps: {
          fileKeys: fileKeys, 
          hide: hide,
          onComplete: (uids: string[]) => handleComplete(uids)
        },
      });

    } catch (err) {
      console.error('S3 Loader error:', err);
      setError(err.message || 'Ошибка при загрузке');
      setLoading(false);
    }
  }, [navigate, show, hide, modePath]);

  return { loadFromS3, loading, error };
};
