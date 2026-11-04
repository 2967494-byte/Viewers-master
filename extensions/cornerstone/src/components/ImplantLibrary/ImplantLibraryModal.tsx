import React, { useMemo, useState } from 'react';
import { IMPLANT_DATA, IMPLANT_MODEL_COUNT, type ImplantModel } from './implantData';
import './ImplantLibraryModal.css';

export default function ImplantLibraryModal({ onSelect, onClose }) {
  const [brandName, setBrandName] = useState(IMPLANT_DATA[0].manufacturer);
  const brand = IMPLANT_DATA.find(item => item.manufacturer === brandName);
  const [familyName, setFamilyName] = useState(brand.lines[0].name);
  const [query, setQuery] = useState('');
  const [diameter, setDiameter] = useState('');
  const [length, setLength] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const family = brand.lines.find(item => item.name === familyName) || brand.lines[0];
  const models = useMemo(
    () =>
      family.models.filter(
        model =>
          (!diameter || model.dimensions.diameter === Number(diameter)) &&
          (!length || model.dimensions.length === Number(length)) &&
          `${model.name} ${model.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      ),
    [family, query, diameter, length]
  );
  const selected = models.find(model => model.id === selectedId);
  const reset = () => {
    setSelectedId(null);
    setDiameter('');
    setLength('');
    setQuery('');
  };
  const sizes = (key: 'diameter' | 'length') =>
    [...new Set(family.models.map(model => model.dimensions[key]))].sort((a, b) => a - b);
  return (
    <div className="implant-library">
      <header className="implant-library-heading">
        <div>
          <h3>Библиотека имплантов</h3>
          <p>{IMPLANT_MODEL_COUNT} типоразмеров · Straumann, Nobel Biocare, Osstem</p>
        </div>
        <button
          type="button"
          className="implant-library-close"
          onClick={onClose}
          aria-label="Закрыть библиотеку имплантов"
        >
          ×
        </button>
      </header>
      <div className="implant-library-body">
        <aside aria-label="Производители имплантов">
          <h4>Производители</h4>
          {IMPLANT_DATA.map(item => (
            <button
              type="button"
              key={item.manufacturer}
              data-selected={brandName === item.manufacturer}
              onClick={() => {
                setBrandName(item.manufacturer);
                setFamilyName(item.lines[0].name);
                reset();
              }}
            >
              <span>{item.manufacturer}</span>
              <small>{item.lines.reduce((sum, line) => sum + line.models.length, 0)}</small>
            </button>
          ))}
          <h4>Линейки</h4>
          <div className="implant-family-list">
            {brand.lines.map(item => (
              <button
                type="button"
                key={item.name}
                data-selected={family.name === item.name}
                onClick={() => {
                  setFamilyName(item.name);
                  reset();
                }}
              >
                <span>{item.name}</span>
                <small>{item.models.length}</small>
              </button>
            ))}
          </div>
        </aside>
        <main>
          <div className="implant-library-filters">
            <input
              type="search"
              aria-label="Поиск импланта"
              placeholder="Название или код модели"
              value={query}
              onChange={event => {
                setQuery(event.target.value);
                setSelectedId(null);
              }}
            />
            <div>
              <label>
                Диаметр
                <select
                  aria-label="Диаметр импланта"
                  value={diameter}
                  onChange={event => {
                    setDiameter(event.target.value);
                    setSelectedId(null);
                  }}
                >
                  <option value="">Все</option>
                  {sizes('diameter').map(value => (
                    <option
                      key={value}
                      value={value}
                    >
                      Ø {value} мм
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Длина
                <select
                  aria-label="Длина импланта"
                  value={length}
                  onChange={event => {
                    setLength(event.target.value);
                    setSelectedId(null);
                  }}
                >
                  <option value="">Все</option>
                  {sizes('length').map(value => (
                    <option
                      key={value}
                      value={value}
                    >
                      {value} мм
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="implant-model-count">
            {family.name} · найдено {models.length}
          </div>
          <div
            className="implant-model-list"
            role="listbox"
            aria-label="Типоразмеры имплантов"
          >
            {models.map(model => (
              <button
                type="button"
                role="option"
                aria-selected={selected?.id === model.id}
                key={model.id}
                onClick={() => setSelectedId(model.id)}
              >
                <span>{model.name}</span>
                <small>{model.id}</small>
              </button>
            ))}
            {!models.length && <p>Нет подходящих типоразмеров. Измените фильтры.</p>}
          </div>
        </main>
        <section
          className="implant-library-preview"
          aria-label="Предпросмотр импланта"
        >
          <h4>Предпросмотр</h4>
          {selected ? (
            <>
              <ImplantPreview model={selected} />
              <strong>{selected.manufacturer}</strong>
              <span>{selected.family}</span>
              <p>
                Ø {selected.dimensions.diameter} × {selected.dimensions.length} мм
              </p>
            </>
          ) : (
            <p>Выберите типоразмер из списка</p>
          )}
          <div className="implant-library-source">
            <p>
              Размеры по маркировке производителя. Форма показана условно, без точной резьбы, шейки
              и конусности.
            </p>
            <a
              href={family.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Открыть каталог производителя ↗
            </a>
          </div>
        </section>
      </div>
      <footer>
        <span>{selected ? selected.name : 'Выберите имплант для установки'}</span>
        <button
          type="button"
          onClick={onClose}
        >
          Отмена
        </button>
        <button
          type="button"
          className="implant-library-add"
          disabled={!selected}
          onClick={() => {
            if (selected) onSelect(selected);
          }}
        >
          Установить имплант
        </button>
      </footer>
    </div>
  );
}

function ImplantPreview({ model }: { model: ImplantModel }) {
  const height = model.dimensions.length * 8;
  const width = model.dimensions.diameter * 8;
  const top = (200 - height) / 2,
    left = 85 - width / 2;
  return (
    <svg
      viewBox="0 0 190 215"
      className="implant-preview-svg"
      role="img"
      aria-label={`Схематический имплант, диаметр ${model.dimensions.diameter} мм, длина ${model.dimensions.length} мм`}
    >
      <path
        d={`M${left} ${top}h${width}v${height}h-${width}z`}
        fill={model.color}
        fillOpacity="0.35"
        stroke={model.color}
        strokeWidth="1.5"
      />
      <path
        d={`M${left + width + 15} ${top}v${height} M${left + width + 11} ${top}h8 M${left + width + 11} ${top + height}h8 M${left} ${top + height + 15}h${width}`}
        fill="none"
        stroke="#94a3b8"
      />
      <text
        x={left + width + 22}
        y="102"
        fill="#e2e8f0"
        fontSize="11"
      >
        {model.dimensions.length} мм
      </text>
      <text
        x="85"
        y={top + height + 30}
        textAnchor="middle"
        fill="#e2e8f0"
        fontSize="11"
      >
        Ø {model.dimensions.diameter} мм
      </text>
    </svg>
  );
}
