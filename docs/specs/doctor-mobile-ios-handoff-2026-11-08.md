# Передача агенту iOS: подключение к CRM и реальные локальные исследования

Дата: 8 ноября 2026. Основание: [контракт сопряжения](doctor-mobile-integration-v1-2026-11-08.md), [OpenAPI](doctor-mobile-v1.openapi.json), [примеры](doctor-mobile-v1-examples/README.md).

Проверен проект `C:/Users/Matvey/Documents/Projects/orbital_doc_app/orbital_doc_app`, commit `7ce5d4d3344dd7dcb4bf1778837ffbbbfe8d0abc`. Локальная копия чистая и совпадает с полученной копией `https://github.com/2967494-byte/orbital_doc_app`. Этот документ — задание на следующую реализацию, не отчёт об исправлении перечисленного. Сам проект iOS и CRM в рамках подготовки не изменялись; Xcode не запускался.

## Что ответить на исходные вопросы

1. **Сервер известен:** `https://admin.orbital3d.ru`. Native API врача ещё надо реализовать; нельзя выдавать существующий browser `/api/viewer/resolve` за Bearer API. Путь `/api/doctor-mobile/v1` в OpenAPI — согласуемый контракт новой реализации, пока не рабочие маршруты.
2. **Вход:** одноразовый QR из авторизованного кабинета врача → отдельная отзываемая сессия устройства → access/refresh в Keychain. QR не содержит постоянный пароль. Сервер определяет врача, а не доверяет doctor_id в QR.
3. **Список:** ACL-фильтрованные patients/studies. Файлы: готовая JPEG 2000 20× серия из `_viewer`, существующие manifest/HEX-индексы + новый immutable inventory с SHA-256/размерами. Native скачивает по exact signed GET напрямую из HOT. Uploader к этому потоку не относится; новые архивы на лету не нужны.
4. **Демо:** начать с двух синтетических наборов A/B. Согласованную реальную пару врач–пациент–studyId выбирает владелец в CRM при подготовке серверного пилота. Не считать встроенную Лукьянову исследованием каждого пациента.

## Подтверждённые точки доработки

Пути ниже относительно корня iOS-проекта. Номера строк относятся к проверенному commit и могут сдвинуться.

