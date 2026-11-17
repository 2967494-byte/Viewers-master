# Примеры контракта и два синтетических исследования

Эти данные созданы для разработки интеграции. Реальных пациентов, действующих QR, паролей, S3-подписей и ключей доступа здесь нет. Все URL `*.example.invalid` намеренно не работают. Новые маршруты в [OpenAPI](../doctor-mobile-v1.openapi.json) ещё не реализованы на сервере.

`contract-examples.json` содержит ответы me/patients/studies, QR, а также inventory/download grant/decoded claims/local descriptor для **двух различных** исследований. Использовать как Codable fixtures/локальный mock, а не как реальные ответы production. Файловые SHA-256 и test ES256 подписи настоящие; API-адреса и доступ — вымышленные.

Генерация из корня Viewers-master:

```text
python .scripts/prepare-doctor-mobile-fixtures.py
node .scripts/validate-doctor-mobile-contract.cjs
```

Генератору нужны Python 3.10+, numpy, pydicom>=3, pylibjpeg, pylibjpeg-openjpeg и cryptography. Валидатор использует Node с доступным `ajv` v6 из зависимостей этого репозитория. Команды не обращаются к сети, не читают клинические исходники и не меняют CRM/S3.

Бинарные результаты создаются в игнорируемой git папке:

```text
tmp/doctor-mobile-integration-20261108/
  synthetic-study-a.zip
  synthetic-study-b.zip
  synthetic-study-a/
    mobile-binding.example.json
    _viewer/representations.json
    _viewer/demo-source-a-1/jpeg2000-20x/demo-generation-a-1/
      download-inventory.json
      manifest.json
      series-a/ohif_metadata.json
      series-a/instances/000001.dcm ... 000036.dcm
  synthetic-study-b/
    ... 40 DICOM files, other IDs, paths, UIDs and pixels ...
```

| Набор | patientId / studyId | Данные | Шаг x/y/z |
| --- | --- | --- | --- |
| A | 910001 / 930001 | Круглый тестовый phantom, 160×160×36 | 0.4 / 0.4 / 0.6 мм |
| B | 910002 / 930002 | Прямоугольный тестовый phantom, 160×160×40 | 0.3 / 0.5 / 0.8 мм |

Оба — JPEG 2000 lossy (`1.2.840.10008.1.2.4.91`), целевой параметр 20×. Размер файлов с заголовками и фактический коэффициент на маленьком phantom не являются тестом клинического качества или сетевой скорости. Это не снимки зубов; автоматическая зубная дуга на них не оценивается.

Для текущего Demo-адаптера можно извлечь содержимое ZIP A в `Documents/RealStudies/hot/2026/11/08/appt_demo_a/`, ZIP B — в `.../hot/2026/11/08/appt_demo_b/`, затем передавать соответствующий **разный** `legacyImportStudyPrefix` и sourceVersion из `mobile-binding.example.json`. Префикс сохраняет `hot/.../appt_.../`, обязательный для текущего `compressedStudyRoot`. Существующий bridge с фиксированной sourceVersion и общий Sample fallback сначала исправить — иначе даже корректные наборы не проверяют привязку. Это временный импорт для Demo; production native-local mode читает verified generation через собственный descriptor без mutable pointer.

### Подписи и время теста

- Открытый **тестовый** P-256 ключ в JSON имеет `kid=EXAMPLE-ONLY-NOT-PRODUCTION-P256-001`. Генератор использует заведомо общеизвестный test scalar 1 — это не секрет и не ключ сервера. **Никогда не доверять этому ключу в production.** В JSON только public JWK.
- Доверенное время теста фиксировано: `2026-11-08T10:00:00Z`. Offline grant истекает `2026-11-15T10:00:00Z`; тест проверяет подпись и срок относительно фиксированной даты. Не переводить часы iPhone и не ослаблять боевую проверку времени ради fixtures. Для ручного Demo без сервера использовать отдельно обозначенный синтетический режим.
- `expiresAt=2030-01-01` в manifest/pointer позволяет тестировать старый cloud-format parser. Это не срок production-хранения и не право игнорировать offline grant.
- ECDSA-подписи могут меняться при повторном запуске генератора. Файлы examples и бинарные наборы использовать от одного запуска; смешивание от разных запусков должно выявляться проверкой hash/binding.

### Что проверяется автоматически

Ссылки/пути OpenAPI, компиляция всех 25 DTO-схем, примеры, точные размеры и SHA-256 inventory/каждого файла, HEX DICOM JSON и UID, соответствие fileId выдаче, разделение A/B и приём обоих наборов существующим `loadCompressedStudy`. Негативные проверки: traversal, смешивание bundle, дубликаты, неверная сумма байтов, другой device, истёкший grant, изменённый payload, неизвестный kid и другая sourceVersion. Генератор дополнительно декодирует каждый из 76 DICOM через OpenJPEG. Для проверки существующего TypeScript-парсера валидатор использует `typescript` из зависимостей репозитория.

После чистого clone JSON-проверки возможны без бинарников; валидатор явно сообщает, что бинарные проверки пропущены. Для полной проверки сначала запустить генератор. Эти проверки не заменяют backend ACL/integration tests, Xcode build и запуск на реальном iPhone.
