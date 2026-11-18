import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useS3Loader } from '../utils/useS3Loader';
import { s3FileService } from '../utils/S3FileService';
import { validateViewerLaunch } from '../utils/viewerLaunch';
import StudyLoadingScreen from '../components/StudyLoadingScreen/StudyLoadingScreen';
import { getViewerOpenTracker } from '@ohif/core/src/constants/orbitalOpenTelemetry';
import { patientCardReturnUrl, returnToPatientCard, setPatientReturnUrl } from '@ohif/core/src/constants/orbitalPatientReturn';

const TokenViewer: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { loadFromS3, error, progress } = useS3Loader('segmentation/dicomlocal');
  const navigate = useNavigate();
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessGranted, setAccessGranted] = useState(false);
  const config = (window as any).config || {};
  const disabled = Boolean(config.disableTokenViewer);
  const resolveUrl = config.viewerIntegration?.resolveUrl || '';

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setAccessError(null);
    setAccessGranted(false);
    setPatientReturnUrl(null);
    const resolve = async () => {
      try {
        if (disabled || !resolveUrl) throw new Error('Открытие из личного кабинета пока не подключено.');
        if (!token) throw new Error('Не указан код доступа к исследованию.');
        s3FileService.clearStudyAccess();
        const response = await fetch(resolveUrl.replace('{token}', encodeURIComponent(token)), {
          credentials: 'include', signal: controller.signal, referrerPolicy: 'no-referrer',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403
          ? 'Нет доступа к исследованию. Войдите в личный кабинет и откройте его заново.'
          : 'Не удалось получить доступ к исследованию из личного кабинета.');
        const launch = validateViewerLaunch(await response.json());
        if (!active) return;
        s3FileService.setStudyAccess(launch.s3Prefix, launch.access.resources, launch.access.expiresAt);
        setAccessGranted(true);
        await loadFromS3(launch.s3Prefix, { sourceVersion: launch.sourceVersion,
          patientReturnUrl: patientCardReturnUrl(launch.s3Prefix, resolveUrl, window.location.href) });
      } catch (failure: any) {
        if (active && failure.name !== 'AbortError') getViewerOpenTracker()?.fail('access-or-index-error');
        if (active && failure.name !== 'AbortError') setAccessError(failure.message || 'Ошибка доступа к исследованию');
      }
    };
    resolve();
    return () => { active = false; controller.abort(); };
  }, [token, disabled, resolveUrl, loadFromS3]);

  const message = accessError || error;
  return (
    <StudyLoadingScreen accessGranted={accessGranted} progress={progress} error={message} onBack={() => {
      if (!returnToPatientCard()) navigate('/');
    }} />
  );
};
export default TokenViewer;