| Файл / место | Текущее поведение | Что сделать |
| --- | --- | --- |
| `OrbitalDoctor/Features/Viewer/LocalViewerFullScreenView.swift:22` | Каждому study назначается `realVatechStudyPrefix` | Инициализировать viewer только проверенным `LocalStudyDescriptor` выбранного исследования; нет файла → понятный статус, без образца другого пациента |
| `OrbitalDoctor/Features/Viewer/LocalViewerBridge.swift:207` | `triggerOpenLocalStudy` передаёт фиксированный `defaultSourceVersion` | Передавать sourceVersion/generation/series из descriptor; проверять identity ответа `studyLoaded` и привязку проекта |
| `OrbitalDoctor/Features/Viewer/LocalViewerBridge.swift:175` | Сохраняется глобальный `customStudyFolderURL`, security scope закрывается до последующего асинхронного чтения | Импортировать выбранный набор в собственный staging, пока scope активен, проверить и опубликовать. Не хранить временный внешний URL как библиотеку и не использовать глобальный override для всех studies |
| `OrbitalDoctor/Features/Viewer/OrbitalLocalSchemeHandler.swift:132` | Поиск файла по очереди: custom → Sample → Documents → общий Resources | Для medical data — только root разрешённого bundle этой viewer-сессии, без fallback. `/viewer` — только разрешённые файлы движка. Проверять scheme, точный host, метод, нормализованный путь и symlink containment; не раздавать всю библиотеку |
| `OrbitalDoctor/Features/Patients/PatientDetailView.swift:907` | Timer имитирует скачивание | `StudyDownloadManager` с реальными URLSession-задачами, устойчивым состоянием и байтами; отдельные transfer/verify/ready. Кнопка недоступна при отсутствии backend вне Demo |
| `OrbitalDoctor/App/AppEnvironment.swift:68,96,117` | `readyToDownload` сразу открывает viewer; save/remove меняют только enum | Открывать только существующий verified bundle с действующим разрешением. Сохранение/удаление/занятая память основаны на файловой библиотеке; облачная карточка и локальная запись — разные сущности |
| `OrbitalDoctor/Models/DoctorModels.swift` | Смешаны UI-строки дат/МБ и состояния облака/диска | Отдельные Codable DTO, domain models, persisted local record и UI formatting. Байты — Int64, сроки — Date, идентификаторы и sourceVersion — строки, profileVersion — число |
| `OrbitalDoctor/Features/Viewer/LocalViewerBridge.swift:22,330,343` | Проект хранится по одному StudyInstanceUID | Имена и проверка содержимого по serverId/userId/studyId/sourceVersion/generationId/bundleId/schemaVersion. Native выбирает namespace, JS не назначает путь. Старые проекты не применять автоматически другой производной геометрии |
| `OrbitalDoctor/Features/Patients/PatientDetailView.swift:864,1067` | `Image("PanoramaSample")` | Превью строить из конкретной локальной серии и кэшировать по bundle+series; до построения — placeholder, без общей картинки |
| `OrbitalDoctor/Features/Auth/QRPairingPreviewView.swift:72` | Кнопка показывает notice, сканера/обмена нет | Реальный scanner, trusted origin, exchange, подтверждённые данные врача, Keychain/device session. Добавить описание доступа к камере в Info.plist; обработать отказ без demo-login |
| `OrbitalDoctor/Resources/ViewerBundle/entry.ts:12` | Импорты из абсолютного `/Users/matvey/Documents/Viewers-master/...` | Воспроизводимая сборка JS/WASM с закреплёнными зависимостями и относительным/package import. Xcode сейчас копирует готовый ViewerBundle; изменение TS без пересборки JS не меняет приложение |
| `OrbitalDoctor/Resources/ViewerBundle/entry.ts:2709–2744` | Cloud loader читает все series, затем общий sort по InstanceNumber; Z берётся из SliceThickness | Local mode читает проверенный inventory, выбирает конкретную series, сортирует по геометрии IOP/IPP, вычисляет реальный шаг. Неподдерживаемый тип → `unsupported`; не объединять несколько series и не молча подставлять 0.2 мм |

Важное уточнение к геометрии: текущие функции расстояния/угла используют `voxelSpacing` — они не все жёстко зашиты на 0.2 мм. Проблема в выборе, порядке, ориентации и определении геометрии входного объёма; строка диагностики «0.2 фиксировано / 100%» не доказывает поддержку других исследований. Удалить неподтверждённое утверждение из UI. Проверить signed/unsigned pixels, rescale каждого instance и согласованность сетки.

Сейчас JS сам запускает `openLocalStudy` после инициализации, а native повторяет запуск на `ready`. Оставить одного владельца открытия — native. Каждому открытию присваивать `loadId`; отменять старую загрузку и игнорировать её поздние сообщения. При A → B очистить volume/sliceBuffers/измерения/дугу, затем применить только проект B. Иначе корректные файлы ещё не исключают показ старого состояния.

В проверенном git отслеживаются 1386 `.dcm`, в том числе ресурсы `appt_real_001`; LocalStudySample включён в Resources таргета. Перед внешней тестовой/боевой поставкой отдельно проверить обезличивание и исключить клинические образцы из app bundle. Этот аудит не публикует их и не меняет историю репозитория.

## Компоненты, которые нужно выделить

