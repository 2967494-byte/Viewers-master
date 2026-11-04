# Справка: S3-загрузка Orbital3D Viewer (Stage 1)

Дата: 28 октября 2026.
VPS: `95.163.231.17` (Nginx только `127.0.0.1:8080`).
Туннель: `http://127.0.0.1:18080/3dviewer/`
Актуальный релиз на момент вечера: **`20261028T201217Z-7d37627`**.

---

## Что сделано сегодня

### Инфраструктура Stage 1
- Production-сборка standalone-просмотрщика выложена на VPS под `/releases/<id>/3dviewer/`.
- Доступ через SSH-туннель на localhost:18080 (secure context / SAB).
- Кнопка **«Загрузить из S3»** на стартовом экране Local; путь вида `hot/.../Data/`.
- Ключи S3 вводятся в модалке (sessionStorage), в бандл не зашиты.
- Endpoint: `https://storage.yandexcloud.net`, bucket: `orbital3d-hot-storage`.

### Путь загрузки S3 (код)
| Компонент | Назначение |
|-----------|------------|
| `S3FileService.ts` | AWS SDK, path-style, List/GetObject, поиск `ohif_metadata.json` вверх по родителям |
| `useS3Loader.ts` | Оркестрация: сначала индекс, иначе list + пофайловая индексация |
| `processS3Dicom.ts` | Fallback: префикс метаданных / полный DICOM |
| `orbitalS3ImageLoader.ts` | Схема `orbitals3:` — пиксели через SDK GetObject по требованию |
| `S3ProgressModal.tsx` | UI прогресса медленного пути (без индекса) |

### Fast path по `ohif_metadata.json`
- Uploader уже кладёт индекс, например:
  `hot/2026/10/28/pat_…/appt_…/ohif_metadata.json`
- UI обычно открывает:
  `…/appt_…/…/Data/`
- **Баг:** искали только `…/Data/ohif_metadata.json` → индекс не находился → шла долгая пофайловая «индексация».
- **Исправлено в `20261028T201217Z`:** поиск JSON в текущем prefix и родительских папках (до 5 уровней); list объектов только если индекса нет; `_url`/`url` резолвятся в `orbitals3:<key>`.

### Промежуточные релизы / грабли
- Белые экраны из‑за `PUBLIC_URL` ≠ путь релиза — учтено в сборке/деплое.
- Presigned URL / ручной SignatureV4 для wadouri оказались хрупкими → пиксели через SDK (`orbitals3:`).
- Пакет `@aws-sdk/s3-request-presigner` ломал webpack (exports `@aws-sdk/core`) — убран.
- Деплой zip ~36 МБ на VPS занимает ~3 мин; иногда казалось «зависанием».

---

## Что видит пользователь сейчас (вечер 28.10)

Наблюдение:
1. **~2 минуты** — «индексация метаданных» (или этап до открытия).
2. **~5–8 минут** — «загрузка слоёв».
3. **Прогресс-бар не двигается** (или почти не двигается) на стартовом экране / при догрузке.

Ожидание было: при наличии `ohif_metadata.json` открытие за секунды, пиксели — по мере показа в viewport.

Фактически до целевого UX «≤1 минута до первого полезного кадра» **не дошли**.

---

## Оставшиеся проблемы (продолжить завтра)

### 1. Fast path, похоже, всё ещё не «мгновенный» или не срабатывает полностью
Возможные причины проверить:
- В консоли есть ли `Fast Path: Using pre-generated metadata index` и путь к JSON?
- Формат JSON: массив инстансов, `_url` относительный к папке JSON или абсолютный key?
- Достаточно ли тегов для volume (ImagePositionPatient, orientation, spacing, Rows/Columns…)? Иначе OHIF долго строит volume / падает в тяжёлый путь.
- Нужна ли натурализация DICOM JSON (`0020000D` → `StudyInstanceUID`) перед `DicomMetadataStore.addInstance`?
- После Ctrl+F5 точно открыт релиз `201217Z`, а не кэш старого бандла?

