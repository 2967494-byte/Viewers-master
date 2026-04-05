# 🦷 Dental Panorama PoC — Полный план развёртывания на Ubuntu

## Концепция

Пользователь загружает DICOM файлы через веб-интерфейс → сервер загружает их в Orthanc →
Puppeteer открывает OHIF в headless Chromium → делает 40 скриншотов 3D черепа с поворотом →
склеивает в панорамный снимок → возвращает пользователю.

---

## Архитектура

```
┌─────────────────────────────────────────────────────────┐
│                    БРАУЗЕР ПОЛЬЗОВАТЕЛЯ                   │
│                                                           │
│  http://SERVER:4000                                       │
│  ┌─────────────────────────────────────────────────┐     │
│  │  Web UI  │  Выбрать папку / Upload DICOM файлы  │     │
│  │          │  [Кнопка: Создать панораму]           │     │
│  │          │  [Статус: обработка... готово!]       │     │
│  │          │  [Результат: изображение панорамы]    │     │
│  └─────────────────────────────────────────────────┘     │
└───────────────────┬─────────────────────────────────────┘
                    │ POST /upload + POST /generate
                    ▼
┌─────────────────────────────────────────────────────────┐
│              СЕРВЕР Ubuntu (один сервер)                  │
│                                                           │
│  ┌──────────────┐   ┌────────────────┐   ┌───────────┐  │
│  │  Main API    │   │  OHIF Viewer   │   │  Orthanc  │  │
│  │  (порт 4000) │──▶│  (порт 3000)   │──▶│ (порт 8042│  │
│  │              │   │                │   │           │  │
│  │  Express.js  │   │  3D CT-Bone    │   │  DICOM    │  │
│  │  + Puppeteer │   │  рендеринг     │   │  хранилище│  │
│  └──────────────┘   └────────────────┘   └───────────┘  │
│         │                                                 │
│         │ spawn headless browser                          │
│         ▼                                                 │
│  ┌──────────────┐                                        │
│  │  Chromium    │ (headless, невидимый)                  │
│  │  Puppeteer   │ → делает 40 скриншотов за ~2 мин       │
│  │  → stitch.js │ → склеивает в панораму                 │
│  └──────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

## Итоговый стек

| Компонент            | Технология                | Порт |
|----------------------|---------------------------|------|
| Главный UI + API     | Node.js / Express         | 4000 |
| 3D Рендеринг         | OHIF Viewer (собранный)   | 3000 |
| DICOM хранилище      | Orthanc (Docker)          | 8042 |
| Headless браузер     | Chromium / Puppeteer      | —    |
| Склейка изображений  | sharp (Node.js)           | —    |
| Менеджер процессов   | PM2                       | —    |

---

## ЧАСТЬ 1: Подготовка сервера

### 1.1 Системные требования

```
ОС:    Ubuntu 22.04 LTS (минимум 20.04)
CPU:   4 cores (для Puppeteer + Orthanc)
RAM:   8 GB минимум (16 GB рекомендуется для CBCT)
Disk:  50 GB (DICOM файлы могут быть большими)
```

### 1.2 Первичная настройка

```bash
# Обновить систему
sudo apt update && sudo apt upgrade -y

# Добавить swap (критично если RAM = 8GB)
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Установить базовые зависимости
sudo apt install -y \
  curl git wget unzip \
  build-essential \
  software-properties-common \
  ca-certificates \
  gnupg

# Настроить брандмауэр
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 4000/tcp  # Основной UI
sudo ufw allow 3000/tcp  # OHIF (внутренний, можно закрыть позже)
sudo ufw allow 8042/tcp  # Orthanc (внутренний, можно закрыть позже)
sudo ufw enable
```

---

## ЧАСТЬ 2: Установка Node.js

```bash
# Установить Node.js 20 LTS через NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Проверить
node --version   # должно быть v20.x.x
npm --version

# Установить PM2 глобально
sudo npm install -g pm2
```

---

## ЧАСТЬ 3: Установка Chromium для Puppeteer

```bash
# Установить Chromium и все его зависимости
sudo apt install -y \
  chromium-browser \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libgconf-2-4 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  xdg-utils

