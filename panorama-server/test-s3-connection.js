#!/usr/bin/env node

/**
 * S3 Connection Test
 * Проверяет что S3 credentials работают правильно
 */

require('dotenv').config();
const AWS = require('aws-sdk');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║          S3 Configuration Test                             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// ============================================
// 1. Проверка переменных окружения
// ============================================

console.log('📋 STEP 1: Проверка переменных окружения\n');

const requiredVars = [
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_BUCKET'
];

let allVarsPresent = true;

requiredVars.forEach(varName => {
  const value = process.env[varName];
  const status = value ? '✅' : '❌';
  const display = value
    ? (varName.includes('SECRET') ? value.substring(0, 10) + '...' : value)
    : 'NOT SET';

  console.log(`${status} ${varName}: ${display}`);

  if (!value) allVarsPresent = false;
});

if (!allVarsPresent) {
  console.log('\n❌ Ошибка: Не все переменные окружения установлены!');
  console.log('📝 Проверьте файл .env и убедитесь что там заполнены все S3_* переменные\n');
  process.exit(1);
}

console.log('\n✅ Все переменные окружения правильно установлены\n');

// ============================================
// 2. Инициализация S3 клиента
// ============================================

console.log('🔌 STEP 2: Инициализация S3 клиента\n');

const s3Config = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
};

console.log('S3 configuration:');
console.log(`  Region: ${s3Config.region}`);
console.log(`  Endpoint: ${s3Config.endpoint}`);
console.log(`  Force Path Style: ${s3Config.s3ForcePathStyle}`);
console.log(`  Access Key ID: ${s3Config.accessKeyId.substring(0, 10)}...`);

try {
  const s3 = new AWS.S3(s3Config);
  console.log('\n✅ S3 клиент инициализирован успешно\n');

  // ============================================
  // 3. Тест подключения: listBuckets
  // ============================================

  console.log('🪣 STEP 3: Тест доступа - получение списка бакетов\n');

  s3.listBuckets((err, data) => {
    if (err) {
      console.log(`❌ Ошибка при подключении к S3:\n   ${err.message}\n`);

      if (err.message.includes('Credentials')) {
        console.log('💡 Совет: Проверьте S3_ACCESS_KEY_ID и S3_SECRET_ACCESS_KEY\n');
      }
      if (err.message.includes('timeout')) {
        console.log('💡 Совет: Проверьте доступность S3_ENDPOINT и интернет соединение\n');
      }

      process.exit(1);
    }

    if (!data.Buckets || data.Buckets.length === 0) {
      console.log('⚠️  Внимание: Не найдено ни одного бакета\n');
    } else {
      console.log(`✅ Найдено ${data.Buckets.length} бакет(ов):\n`);
      data.Buckets.forEach(bucket => {
        console.log(`   📦 ${bucket.Name}`);
      });
      console.log('');
    }

    // ============================================
    // 4. Проверка целевого бакета
    // ============================================

    console.log('🎯 STEP 4: Проверка целевого бакета\n');

    const targetBucket = process.env.S3_BUCKET;
    console.log(`Проверяю доступ к бакету: ${targetBucket}\n`);

    const bucketExists = data.Buckets.some(b => b.Name === targetBucket);

    if (!bucketExists) {
      console.log(`❌ Ошибка: Бакет '${targetBucket}' не найден в списке доступных\n`);
      console.log('Возможные причины:');
      console.log('  1. Вы не имеете доступ к этому бакету');
      console.log('  2. Бакет не существует');
      console.log('  3. Неправильное имя бакета в S3_BUCKET\n');
      process.exit(1);
    }

    console.log(`✅ Бакет '${targetBucket}' доступен\n`);

    // ============================================
    // 5. Тест загрузки файла (опционально)
    // ============================================

    console.log('📤 STEP 5: Тест загрузки файла\n');

    const testKey = `${process.env.S3_PREFIX || 'panorama/'}test-connection-${Date.now()}.txt`;
    const testData = `Test file created at ${new Date().toISOString()}`;

    s3.putObject({
      Bucket: targetBucket,
      Key: testKey,
      Body: testData,
      ContentType: 'text/plain',
      Metadata: {
        'test': 'true'
      }
    }, (err, uploadData) => {
      if (err) {
        console.log(`❌ Ошибка при загрузке файла:\n   ${err.message}\n`);
        process.exit(1);
      }

      console.log(`✅ Файл успешно загружен`);
      console.log(`   Bucket: ${targetBucket}`);
      console.log(`   Key: ${testKey}`);
      console.log(`   ETag: ${uploadData.ETag}\n`);

      // ============================================
      // 6. Очистка: удалить тестовый файл
      // ============================================

      console.log('🧹 STEP 6: Очистка тестовых данных\n');

      s3.deleteObject({
        Bucket: targetBucket,
        Key: testKey
      }, (err) => {
        if (err) {
          console.log(`⚠️  Предупреждение при удалении тестового файла:\n   ${err.message}\n`);
        } else {
          console.log(`✅ Тестовый файл удален\n`);
        }

        // ============================================
        // Итоговый результат
        // ============================================

        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║                     ✅ УСПЕХ                              ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        console.log('✨ Все проверки прошли успешно!');
        console.log('Ваша S3 конфигурация готова к использованию.\n');

        console.log('📝 Сводка:');
        console.log(`   Provider: ${process.env.S3_ENDPOINT}`);
        console.log(`   Region: ${process.env.S3_REGION}`);
        console.log(`   Bucket: ${targetBucket}`);
        console.log(`   Access: ✅ OK\n`);

        console.log('🚀 Вы можете запустить микросервис командой:');
        console.log('   npm start\n');
      });
    });
  });

} catch (error) {
  console.log(`❌ Критическая ошибка при инициализации S3:\n   ${error.message}\n`);
  process.exit(1);
}
