import React, { useEffect, useRef, useState, useCallback } from 'react';
import classnames from 'classnames';
import { useNavigate } from 'react-router-dom';
import { DicomMetadataStore, MODULE_TYPES, useSystem } from '@ohif/core';
import Dropzone from 'react-dropzone';

import filesToStudies from './filesToStudies';
import { extensionManager } from '../../App';
import { Button, Icons, useModal } from '@ohif/ui-next';
import S3BrowseModal from '../../components/S3BrowseModal/S3BrowseModal';
import { s3FileService } from '../../utils/S3FileService';

const getLoadButton = (onDrop, text, isDir) => {
  return (
    <Dropzone
      onDrop={onDrop}
      noDrag
    >
      {({ getRootProps, getInputProps }) => (
        <div {...getRootProps()}>
          <Button
            variant="default"
            className="min-w-32"
            style={{
              backgroundColor: '#9333ea',
              color: 'white',
              border: 'none',
            }}
            disabled={false}
            onClick={() => {}}
          >
            {text}
            {isDir ? (
              <input
                {...getInputProps()}
                webkitdirectory="true"
                mozdirectory="true"
                style={{ display: 'none' }}
              />
            ) : (
              <input
                {...getInputProps()}
                style={{ display: 'none' }}
              />
            )}
          </Button>
        </div>
      )}
    </Dropzone>
  );
};

type LocalProps = {
  modePath: string;
};

