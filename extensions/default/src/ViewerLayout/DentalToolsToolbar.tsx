import React, { useEffect, useId, useRef, useState } from 'react';
import './DentalToolsToolbar.css';
import { ORBITAL_MAGNIFICATIONS, normalizeMagnification } from '@ohif/core/src/constants/orbitalTheme';
import useAxesVisibility from '@ohif/core/src/hooks/useAxesVisibility';
import useImageFilter from '@ohif/core/src/hooks/useImageFilter';
import { IMAGE_FILTER_OPTIONS, setImageFilter } from '@ohif/core/src/constants/orbitalImageFilters';

const groups = [
  {
    id: 'ruler',
    title: 'Линейка',
    options: [
      { id: 'length2d', title: 'Линейка 2D', help: 'Две точки на одном срезе.' },
      {
        id: 'length3d',
        title: 'Линейка 3D',
        help: 'Две точки в объёме. Можно выбирать на разных MPR-срезах.',
      },
    ],
  },
  {
    id: 'tape',
    title: 'Измерительная лента',
    options: [
      {
        id: 'tapeLine',
        title: 'Лента: ломаная линия',
        help: 'Отмечайте точки. Двойной щелчок или Enter — завершить.',
      },
      {
        id: 'tapeCurve',
        title: 'Лента: плавная кривая',
        help: 'Отмечайте точки. Двойной щелчок или Enter — завершить.',
      },
    ],
  },
  {
    id: 'angle',
    title: 'Угол',
    options: [
      {
        id: 'angle2d',
        title: 'Угол 2D',
        help: 'Три точки на одном срезе. Вторая точка — вершина угла.',
      },
      { id: 'angle3d', title: 'Угол 3D', help: 'Три точки в объёме. Вторая точка — вершина угла.' },
    ],
  },
];
const canal = {
  id: 'canal',
  title: 'Нарисовать канал',
  help: 'Отмечайте ход канала на MPR-срезах. Двойной щелчок или Enter — завершить. Диаметр отображения — 2 мм.',
};
const implant = {
  id: 'implant',
  title: 'Имплант',
  help: 'Щёлкните на MPR-срезе для установки выбранного импланта. Средняя кнопка — перемещение, правая — масштаб.',
};
const pan = {
  id: 'pan', title: 'Перемещение',
  help: 'Тяните изображение в MPR или 3D левой кнопкой мыши. Срезы и масштаб сохраняются. Esc — навигация.',
};
const options = [...groups.flatMap(group => group.options), canal, implant, pan];

