# Конфигурация AWS SDK v2 и S3

## Важно! Переменные окружения для AWS SDK v2

Приложение использует **AWS SDK v2**, который требует специальный формат переменных окружения.

### ✅ Правильный формат переменных

```bash
# Все переменные должны иметь префикс S3_
S3_ACCESS_KEY_ID=your-key-id
S3_SECRET_ACCESS_KEY=your-secret-key
S3_REGION=ru-msk
S3_ENDPOINT=https://storage.yandexcloud.net
S3_BUCKET=your-bucket-name
S3_PREFIX=panorama/
S3_FORCE_PATH_STYLE=true
```

### ❌ Неправильный формат (не работает)

```bash
# Эти переменные будут игнорироваться AWS SDK v2!
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=...
```

---

## Конфигурация для разных S3 провайдеров

### 🟨 Yandex Cloud

```bash
S3_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_REGION=ru-msk
S3_ENDPOINT=https://storage.yandexcloud.net
S3_BUCKET=my-bucket
S3_FORCE_PATH_STYLE=true
```

**Как получить credentials в Yandex Cloud:**
1. Перейти в https://console.cloud.yandex.ru
2. Создать service account
3. Создать static access key
4. Скопировать Access Key ID и Secret Access Key

---

### ☁️ AWS S3

```bash
S3_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_REGION=us-east-1
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=my-bucket
S3_FORCE_PATH_STYLE=false
```

---

### 🐳 MinIO (локальный S3)

```bash
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_REGION=us-east-1
S3_ENDPOINT=http://minio-server:9000
S3_BUCKET=my-bucket
S3_FORCE_PATH_STYLE=true
```

---

### 🌊 DigitalOcean Spaces

```bash
S3_ACCESS_KEY_ID=your-spaces-key
S3_SECRET_ACCESS_KEY=your-spaces-secret
S3_REGION=nyc3
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_BUCKET=my-space-name
S3_FORCE_PATH_STYLE=true
```

---

## Проверка конфигурации

Проверить что credentials работают:

```bash
# 1. Убедитесь что .env файл заполнен:
cat /opt/ohif-panorama/.env | grep S3_

# 2. Проверить что переменные загружены:
node -e "require('dotenv').config(); console.log(process.env.S3_ACCESS_KEY_ID)"

# 3. Тестовое подключение:
node -e "
require('dotenv').config();
const AWS = require('aws-sdk');
const s3 = new AWS.S3({
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
});
s3.listBuckets((err, data) => {
  if (err) {
    console.error('❌ Ошибка:', err.message);
  } else {
    console.log('✅ Успешно! Бакеты:', data.Buckets.map(b => b.Name));
  }
});
"
```

---

## Альтернатива: AWS CLI конфигурация

Если вы хотите использовать стандартный `~/.aws/credentials` вместо .env:

```bash
# 1. Создать ~/.aws/credentials
mkdir -p ~/.aws
nano ~/.aws/credentials

# Вставить:
[default]
aws_access_key_id = your-key-id
aws_secret_access_key = your-secret-key

# 2. Создать ~/.aws/config
nano ~/.aws/config

# Вставить:
[default]
region = ru-msk
```

**ОДНАКО:** Наше приложение использует переменные окружения из .env, поэтому рекомендуется использовать .env файл.

---

## Troubleshooting

### ❌ Ошибка: "Credentials not found"

```bash
# Убедитесь что .env содержит эти строки:
grep -E "S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY" /opt/ohif-panorama/.env

# Проверьте что переменные не пустые
cat /opt/ohif-panorama/.env | grep S3_
```

### ❌ Ошибка: "Access Denied"

```bash
# Проверьте credentials в S3:
# - Access Key ID правильный?
# - Secret Access Key правильный?
# - Пользователь имеет доступ к бакету?
# - Не просрочились ли старые ключи?

# Пересоздайте ключи и обновите .env
```

### ❌ Ошибка: "InvalidAddress / Cannot connect to host"

```bash
# Проверьте S3_ENDPOINT:
curl -I https://storage.yandexcloud.net

# Если ошибка - проверьте:
# - Правильный endpoint для вашего провайдера
# - Интернет соединение на сервере
# - Firewall не блокирует HTTPS
```

### ❌ Ошибка: "NoSuchBucket"

```bash
# Проверьте что бакет существует и создан:
# Присутствует ли в списке?
node -e "
require('dotenv').config();
const AWS = require('aws-sdk');
const s3 = new AWS.S3({
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
});
s3.listBuckets((err, data) => {
  console.log(data.Buckets.map(b => b.Name));
});
"

# Проверьте имя бакета в .env совпадает точно
```

---

## Когда что использовать

| Сценарий | Решение |
|----------|---------|
| Разработка локально | Используйте MinIO в Docker |
| Продакшн на AWS | AWS S3 + IAM credentials |
| Серверные решения | Yandex Cloud, DigitalOcean |
| Гибридное облако | MinIO self-hosted |

Выберите подходящий сценарий и заполните .env правильно! 🚀
