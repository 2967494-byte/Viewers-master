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
  const [loading, setLoading] = useState(false);

  const fetchItems = async (prefix = '') => {
    setLoading(true);
    try {
      const data = await s3FileService.listPrefixes(prefix);
      setItems(data);
      setCurrentPrefix(prefix);
    } catch (err) {
      console.error('Failed to fetch S3 items:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
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

  const handleLoadSelected = async () => {
    onConfirm(currentPrefix);
    hide();
  };

  return (
    <div className="flex flex-col bg-black text-white p-6 rounded-lg shadow-2xl" style={{ minWidth: '600px', maxHeight: '80vh' }}>
      <div className="flex items-center justify-between border-b border-gray-800 pb-4 mb-4">
        <Typography variant="h6" color="primary" component="h2" className="flex items-center gap-2">
          <Icons.CloudServer className="h-6 w-6" />
          S3 Browser: {currentPrefix || '/'}
        </Typography>
        <button onClick={hide} className="text-gray-400 hover:text-white transition-colors">
          <Icons.Close className="h-6 w-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar" style={{ minHeight: '350px' }}>
        {loading ? (
          <div className="flex flex-col h-full items-center justify-center space-y-3 py-12">
            <Icons.LoadingOHIFMark className="h-10 w-10 animate-spin text-purple-500" />
            <Typography variant="subtitle" component="p" className="text-gray-500">Загрузка списка...</Typography>
          </div>
        ) : (
          <div className="space-y-1">
            {currentPrefix && (
              <div
                onClick={handleBack}
                className="flex cursor-pointer items-center space-x-3 rounded-md p-3 hover:bg-gray-800/50 transition-colors group"
              >
                <Icons.ArrowLeft className="h-5 w-5 text-purple-400 group-hover:-translate-x-1 transition-transform" />
                <Typography variant="subtitle" component="span" className="text-purple-300">.. / (Назад)</Typography>
              </div>
            )}
            
            {items.folders.length === 0 && items.files.length === 0 && !loading && (
              <div className="py-16 text-center space-y-3">
                <Icons.Search className="h-12 w-12 mx-auto text-gray-700" />
                <Typography variant="subtitle" color="error" component="p" className="max-w-xs mx-auto">
                  Папка пуста или нет доступа к S3. Откройте консоль (F12) для диагностики CORS.
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
                  <span className="truncate flex-1 font-medium">{folder.replace(currentPrefix, '')}</span>
                  <Icons.ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-white opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              ))}

              {items.files.map(file => (
                <div key={file} className="flex items-center space-x-3 rounded-md p-3 text-gray-500 hover:bg-white/5 transition-colors group">
                  <Icons.ByName name="list-bullets" className="h-5 w-5 text-blue-500 group-hover:text-blue-400" />
                  <span className="truncate flex-1 text-sm">{file.replace(currentPrefix, '')}</span>
                  <span className="text-[10px] text-gray-700 uppercase font-bold tracking-widest hidden group-hover:inline">DICOM</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-5 mt-4">
        <div className="flex flex-col">
          <Typography variant="caption" className="text-gray-500 font-medium">
             Статистика папки
          </Typography>
          <Typography variant="subtitle" component="span" className="text-gray-400 text-xs">
            {items.folders.length} папок, {items.files.length} файлов
          </Typography>
        </div>
        <div className="flex gap-3">
          <Button onClick={hide} variant="outline" color="primary" className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white">
            Отмена
          </Button>
          <Button
            onClick={handleLoadSelected}
            variant="default"
            color="primary"
            className="shadow-lg shadow-purple-900/20 px-6"
            disabled={loading || (!currentPrefix && items.files.length === 0)}
          >
            Загрузить Эту Папку
          </Button>
        </div>
      </div>
    </div>
  );
};

export default S3BrowseModal;
