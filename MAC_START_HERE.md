# ORBITAL 3D: начать работу на MacBook

Этот репозиторий содержит **исходники нашего просмотрщика**, его тесты и ТЗ приложения врача. Здесь не готовое iOS-приложение: Xcode-проект создаётся на первом этапе плана. Движок используется как основа адаптации; локальная работа в WKWebView ещё должна быть подтверждена этапом 2.

Ветка переноса: `codex/viewer-ios-baseline`. Она сохраняет цельный набор локальных доработок относительно `main` (`7d37627`), не меняя production-сервер. Для разработки приложения клонировать эту ветку целиком. Копирование одной папки `platform/app` не заменяет клонирование: OHIF использует общие workspace-пакеты, расширения и режимы.

## 1. Получить исходники

```bash
git clone --branch codex/viewer-ios-baseline --single-branch --depth 1 https://github.com/2967494-byte/Viewers-master.git
cd Viewers-master
```

Если репозиторий требует входа, использовать свой доступ к GitHub/SSH или авторизацию Git-клиента. Ключи S3, пароль VPS и рабочие медицинские файлы для чтения кода и первых этапов приложения не нужны.

Открыть **корень клона** в агенте на MacBook. Он сможет читать все исходники ниже и работать по ТЗ. Пути `C:\Users\...` внутри исторических документов относятся к Windows-машине: на Mac использовать относительный путь от корня этого клона. CRM находится в другом репозитории; её серверные изменения не выполнять в клиентских этапах.

## 2. Что прочитать агенту в начале

1. [ТЗ iOS-приложения, редакция 2](docs/specs/doctor-ios-app-tz-2026-11-04.md): мобильный кабинет, обязательный офлайн, дизайн и безопасность.
2. [План поэтапных сборок](docs/specs/doctor-ios-implementation-stages-2026-11-04.md): делать один этап, передавать собираемый результат пользователю, ждать его проверки/команды.
3. [Контракт готовых сжатых серий](docs/specs/viewer-compressed-hot-contract-v1.md): текущий browser/S3-контракт. Подписанное офлайн-разрешение — будущее расширение, его ещё нет в CRM.
4. [План подготовки JPEG 2000 20×](docs/specs/viewer-hot-compression-plan-2026-11-04.md): готовность, версии, сроки и память.
5. [Карта кастомизаций](CUSTOMIZATIONS.md) и [отчёт подготовки репозитория](docs/repository-baseline-2026-11-04.md).

Первые этапы выполняются на синтетических/обезличенных данных и явно обозначенном Demo backend. Сам DICOM-рендер должен быть настоящим. Не заменять наш viewer iframe удалённого сайта и не считать прогретый browser cache автономной работой.

## 3. Где находится нужный код

| Область | Путь от корня репозитория |
| --- | --- |
| Открытие файлов с компьютера | `platform/app/src/routes/Local/Local.tsx` |
| Локальный DICOM-loader и индексация | `platform/app/src/routes/Local/fileLoaderService.js`, `dicomFileLoader.js`, `filesToStudies.js`, `readDicomMetadataFast.js` |
| Наш layout/режим | `modes/segmentation/src/`, `extensions/default/src/ViewerLayout/` |
| MPR и окна | `extensions/cornerstone/src/Viewport/`, `hps/mpr2x2.ts` |
| Кресты и проекции | `extensions/cornerstone/src/tools/DentalCrosshairsTool.ts`, `utils/intersectVolumePlane.ts` |
| Панорама, дуга, реконструкция, локальное состояние | `extensions/cornerstone/src/components/ManualPanorama/` |
| Измерения | `extensions/cornerstone/src/tools/DentalMeasurementTools.ts`, `dentalGeometry.ts` |
| Импланты и канал | `extensions/cornerstone/src/tools/DentalImplantTool.ts`, `implantGeometry.ts`, `components/ImplantLibrary/` |
| Панель dental-инструментов | `extensions/default/src/ViewerLayout/DentalToolsToolbar.tsx` |
| Облачный контракт и загрузка | `platform/app/src/utils/s3CompressedStudy.ts`, `viewerLaunch.ts`, `S3FileService.ts`, `useS3Loader.ts` |
| Текущий cookie-based вход из CRM | `platform/app/src/routes/TokenViewer.tsx` — не использовать как обязательный bootstrap офлайн-приложения |
| Самостоятельный профиль web-стенда | `platform/app/public/config/standalone.js` |
| Декодеры и зависимости | корневые `package.json`, `yarn.lock` и `platform/app/package.json` |
| Сборка ресурсов | `.webpack/`, `platform/app/.webpack/webpack.pwa.js` |
| Сфокусированные регрессии ORBITAL | `.scripts/test-orbital.cjs` |

Внутри строки таблицы сокращённые имена относятся к той же папке. Это monorepo: модули `@ohif/core`, `@ohif/ui`, `@ohif/ui-next`, extensions и modes связаны workspace-зависимостями. Не обновлять OHIF/Cornerstone/VTK и не вырезать зависимости «до минимума» до первой воспроизводимой сборки.