- `DoctorAPIClient`: база из trusted server profile, Codable, JSON-ошибки, requestId, auth refresh single-flight. `capabilities` проверяет реальную готовность API. 404/HTML не превращаются в Demo.
- `DeviceSessionStore`: QR, Keychain, deviceId, logout/revoke, изоляция между врачами/серверами. AppSessionStore управляет интерфейсом, а не выдаёт себе права.
- `StudyRepository`: связь удалённых карточек с локальными записями. Не генерирует врачебные/клинические данные там, где API их ещё не выдаёт. Отсутствующий specialty/clinic/report/booking скрывать или честно обозначать, а не брать из DemoFixtures.
- `StudyDownloadManager`: URLSession download-to-file, staging, реальный прогресс, отмена, retry, восстановление, обновление точных URL. Секреты CRM не уходят в S3.
- `LocalStudyStore`: verified immutable bundle, точный подсчёт места, безопасное удаление, reconciliation после crash. Пути не содержат ФИО.
- `OfflineAccessVerifier`: ES256 CryptoKit P256, доверенный `kid`, R||S `rawRepresentation`, binding/scope/time/hash. Test key — только в явно отдельной Demo/test конфигурации.
- `LocalViewerAdapter`: выдаёт local descriptor и разрешает чтение только одного bundle; сохраняет существующий офлайн WKURLSchemeHandler. Медицинский viewer не переводить на удалённую web-страницу ради нового API.

## Проверяемые сборки

### M01 — правильная локальная библиотека, без backend

Сначала убрать общий prefix, фиксированную sourceVersion, подмену через Sample и Timer. Импорт A/B, таблица локальных записей, проверка sizes/hash, реальные delete/storage. Синтетический import явно Demo; production grant при этом не обходится. Локальная запись без файлов не может стать ready.

Приёмка: A — круглый phantom, B — прямоугольный; разные IDs/UID/папки. A → B → A не переносит измерения/дугу/панораму, удаление B не затрагивает A. Полностью завершить приложение, открыть снова в авиарежиме. При удалённом/повреждённом файле показывать ошибку именно этого bundle, без встроенного исследования.

### M02 — QR и настоящий каталог, после backend B

Подключить capabilities/exchange/refresh/me/patients/studies. Схема Staging не содержит скрытой Demo-сессии. Пока download API отсутствует — кнопка честно недоступна.

Приёмка: два врача, разные допустимые списки; один не может получить другого study через подстановку id. Использованный/истёкший QR, потеря ответа exchange, refresh, logout/revoke, блокировка проверены на тестовом сервере. ФИО в шапке подтверждено сервером.

### M03 — первая настоящая загрузка, после backend C

Download grant → exact inventory hash → DICOM/index/manifest → проверка → атомарное ready → локальное открытие. Обновление подписей для того же bundle, не загрузка оригинального ZIP. Данные в QR/примерах не являются рабочим доступом; реальные studyIds согласует владелец.

Приёмка: отрыв сети, повтор, 403 от истёкшего URL, source_changed, мало диска, отмена и перезапуск. Прогресс измеряется байтами, ready только после верификации. iOS-генерированная панорама из этой серии; одинаковые геометрия/положение/измерения с настольной версией на эталонном исследовании.

### M04 — автономность и пилот

Сохранить два согласованных исследования, завершить процесс, авиарежим, открыть каждое и собственный проект. Проверить истечение grant и возврат сети без повторной загрузки DICOM, отзыв при сети, смену врача/сервера, background и реальный memory footprint. На целевом iPhone отдельно измерить загрузку/декодирование большого 16×16: 20× экономит сеть/диск, не гарантирует такой же экономии RAM.

На каждой сборке фиксировать commit, build, iPhone/iOS, что проверено и отзыв владельца. Это новые шаги интеграции, не переименование уже принятых E01–E05.

## Граница работ серверного агента

Backend B–C из основного контракта: явный principal для общего ACL (текущая wrapper-функция возвращается к current_user), device sessions/QR/revoke, каталог, bundle publication/backfill, download/urls/offline-access, signing key, миграции, feature flag выключен. Не затрагивать Uploader и не ломать browser viewer. Отдельно подтвердить срок offline-доступа до включения production; 7 суток в контракте — предложение для пилота.

До реализации этих серверных этапов не существует команды, которую можно передать iOS-агенту для скачивания реальных исследований через новый API. Рабочий результат текущего этапа — общий проверяемый контракт и локальная подготовка, после чего сервер и приложение соединяются без выдуманных адресов.