# Запомнить путь
which chromium-browser   # обычно /usr/bin/chromium-browser
chromium-browser --version
```

---

## ЧАСТЬ 4: Установка Docker и Orthanc

```bash
# Установить Docker
sudo apt install -y docker.io docker-compose
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
newgrp docker   # применить группу без перезапуска

# Проверить
docker --version

# Создать директорию для Orthanc
sudo mkdir -p /opt/panorama/orthanc-db
sudo chown $USER:$USER /opt/panorama

# Конфигурация Orthanc
cat > /opt/panorama/orthanc.json << 'EOF'
{
  "Name": "PanoramaOrthanc",
  "StorageDirectory": "/var/lib/orthanc/db",
  "IndexDirectory": "/var/lib/orthanc/db",
  "HttpServerEnabled": true,
  "HttpPort": 8042,
  "AuthenticationEnabled": false,
  "RemoteAccessAllowed": true,
  "DicomWeb": {
    "Enable": true,
    "Root": "/dicom-web/",
    "EnableWado": true,
    "WadoRoot": "/wado"
  }
}
EOF

# Запустить Orthanc с плагином DicomWeb
docker run -d \
  --name orthanc \
  --restart unless-stopped \
  -p 8042:8042 \
  -p 4242:4242 \
  -v /opt/panorama/orthanc-db:/var/lib/orthanc/db \
  -v /opt/panorama/orthanc.json:/etc/orthanc/orthanc.json:ro \
  orthancteam/orthanc:latest

# Подождать 10 секунд и проверить
sleep 10
curl http://localhost:8042/system
# Должен вернуть JSON с информацией о сервере
```

---

## ЧАСТЬ 5: Клонирование и сборка OHIF

```bash
# Создать структуру директорий
mkdir -p /opt/panorama/{source,uploads,output,temp,logs}
cd /opt/panorama

# Вариант A: клонировать репозиторий (форк с изменениями)
git clone https://github.com/YOUR_USERNAME/Viewers-master.git source

# Вариант B (БЫСТРЕЕ): собрать на локальной Windows машине и скопировать dist
# Локально: npm run build
# Затем: scp -r platform/app/dist user@SERVER:/opt/panorama/ohif-dist
# На сервере: sudo npm install -g serve
# Запуск: serve -s /opt/panorama/ohif-dist -l 3000

cd /opt/panorama/source

# Если клонировали репозиторий — установить зависимости (5-15 минут)
npm ci --legacy-peer-deps

# Создать конфиг OHIF для подключения к Orthanc
cat > /opt/panorama/source/platform/app/public/app-config.js << 'EOF'
window.config = {
  routerBasename: '/',
  showStudyList: true,
  extensions: [],
  modes: [],
  customizationService: {},
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: false,
  strictZSpacingForVolumeViewport: false,
  defaultDataSourceName: 'dicomweb',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        name: 'orthanc',
        wadoUriRoot: 'http://localhost:8042/wado',
        qidoRoot: 'http://localhost:8042/dicom-web',
        wadoRoot: 'http://localhost:8042/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: false,
        staticWado: false,
        singlepart: 'bulkdata,video',
      },
    },
  ],
};
EOF

# Собрать OHIF (10-20 минут!)
npm run build

# Проверить что собралось
ls platform/app/dist/
```

> ⚠️ **Рекомендация:** Собрать OHIF на **локальной Windows машине** где уже есть репозиторий,
> и скопировать папку `dist` на сервер через scp. Намного быстрее.

---

## ЧАСТЬ 6: Создание главного приложения

```bash
cd /opt/panorama

# Инициализировать npm проект
npm init -y

