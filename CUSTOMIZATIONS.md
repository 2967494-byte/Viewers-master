# Кастомы форка (перенос на OHIF 3.13)

Не только UI — ниже полный список того, что нужно сохранить при апгрейде.

## UI / layout
- `modes/segmentation/src/index.tsx` — вертикальный тулбар, скрытие правой панели/шапки, оверлеи viewport, toolbar sections
- `extensions/default/src/ViewerLayout/index.tsx` — `verticalPrimaryToolbar`, флаги шапки
- `extensions/default/src/ViewerLayout/ViewerHeader.tsx` — undo/redo/patient/menu toggles
- `platform/ui-next/src/components/Header/Header.tsx` — опциональные правые слоты без пустых разделителей
- `platform/app/src/routes/Local/Local.tsx` — русские тексты загрузки
- `platform/app/src/routes/index.tsx` — `/` → Local → `segmentation/dicomlocal`

## Функционал (не UI)
- `extensions/cornerstone/src/tools/DentalImplantTool.ts` + регистрация в `initCornerstoneTools.js`
- Dental panorama / implant команды в `extensions/cornerstone/src/commandsModule.ts`
- `extensions/cornerstone/src/hps/mpr2x2.ts` + layout selector
- S3: `useS3Loader.ts`, `S3FileService.ts`, `S3ProgressModal`, `S3BrowseModal`
- Быстрая индексация DICOM: `readDicomMetadataFast.js`, правки `filesToStudies.js`
- Webpack proxy `/s3-proxy`, `/dicomweb` (если есть в `.webpack`)
- `platform/app/public/config/default.js` — кастомный datasource/default

## Инфра / docs
- `install.md`, `SERVER_SETUP.md`, `panorama-server/`
