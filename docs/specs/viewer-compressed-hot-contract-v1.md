# Контракт сжатых серий HOT: просмотрщик ↔ будущая служба/CRM

Дата: 4 ноября 2026. Версия схемы: 1. CRM и служба сжатия этим изменением не модифицируются.

## Размещение в S3

Текущий профиль viewer использует `https://storage.yandexcloud.net`, bucket `orbital3d-hot-storage`.
При смене хранилища endpoint/bucket меняются в runtime `app-config.js`; ключи в сборку не встраиваются.

```text
hot/<год>/<месяц>/<день>/pat_<id>/appt_<id>/
  <исходные файлы и папки>                         # viewer их не перебирает
  _viewer/
    representations.json                           # публикуется последним
    <sourceVersion>/jpeg2000-20x/<generationId>/
      manifest.json
      <seriesId>/
        ohif_metadata.json
        instances/000001.dcm
        instances/000002.dcm
```

Для ручной проверки в S3-форме вводится корень `hot/.../appt_<id>/` либо существующая подпапка внутри него.
Loader определяет корень appointment и читает **только** `_viewer/representations.json`.
Папка `Data/` с исходниками или одиночный `ohif_metadata.json` не включают облачный просмотр.
Локальная загрузка файлов/папки с компьютера остаётся доступной отдельно.

## representations.json

```json
{
  "schemaVersion": 1,
  "sourceVersion": 1,
  "expiresAt": "2026-12-04T12:00:00Z",
  "defaultRepresentationId": "jpeg2000-20x",
  "representations": [
    {
      "id": "jpeg2000-20x",
      "status": "ready",
      "manifest": "1/jpeg2000-20x/generation-001/manifest.json"
    }
  ]
}
```

Пути в указателе относительны `_viewer/`. Наличие версии со статусом `ready` обязательно.
Все даты в примерах иллюстративные: служба рассчитывает реальные сроки по политике HOT.

## manifest.json

```json
{
  "schemaVersion": 1,
  "id": "jpeg2000-20x",
  "status": "ready",
  "sourceVersion": 1,
  "expiresAt": "2026-12-04T12:00:00Z",
  "profile": { "codec": "jpeg2000", "targetRatio": 20 },
  "series": [
    {
      "id": "derived-series-1",
      "index": "derived-series-1/ohif_metadata.json",
      "instanceCount": 450
    }
  ]
}
```

`index` относителен каталогу manifest. В первой реализации codec — `jpeg2000`; loader также распознаёт `htj2k` для будущих испытаний.
Каждая перечисленная серия должна быть полностью записана. `instanceCount` — число файлов/инстансов, не сумма кадров multiframe.
Индекс каждой серии — непустой JSON-массив DICOM-заголовков, полученных из производных DICOM, с относительными `_url`, например `instances/000001.dcm`.
Поддерживаются HEX DICOM JSON-теги и натурализованные имена. Обязательны Study/Series/SOP Instance UID и геометрия по существующей спецификации индекса.
Новые UID производных и признаки lossy/derived формирует encoder; исходный JSON нельзя просто скопировать.

Абсолютные URL, `orbitals3:`/`wadouri:` в JSON, переходы `..`, абсолютные object keys и ссылки за пределы опубликованного поколения не принимаются.
Пути к DICOM уникальны, SOP UID уникальны в готовом наборе. Файлы имеют расширение `.dcm`.
Source version указателя, manifest и ожидаемая версия от CRM должны совпадать. Истёкший срок блокирует открытие.
Нет указателя / нет ready-версии / неполный индекс / ошибка авторизации / битый JSON → понятная ошибка, без ListObjects и без чтения исходных срезов.

## Публикация будущей службой

1. Завершить обычную распаковку и проверку исходного архива в HOT.
2. В уникальном generation-prefix подготовить сжатые DICOM JPEG 2000, затем индекс.
3. Повторно декодировать и проверить полный состав/геометрию; записать ready-manifest.
4. Убедиться, что версия источника актуальна и срок не истёк.
5. Последним PUT обновить `representations.json`. Старое поколение при этом не перезаписывается пофайлово.
6. При замене исходного архива снять актуальность указателя; новую source version передавать в resolver.

Файлы не зависят от установки Orbital Uploader. Сжатие/переупаковка при открытии viewer отсутствуют.

## Будущее открытие из CRM

Ссылка: `<адрес viewer>/3dviewer/v/<непредсказуемый временный токен>`.
Runtime `viewerIntegration.resolveUrl` по умолчанию: `https://admin.orbital3d.ru/api/viewer/resolve/{token}`.
Этот endpoint вызывается только при переходе по такой ссылке. На текущей CRM он пока не реализуется/не изменяется.

Viewer делает GET с `credentials: include`, `Accept: application/json` и без Referrer; токен URL-кодируется.
Сервер CRM должен проверить сессию/токен, право врача на исследование, текущую source version, готовность сжатого результата и сроки.
Успешный ответ нового формата:

```json
{
  "schemaVersion": 1,
  "viewerAvailable": true,
  "s3Prefix": "hot/2026/11/04/pat_1/appt_2/",
  "sourceVersion": 1,
  "access": {
    "expiresAt": "2026-11-04T13:20:00Z",
    "resources": {
      "hot/2026/11/04/pat_1/appt_2/_viewer/representations.json": "https://storage.yandexcloud.net/orbital3d-hot-storage/hot/2026/11/04/pat_1/appt_2/_viewer/representations.json?<S3-подпись>",
      "<полный object key manifest>": "<подписанный GET URL manifest>",
      "<полный object key индекса>": "<подписанный GET URL индекса>",
      "<полный object key каждого DICOM>": "<подписанный GET URL этого DICOM>"
    }
  }
}
```

`resources` включает точный указатель, manifest, индексы и **все** файлы опубликованных серий. Нет wildcard или шаблона на произвольный ключ.
Подписанные ссылки должны быть действительны как минимум до `access.expiresAt`; этот срок также ограничивается общим сроком исследования.
На первом этапе можно выдавать доступ, например, на 30 минут; фактическую продолжительность определить при интеграции CRM.
URL ожидаются в path-style формате текущего S3 endpoint/bucket. Loader отклоняет чужие storage origins, другой bucket/key и разрешения вне `_viewer/` этого appointment.
Ссылки хранятся только в памяти вкладки; постоянные ключи S3 не передаются и в sessionStorage не сохраняются.
Если доступ истёк, нужно повторно открыть исследование из CRM. Запасного декодирования base64(JSON с prefix) больше нет.

До реализации нового endpoint переход из CRM покажет сообщение о недоступности. Обычное локальное открытие и администраторская S3-форма работают самостоятельно.
Backend должен возвращать `viewerAvailable: false` либо соответствующую ошибку для неготовой серии, а не ссылки на оригиналы.

## CORS и публикация

Будущая CRM разрешает запросы resolver с точного origin viewer, включая credentials. Для пикселей и JSON браузер обращается напрямую к S3 по подписанным URL без cookie CRM.
S3 CORS должен разрешать GET с origin viewer и чтение нужных заголовков. COOP/COEP просмотрщика сохраняются; сервер S3 должен позволять загрузку ресурсов в таком режиме.
На данном этапе VPS остаётся на loopback `127.0.0.1:8080` через SSH-туннель; публичные порты и DNS/HTTPS отдельной задачей не открываются.
Маршрут `/3dviewer/v/` на Nginx выдаётся без записи токена в access log и с `no-store`/`no-referrer`.

Медицинские файлы локального эксперимента не копируются на VPS, в релиз или в S3 этим обновлением. CRM и S3 bucket/lifecycle не изменяются.
