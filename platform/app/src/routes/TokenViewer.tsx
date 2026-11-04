import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useS3Loader } from '../utils/useS3Loader';
import { s3FileService } from '../utils/S3FileService';
import { validateViewerLaunch } from '../utils/viewerLaunch';

const TokenViewer: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { loadFromS3, error, progress } = useS3Loader('segmentation/dicomlocal');
  const navigate = useNavigate();
  const [accessError, setAccessError] = useState<string | null>(null);
  const config = (window as any).config || {};
  const disabled = Boolean(config.disableTokenViewer);
  const resolveUrl = config.viewerIntegration?.resolveUrl || '';

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
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
        await loadFromS3(launch.s3Prefix, { sourceVersion: launch.sourceVersion });
      } catch (failure: any) {
        if (active && failure.name !== 'AbortError') setAccessError(failure.message || 'Ошибка доступа к исследованию');
      }
    };
    resolve();
    return () => { active = false; controller.abort(); };
  }, [token, disabled, resolveUrl, loadFromS3]);

  const message = accessError || error;
  return (
    <div className="flex flex-col h-screen w-screen items-center justify-center gap-6 p-8 bg-black text-white">
      <h1 className="text-2xl font-bold">{message ? 'Просмотр пока недоступен' : 'Загрузка исследования'}</h1>
      <p className="max-w-lg text-center text-gray-300" role={message ? 'alert' : 'status'}>
        {message || progress.text}
      </p>
      {!message && <progress className="w-64" max={100} value={progress.percent} />}
      {message && <button onClick={() => navigate('/')} className="px-6 py-2 bg-purple-600 rounded-lg">Вернуться в меню</button>}
    </div>
  );
};
export default TokenViewer;
