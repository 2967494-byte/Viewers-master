import React, { useState, useEffect } from 'react';
import { s3FileService } from '../../utils/S3FileService';
import { Button, Icons } from '@ohif/ui-next';
import { Typography } from '@ohif/ui';

interface S3BrowseModalProps {
  onConfirm: (prefix: string) => void;
  hide: () => void;
}

const S3BrowseModal: React.FC<S3BrowseModalProps> = ({ onConfirm, hide }) => {
  const [items, setItems] = useState({ folders: [], files: [] });
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsCreds = !s3FileService.hasCredentials();

  const fetchItems = async (prefix = '') => {
    setLoading(true);
    setError(null);
    try {
      if (needsCreds) {
        if (!accessKeyId.trim() || !secretAccessKey.trim()) {
          throw new Error('Укажите Access Key и Secret Key для S3');
        }
        s3FileService.setSessionCredentials(accessKeyId.trim(), secretAccessKey.trim());
      }
      const normalized = s3FileService.normalizePrefix(prefix);
      const data = await s3FileService.listPrefixes(normalized);
      setItems(data);
      setCurrentPrefix(normalized);
      setPathInput(normalized);
    } catch (err: any) {
      console.error('Failed to fetch S3 items:', err);
      setError(err?.message || 'Ошибка доступа к S3 (проверьте ключи и CORS)');
      setItems({ folders: [], files: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Do not auto-list root when credentials may be missing — wait for path/load.
  }, []);

  const handleFolderClick = folder => {
    fetchItems(folder);
  };

  const handleBack = () => {
    const parts = currentPrefix.split('/').filter(Boolean);
    parts.pop();
    const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    fetchItems(parentPrefix);
  };

  const ensureCreds = () => {
    if (!s3FileService.hasCredentials()) {
      if (!accessKeyId.trim() || !secretAccessKey.trim()) {
        throw new Error('Укажите Access Key и Secret Key для S3');
      }
      s3FileService.setSessionCredentials(accessKeyId.trim(), secretAccessKey.trim());
    }
  };

  const handleLoadPath = async () => {
    try {
      ensureCreds();
      const normalized = s3FileService.normalizePrefix(pathInput);
      if (!normalized) {
        setError('Вставьте путь исследования hot/.../appt_.../. Нужна готовая сжатая серия.');
        return;
      }
      onConfirm(normalized);
      hide();
    } catch (err: any) {
      setError(err?.message || 'Не удалось начать загрузку');
    }
  };

  const handleBrowsePath = async () => {
    await fetchItems(pathInput);
  };

  const handleLoadSelected = async () => {
    try {
      ensureCreds();
      const normalized = s3FileService.normalizePrefix(currentPrefix || pathInput);
      if (!normalized) {
        setError('Выберите папку или вставьте путь');
        return;
      }
      onConfirm(normalized);
      hide();
    } catch (err: any) {
      setError(err?.message || 'Не удалось начать загрузку');
    }
  };

  return (
    <div
      className="flex flex-col bg-black text-white p-6 rounded-lg shadow-2xl"
      style={{ minWidth: '640px', maxHeight: '85vh' }}
    >
      <div className="flex items-center justify-between border-b border-gray-800 pb-4 mb-4">
        <Typography
          variant="h6"
          color="primary"
          component="h2"
          className="flex items-center gap-2"
        >
          <Icons.Database className="h-6 w-6" />
          Загрузка из S3
        </Typography>
        <button
          onClick={hide}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <Icons.Close className="h-6 w-6" />
        </button>
      </div>

      <div className="space-y-3 mb-4">
        <label className="block text-xs uppercase tracking-widest text-gray-400 font-semibold">
          Путь исследования в HOT
        </label>
        <input
          value={pathInput}
          onChange={e => setPathInput(e.target.value)}
          placeholder="hot/2026/11/04/pat_.../appt_.../"
          className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm font-mono text-white outline-none focus:border-purple-500"
        />
        <p className="text-xs text-gray-400">Откроется подготовленная сжатая серия. Если подготовка не завершена, просмотр пока недоступен.</p>
        {needsCreds && (
          <div className="grid grid-cols-1 gap-2 pt-1">
            <input
              value={accessKeyId}
              onChange={e => setAccessKeyId(e.target.value)}
              placeholder="S3 Access Key"
              autoComplete="off"
              className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm font-mono text-white outline-none focus:border-purple-500"
            />
            <input
              value={secretAccessKey}
              onChange={e => setSecretAccessKey(e.target.value)}
              placeholder="S3 Secret Key"
              type="password"
              autoComplete="off"
              className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm font-mono text-white outline-none focus:border-purple-500"
            />
            <p className="text-[10px] text-gray-500">
              Ключи только в sessionStorage этой вкладки, в репозиторий не пишутся.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleLoadPath}
            variant="default"
            className="bg-blue-600 hover:bg-blue-700 text-white border-none"
          >
            Загрузить по пути
          </Button>
          <Button
            onClick={handleBrowsePath}
            variant="outline"
            className="border-gray-700 text-gray-300"
            disabled={loading}
          >
            Открыть в браузере
          </Button>
        </div>
        {error && (
          <p className="text-sm text-red-400 break-words">{error}</p>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto pr-2 custom-scrollbar border border-white/5 rounded-md"
        style={{ minHeight: '280px' }}
      >
        {loading ? (
          <div className="flex flex-col h-full items-center justify-center space-y-3 py-12">
            <Typography
              variant="subtitle"
              component="p"
              className="text-gray-500"
            >
              Загрузка списка...
            </Typography>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {currentPrefix && (
              <div
                onClick={handleBack}
                className="flex cursor-pointer items-center space-x-3 rounded-md p-3 hover:bg-gray-800/50 transition-colors group"
              >
                <Icons.ArrowLeft className="h-5 w-5 text-purple-400 group-hover:-translate-x-1 transition-transform" />
                <Typography
                  variant="subtitle"
                  component="span"
                  className="text-purple-300"
                >
                  .. / (Назад)
                </Typography>
              </div>
            )}

            {!currentPrefix && items.folders.length === 0 && items.files.length === 0 && (
              <div className="py-12 text-center space-y-2 text-gray-500 text-sm">
                Вставьте путь вида hot/ГГГГ/ММ/ДД/.../Data/ и нажмите «Загрузить по пути».
              </div>
            )}

            {currentPrefix && items.folders.length === 0 && items.files.length === 0 && !loading && (
              <div className="py-12 text-center space-y-3">
                <Icons.Search className="h-12 w-12 mx-auto text-gray-700" />
                <Typography
                  variant="subtitle"
                  color="error"
                  component="p"
                  className="max-w-xs mx-auto"
                >
                  Папка пуста или нет доступа к S3. Проверьте путь, ключи и CORS.
                </Typography>
              </div>
            )}

            <div className="grid grid-cols-1 gap-1">
              {items.folders.map(folder => (
                <div
                  key={folder}
                  onClick={() => handleFolderClick(folder)}
                  className="flex cursor-pointer items-center space-x-3 rounded-md p-3 hover:bg-white/5 border border-transparent hover:border-white/10 transition-all group"
                >
                  <Icons.Database className="h-5 w-5 text-yellow-500 group-hover:scale-110 transition-transform" />
                  <span className="truncate flex-1 font-medium">
                    {folder.replace(currentPrefix, '')}
                  </span>
                  <Icons.ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-white opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              ))}

              {items.files.map(file => (
                <div
                  key={file}
                  className="flex items-center space-x-3 rounded-md p-3 text-gray-500 hover:bg-white/5 transition-colors group"
                >
                  <Icons.Series className="h-5 w-5 text-blue-500 group-hover:text-blue-400" />
                  <span className="truncate flex-1 text-sm">
                    {file.replace(currentPrefix, '')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-5 mt-4">
        <div className="flex flex-col">
          <Typography
            variant="caption"
            className="text-gray-500 font-medium"
            component="p"
          >
            Текущий prefix
          </Typography>
          <Typography
            variant="subtitle"
            component="span"
            className="text-gray-400 text-xs font-mono break-all"
          >
            {currentPrefix || '—'}
          </Typography>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={hide}
            variant="outline"
            color="primary"
            className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            Отмена
          </Button>
          <Button
            onClick={handleLoadSelected}
            variant="default"
            color="primary"
            className="shadow-lg shadow-purple-900/20 px-6"
            disabled={loading}
          >
            Загрузить эту папку
          </Button>
        </div>
      </div>
    </div>
  );
};

export default S3BrowseModal;