# Установить зависимости
npm install express puppeteer-core multer cors uuid sharp
```

Нужно создать следующие файлы (код создаётся отдельно):

### `server.js` — главный Express сервер
**Эндпоинты:**
- `POST /api/upload` — загрузить DICOM файлы (multipart/form-data)
- `POST /api/generate` — запустить генерацию панорамы (передать studyUID)
- `GET  /api/status/:jobId` — polling статуса задачи
- `GET  /api/result/:jobId` — скачать/просмотреть готовую панораму
- `GET  /api/health` — healthcheck
- `GET  /` — статический Web UI

### `panorama-capture.js` — Puppeteer логика
**Алгоритм:**
1. Открыть Chromium headless
2. Перейти на `http://localhost:3000/panorama-capture?studyUID=XXX`
3. Ждать `window.__panoramaReady === true` (таймаут 120 сек)
4. Цикл: для каждого угла от -40° до +40° с шагом 2° (итого 40 снимков):
   - `window.__panoramaAPI.rotateTo(angle)`
   - `window.__panoramaAPI.waitForRender()`
   - сделать скриншот canvas `#panorama-3d-canvas`
   - сохранить как `temp/frame-NNN.png`
5. Передать список файлов в `stitch.js`

**Параметры съёмки:**
- Диапазон углов: -40° … +40° (сектор 80° — дуга челюсти)
- Шаг: 2° → 40 кадров
- Высота камеры: уровень зубов (focalPoint.y смещён вниз)
- Пресет: CT-Bone (уже настроен в `only3D` layout)

### `stitch.js` — склейка панорамы
**Алгоритм:**
1. Из каждого кадра вырезать центральную вертикальную полосу
   - ширина полосы = `viewport_width / frames_count`
2. Склеить все полосы горизонтально через `sharp`
3. Постобработка:
   - `.normalise()` — авто-контраст
   - `.sharpen()` — резкость
   - `.gamma(1.5)` — гамма коррекция
4. Сохранить как `output/<jobId>/panorama.jpg`

### `public/index.html` — Web UI
**Функционал:**
- Drag & Drop зона для DICOM файлов (`.dcm`)
- Прогресс загрузки файлов
- Кнопка «Создать панораму»
- Polling статуса каждые 3 секунды
- Отображение готового изображения
- Кнопка «Скачать»

---

## ЧАСТЬ 7: Добавление страницы захвата в OHIF

В OHIF репозитории (локально на Windows) нужно создать:

### `platform/app/src/routes/PanoramaCapture/PanoramaCapturePage.tsx`

**Логика страницы:**
```
1. Прочитать studyUID из URL: ?studyUID=1.2.3...
2. Загрузить исследование через OHIF API
3. Применить layout 'only3D' с пресетом CT-Bone
4. Подписаться на событие VOLUME_LOADED из cornerstoneJS
5. После загрузки установить:
   window.__panoramaReady = true
   window.__panoramaAPI = {
     rotateTo(azimuthDegrees),  // поворот камеры вокруг вертикальной оси Y
     captureCanvas(),            // возвращает HTMLCanvasElement '#panorama-3d-canvas'
     waitForRender()             // Promise — ждёт requestAnimationFrame после render()
   }
```

**Логика `rotateTo(angle)` — из уже существующего кода:**
```typescript
// Взята из VolumeRotateMouseWheelTool.ts и _rotateViewport в commandsModule.ts
const camera = viewport.getCamera();
const { position, focalPoint, viewUp } = camera;
const verticalAxis = vec3.fromValues(0, 1, 0);          // мировая ось Y
const radians = (targetAngle * Math.PI) / 180;
// orbit: вращаем position вокруг focalPoint
const offset = vec3.sub(vec3.create(), position, focalPoint);
const rotMat = mat4.fromRotation(mat4.create(), radians, verticalAxis);
const newOffset = vec3.transformMat4(vec3.create(), offset, rotMat);
const newPosition = vec3.add(vec3.create(), focalPoint, newOffset);
viewport.setCamera({ position: newPosition, viewUp: [0, 1, 0] });
viewport.render();
```

### Зарегистрировать route в `platform/app/src/routes/index.tsx`:
```typescript
{
  path: '/panorama-capture',
  component: PanoramaCapturePage,
}
```

### После изменений — пересобрать и скопировать на сервер:
```bash
# Локально на Windows:
npm run build
# Скопировать dist на сервер:
scp -r platform/app/dist user@SERVER:/opt/panorama/ohif-dist
```

---

## ЧАСТЬ 8: Настройка PM2

