import React, { useState } from 'react';
import { IMPLANT_DATA } from './implantData';

const ImplantLibraryModal = ({ onSelect, onClose }) => {
  const [selectedManufacturer, setSelectedManufacturer] = useState(IMPLANT_DATA[0]);
  const [selectedLine, setSelectedLine] = useState(IMPLANT_DATA[0].lines[0]);
  const [selectedModel, setSelectedModel] = useState(null);

  const handleManufacturerChange = (manufacturer) => {
    setSelectedManufacturer(manufacturer);
    setSelectedLine(manufacturer.lines[0]);
    setSelectedModel(null);
  };

  const handleLineChange = (line) => {
    setSelectedLine(line);
    setSelectedModel(null);
  };

  return (
    <div className="flex flex-col h-[500px] w-[800px] bg-primary-dark text-white rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary-dark border-b border-secondary-light">
        <h3 className="text-lg font-semibold">Implant Library</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Navigation Tree */}
        <div className="w-1/3 border-r border-secondary-light p-2 overflow-y-auto bg-primary-dark">
          <div className="mb-4">
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Manufacturers</h4>
            <ul>
              {IMPLANT_DATA.map((manufacturer) => (
                <li key={manufacturer.manufacturer}>
                  <button
                    onClick={() => handleManufacturerChange(manufacturer)}
                    className={`w-full text-left px-3 py-2 rounded text-sm ${
                      selectedManufacturer === manufacturer
                        ? 'bg-secondary-active text-white'
                        : 'text-gray-300 hover:bg-secondary-dark'
                    }`}
                  >
                    {manufacturer.manufacturer}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {selectedManufacturer && (
            <div>
              <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Product Lines</h4>
              <ul>
                {selectedManufacturer.lines.map((line) => (
                  <li key={line.name}>
                    <button
                      onClick={() => handleLineChange(line)}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${
                        selectedLine === line
                          ? 'bg-secondary-active text-white'
                          : 'text-gray-300 hover:bg-secondary-dark'
                      }`}
                    >
                      {line.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Middle Panel: Model List */}
        <div className="w-1/3 border-r border-secondary-light p-2 overflow-y-auto bg-primary-dark">
          <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Models</h4>
          {selectedLine ? (
            <ul>
              {selectedLine.models.map((model) => (
                <li key={model.id}>
                  <button
                    onClick={() => setSelectedModel(model)}
                    className={`w-full text-left px-3 py-2 rounded text-sm border border-transparent ${
                      selectedModel === model
                        ? 'bg-secondary-active border-primary-active text-white'
                        : 'text-gray-300 hover:bg-secondary-dark'
                    }`}
                  >
                    <div className="font-semibold">{model.name}</div>
                    <div className="text-xs text-gray-400">
                      L: {model.dimensions.length}mm | Ø: {model.dimensions.diameter}mm
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-gray-500 text-sm text-center mt-10">Select a product line</div>
          )}
        </div>

        {/* Right Panel: Preview (Placeholder) */}
        <div className="w-1/3 p-4 bg-black flex flex-col items-center justify-center">
          <h4 className="text-xs font-bold text-gray-500 uppercase mb-4 self-start">Preview</h4>
          {selectedModel ? (
            <div className="flex flex-col items-center">
              <div
                className="mb-4 bg-gray-800 border border-gray-600 flex items-center justify-center"
                style={{
                    width: '100px',
                    height: '150px',
                }}
              >
                  {/* Schematic Representation */}
                  <div
                    style={{
                        width: `${selectedModel.dimensions.diameter * 10}px`,
                        height: `${selectedModel.dimensions.length * 10}px`,
                        backgroundColor: selectedModel.color,
                        opacity: 0.8
                    }}
                  ></div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-white">{selectedModel.name}</div>
                <div className="text-sm text-gray-400">{selectedModel.id}</div>
              </div>
            </div>
          ) : (
             <div className="text-gray-500 text-sm">Select a model to preview</div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-secondary-dark border-t border-secondary-light flex justify-end space-x-2">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-transparent hover:bg-gray-700 text-white rounded text-sm"
        >
          Cancel
        </button>
        <button
          onClick={() => {
             if(selectedModel) onSelect(selectedModel);
          }}
          disabled={!selectedModel}
          className={`px-4 py-2 rounded text-sm font-semibold ${
            selectedModel
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
          }`}
        >
          Add Implant
        </button>
      </div>
    </div>
  );
};

export default ImplantLibraryModal;