function Local({ modePath }: LocalProps) {
  const { servicesManager } = useSystem();
  const { customizationService } = servicesManager.services;
  const navigate = useNavigate();
  const { show, hide } = useModal();
  const dropzoneRef = useRef();
  const [dropInitiated, setDropInitiated] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);

  const LoadingIndicatorProgress = customizationService.getCustomization(
    'ui.loadingIndicatorProgress'
  );

  // Initializing the dicom local dataSource
  const dataSourceModules = extensionManager.modules[MODULE_TYPES.DATA_SOURCE];
  const localDataSources = dataSourceModules.reduce((acc, curr) => {
    const mods = [];
    curr.module.forEach(mod => {
      if (mod.type === 'localApi') {
        mods.push(mod);
      }
    });
    return acc.concat(mods);
  }, []);

  const firstLocalDataSource = localDataSources[0];
  const dataSource = firstLocalDataSource.createDataSource({});

  const microscopyExtensionLoaded = extensionManager.registeredExtensionIds.includes(
    '@ohif/extension-dicom-microscopy'
  );

  const onDrop = async acceptedFiles => {
    const studies = await filesToStudies(acceptedFiles);

    const query = new URLSearchParams();

    if (microscopyExtensionLoaded) {
      const smStudies = studies.filter(id => {
        const study = DicomMetadataStore.getStudy(id);
        return (
          study.series.findIndex(s => s.Modality === 'SM' || s.instances[0].Modality === 'SM') >= 0
        );
      });

      if (smStudies.length > 0) {
        smStudies.forEach(id => query.append('StudyInstanceUIDs', id));
        modePath = 'microscopy';
      }
    }

    studies.filter(id => id).forEach(id => query.append('StudyInstanceUIDs', id));
    navigate(`/${modePath}?${decodeURIComponent(query.toString())}`);
  };

  const handleS3StreamLoad = async (prefix: string) => {
    hide();
    setDropInitiated(true);
    setStatusText('Подключение к S3...');

    try {
      const allKeys = await s3FileService.listAllObjects(prefix);
      const fileKeys = allKeys.filter(key => !key.endsWith('/'));

      if (fileKeys.length === 0) {
        alert('Папка пуста');
        setDropInitiated(false);
        return;
      }

      setStatusText(`Найдено ${fileKeys.length} файлов. Подготовка...`);
      
      const initialKeys = fileKeys.slice(0, 3);
      const remainingKeys = fileKeys.slice(3);

      const downloadFile = async (key: string, index: number) => {
        const blob = await s3FileService.getObjectAsBlob(key);
        const file = blob as any;
        file.name = key.split('/').pop() || `file-${index}.dcm`;
        return file;
      };

      const initialFiles = await Promise.all(initialKeys.map((key, i) => downloadFile(key, i)));
      const { processFile } = await import('./filesToStudies');
      await Promise.all(initialFiles.map(f => processFile(f)));
      
      const studies = DicomMetadataStore.getStudyInstanceUIDs();
      const studyUID = studies[studies.length - 1];

      if (studyUID) {
        // Мгновенный переход
        const query = new URLSearchParams();
        query.append('StudyInstanceUIDs', studyUID);
        navigate(`/${modePath}?${decodeURIComponent(query.toString())}`);
        
        // Фоновая загрузка оставшихся файлов пачками
        const BATCH_SIZE = 10;
        for (let i = 0; i < remainingKeys.length; i += BATCH_SIZE) {
          const batch = remainingKeys.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (key, idx) => {
            try {
              const f = await downloadFile(key, i + idx);
              await processFile(f);
            } catch (e) {
              console.error('Failed to stream file:', key, e);
            }
          }));
          const progress = Math.round(((i + batch.length + 3) / fileKeys.length) * 100);
          setDownloadProgress(progress);
          setStatusText(`Загружено ${i + batch.length + 3} из ${fileKeys.length}`);
        }
      } else {
        alert('Не удалось определить ID исследования.');
        setDropInitiated(false);
      }
    } catch (err) {
      console.error('Streaming S3 load failed:', err);
      alert('Ошибка при загрузке');
      setDropInitiated(false);
    }
  };

  const handleS3Load = () => {
    show({
      content: S3BrowseModal,
      title: 'Load from S3',
      contentProps: {
        onConfirm: handleS3StreamLoad,
        hide: hide,
      },
    });
  };

  useEffect(() => {
    document.body.classList.add('bg-white');
    return () => {
      document.body.classList.remove('bg-white');
    };
  }, []);

  return (
    <Dropzone
      ref={dropzoneRef}
      onDrop={acceptedFiles => {
        setDropInitiated(true);
        onDrop(acceptedFiles);
      }}
      noClick
    >
      {({ getRootProps }) => (
        <div
          {...getRootProps()}
          style={{ width: '100%', height: '100%', backgroundColor: 'white' }}
        >
          <div className="flex h-screen w-screen items-center justify-center" style={{ backgroundColor: 'white' }}>
            <div
              className="mx-auto space-y-2 rounded-xl py-12 px-12 drop-shadow-md"
              style={{
                backgroundColor: 'white',
                border: '2px dashed #9333ea',
                boxShadow: '0 4px 20px rgba(147, 51, 234, 0.2)'
              }}
            >
              <div className="space-y-2 py-6 text-center">
                {dropInitiated ? (
                  <div className="flex flex-col items-center justify-center pt-12">
                    {LoadingIndicatorProgress && LoadingIndicatorProgress.component ? (
                       <LoadingIndicatorProgress.component
                         progress={downloadProgress}
                         textBlock={
                           <div className="text-center pt-4">
                             <div className="text-[#9333ea] text-lg font-bold">{statusText}</div>
                           </div>
                         }
                         className={'h-full w-full'}
                       />
                    ) : (
                      <div className="text-[#9333ea] animate-pulse">Loading... {statusText}</div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="pt-0 text-xl" style={{ color: '#9333ea' }}>
                      Перетащите DICOM файлы и папки сюда <br />
                      для локальной загрузки.
                    </p>
                    <p className="text-gray-500 text-base">
                      Примечание: Ваши данные остаются в браузере
                      <br /> и никогда не загружаются на сервер.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex justify-center gap-4 pt-4">
                {getLoadButton(onDrop, 'Загрузить файлы', false)}
                {getLoadButton(onDrop, 'Загрузить папку', true)}
                <Button
                  variant="default"
                  className="min-w-32"
                  style={{
                    backgroundColor: '#2563eb',
                    color: 'white',
                    border: 'none',
                  }}
                  onClick={handleS3Load}
                >
                  Загрузить из S3
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Dropzone>
  );
}

export default Local;