```bash
# Создать ecosystem файл
cat > /opt/panorama/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'panorama-main',
      script: './server.js',
      cwd: '/opt/panorama',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        OHIF_URL: 'http://localhost:3000',
        ORTHANC_URL: 'http://localhost:8042',
        CHROMIUM_PATH: '/usr/bin/chromium-browser',
        UPLOADS_DIR: '/opt/panorama/uploads',
        OUTPUT_DIR: '/opt/panorama/output',
        TEMP_DIR: '/opt/panorama/temp',
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'ohif-viewer',
      script: 'serve',
      interpreter: 'none',
      args: '-s /opt/panorama/ohif-dist -l 3000',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
EOF

# Установить serve для OHIF
sudo npm install -g serve

# Запустить всё
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # скопировать и выполнить команду которую выведет
```

---

## ЧАСТЬ 9: Проверка работоспособности

```bash
# 1. Проверить Orthanc
curl http://localhost:8042/system
curl http://localhost:8042/dicom-web/studies

# 2. Проверить OHIF
curl -I http://localhost:3000
# Должен вернуть HTTP 200

# 3. Проверить главный сервер
curl http://localhost:4000/api/health

# 4. Посмотреть логи
pm2 logs panorama-main --lines 50
docker logs orthanc --tail 20

# 5. Открыть в браузере
# http://SERVER_IP:4000
```

---

## ЧАСТЬ 10: Сценарий использования (после развёртывания)

```
1. Открыть http://SERVER_IP:4000 в браузере

2. Перетащить DICOM файлы (.dcm) в зону загрузки
   → прогресс бар загрузки → "Загружено N файлов"
   → файлы автоматически отправляются в Orthanc

3. Нажать "Создать панораму"
   → статус: "Запуск 3D рендеринга..."
   → статус: "Снимок 5/40..."
   → статус: "Склейка изображения..."

4. Через 2-3 минуты:
   → появляется готовое панорамное изображение
   → кнопка "Скачать"
```

---

## ЧАСТЬ 11: Troubleshooting

### Orthanc не принимает DICOM файлы
```bash
# Проверить что плагин DicomWeb активен
curl http://localhost:8042/plugins
# Должен содержать "dicom-web"

# Загрузить тестовый файл вручную
curl -X POST http://localhost:8042/instances \
  --data-binary @/path/to/file.dcm \
  -H "Content-Type: application/dicom"
```

### Puppeteer падает / Chromium не запускается
```bash
# Тест запуска Chromium
chromium-browser --headless --no-sandbox --disable-gpu \
  --screenshot=/tmp/test.png https://google.com
ls -la /tmp/test.png

# Если ошибка песочницы — добавить в Puppeteer args:
# '--no-sandbox', '--disable-setuid-sandbox'
```

### OHIF не видит исследования в Orthanc
```bash
# Проверить DICOMweb endpoint
curl http://localhost:8042/dicom-web/studies
# Должен вернуть JSON массив (пустой [] если нет исследований)

# Если возвращает 404 — DicomWeb плагин не установлен
# Использовать образ orthancteam/orthanc:latest (включает плагины)
```

### window.__panoramaReady никогда не становится true
```bash
# Открыть OHIF вручную в браузере и проверить консоль
http://localhost:3000/panorama-capture?studyUID=STUDY_UID
# F12 → Console → проверить ошибки загрузки
```

### Нехватка памяти при загрузке CBCT (451 срез)
```bash
# Убедиться что swap активен
free -h
# Увеличить Node.js heap
NODE_OPTIONS="--max-old-space-size=4096" pm2 restart panorama-main
```

---

## Следующие шаги (после PoC)

1. **Улучшить качество панорамы:**
   - Настроить Window/Level в OHIF пресете специально для зубов
   - Поэкспериментировать с диапазоном углов и количеством кадров
   - Добавить CLAHE постобработку

2. **Оптимизировать скорость:**
   - Параллельный рендеринг нескольких задач
   - Кеширование загруженных исследований

3. **Улучшить UI:**
   - Параметры настройки (углы, количество кадров, пресет)
   - Предпросмотр отдельных кадров
   - История сгенерированных панорам

---

*Создан: 2026-02-27*
*Версия плана: 1.0*