### 2. Загрузка слоёв 5–8 минут
Даже с индексом метаданных **каждый срез для MPR/volume всё равно качается** через `orbitals3:` → полный GetObject.
Канал к Yandex ~**420 КБ/с** — потолок; concurrency почти не помогает.
Итог: сотни срезов × размер файла ≈ минуты до полного volume.

Нужно (идеи):
- progressive open: первый срез / частичный volume сразу, остальное в фоне;
- не строить полный volume до готовности N срезов;
- сжатие DICOM / меньший сериал для просмотра;
- кэш/CDN ближе к врачу (уже инфраструктура);
- опционально: не грузить все серии сразу.

### 3. Прогресс-бар «не едет»
На стартовом Local прогресс часто пишется в DOM (`#indexing-progress`, `#indexing-bar`) точечно (20% → 80% → navigate), **без** плавного трекинга догрузки пикселей в viewer.
`S3ProgressModal` показывает прогресс только на **медленном** пути (нет JSON).
На fast path и при загрузке слоёв в Cornerstone **отдельного прогресса нет** — это баг UX, не обязательно сети.

Сделать завтра:
- явный статус «индекс найден / N инстансов»;
- прогресс догрузки volume (loaded / total imageIds) в layout viewer;
- не оставлять «залипший» бар на 0–20%.

### 4. Range / префикс без индекса
Если JSON нет: Range может упираться в CORS → fallback на полный GET / stream-abort → снова медленно.
С индексом этот путь не должен быть основным.

### 5. Вне скоупа Stage 1 (не забывать)
- CRM / DNS / публичный HTTPS;
- CORS bucket (добавить `Range`, если понадобится);
- генерация/расположение `ohif_metadata.json` на стороне Uploader (сейчас файл есть, путь — appt-root).

---

## Как проверять завтра

1. Туннель: `python tmp/start_viewer_tunnel.py` (нужен `ORBITAL_VPS_PASSWORD`).
2. Открыть `http://127.0.0.1:18080/3dviewer/` → **Ctrl+F5**.
3. Загрузить путь к `…/Data/` того же исследования.
4. DevTools → Console: строки `S3 metadata index found:` / `Fast Path:…`.
5. Network: один GET `ohif_metadata.json`, затем GetObject только по видимым/нужным срезам (не сразу сотни).
6. Сверить `http://127.0.0.1:18080/build-info.json` → `releaseId`.

---

## Ключевые файлы

```
platform/app/src/utils/S3FileService.ts
platform/app/src/utils/useS3Loader.ts
platform/app/src/utils/processS3Dicom.ts
platform/app/src/utils/orbitalS3ImageLoader.ts
platform/app/src/components/S3ProgressModal/S3ProgressModal.tsx
platform/app/src/components/S3BrowseModal/S3BrowseModal.tsx
platform/app/public/config/standalone.js
tmp/stage1_package_and_deploy.py
tmp/start_viewer_tunnel.py
docs/specs/viewer-vps-stage1-report.md
S3_METADATA_INDEX_SPEC.md
```

---

## Цель на завтра (кратко)

1. Подтвердить, что `ohif_metadata.json` с appt-root реально подхватывается (логи + Network).
2. Если подхватывается — ускорить/отложить полную загрузку слоёв (progressive + прогресс в viewer).
3. Если нет — починить формат/`_url`/натурализацию JSON.
4. Починить видимый progress bar на всём пути до первого кадра и догрузки volume.

## Продолжение: локальные исправления

Внесены и проверены изменения поиска индекса, нормализации DICOM JSON,
идентификаторов S3-изображений, ограничения SDK GET и индикатора volume.
Подробности, воспроизведённые дефекты, ограничения проверки и приёмка:
[viewer-s3-load-fix-2026-10-28.md](viewer-s3-load-fix-2026-10-28.md).
На VPS эти изменения пока не опубликованы; прежние замеры выше остаются
результатами релиза `20261028T201217Z-7d37627`.
