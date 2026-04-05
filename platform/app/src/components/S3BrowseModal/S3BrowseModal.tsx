import React, { useState, useEffect, useCallback } from 'react';
import { s3FileService } from '../../utils/S3FileService';
import { Button, Icons } from '@ohif/ui-next';
import { Typography } from '@ohif/ui';

interface S3BrowseModalProps {
  onLoad: (files: Blob[]) => void;
  hide: () => void;
}

const S3BrowseModal: React.FC<S3BrowseModalProps> = ({ onLoad, hide }) => {
  const [items, setItems] = useState({ folders: [], files: [] });
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });

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
    setLoading(true);
    try {
      const allKeys = await s3FileService.listAllObjects(currentPrefix);
      const fileKeys = allKeys.filter(key => !key.endsWith('/'));

      if (fileKeys.length === 0) {
        alert('No files found in this folder!');
        setLoading(false);
        return;
      }

      setDownloadProgress({ current: 0, total: fileKeys.length });
      
      const blobs: Blob[] = [];
      const BATCH_SIZE = 10;
      
      for (let i = 0; i < fileKeys.length; i += BATCH_SIZE) {
        const batch = fileKeys.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(key => s3FileService.getObjectAsBlob(key))
        );
        blobs.push(...results);
        setDownloadProgress({ current: Math.min(i + BATCH_SIZE, fileKeys.length), total: fileKeys.length });
      }
      
      onLoad(blobs);
    } catch (err) {
      console.error('Failed to download S3 study:', err);
      alert('Error downloading from S3. Check CORS or credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col bg-black text-white" style={{ minWidth: '500px', maxHeight: '80vh' }}>
      <div className="flex items-center justify-between border-b border-gray-700 p-4">
        <Typography variant="h6" color="primary" component="h2" className="">
          S3 Browser: {currentPrefix || '/'}
        </Typography>
        <button onClick={hide} className="text-gray-400 hover:text-white">
          <Icons.Close className="h-6 w-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4" style={{ minHeight: '300px' }}>
        {loading && downloadProgress.total === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Typography variant="subtitle" component="p" className="">Loading list...</Typography>
          </div>
        ) : loading && downloadProgress.total > 0 ? (
           <div className="flex flex-col h-full items-center justify-center space-y-4">
             <div className="w-full bg-gray-700 rounded-full h-2.5">
               <div 
                 className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                 style={{ width: `${(downloadProgress.current / downloadProgress.total) * 100}%` }}
               ></div>
             </div>
             <Typography variant="subtitle" component="p" className="">
               Downloading: {downloadProgress.current} / {downloadProgress.total} files
             </Typography>
           </div>
        ) : (
          <div className="space-y-1">
            {currentPrefix && (
              <div
                onClick={handleBack}
                className="flex cursor-pointer items-center space-x-2 rounded p-2 hover:bg-gray-800"
              >
                <Icons.ArrowLeft className="h-5 w-5 text-blue-400" />
                <Typography variant="subtitle" component="span" className="">.. / (Back)</Typography>
              </div>
            )}
            
            {items.folders.length === 0 && items.files.length === 0 && !loading && (
              <div className="py-10 text-center">
                <Typography variant="subtitle" color="error" component="p" className="">
                  No items found or failed to fetch. Check S3 CORS settings.
                </Typography>
              </div>
            )}

            {items.folders.map(folder => (
              <div
                key={folder}
                onClick={() => handleFolderClick(folder)}
                className="flex cursor-pointer items-center space-x-2 rounded p-2 hover:bg-gray-800"
              >
                <Icons.Database className="h-5 w-5 text-yellow-500" />
                <span className="truncate">{folder.replace(currentPrefix, '')}</span>
              </div>
            ))}

            {items.files.map(file => (
              <div key={file} className="flex items-center space-x-2 rounded p-2 text-gray-400 hover:bg-gray-800">
                <Icons.ByName name="list-bullets" className="h-5 w-5 text-blue-400" />
                <span className="truncate">{file.replace(currentPrefix, '')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-700 p-4 bg-gray-900">
        <Typography variant="subtitle" component="span" className="">
          {items.folders.length} folders, {items.files.length} files
        </Typography>
        <div className="space-x-2">
          <Button onClick={hide} variant="outline" color="primary">
            Cancel
          </Button>
          <Button
            onClick={handleLoadSelected}
            variant="default"
            color="primary"
            disabled={loading || (!currentPrefix && items.files.length === 0)}
          >
            {loading ? 'Processing...' : 'Load Current Folder'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default S3BrowseModal;
