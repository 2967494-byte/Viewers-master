# Установка и настройка OHIF Viewer (этот форк) на Ubuntu Server

Документ описывает развёртывание на **чистой виртуальной машине с Ubuntu** (рекомендуется **22.04 LTS** или **24.04 LTS**). После запуска в браузере открывается **`http://localhost:3000/`** (или `http://<IP-сервера>:3000/`) — стартовая страница с **загрузкой DICOM-файлов** с диска (режим локальных файлов и сегментации).

> **Важно:** в `platform/app/src/routes/index.tsx` корневой маршрут `/` уже настроен на компонент локальной загрузки с переходом в `segmentation/dicomlocal`. Отдельно менять маршрутизацию для описанного сценария не требуется.

---

## 1. Требования

| Ресурс | Минимум / рекомендация |
|--------|-------------------------|
| ОС | Ubuntu 22.04 или 24.04 (amd64) |
| RAM | **не менее 8 ГБ** для стабильной сборки (webpack использует до ~8 ГБ heap) |
| Диск | **не менее 15–20 ГБ** свободного места (репозиторий + `node_modules` + артефакты сборки) |
| Сеть | доступ в интернет для `apt` и загрузки зависимостей npm |

Пользователь, от имени которого выполняется установка, должен иметь права `sudo`.

---

## 2. Базовая подготовка системы

```bash
sudo apt-get update
sudo apt-get upgrade -y

sudo apt-get install -y \
  git \
  curl \
  ca-certificates \
  build-essential \
  python3
```

`build-essential` и `python3` часто нужны для нативных зависимостей Node.js.

---

## 3. Node.js (версия 18 или новее)

Проект в `package.json` указывает `"node": ">=18"`. Удобно поставить **Node.js 20 LTS** через **nvm** (не конфликтует с системным пакетом `nodejs`).

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

Закройте сессию SSH и зайдите снова, либо выполните:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

Установка и выбор версии:

```bash
nvm install 20
nvm use 20
nvm alias default 20

node --version   # ожидается v20.x
```

---

## 4. Yarn Classic (1.22.x)

Монорепозиторий собирается через **Yarn 1** (см. `packageManager` в корневом `package.json`).

```bash
npm install -g yarn@1.22.22
yarn --version
```

---

## 5. Получение исходного кода

Замените URL на свой (форк, зеркало или внутренний Git-сервер).

```bash
sudo mkdir -p /opt/ohif-viewer
sudo chown "$USER:$USER" /opt/ohif-viewer
cd /opt/ohif-viewer

git clone <URL_ВАШЕГО_РЕПОЗИТОРИЯ> Viewers
cd Viewers
```

Если репозиторий приватный — настройте SSH-ключ или токен доступа к Git.

---

## 6. Установка зависимостей

Из **корня** репозитория:

```bash
cd /opt/ohif-viewer/Viewers
yarn install --frozen-lockfile
```

При ошибках сети или кэша:

```bash
yarn cache clean
yarn install --frozen-lockfile
```

---

## 7. Режим разработки (порт 3000 по умолчанию)

Сервер разработки задаётся в `platform/app/.webpack/webpack.pwa.js` переменной **`OHIF_PORT`** (по умолчанию **3000**).

```bash
cd /opt/ohif-viewer/Viewers
yarn dev
```

Дождитесь сообщения компиляции и откройте в браузере:

- на самой машине: **http://localhost:3000/**
- с другого ПК в сети: **http://&lt;IP_сервера&gt;:3000/** (см. раздел про firewall).

Остановка: `Ctrl+C` в терминале.

При необходимости другой порт:

```bash
OHIF_PORT=8080 yarn dev
```

Конфиг приложения по умолчанию подхватывается из `platform/app/public/config/default.js` (переменная окружения **`APP_CONFIG`** при сборке; для `yarn dev` без переопределения используется `config/default.js`).

---

## 8. Продакшен-сборка

```bash
cd /opt/ohif-viewer/Viewers
yarn build
```

Готовые статические файлы: **`platform/app/dist/`**.

Если сборка падает с ошибкой нехватки памяти:

```bash
export NODE_OPTIONS=--max-old-space-size=8192
yarn build
```

### 8.1. Быстрая раздача статики (проверка)

