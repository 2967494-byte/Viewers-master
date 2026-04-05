# AWS SDK v2 Configuration Fix

## Проблема
AWS SDK v2 требует переменных окружения с правильными названиями. Ошибка возникает если переменные названы неправильно.

## Решение

### ✅ Правильно:
Все переменные должны иметь префикс `S3_`:
```env
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
S3_REGION=ru-msk
S3_ENDPOINT=https://storage.yandexcloud.net
S3_BUCKET=your-bucket
S3_PREFIX=panorama/
S3_FORCE_PATH_STYLE=true
```

### ❌ Неправильно:
AWS SDK v2 **НЕ РАСПОЗНАЕТ** переменные с префиксом `AWS_`:
```env
AWS_ACCESS_KEY_ID=...     # ❌ НЕ БУДЕТ ИСПОЛЬЗОВАТЬСЯ
AWS_SECRET_ACCESS_KEY=... # ❌ НЕ БУДЕТ ИСПОЛЬЗОВАТЬСЯ
AWS_REGION=...            # ❌ НЕ БУДЕТ ИСПОЛЬЗОВАТЬСЯ
```

## Изменения в коде

Файл `lib/panorama-generator.js` уже обновлен для использования переменных с префиксом `S3_`:

```javascript
// ПРАВИЛЬНО (текущая версия):
this.s3 = new AWS.S3({
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION || 'ru-msk',
  endpoint: process.env.S3_ENDPOINT,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
});
```

## Проверка на сервере

1. **Убедитесь что .env содержит правильные переменные:**
```bash
grep "^S3_" /opt/ohif-panorama/.env
```

Должно вывести:
```
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=...
S3_ENDPOINT=...
S3_BUCKET=...
```

2. **Тестчиковое подключение:**
```bash
cd /opt/ohif-panorama/panorama-server
npm run test:s3
```

3. **Если ошибка - проверьте:**
- [ ] Переменные имеют префикс `S3_` (не `AWS_`)
- [ ] Ключи и значения правильные
- [ ] .env файл загруженется (не .env.example)
- [ ] Нет опечаток в имени переменной

## Дополнительная информация

Подробное описание конфигурации для разных S3 провайдеров находится в:
- **S3_CONFIG.md** - Полное описание и примеры
- **.env.example** - Шаблон с комментариями

## Примеры для популярных сервисов

### Yandex Cloud
```env
S3_REGION=ru-msk
S3_ENDPOINT=https://storage.yandexcloud.net
S3_FORCE_PATH_STYLE=true
```

### AWS S3
```env
S3_REGION=us-east-1
S3_ENDPOINT=https://s3.amazonaws.com
S3_FORCE_PATH_STYLE=false
```

### MinIO (локальный)
```env
S3_REGION=us-east-1
S3_ENDPOINT=http://minio:9000
S3_FORCE_PATH_STYLE=true
```

---

✅ После исправления переменных окружения перезагрузите сервис:
```bash
pm2 restart ohif-panorama-api
```
