# 🚀 Quick Start - Быстрое решение проблемы AWS SDK v2

## Проблема
"AWS SDK v2 использует AWS SDK v2, который ожидает переменные в другом формате"

## Решение в 3 шага

### Шаг 1️⃣: Обновить .env файл

На сервере отредактировать `/opt/ohif-panorama/.env`:

```bash
nano /opt/ohif-panorama/.env
```

**Заменить это:**
```env
AWS_REGION=us-east-1
```

**На это:**
```env
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_REGION=ru-msk
S3_ENDPOINT=https://storage.yandexcloud.net
S3_FORCE_PATH_STYLE=true
S3_BUCKET=your-bucket-name
S3_PREFIX=panorama/
```

Сохранить: `Ctrl+O` → `Enter` → `Ctrl+X`

---

### Шаг 2️⃣: Скопировать обновленный код

На локальной машине скопировать обновленный файл на сервер:

```bash
scp panorama-server/lib/panorama-generator.js username@server-ip:/opt/ohif-panorama/panorama-server/lib/
```

---

### Шаг 3️⃣: Протестировать и запустить

На сервере:

```bash
cd /opt/ohif-panorama/panorama-server

# Тест конфигурации S3
npm run test:s3

# Если все ✅ - запустить сервис
npm start
# или (если используется PM2):
pm2 restart ohif-panorama-api
```

---

## Что произошло?

AWS SDK v2 требует переменные окружения **с префиксом `S3_`**, а не `AWS_`:

| ❌ Было (неправильно) | ✅ Стало (правильно) |
|-------------------|------------------|
| AWS_REGION | S3_REGION |
| AWS_ACCESS_KEY_ID | S3_ACCESS_KEY_ID |
| AWS_SECRET_ACCESS_KEY | S3_SECRET_ACCESS_KEY |

Код в `panorama-generator.js` был обновлен чтобы использовать переменные с префиксом `S3_`.

---

## Если что-то не работает

1. **Ошибка при тесте S3:**
   ```bash
   npm run test:s3
   ```
   Прочитайте вывод - там будет описание проблемы.

2. **Больше подробностей:**
   - Читайте [S3_CONFIG.md](S3_CONFIG.md) для конфигурации разных S3 провайдеров
   - Читайте [AWS_SDK_V2_FIX.md](AWS_SDK_V2_FIX.md) для техничних деталей
   - Читайте [DEPLOYMENT.md](DEPLOYMENT.md) для полного гайда

3. **Проверить переменные:**
   ```bash
   grep "^S3_" /opt/ohif-panorama/.env
   ```

---

## Файлы которые нужно обновить

- ✅ `panorama-server/lib/panorama-generator.js` - уже обновлен
- ✅ `SERVER_SETUP.md` - уже обновлен
- 📝 `.env` на сервере - нужно обновить вручную

---

✅ **Готово!** Сервис будет работать с правильной конфигурацией AWS SDK v2.
