import React, { useState, useEffect, useCallback } from 'react';
import { s3FileService } from '../../utils/S3FileService';
import { Button, Icons } from '@ohif/ui-next';
import { Typography } from '@ohif/ui';

interface S3BrowseModalProps {
  onLoad: (files: Blob[]) => void;
  onClose: () => void;
}

const S3BrowseModal: React.FC<S3BrowseModalProps> = ({ onLoad, onClose }) => {
const S3BrowseModal = ({ onLoad, onConfirm, hide }) => {
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
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Typography variant="subtitle" component="p" className="">Loading...</Typography>
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
                  Failed to fetch items from S3. Please check your credentials and bucket CORS settings.
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
          Total: {items.folders.length} folders, {items.files.length} files
        </Typography>
        <div className="space-x-2">
          <Button onClick={hide} variant="outline" color="primary">
            Cancel
          </Button>
          <Button
            onClick={handleLoadSelected}
            variant="default"
            color="primary"
            disabled={!currentPrefix && items.files.length === 0}
          >
            Load Current Folder
          </Button>
        </div>
      </div>
    </div>
  );
};

export default S3BrowseModal;

export default S3BrowseModal;
