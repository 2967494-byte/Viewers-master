import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography } from '@ohif/ui';
import { useS3Loader } from '../utils/useS3Loader';

const TokenViewer: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { loadFromS3, loading, error } = useS3Loader('segmentation/dicomlocal');
  const navigate = useNavigate();

  useEffect(() => {
    const resolveToken = async () => {
      if (!token) return;

      try {
        console.log('Resolving token:', token);
        
        // 1. Пытаемся получить данные с бэкенда
        let studyInfo;
        try {
          const response = await fetch(`https://admin.orbital3d.ru/api/viewer/resolve/${token}`);
          if (response.ok) {
            studyInfo = await response.json();
            console.log('Resolved study from API:', studyInfo);
          }
        } catch (apiErr) {
          console.warn('Backend API resolution failed, trying fallback...', apiErr);
        }

        // 2. Fallback: Попытка декодировать Base64 (обфускация)
        // Формат: base64(JSON.stringify({ prefix: "...", uid: "..." }))
        if (!studyInfo) {
          try {
            const decoded = atob(token);
            const parsed = JSON.parse(decoded);
            if (parsed.prefix) {
              studyInfo = { s3Prefix: parsed.prefix };
              console.log('Resolved study from Base64 fallback:', studyInfo);
            }
          } catch (b64Err) {
            console.warn('Base64 fallback failed:', b64Err);
          }
        }

        if (studyInfo && studyInfo.s3Prefix) {
          loadFromS3(studyInfo.s3Prefix);
        } else {
          throw new Error('Не удалось расшифровать токен или получить данные об исследовании');
        }

      } catch (err) {
        console.error('Token resolution error:', err);
      }
    };

    resolveToken();
  }, [token, loadFromS3]);

  if (error) {
    return (
      <div className="flex flex-col h-screen w-screen items-center justify-center p-8 bg-black text-white">
        <Typography variant="h4" color="error" className="mb-4" component="h1">Ошибка доступа</Typography>
        <Typography variant="subtitle" className="text-gray-400 mb-8 max-w-lg text-center" component="p">
          {error}
        </Typography>
        <button 
          onClick={() => navigate('/local')}
          className="px-6 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
        >
          Вернуться в меню
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen items-center justify-center bg-black overflow-hidden relative">
      {/* Анимация фона */}
      <div className="absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600 rounded-full blur-[120px] animate-pulse transition-all"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600 rounded-full blur-[120px] animate-pulse transition-all delay-1000"></div>
      </div>

      <div className="z-10 flex flex-col items-center gap-8">
        <div className="relative">
           <div className="w-24 h-24 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin shadow-[0_0_20px_rgba(147,51,234,0.3)]"></div>
           <div className="absolute inset-0 flex items-center justify-center">
             <div className="w-12 h-12 rounded-full bg-purple-500/10 backdrop-blur-sm animate-pulse scale-90"></div>
           </div>
        </div>
        
        <div className="space-y-4 text-center">
          <Typography variant="h5" className="text-white font-bold tracking-tight uppercase" component="h2">
             Загрузка исследования
          </Typography>
          <div className="flex flex-col items-center gap-1">
            <Typography variant="subtitle" className="text-gray-500 tracking-widest uppercase font-mono text-[10px]" component="p">
               Анонимный доступ активен
            </Typography>
            <div className="h-[2px] w-12 bg-gradient-to-r from-transparent via-purple-500 to-transparent"></div>
          </div>
        </div>
      </div>
      
      <div className="absolute bottom-12 text-gray-700 text-[10px] tracking-widest font-medium uppercase italic">
         Orbital3D Secure Viewer Pipeline
      </div>
    </div>
  );
};

export default TokenViewer;
