import React, { useEffect, useState } from 'react';
import { getEnabledElement, eventTarget, Enums } from '@cornerstonejs/core';
import { annotation, Enums as ToolEnums } from '@cornerstonejs/tools';
import { IMPLANT_DATA } from './implantData';
import { implantAngles, implantAxisFromAngles } from '../../tools/implantGeometry';
import type { Point3 } from '../../tools/dentalGeometry';
import './ImplantEditor.css';

const models = IMPLANT_DATA.flatMap(brand => brand.lines.flatMap(line => line.models));
const EDIT = 'orbital:implant-edit',
  UPDATED = 'orbital:implant-updated';
function draftFor(item) {
  const [start, end] = item.data.handles.points;
  const angles = implantAngles(start, end);
  return {
    ...angles,
    frontal: Number(angles.frontal.toFixed(2)),
    sagittal: Number(angles.sagittal.toFixed(2)),
    anglesChanged: false,
    modelId: item.data.implant?.id || '',
    shift: 0,
  };
}

/** One editor belongs to the pane that selected the implant; drafts commit as one history operation. */
export default function ImplantEditor({ element }: { element: HTMLDivElement }) {
  const [owner, setOwner] = useState<any>(null),
    [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState(''),
    [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!element) return;
    const open = event => {
      const detail = event.detail;
      if (detail.element !== element) {
        setOwner(null);
        return;
      }
      setOwner(detail);
      setDraft(draftFor(detail.item));
      setError('');
    };
    const close = () => setOwner(null);
    const disabled = event => {
      if (event.detail?.element === element) close();
    };
    const drag = event => setDragging(!!event.detail.dragging);
    window.addEventListener(EDIT, open);
    window.addEventListener('orbital:implant-drag', drag);
    element.addEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, close);
    eventTarget.addEventListener(Enums.Events.ELEMENT_DISABLED, disabled);
    return () => {
      window.removeEventListener(EDIT, open);
      window.removeEventListener('orbital:implant-drag', drag);
      element.removeEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, close);
      eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, disabled);
    };
  }, [element]);
  useEffect(() => {
    if (!owner) return;
    const sync = () => {
      const viewport = getEnabledElement(element)?.viewport as any;
      if (
        annotation.state.getAnnotation(owner.item.annotationUID) !== owner.item ||
        viewport?.getVolumeId?.() !== owner.item.metadata.dentalVolumeId ||
        !annotation.visibility.isAnnotationVisible(owner.item.annotationUID) ||
        annotation.locking.isAnnotationLocked(owner.item.annotationUID) ||
        !annotation.selection.isAnnotationSelected(owner.item.annotationUID)
      ) {
        setOwner(null);
        return;
      }
      setDraft(draftFor(owner.item));
      setError('');
    };
    const events = [
      ToolEnums.Events.ANNOTATION_MODIFIED,
      ToolEnums.Events.ANNOTATION_REMOVED,
      ToolEnums.Events.ANNOTATION_SELECTION_CHANGE,
      ToolEnums.Events.ANNOTATION_VISIBILITY_CHANGE,
      ToolEnums.Events.ANNOTATION_LOCK_CHANGE,
    ].filter(Boolean);
    events.forEach(name => eventTarget.addEventListener(name, sync));
    window.addEventListener(UPDATED, sync);
    return () => {
      events.forEach(name => eventTarget.removeEventListener(name, sync));
      window.removeEventListener(UPDATED, sync);
    };
  }, [owner, element]);
  if (!owner || !draft) return null;
  const { item, tool } = owner;
  const model =
    models.find(m => m.id === draft.modelId) ||
    (draft.modelId === item.data.implant?.id ? item.data.implant : null);
  const numeric = [draft.frontal, draft.sagittal, draft.shift].every(
    v => v !== '' && Number.isFinite(Number(v))
  );
  const valid =
    model &&
    numeric &&
    Math.abs(Number(draft.frontal)) <= 90 &&
    Math.abs(Number(draft.sagittal)) <= 90 &&
    Math.abs(Number(draft.shift)) <= 100;
  const apply = event => {
    event.preventDefault();
    if (!valid) return;
    const [oldStart, oldEnd] = item.data.handles.points;
    const length = Math.hypot(...oldEnd.map((v, i) => v - oldStart[i]));
    const axis = draft.anglesChanged
      ? implantAxisFromAngles(Number(draft.frontal), Number(draft.sagittal), draft.direction)
      : oldEnd.map((v, i) => (v - oldStart[i]) / length);
    const start = oldStart.map((v, i) => v + axis[i] * Number(draft.shift)) as Point3;
    const end = start.map((v, i) => v + axis[i] * model.dimensions.length) as Point3;
    if (!tool.updateImplant(element, item, [start, end], model))
      setError('Не удалось применить: выберите имплант заново.');
  };
  return (
    <form
      className="implant-editor"
      aria-label="Редактор импланта"
      onSubmit={apply}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          tool.cancel?.(element);
          setOwner(null);
        }
      }}
    >
      <header>
        <strong>Имплант</strong>
        <button
          type="button"
          aria-label="Закрыть редактор импланта"
          onClick={() => setOwner(null)}
        >
          ×
        </button>
      </header>
      <p>Тело — перенос. Голубая ручка — наклон без изменения длины.</p>
      <div className="implant-editor-scroll">
        <fieldset disabled={dragging}>
          <label>
            Типоразмер
            <select
              aria-label="Типоразмер установленного импланта"
              value={draft.modelId}
              onChange={e => setDraft({ ...draft, modelId: e.target.value })}
            >
              {!models.some(m => m.id === draft.modelId) && (
                <option value={draft.modelId}>
                  {item.data.implant?.name || 'Выберите модель'}
                </option>
              )}
              {IMPLANT_DATA.map(brand => (
                <optgroup
                  key={brand.manufacturer}
                  label={brand.manufacturer}
                >
                  {brand.lines.flatMap(line =>
                    line.models.map(m => (
                      <option
                        key={m.id}
                        value={m.id}
                      >
                        {m.name}
                      </option>
                    ))
                  )}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="implant-editor-direction">
            <button
              type="button"
              onClick={() =>
                setDraft({ ...draft, frontal: 0, sagittal: 0, direction: 1, anglesChanged: true })
              }
            >
              Вертикально вверх
            </button>
            <button
              type="button"
              onClick={() =>
                setDraft({ ...draft, frontal: 0, sagittal: 0, direction: -1, anglesChanged: true })
              }
            >
              Вертикально вниз
            </button>
          </div>
          <div className="implant-editor-angles">
            <label>
              Влево / вправо, °
              <input
                aria-label="Наклон импланта XZ"
                type="number"
                min="-90"
                max="90"
                step="any"
                value={draft.frontal}
                onChange={e => setDraft({ ...draft, frontal: e.target.value, anglesChanged: true })}
              />
            </label>
            <label>
              Вперёд / назад, °
              <input
                aria-label="Наклон импланта YZ"
                type="number"
                min="-90"
                max="90"
                step="any"
                value={draft.sagittal}
                onChange={e =>
                  setDraft({ ...draft, sagittal: e.target.value, anglesChanged: true })
                }
              />
            </label>
          </div>
          <label>
            Смещение вдоль оси, мм
            <input
              aria-label="Смещение импланта вдоль оси"
              type="number"
              min="-100"
              max="100"
              step="any"
              value={draft.shift}
              onChange={e => setDraft({ ...draft, shift: e.target.value })}
            />
          </label>
          <small>Плюс — к вершине. Изменения применяются кнопкой ниже.</small>
          {model?.dimensions && (
            <output>
              Ø {model.dimensions.diameter} × {model.dimensions.length} мм ·{' '}
              {draft.direction > 0 ? 'вверх' : 'вниз'}
            </output>
          )}
        </fieldset>
      </div>
      <button
        type="submit"
        className="implant-editor-apply"
        disabled={dragging || !valid}
      >
        Применить
      </button>
      {error && <p role="alert">{error}</p>}
      <small>Форма условная, по номинальным размерам. Пунктир показывает проекцию оси.</small>
    </form>
  );
}