function ToolIcon({ name, spatial = false }: { name: string; spatial?: boolean }) {
  const gradient = useId().replace(/:/g, '');
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradient}
          x1="0"
          y1="0"
          x2="0.7"
          y2="1"
        >
          <stop stopColor="#ffffff" />
          <stop
            offset="0.48"
            stopColor="#cbd2db"
          />
          <stop
            offset="1"
            stopColor="#6c7888"
          />
        </linearGradient>
      </defs>
      {name === 'ruler' && (
        <>
          <path
            d="M2 10h28v12H2z"
            fill={`url(#${gradient})`}
            stroke="#475569"
          />
          <path
            d="M5 10v7 M8 10v4 M11 10v7 M14 10v4 M17 10v7 M20 10v4 M23 10v7 M26 10v4"
            stroke="#475569"
            strokeWidth="1"
          />
          <path
            d="M3 24h26"
            stroke="#e2e8f0"
            strokeWidth="1"
          />
        </>
      )}
      {name === 'tape' && (
        <>
          <path
            d="M6 4c-3 3-2 7 1 9 M27 14c-6-4-17-4-22 1v7c5 8 19 7 24 0v-6z"
            fill={`url(#${gradient})`}
            stroke="#475569"
          />
          <path
            d="M5 15c5 5 18 5 24 0 M8 18v5 M12 20v5 M17 20v5 M22 19v5 M26 17v5"
            stroke="#475569"
            strokeWidth="1"
          />
          <ellipse
            cx="17"
            cy="14"
            rx="7"
            ry="2.5"
            stroke="#475569"
            strokeWidth="1"
          />
          <path
            d="M7 13C3 11 3 7 7 4"
            stroke="#e2e8f0"
          />
        </>
      )}
      {name === 'angle' && (
        <>
          <path
            d="M3 25a13 13 0 0 1 26 0h-8a5 5 0 0 0-10 0z"
            fill={`url(#${gradient})`}
            stroke="#475569"
          />
          <path
            d="M6 22l4 1 M9 16l3 3 M16 12v5 M23 16l-3 3 M26 22l-4 1 M16 25L26 9"
            stroke="#475569"
            strokeWidth="1.2"
          />
          <circle
            cx="16"
            cy="25"
            r="1.8"
            fill="#e2e8f0"
          />
          {spatial && (
            <path
              d="M7 27c-5-6-3-15 3-19 7-5 16-1 19 6"
              stroke="#94a3b8"
              strokeWidth="1"
            />
          )}
        </>
      )}
      {name === 'canal' && (
        <>
          <path
            d="M3 9c3-4 6-2 7 0 1-3 5-3 6 0 2-3 5-3 7 0 3-3 7-1 6 3l-2 11-3-7-3 7-4-7-3 7-3-7-4 7z"
            fill={`url(#${gradient})`}
            stroke="#475569"
            strokeWidth="1.2"
          />
          <path
            d="M4 26c7-6 17 2 24-4"
            stroke="#ff6b61"
            strokeWidth="2.5"
          />
        </>
      )}
      {name === 'implant' && (
        <>
          <path
            d="M9 4h14v6H9z M11 10l2 16 3 3 3-3 2-16z"
            fill={`url(#${gradient})`}
            stroke="#475569"
          />
          <path
            d="M10 13l12-2 M11 17l10-2 M12 21l8-2 M13 25l6-2 M10 6h12"
            stroke="#475569"
            strokeWidth="1.2"
          />
        </>
      )}
      {name === 'navigate' && (
        <>
          <path d="M16 3v26 M3 16h26 M12 7l4-4 4 4 M12 25l4 4 4-4 M7 12l-4 4 4 4 M25 12l4 4-4 4" />
          <circle
            cx="16"
            cy="16"
            r="4"
          />
        </>
      )}
      {name === 'magnify' && (
        <>
          <circle cx="13" cy="13" r="9" />
          <path d="m20 20 9 9 M9 13h8 M13 9v8" />
        </>
      )}
      {name === 'pan' && (
        <path
          d="M10 16V7a2 2 0 0 1 4 0v7-10a2 2 0 0 1 4 0v10-8a2 2 0 0 1 4 0v9-5a2 2 0 0 1 4 0v10c0 6-3 10-9 10-4 0-6-2-8-5l-5-8a2 2 0 0 1 3-2l3 3"
          fill={`url(#${gradient})`}
          stroke="#6c7888"
        />
      )}
      {name === 'axes' && (
        <>
          <path d="M16 3v10m0 6v10M3 16h10m6 0h10 M13 6l3-3 3 3 M26 13l3 3-3 3" />
          <circle cx="16" cy="16" r="2" />
        </>
      )}
      {name === 'filter' && (
        <>
          <rect x="4" y="4" width="24" height="24" rx="2" />
          <path d="M4 12h24 M4 20h24 M12 4v24 M20 4v24" strokeWidth="1" />
          <path d="M4 4h8v8H4z M20 4h8v8h-8z M12 12h8v8h-8z M4 20h8v8H4z M20 20h8v8h-8z" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'delete' && (
        <>
          <path d="M7 9h18 M12 9V5h8v4 M9 9l1 19h12l1-19 M14 13v11 M18 13v11" />
        </>
      )}
    </svg>
  );
}

