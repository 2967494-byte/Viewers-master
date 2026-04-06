import React, { useEffect, useRef, useState } from 'react';
import classnames from 'classnames';
import { useNavigate } from 'react-router-dom';
import { DicomMetadataStore, MODULE_TYPES, useSystem } from '@ohif/core';
import { Typography } from '@ohif/ui';
import Dropzone from 'react-dropzone';

import filesToStudies from './filesToStudies';
import { extensionManager } from '../../App';
import { Button, Icons, useModal } from '@ohif/ui-next';
import S3BrowseModal from '../../components/S3BrowseModal/S3BrowseModal';
import S3ProgressModal from '../../components/S3ProgressModal/S3ProgressModal';
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
            className="min-w-32 bg-purple-600 hover:bg-purple-700 text-white border-none shadow-md transition-all active:scale-95"
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
    const studies = await filesToStudies(acceptedFiles, dataSource);

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
    hide(); // Закрываем окно браузера S3
    setDropInitiated(true);

    try {
      const allKeys = await s3FileService.listAllObjects(prefix);
      
      const fileKeys = allKeys.filter(key => {
        if (key.endsWith('/')) return false;
        
        const lowerKey = key.toLowerCase();
        // Пропускаем метаданные и системные файлы
        if (lowerKey.endsWith('ohif_metadata.json')) return false;
        if (lowerKey.endsWith('.json')) return false;
        if (lowerKey.endsWith('.txt')) return false;
        if (lowerKey.endsWith('.png') || lowerKey.endsWith('.jpg')) return false;
        if (lowerKey.includes('thumbs.db')) return false;
        
        return true;
      }).sort();

      if (fileKeys.length === 0) {
        alert('Папка пуста');
        setDropInitiated(false);
        return;
      }

      // Функция для перехода во вьювер после полной загрузки
      const handleComplete = (uids?: string[]) => {
        // Пытаемся взять UID из переданных (при медленной загрузке)
        // или из DicomMetadataStore (как запасной вариант)
        const studies = (uids && uids.length > 0) ? uids : DicomMetadataStore.getStudyInstanceUIDs();
        
        // Фильтруем пустые значения и берем последний найденный UID
        const validUIDs = studies.filter(Boolean);
        const studyUID = validUIDs[validUIDs.length - 1];

        if (studyUID) {
          console.log('Navigating to study:', studyUID);
          const query = new URLSearchParams();
          query.append('StudyInstanceUIDs', studyUID);
          navigate(`/${modePath}?${decodeURIComponent(query.toString())}`);
        } else {
          console.error('Final check: No StudyInstanceUID found in metadata store or results', studies);
          alert('Не удалось определить ID исследования. Попробуйте обновить страницу или проверить файлы.');
          setDropInitiated(false);
        }
      };

      // Пытаемся сначала по «Быстрому Пути» (Fast Path): Поиск предсгенерированного индекса метаданных
      const metadataIndex = await s3FileService.getMetadataIndex(prefix);
      
      if (metadataIndex && Array.isArray(metadataIndex)) {
        console.log('Fast Path: Using pre-generated metadata index');
        const fastUIDs = new Set<string>();

        metadataIndex.forEach(instance => {
          // Стандартизируем URL
          if (instance._url && !instance.url) {
            instance.url = instance._url;
          }
          
          if (instance.url) {
            DicomMetadataStore.addInstance(instance);
            
            // Явно вытаскиваем UID из JSON для надежности (разные форматы тегов)
            const uid = instance.StudyInstanceUID || 
                        instance.studyInstanceUid || 
                        (instance['0020000D'] && instance['0020000D'].Value && instance['0020000D'].Value[0]);
            if (uid) {
              fastUIDs.add(uid);
            }
          }
        });

        handleComplete(Array.from(fastUIDs));
        return;
      }

      // Если индекса нет — показываем окно прогресса и ждем 100% загрузки
      show({
        content: S3ProgressModal,
        contentProps: {
          fileKeys: fileKeys, 
          hide: hide,
          onComplete: (uids: string[]) => handleComplete(uids)
        },
      });
    } catch (err) {
      console.error('S3 Load error:', err);
      alert('Ошибка при загрузке из S3');
      setDropInitiated(false);
    }
  };

  const handleS3Load = () => {
    show({
      content: S3BrowseModal,
      title: 'Orbital3D S3 Explorer',
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
      noDrag
    >
      {({ getRootProps }) => (
        <div
          {...getRootProps()}
          style={{ width: '100%', height: '100%', backgroundColor: 'white' }}
        >
          <div className="flex h-screen w-screen items-center justify-center p-4" style={{ backgroundColor: 'white' }}>
            <div
              className="mx-auto space-y-4 rounded-2xl py-16 px-16 drop-shadow-2xl border-2 border-dashed border-purple-500/30 transition-all duration-500"
              style={{
                backgroundColor: 'white',
                boxShadow: '0 10px 40px rgba(147, 51, 234, 0.15)'
              }}
            >
              <div className="space-y-4 text-center">
                <div className="flex justify-center mb-6">
                </div>
                {dropInitiated ? (
                  <div className="flex flex-col items-center justify-center gap-4">
                     <div className="flex flex-col items-center justify-center gap-2">
                        <div className="text-purple-600 font-bold text-2xl mb-2" id="indexing-progress">
                           {/* Сюда будем выводить прогресс через DOM для скорости */}
                           Инициализация...
                        </div>
                        <div className="w-64 bg-gray-100 rounded-full h-2 overflow-hidden border border-purple-100">
                           <div id="indexing-bar" className="bg-purple-500 h-full w-0 transition-all duration-300"></div>
                        </div>
                     </div>
                     <p className="text-gray-400 text-sm italic">
                        Подготовка DICOM объектов...
                     </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Typography variant="h4" className="text-purple-600 font-bold tracking-tight" component="h1">
                      Orbital3D Viewer
                    </Typography>
                    <p className="text-gray-600 text-lg font-medium">
                      Перетащите DICOM файлы сюда <br />
                      для локальной загрузки
                    </p>
                    <p className="text-gray-400 text-xs uppercase tracking-widest font-bold">
                      или выберите источник ниже
                    </p>
                  </div>
                )}
              </div>
              {!dropInitiated && (
                <div className="flex justify-center flex-wrap gap-4 pt-8">
                  {getLoadButton(onDrop, 'Локальные файлы', false)}
                  {getLoadButton(onDrop, 'Локальная папка', true)}
                  <Button
                    variant="default"
                    className="min-w-32 bg-blue-600 hover:bg-blue-700 text-white border-none shadow-md shadow-blue-500/20 active:scale-95 transition-all"
                    onClick={handleS3Load}
                  >
                    Облачное хранилище S3
                  </Button>
                </div>
              )}
              {!dropInitiated && (
                <p className="text-center text-[10px] text-gray-400 mt-8 font-medium italic opacity-50 uppercase tracking-widest">
                  Данные обрабатываются локально и не передаются на сервер
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </Dropzone>
  );
}

export default Local;
