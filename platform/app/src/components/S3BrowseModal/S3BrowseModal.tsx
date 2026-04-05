import React, { useState, useEffect, useCallback } from 'react';
import { s3FileService } from '../../utils/S3FileService';
import { Button, Icons } from '@ohif/ui-next';
import { Typography } from '@ohif/ui';

interface S3BrowseModalProps {
  onLoad: (files: Blob[]) => void;
  onClose: () => void;
}

const S3BrowseModal: React.FC<S3BrowseModalProps> = ({ onLoad, onClose }) => {
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const fetchItems = useCallback(async (prefix: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await s3FileService.listPrefixes(prefix);
      setFolders(response.folders);
      setFiles(response.files);
      setCurrentPrefix(prefix);
      setSelectedFolder(null); // Reset selection when moving
    } catch (err) {
      setError('Failed to fetch items from S3. Please check your credentials and bucket CORS settings.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems('');
  }, [fetchItems]);

  const handleFolderClick = (folder: string) => {
    fetchItems(folder);
  };

  const handleBack = () => {
    if (currentPrefix === '') return;
    const parts = currentPrefix.split('/').filter(Boolean);
    parts.pop();
    const newPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    fetchItems(newPrefix);
  };

  const handleSelectFolder = (folder: string) => {
    setSelectedFolder(folder === selectedFolder ? null : folder);
  };

  const handleLoadSelected = async () => {
    const targetPrefix = selectedFolder || currentPrefix;
    if (!targetPrefix && !files.length) return;

    setLoading(true);
    try {
      const allKeys = await s3FileService.listAllObjects(targetPrefix);
      // Filter for files only (S3 might list the folder itself)
      const fileKeys = allKeys.filter(key => !key.endsWith('/'));
      
      const blobs: Blob[] = await Promise.all(
        fileKeys.map(key => s3FileService.getObjectAsBlob(key))
      );
      
      onLoad(blobs);
    } catch (err) {
      setError('Failed to download files from S3.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col bg-black h-[500px] w-full p-4 select-none">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <Typography variant="h6" className="text-white whitespace-nowrap">S3 Browser:</Typography>
          <Typography variant="subtitle1" className="text-gray-400 truncate">
            {currentPrefix || '/'}
          </Typography>
        </div>
        <div className="flex gap-2">
          {currentPrefix !== '' && (
            <Button variant="secondary" size="sm" onClick={handleBack}>
              Back
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
             <Icons.Close className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="flex-grow overflow-y-auto border border-gray-800 rounded bg-gray-900 p-2 mb-4 custom-scrollbar">
        {loading && (
          <div className="flex justify-center items-center h-full">
            <Icons.LoadingSpinner className="w-8 h-8 text-primary-active animate-spin" />
          </div>
        )}
        
        {error && (
          <div className="text-red-500 p-4 text-center">
            {error}
          </div>
        )}

        {!loading && !error && (
          <ul className="space-y-1 text-sm">
            {folders.map(folder => (
              <li 
                key={folder} 
                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                  selectedFolder === folder ? 'bg-primary-main text-white' : 'hover:bg-gray-800 text-gray-300'
                }`}
                onClick={() => handleFolderClick(folder)}
                onContextMenu={(e) => {
                    e.preventDefault();
                    handleSelectFolder(folder);
                }}
              >
                <Icons.Database className="w-4 h-4 text-primary-light" />
                <span className="truncate">{folder.replace(currentPrefix, '')}</span>
              </li>
            ))}
            {files.map(file => (
              <li key={file} className="flex items-center gap-2 p-2 text-gray-500 italic">
                <Icons.Series className="w-4 h-4 text-gray-600" />
                <span className="truncate">{file.replace(currentPrefix, '')}</span>
              </li>
            ))}
            {folders.length === 0 && files.length === 0 && (
              <li className="text-gray-600 italic p-4 text-center">Empty directory</li>
            )}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-3 mt-auto pt-2 border-t border-gray-800">
         <Typography variant="caption" className="text-gray-500 self-center flex-grow italic">
            Click to enter folder, Right-click to select folder for loading.
         </Typography>
        <Button 
          variant="secondary" 
          onClick={onClose}
          disabled={loading}
        >
          Cancel
        </Button>
        <Button 
          variant="default" 
          onClick={handleLoadSelected}
          disabled={loading || (!selectedFolder && folders.length > 0 && !files.length)}
        >
          {loading ? 'Processing...' : 'Load Current Folder'}
        </Button>
      </div>
    </div>
  );
};

export default S3BrowseModal;
