import React, { useMemo, useState } from 'react';
import { IMPLANT_DATA, IMPLANT_MODEL_COUNT, type ImplantModel } from './implantData';
import { ALL_IMPLANT_MODELS, favoritesFirst } from './implantFavorites';
import { useImplantFavorites } from './useImplantFavorites';
import './ImplantLibraryModal.css';

export default function ImplantLibraryModal({ onSelect, onClose }) {
  const [scope, setScope] = useState<'all' | 'favorites' | 'family'>('all');
  const favorites = useImplantFavorites();
  const { favoriteIds } = favorites;
  const [brandName, setBrandName] = useState(IMPLANT_DATA[0].manufacturer);
  const brand = IMPLANT_DATA.find(item => item.manufacturer === brandName);
  const [familyName, setFamilyName] = useState(brand.lines[0].name);
  const [query, setQuery] = useState('');
  const [diameter, setDiameter] = useState('');
  const [length, setLength] = useState('');
  const [gingivalHeight, setGingivalHeight] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const family = brand.lines.find(item => item.name === familyName) || brand.lines[0];
  const availableModels = scope === 'family' ? family.models : ALL_IMPLANT_MODELS;
  const models = useMemo(
    () =>
      favoritesFirst(
        availableModels.filter(
          model =>
            (scope !== 'favorites' || favoriteIds.includes(model.id)) &&
            (!diameter || model.dimensions.diameter === Number(diameter)) &&
            (!length || model.dimensions.length === Number(length)) &&
            (!gingivalHeight || model.gingivalHeight === Number(gingivalHeight)) &&
            `${model.manufacturer} ${model.name} ${model.id}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())
        ),
        favoriteIds
      ),
    [availableModels, scope, favoriteIds, query, diameter, length, gingivalHeight]
  );
  const favoriteModels = models.filter(model => favoriteIds.includes(model.id));
  const otherModels = models.filter(model => !favoriteIds.includes(model.id));
  const selected = models.find(model => model.id === selectedId);
  const reset = () => {
    setSelectedId(null);
    setDiameter('');
    setLength('');
    setGingivalHeight('');
    setQuery('');
  };
  const sizes = (key: 'diameter' | 'length') =>
    [...new Set(availableModels.map(model => model.dimensions[key]))].sort((a, b) => a - b);
  const heights = [
    ...new Set(
      availableModels.map(model => model.gingivalHeight).filter(value => value !== undefined)
    ),
  ].sort((a, b) => a - b);
  const sourceUrl = selected?.sourceUrl || (scope === 'family' ? family.sourceUrl : null);
  const renderModel = (model: ImplantModel) => {
    const favorite = favoriteIds.includes(model.id);
    return (
      <li
        className="implant-model-row"
        key={model.id}
      >
        <button
          type="button"
          className="implant-model-select"
          aria-label={`Выбрать ${model.manufacturer} ${model.name}`}
          aria-pressed={selected?.id === model.id}
          onClick={() => setSelectedId(model.id)}
        >
          <span>{model.name}</span>
          <small>
            {model.manufacturer} · {model.id}
          </small>
        </button>
        <button
          type="button"
          className="implant-favorite-button"
          aria-label={`${favorite ? 'Убрать из избранного' : 'Добавить в избранное'}: ${model.manufacturer} ${model.name}`}
          aria-pressed={favorite}
          title={favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
          disabled={!favorites.ready || favorites.busy}
          onClick={event => {
            event.stopPropagation();
            favorites.toggle(model.id);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill={favorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          >
            <path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91L12 3Z" />
          </svg>
        </button>
      </li>
    );
  };
  return (
    <div className="implant-library">
      <header className="implant-library-heading">
        <div>
          <h3>Библиотека имплантов</h3>
          <p>
            {IMPLANT_MODEL_COUNT} типоразмеров ·{' '}
            {IMPLANT_DATA.map(item => item.manufacturer).join(', ')}
          </p>
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
          <h4>Моя библиотека</h4>
          <button
            type="button"
            data-selected={scope === 'all'}
            onClick={() => {
              setScope('all');
              reset();
            }}
          >
            <span>Все импланты</span>
            <small>{IMPLANT_MODEL_COUNT}</small>
          </button>
          <button
            type="button"
            data-selected={scope === 'favorites'}
            onClick={() => {
              setScope('favorites');
              reset();
            }}
          >
            <span>★ Избранное</span>
            <small>{favoriteIds.length}</small>
          </button>
          <h4>Производители</h4>
          {IMPLANT_DATA.map(item => (
            <button
              type="button"
              key={item.manufacturer}
              data-selected={scope === 'family' && brandName === item.manufacturer}
              onClick={() => {
                setBrandName(item.manufacturer);
                setScope('family');
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
                data-selected={scope === 'family' && family.name === item.name}
                onClick={() => {
                  setFamilyName(item.name);
                  setScope('family');
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
                Диаметр тела
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
              {heights.length > 0 && (
                <label>
                  Шейка (G/H)
                  <select
                    aria-label="Высота шейки импланта"
                    value={gingivalHeight}
                    onChange={event => {
                      setGingivalHeight(event.target.value);
                      setSelectedId(null);
                    }}
                  >
                    <option value="">Все</option>
                    {heights.map(value => (
                      <option
                        key={value}
                        value={value}
                      >
                        {value} мм
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
          <div className="implant-model-count">
            {scope === 'all' ? 'Все импланты' : scope === 'favorites' ? 'Избранное' : family.name} ·
            найдено {models.length}
          </div>
          <div className="implant-model-list">
            {favoriteModels.length > 0 && (
              <section aria-label="Избранные импланты">
                <h4>★ Избранное</h4>
                <ul aria-label="Избранные типоразмеры имплантов">
                  {favoriteModels.map(renderModel)}
                </ul>
              </section>
            )}
            {otherModels.length > 0 && (
              <section>
                {favoriteModels.length > 0 && <h4>Остальные импланты</h4>}
                <ul aria-label="Типоразмеры имплантов">{otherModels.map(renderModel)}</ul>
              </section>
            )}
            {!models.length && (
              <p>
                {scope === 'favorites' && !favoriteIds.length
                  ? 'Добавьте нужные типоразмеры в избранное нажатием на звёздочку.'
                  : 'Нет подходящих типоразмеров. Измените фильтры.'}
              </p>
            )}
          </div>
          {favorites.busy && (
            <p
              className="implant-favorites-notice"
              role="status"
            >
              Синхронизация избранного…
            </p>
          )}
          {favorites.error && (
            <div
              className="implant-favorites-notice"
              role="status"
            >
              {favorites.error}{' '}
              <button
                type="button"
                onClick={favorites.reload}
              >
                Повторить загрузку
              </button>
            </div>
          )}
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
              {selected.platformDiameter !== undefined && (
                <p className="implant-platform-details">
                  Платформа Ø {selected.platformDiameter} мм
                  {selected.gingivalHeight !== undefined && (
                    <>
                      <br />
                      Шейка (G/H) {selected.gingivalHeight} мм
                    </>
                  )}
                </p>
              )}
            </>
          ) : (
            <p>Выберите типоразмер из списка</p>
          )}
          <div className="implant-library-source">
            <p>
              Размеры по маркировке производителя. Форма показана условно, без точной резьбы, шейки
              и конусности.
            </p>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Открыть каталог производителя ↗
              </a>
            )}
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
