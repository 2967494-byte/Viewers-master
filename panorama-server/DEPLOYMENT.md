# Развертывание Panorama Microservice на Ubuntu

## 1. Подготовить файлы на локальной машине

```bash
# Скопировать папку panorama-server на сервер
scp -r ./panorama-server username@server-ip:/opt/ohif-panorama/
```

Структура будет:
```
/opt/ohif-panorama/
├── source/              # OHIF Viewers
├── screenshots/         # Результаты (локально)
├── data/               # DICOM кэш
├── logs/               # Логи
├── panorama-server/    # Микросервис
│   ├── server.js
│   ├── package.json
│   ├── lib/
│   │   └── panorama-generator.js
│   └── test-api-examples.js
└── .env                # Конфиг
```

---

## 2. На сервере: установка зависимостей микросервиса

```bash
cd /opt/ohif-panorama/panorama-server
npm install

# Проверить что все пакеты установлены
npm list
```

**Результат должен быть похожим на:**
```
ohif-panorama-server@1.0.0
├── axios@1.4.0
├── aws-sdk@2.1400.0
├── express@4.18.2
└── puppeteer@20.0.0
```

---

## 3. Проверить конфигурацию (.env)

```bash
cat /opt/ohif-panorama/.env

# Убедитесь, что там правильно установлены все S3_* переменные:
# S3_ACCESS_KEY_ID=...
# S3_SECRET_ACCESS_KEY=...
# S3_REGION=ru-msk
# S3_ENDPOINT=https://storage.yandexcloud.net
# S3_BUCKET=your-bucket-name
# S3_PREFIX=panorama/
```

---

## 4. Тест S3 соединения

```bash
# Перейти в директорию микросервиса
cd /opt/ohif-panorama/panorama-server

# Запустить тест S3 конфигурации
npm run test:s3

# Вы должны увидеть:
# ✅ УСПЕХ - Все проверки прошли успешно!
```

Если получите ошибку - прочитайте раздел **S3_CONFIG.md** в папке panorama-server для решения.

---

## 5. Тестировать локально

```bash
# Перейти в директорию микросервиса
cd /opt/ohif-panorama/panorama-server

# Запустить сервер в форгаунде (чтобы видеть ошибки)
node server.js

# В браузере/новом терминале:
curl http://localhost:3001/health

# Результат:
# {"status":"ok","timestamp":"2024-01-20T10:30:45.123Z","uptime":2.456}
```

---

## 6. Если все работает - запустить через PM2

```bash
# Если PM2 ещё не установлен
sudo npm install -g pm2

# Запустить сервис
cd /opt/ohif-panorama
pm2 start panorama-server/server.js --name "ohif-panorama-api"

# Проверить статус
pm2 status

# Смотреть логи
pm2 logs ohif-panorama-api

# Сохранить конфиг чтобы он стартовал при загрузке
pm2 startup
pm2 save
```

---

## 7. Использование API

### Запустить генерацию панорамы:

```bash
curl -X POST http://localhost:3001/api/panorama/generate \
  -H "Content-Type: application/json" \
  -d '{
    "dicomInstanceUID": "1.2.3.4.5",
    "s3Path": "s3://your-bucket/path/to/dicom.dcm",
    "rotationSteps": 36,
    "angleDelta": 10,
    "screenshotWidth": 1024,
    "screenshotHeight": 768,
    "format": "png"
  }'

# Ответ:
# {
#   "jobId": "job-1705749045123-abc123def",
#   "status": "accepted",
#   "message": "Panorama generation started",
#   "estimatedTime": "72-108 seconds"
# }
```

### Проверить статус:

```bash
curl http://localhost:3001/api/panorama/status/job-1705749045123-abc123def
```

### Список всех задач:

```bash
curl http://localhost:3001/api/panorama/list
```

### Скачать результаты (когда status = 'success'):

```bash
curl -O http://localhost:3001/api/panorama/download/job-1705749045123-abc123def
```

---

## 8. Мониторинг и логирование

```bash
# Смотреть логи в реальном времени
pm2 logs ohif-panorama-api

# Только ошибки
pm2 logs ohif-panorama-api | grep ERROR

# Весь прогресс задачи
tail -f /opt/ohif-panorama/logs/api.log | grep "job-1705749045123-abc123def"
```

---

## 9. Troubleshooting

### Проблема: Chromium не запускается

```bash
# Проверить что он установлен
which chromium-browser

# Если нет, переинсталлировать
sudo apt-get remove chromium-browser
sudo apt-get install chromium-browser

# Проверить версию
chromium-browser --version
```

### Проблема: Не хватает памяти

```bash
# Проверить используемую память
free -h

# Проверить процессы
ps aux | grep chromium

# Если нужно, перезагрузить сервис
pm2 restart ohif-panorama-api
```

### Проблема: S3 ошибки доступа

```bash
# Проверить credentials
cat ~/.aws/credentials

# Тестов S3 доступ
aws s3 ls s3://your-bucket --region us-east-1

# Если ошибка - пересоздать credentials с правильными ключами
```

---

## 10. Production настройки

### Добавить nginx реверс прокси:

```bash
sudo nano /etc/nginx/sites-available/ohif-panorama

# Вставить:
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # Timeouts для долгих запросов
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}

# Активировать
sudo ln -s /etc/nginx/sites-available/ohif-panorama /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Добавить логротацию:

```bash
sudo nano /etc/logrotate.d/ohif-panorama

# Вставить:
/opt/ohif-panorama/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 nobody nobody
    postrotate
        systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
```

---

## 11. Остановка и рестарт

```bash
# Остановить сервис
pm2 stop ohif-panorama-api

# Перезагрузить
pm2 restart ohif-panorama-api

# Удалить из PM2
pm2 delete ohif-panorama-api

# Несохранённые изменения PM2 потеряются, пересохранить если нужно
pm2 save
```

---

## ✅ Готово!

После всех этих шагов у тебя должен быть полностью рабочий API сервис на:
- **http://your-domain:3001** (или через nginx)

Все скриншоты будут сохраняться на S3, логи в `/opt/ohif-panorama/logs/`.

**Следующий шаг:** Найти способ для post-processing (сшивание скриншотов в панораму).