Исследовательские заметки DenCT/VTK находятся в `docs/specs/denct-*`. Чужой скачанный исходный код и локальные benchmark-окружения в baseline не входят и для сборки нашего viewer не требуются.

## 4. Воспроизвести web-стенд на Mac

Для первого этапа SwiftUI Node не нужен. Он нужен, когда потребуется собрать/адаптировать наш JS-движок и проверить его web-версию для сравнения.

- Версия Node зафиксирована в `.node-version`: `24.19.0`, соответствующая проверочному runtime переноса.
- Yarn Classic: `1.22.22`, как в `packageManager` корневого package.json.
- Зависимости устанавливаются из существующего `yarn.lock`; не удалять его и не выполнять массовый upgrade.

Если используется nvm:

```bash
nvm install
nvm use
```

Если Yarn ещё не установлен:

```bash
npm install --global yarn@1.22.22
```

Установить зависимости, не скачивая ненужные на первом шаге браузеры Cypress/Playwright:

```bash
env -u GITHUB_TOKEN CYPRESS_INSTALL_BINARY=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 yarn install --frozen-lockfile
```

`GITHUB_TOKEN` этому публичному дереву зависимостей не нужен. Наследуемый preinstall содержит настройку приватного Git; не передавать туда личный токен для обычной установки. Доступ к самому GitHub-репозиторию настраивается отдельно. В baseline убран вывод токена из preinstall-лога, но это не повод использовать его как хранилище учётных данных.

Запуск web-версии для сравнения:

```bash
PUBLIC_URL=/3dviewer/ APP_CONFIG=config/standalone.js OHIF_OPEN=false yarn workspace @ohif/app dev
```

Открыть `http://localhost:3000/3dviewer/` и использовать локальную тестовую DICOM-серию. Не вводить боевые ключи S3 для разработки макета приложения. Бакет/endpoint в standalone — параметры существующего стенда, не инструкция переносить туда production CRM.

Проверки ORBITAL:

```bash
node .scripts/test-orbital.cjs
```

Контрольная production web-сборка:

```bash
NODE_ENV=production PUBLIC_URL=/3dviewer/ APP_CONFIG=config/standalone.js QUICK_BUILD=false yarn workspace @ohif/app build
```

Результат — `platform/app/dist/`, игнорируемый Git. Это сборка desktop/web-профиля; она **не является готовым автономным iOS-bundle**. На этапе 2 потребуются локальная поставка chunks/WASM/workers и resource adapter. Перепроверить сборку на Mac: проверка Windows не заменяет её.

`commit.txt` — метаданные сборки, его обновляет `version.mjs`. Не редактировать вручную и не запускать `release`/публикацию пакетов для обычного просмотра приложения. Ветка переноса сохраняет его исходное значение текущей локальной версии; сервер от изменения Git сам по себе этой задачей не обновляется.

## 5. Где создавать приложение

Рекомендуемое отдельное место в этом же клоне — `apps/doctor-ios/`. На момент подготовки baseline папки с готовым Xcode-проектом там ещё нет; она создаётся на этапе 1. Структура не входит в существующие JS workspaces и не заменяет web-исходники.

Преимущество одного репозитория на старте: агент видит исходный движок и адаптацию рядом, а версия локального viewer соответствует версии приложения. Shared web-логика должна сохранять работу браузерного профиля. Не копировать разрозненные файлы из Windows и не создавать независимую потерявшую связь копию панорамы/геометрии.

Для повседневной разработки приложения создать следующую отдельную ветку от опубликованного baseline, например `codex/ios-stage-01`. Это выполняется при старте этапа 1 на Mac, не меняет `main` и не запускает выкладку на VPS.

## 6. Что остаётся локально на Windows

- `tmp/`, `.tmp/`: распакованные релизы, ZIP, эксперименты с медицинскими данными, SSH/tunnel-скрипты, сторонние исследовательские checkout и локальные отчёты.
- `output/`: маркетинговая листовка и PDF/изображения.
- Локальные UI preview в `docs/specs/` и промежуточные итерации review старого Uploader.
- `.env`, DICOM/raw-файлы и секретный файл с историческим именем `Viewers-master.zip`.

Они не удаляются с диска и не требуются агенту на Mac для понимания кода. Исторически отслеженные файлы не становятся безопасными от одного `.gitignore`: для credential-файла выполнено отдельное исключение из индекса. Ключи, ранее попавшие в историю, необходимо перевыпустить; baseline не заявляет очистку истории `main`.

## 7. Первое задание агенту на Mac

> Прочитай MAC_START_HERE.md, docs/specs/doctor-ios-app-tz-2026-11-04.md и docs/specs/doctor-ios-implementation-stages-2026-11-04.md. Выполни только этап 1 в apps/doctor-ios/. Нужна независимо собираемая SwiftUI-оболочка со светлым дизайном и Demo-навигацией. Наш движок находится в этом же репозитории, его адаптация начинается с этапа 2. CRM, production S3, VPS и main не меняй. Передай точные инструкции Xcode и короткий сценарий проверки; после этапа остановись, чтобы я собрал приложение и дал обратную связь.
