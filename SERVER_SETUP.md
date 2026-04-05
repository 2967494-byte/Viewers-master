# Инструкция по развертыванию Panorama сервера на Ubuntu

## 1️⃣ Начальная настройка системы (выполнить по порядку)

```bash
# Обновить систему
sudo apt-get update
sudo apt-get upgrade -y

# Установить Node.js 18
curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Установить Git
sudo apt-get install -y git

# Установить Chromium (для Puppeteer)
sudo apt-get install -y chromium-browser

# Установить зависимости для Puppeteer
sudo apt-get install -y libgconf-2-4 libatk1.0-0 libatk-bridge2.0-0 libgdk-pixbuf2.0-0 libgtk-3-0 libgbm1 libnss3 libxss1 libasound2
```

---

## 2️⃣ Подготовка директорий

```bash
# Перейти в рабочую директорию
cd /opt
sudo mkdir -p ohif-panorama
sudo chown $USER:$USER ohif-panorama
cd ohif-panorama

# Создать структуру
mkdir -p {source,data,screenshots,logs}
```

---

## 3️⃣ Клонирование и настройка OHIF

```bash
cd /opt/ohif-panorama/source

# Клонировать OHIF
git clone https://github.com/OHIF/Viewers.git .

# Установить зависимости (может занять 5-10 минут)
npm ci

# Собрать OHIF для продакшена
npm run build

# Результат будет в platform/app/dist
```

---

## 4️⃣ Установка зависимостей для микросервиса

```bash
cd /opt/ohif-panorama

# Установить глобально (или в отдельный package.json)
npm install express axios aws-sdk puppeteer dotenv

# Версии:
# - express@^4.18.0
# - axios@^1.4.0
# - aws-sdk@^2.1400.0
# - puppeteer@^20.0.0
# - dotenv@^16.0.0
```

---

## 5️⃣ Настройка AWS S3 credentials

```bash
# Создать файл конфигурации
mkdir -p ~/.aws
nano ~/.aws/credentials

# Вставить:
[default]
aws_access_key_id = YOUR_KEY_ID
aws_secret_access_key = YOUR_SECRET_KEY

# Сохранить: Ctrl+O → Enter → Ctrl+X

# Также создать конфиг:
nano ~/.aws/config

# Вставить:
[default]
region = us-east-1

# (або твой регион)
```

---

## 6️⃣ Создать .env файл для микросервиса

```bash
cd /opt/ohif-panorama
nano .env

# Вставить:
PORT=3001
OHIF_BUILD_PATH=/opt/ohif-panorama/source/platform/app/dist
OHIF_PUBLIC_URL=http://localhost:3000
SCREENSHOTS_DIR=/opt/ohif-panorama/screenshots
DATA_DIR=/opt/ohif-panorama/data

# S3 Credentials (заменить на реальные значения)
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_REGION=ru-msk
S3_ENDPOINT=https://s3.your-provider.com
S3_FORCE_PATH_STYLE=true
S3_BUCKET=your-bucket-name
S3_PREFIX=panorama/

LOG_DIR=/opt/ohif-panorama/logs

CHROMIUM_PATH=/usr/bin/chromium-browser

# Сохранить: Ctrl+O → Enter → Ctrl+X
```

---

## 7️⃣ Настройка PM2 (для автозапуска)

```bash
# Установить PM2 глобально
sudo npm install -g pm2

# Создать ecosystem.config.js
nano /opt/ohif-panorama/ecosystem.config.js

# Вставить:
module.exports = {
  apps: [
    {
      name: 'ohif-panorama-api',
      script: './server.js',
      cwd: '/opt/ohif-panorama',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};

# Сохранить: Ctrl+O → Enter → Ctrl+X

# Запустить через PM2
pm2 start ecosystem.config.js

# Настроить автозапуск при перезагрузке
pm2 startup
pm2 save

# Проверить статус
pm2 status
```

---

## 8️⃣ Проверка портов и firewall

```bash
# Открыть порты (если используется UFW)
sudo ufw allow 3001/tcp   # API сервер
sudo ufw allow 3000/tcp   # OHIF viewer (опционально)

# Проверить, что сервис запущен
curl http://localhost:3001/health
```

---

## 9️⃣ Логирование

```bash
# Смотреть логи в реальном времени
pm2 logs ohif-panorama-api

# Или
tail -f /opt/ohif-panorama/logs/out.log
```

---

## ✅ Checklist готовности

- [ ] Node.js v18+ установлен (`node --version`)
- [ ] Chromium установлен (`which chromium-browser`)
- [ ] OHIF клонирован и собран (проверить `/opt/ohif-panorama/source/platform/app/dist`)
- [ ] AWS credentials настроены (`cat ~/.aws/credentials`)
- [ ] .env файл создан
- [ ] PM2 установлен (`pm2 --version`)
- [ ] Порт 3001 открыт (`sudo netstat -tuln | grep 3001`)

---

## 🐛 Troubleshooting

**Проблема:** Chromium не запускается
```bash
chromium-browser --version
# Если не работает, переинсталляция:
sudo apt-get remove chromium-browser
sudo apt-get install chromium-browser
```

**Проблема:** Node modules не устанавливаются
```bash
cd /opt/ohif-panorama/source
npm cache clean --force
npm ci
```

**Проблема:** S3 access denied
```bash
# Проверить credentials
cat ~/.aws/credentials
# Проверить регион в .env совпадает с регионом S3 бакета
```

---

После выполнения этих шагов дай мне знать! Потом я напишу весь код. ✅