export default function DentalToolsToolbar({ commandsManager }) {
  const axesVisible = useAxesVisibility();
  const imageFilter = useImageFilter();
  const [active, setActive] = useState('navigate');
  const [implantPlaced, setImplantPlaced] = useState(false);
  const [deleteReady, setDeleteReady] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [magnification, setMagnification] = useState(3);
  const ref = useRef<HTMLDivElement>(null);
  const viewerKeyboardTarget = useRef(false);
  const choose = (tool: string) => {
    commandsManager.run('activateDentalTool', { tool });
    setMenu(null);
  };
  useEffect(() => {
    const changed = (event: CustomEvent) => {
      setActive(event.detail.tool);
      if (event.detail.tool === 'magnify') setMagnification(normalizeMagnification(event.detail.magnification));
      if (event.detail.tool !== 'navigate') setImplantPlaced(false);
    };
    const placed = () => setImplantPlaced(true);
    const drag = (event: CustomEvent) => {
      setDeleteReady(!!event.detail.outside);
      setImplantPlaced(!event.detail.deleted);
    };
    const outside = (event: PointerEvent) => {
      viewerKeyboardTarget.current = !!(event.target as HTMLElement)?.closest?.(
        '[data-viewportid],.automatic-panorama-pane,.manual-raster-frame'
      );
      if (!ref.current?.contains(event.target as Node)) setMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        const target = event.target as HTMLElement;
        if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
          target?.closest?.('input,textarea,select,button,a,[contenteditable]:not([contenteditable=false]),[role=dialog],[role=alertdialog],[role=menu]')) return;
        if (!viewerKeyboardTarget.current && !target?.closest?.('[data-viewportid],.automatic-panorama-pane,.manual-raster-frame')) return;
        if (commandsManager.run('toggleDentalAxes', { fromKeyboard: true }) === true) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if ((event.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable=true]'))
        return;
      if (event.key === 'Escape') {
        setMenu(null);
        setImplantPlaced(false);
        setDeleteReady(false);
        commandsManager.run('activateDentalTool', { tool: 'navigate' });
      }
    };
    window.addEventListener('orbital:dental-tool-changed', changed);
    window.addEventListener('orbital:implant-placed', placed);
    window.addEventListener('orbital:implant-drag', drag);
    document.addEventListener('pointerdown', outside);
    // OHIF's document hotkeys stop bubbling; Escape must also reach the dental toolbar.
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('orbital:dental-tool-changed', changed);
      window.removeEventListener('orbital:implant-placed', placed);
      window.removeEventListener('orbital:implant-drag', drag);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key, true);
    };
  }, [commandsManager]);
  useEffect(() => {
    if (menu) ref.current?.querySelector<HTMLButtonElement>('[role=menuitem], [role=menuitemradio]')?.focus();
  }, [menu]);
  useEffect(() => {
    document.body.classList.toggle('dental-pan-active', active === 'pan');
    return () => document.body.classList.remove('dental-pan-active');
  }, [active]);
  const current = active === 'magnify'
    ? { title: `Лупа ${magnification}×`, help: 'Водите курсором по снимку. Кратность — в меню лупы. Esc — навигация.' }
    : options.find(option => option.id === active);
  return (
    <>
      <div
        className="dental-tools-toolbar"
        role="toolbar"
        aria-label="Измерения и планирование"
        ref={ref}
      >
        <button
          type="button"
          className="dental-header-tool"
          aria-label="Навигация по срезам"
          title="Навигация по срезам (Esc)"
          aria-pressed={active === 'navigate'}
          onClick={() => choose('navigate')}
        >
          <ToolIcon name="navigate" />
        </button>
        <button
          type="button"
          className="dental-header-tool"
          aria-label={pan.title}
          title="Перемещение изображения: тяните левой кнопкой мыши (Esc — навигация)"
          aria-pressed={active === 'pan'}
          onClick={() => choose('pan')}
        >
          <ToolIcon name="pan" />
        </button>
        <button
          type="button"
          className="dental-header-tool"
          aria-label={axesVisible ? 'Скрыть оси координат' : 'Показать оси координат'}
          title={`${axesVisible ? 'Скрыть' : 'Показать'} оси координат (Enter в окне просмотра)`}
          aria-pressed={axesVisible}
          onClick={() => commandsManager.run('toggleDentalAxes')}
        >
          <ToolIcon name="axes" />
        </button>
        <div className="dental-tool-group">
          <button
            type="button"
            className="dental-header-tool"
            aria-label="Фильтры 2D"
            title={`Фильтр всех 2D-окон: ${IMAGE_FILTER_OPTIONS.find(option => option.id === imageFilter).title}`}
            data-active={imageFilter !== 'none'}
            aria-haspopup="menu"
            aria-expanded={menu === 'filter'}
            onClick={() => setMenu(menu === 'filter' ? null : 'filter')}
          >
            <ToolIcon name="filter" />
            <span className="dental-tool-chevron">▾</span>
          </button>
          {menu === 'filter' && (
            <div
              className="dental-tool-menu"
              role="menu"
              aria-label="Обработка всех 2D-окон"
              onKeyDown={event => {
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
                }
              }}
            >
              {IMAGE_FILTER_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={imageFilter === option.id}
                  onClick={() => { setImageFilter(option.id); setMenu(null); }}
                >
                  <span>{option.title}</span>
                  <small>{option.help}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="dental-tool-group">
          <button
            type="button"
            className="dental-header-tool"
            aria-label="Лупа"
            title={`Лупа ${magnification}×: выбрать увеличение`}
            aria-pressed={active === 'magnify'}
            aria-haspopup="menu"
            aria-expanded={menu === 'magnify'}
            onClick={() => setMenu(menu === 'magnify' ? null : 'magnify')}
          >
            <ToolIcon name="magnify" />
            <span className="dental-tool-badge">{magnification}×</span>
            <span className="dental-tool-chevron">▾</span>
          </button>
          {menu === 'magnify' && (
            <div
              className="dental-tool-menu"
              role="menu"
              aria-label="Увеличение лупы"
              onKeyDown={event => {
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
                }
              }}
            >
              {ORBITAL_MAGNIFICATIONS.map(zoom => (
                <button
                  key={zoom}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active === 'magnify' && magnification === zoom}
                  onClick={() => {
                    setMagnification(zoom);
                    setMenu(null);
                    commandsManager.run('activateDentalTool', { tool: 'magnify', magnification: zoom });
                  }}
                >Лупа {zoom}×</button>
              ))}
            </div>
          )}
        </div>
        {groups
          .filter(group => group.id !== 'angle')
          .map(group => {
            const selected = group.options.find(option => option.id === active);
            return (
              <div
                key={group.id}
                className="dental-tool-group"
              >
                <button
                  type="button"
                  className="dental-header-tool"
                  aria-label={group.title}
                  title={selected?.title || group.title}
                  aria-haspopup="menu"
                  aria-expanded={menu === group.id}
                  data-active={!!selected}
                  onClick={() => setMenu(menu === group.id ? null : group.id)}
                >
                  <ToolIcon
                    name={group.id}
                    spatial={selected?.title.includes('3D')}
                  />
                  <span className="dental-tool-badge">
                    {selected?.title.includes('3D') ? '3D' : group.id === 'tape' ? '' : '2D'}
                  </span>
                  <span className="dental-tool-chevron">▾</span>
                </button>
                {menu === group.id && (
                  <div
                    className="dental-tool-menu"
                    role="menu"
                    aria-label={group.title}
                    onKeyDown={event => {
                      const buttons = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
                      );
                      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        buttons[
                          (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
                            buttons.length
                        ]?.focus();
                      }
                    }}
                  >
                    {group.options.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitem"
                        onClick={() => choose(option.id)}
                      >
                        <span>{option.title}</span>
                        <small>{option.help}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        {groups
          .find(group => group.id === 'angle')
          .options.map(option => (
            <button
              key={option.id}
              type="button"
              className="dental-header-tool"
              aria-label={option.title}
              title={option.title}
              aria-pressed={active === option.id}
              onClick={() => choose(option.id)}
            >
              <ToolIcon
                name="angle"
                spatial={option.id === 'angle3d'}
              />
              <span className="dental-tool-badge">{option.id === 'angle3d' ? '3D' : '2D'}</span>
            </button>
          ))}
        <button
          type="button"
          className="dental-header-tool"
          aria-label={canal.title}
          title={canal.title}
          aria-pressed={active === 'canal'}
          onClick={() => choose('canal')}
        >
          <ToolIcon name="canal" />
        </button>
        <button
          type="button"
          className="dental-header-tool"
          aria-label="Библиотека имплантов"
          title="Имплант: выбрать модель и установить"
          aria-pressed={active === 'implant'}
          onClick={() => {
            setMenu(null);
            commandsManager.run('openImplantLibrary');
          }}
        >
          <ToolIcon name="implant" />
        </button>
        <button
          type="button"
          className="dental-header-tool dental-tool-delete"
          aria-label="Удалить выбранное или последнее измерение"
          title="Удалить выбранное или последнее измерение / имплант"
          onClick={() => {
            setMenu(null);
            commandsManager.run('deleteDentalAnnotation');
          }}
        >
          <ToolIcon name="delete" />
        </button>
      </div>
      {(current || implantPlaced || deleteReady) && (
        <div
          className={['dental-tool-instructions', deleteReady && 'dental-delete-instructions']
            .filter(Boolean)
            .join(' ')}
          role="status"
        >
          <strong>
            {deleteReady ? 'Удаление импланта' : current?.title || 'Имплант установлен'}
          </strong>
          <span>
            {deleteReady
              ? 'Отпустите, чтобы удалить. Верните внутрь окна, чтобы оставить.'
              : current?.help ||
                'Перетащите имплант за тело для перемещения, за голубую ручку — для наклона. Отпустите тело за границей окна, чтобы удалить.'}
          </span>
          <button
            type="button"
            aria-label="Завершить работу с инструментом"
            onClick={() => {
              setImplantPlaced(false);
              choose('navigate');
            }}
          >
            Esc · Навигация
          </button>
        </div>
      )}
    </>
  );
}