Из каталога приложения:

```bash
cd /opt/ohif-viewer/Viewers/platform/app
npx --yes serve -s dist -l 3000
```

Флаг **`-s`** включает режим **SPA**: для путей без файла отдаётся `index.html`.

Откройте **http://localhost:3000/**.

### 8.2. PM2 (автозапуск после перезагрузки)

```bash
sudo npm install -g pm2
cd /opt/ohif-viewer/Viewers/platform/app
pm2 serve dist 3000 --spa --name ohif-viewer
pm2 save
pm2 startup
# выполните команду, которую выведет pm2 startup (с sudo)
```

---

## 9. Nginx (опционально, порт 80 / HTTPS)

Пример виртуального хоста для раздачи `dist` и поддержки client-side routing:

```nginx
server {
    listen 80;
    server_name _;

    root /opt/ohif-viewer/Viewers/platform/app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Установка и включение:

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/ohif-viewer
# вставьте конфиг выше, поправьте root при другом пути
sudo ln -sf /etc/nginx/sites-available/ohif-viewer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Для HTTPS используйте **Certbot** (`certbot --nginx`) или корпоративные сертификаты — по политике вашей организации.

---

## 10. Firewall

Если включён **UFW**:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 3000/tcp comment 'OHIF dev or pm2 serve'
# или после настройки nginx:
# sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## 11. Поведение после установки

1. Откройте **`http://<хост>:3000/`** (или порт/протокол, который вы настроили).
2. Должна открыться страница **загрузки DICOM** (перетаскивание файлов или выбор папки/файлов).
3. После выбора данных выполняется переход в просмотр (в этом форке — режим **segmentation** с источником **dicomlocal**).

Отдельный PACS или DICOMweb для этой точки входа **не обязателен** — данные читаются в браузере из выбранных файлов.

---

## 12. Дополнительно: отдельный конфиг без пересборки (runtime)

Включение динамической подгрузки конфига задаётся в `window.config` (см. комментарии в `default.js` про `dangerouslyUseDynamicConfig`). Для продакшена чаще достаточно собрать с нужным **`APP_CONFIG`**:

```bash
cd /opt/ohif-viewer/Viewers
APP_CONFIG=config/local_static.js yarn build
```

Переменная **`APP_CONFIG`** задаёт файл из `platform/app/public/config/` (относительно каталога `public`). Сборку удобно запускать **из корня монорепозитория**, как обычный `yarn build`.

---

## 13. Опционально: сервис Panorama

В каталоге **`panorama-server/`** лежит отдельный Node.js-сервис (S3, скриншоты и т.д.). Он **не обязателен** для работы страницы загрузки DICOM на `:3000`. Краткие инструкции см. в:

- `panorama-server/QUICK_START.md`
- `panorama-server/DEPLOYMENT.md`

---

## 14. Устранение неполадок

| Симптом | Действия |
|---------|----------|
| `yarn: command not found` | Установите Yarn (раздел 4), перезапустите shell. |
| Сборка падает по памяти | `export NODE_OPTIONS=--max-old-space-size=8192`, увеличьте RAM ВМ. |
| Пустая страница / 404 при обновлении URL | Для SPA нужен fallback на `index.html` (`serve -s`, `try_files` в nginx). |
| Порт занят | `OHIF_PORT=8080 yarn dev` или смените порт в `pm2 serve` / nginx. |
| Старый кэш webpack | `yarn dev:no:cache` из корня (скрипт в корневом `package.json`). |

---

## 15. Краткий чеклист команд (копирование блоком)

```bash
# Система
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y git curl ca-certificates build-essential python3

# Node 20 через nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm alias default 20

# Yarn
npm install -g yarn@1.22.22

# Код и зависимости
sudo mkdir -p /opt/ohif-viewer && sudo chown "$USER:$USER" /opt/ohif-viewer
cd /opt/ohif-viewer
git clone <URL_ВАШЕГО_РЕПОЗИТОРИЯ> Viewers
cd Viewers
yarn install --frozen-lockfile

# Запуск (разработка)
yarn dev
# Браузер: http://localhost:3000/
```

После этого интерфейс по адресу **`http://localhost:3000/`** соответствует сценарию **загрузки DICOM-файлов** из этого репозитория.
