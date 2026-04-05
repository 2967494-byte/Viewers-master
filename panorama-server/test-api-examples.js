/**
 * Примеры использования API Panorama Server
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3001';

// ============================================
// 1. ЗАПУСК ГЕНЕРАЦИИ ПАНОРАМЫ
// ============================================

async function generatePanorama() {
  try {
    console.log('[TEST] Запуск генерации панорамы...');

    const response = await axios.post(`${API_BASE}/api/panorama/generate`, {
      // Эти значения нужно заменить на реальные из твоего S3
      dicomInstanceUID: '1.2.3.4.5.123456789',
      s3Path: 's3://your-bucket/path/to/dicom.dcm',

      // Параметры (опциональные)
      rotationSteps: 36,           // 36 снимков = каждые 10 градусов
      angleDelta: 10,              // шаг поворота в градусах
      screenshotWidth: 1024,       // ширина скриншота
      screenshotHeight: 768,       // высота скриншота
      format: 'png'                // формат изображения
    });

    console.log('[SUCCESS] Задача создана:');
    console.log(JSON.stringify(response.data, null, 2));

    return response.data.jobId;

  } catch (error) {
    console.error('[ERROR] Ошибка при генерации:', error.response?.data || error.message);
    throw error;
  }
}

// ============================================
// 2. ПРОВЕРИТЬ СТАТУС ГЕНЕРАЦИИ
// ============================================

async function checkStatus(jobId) {
  try {
    console.log(`[TEST] Проверка статуса для job ${jobId}...`);

    const response = await axios.get(`${API_BASE}/api/panorama/status/${jobId}`);

    console.log('[STATUS]');
    console.log(JSON.stringify(response.data, null, 2));

    return response.data;

  } catch (error) {
    if (error.response?.status === 404) {
      console.log('[INFO] Задача ещё обрабатывается...');
    } else {
      console.error('[ERROR]', error.response?.data || error.message);
    }
    throw error;
  }
}

// ============================================
// 3. СПИСОК ВСЕХ ЗАВЕРШЁННЫХ ЗАДАЧ
// ============================================

async function listJobs() {
  try {
    console.log('[TEST] Получение списка задач...');

    const response = await axios.get(`${API_BASE}/api/panorama/list`);

    console.log(`[LIST] Всего завершено: ${response.data.total}`);
    response.data.jobs.forEach(job => {
      console.log(`  - ${job.jobId}: ${job.status} (${job.screenshotsCount} снимков)`);
    });

    return response.data;

  } catch (error) {
    console.error('[ERROR]', error.response?.data || error.message);
    throw error;
  }
}

// ============================================
// 4. СКАЧАТЬ АРХИВ РЕЗУЛЬТАТОВ
// ============================================

async function downloadResults(jobId) {
  try {
    console.log(`[TEST] Загрузка результатов для job ${jobId}...`);

    const response = await axios.get(`${API_BASE}/api/panorama/download/${jobId}`, {
      responseType: 'arraybuffer'
    });

    const fs = require('fs');
    const filename = `panorama-${jobId}.zip`;
    fs.writeFileSync(filename, response.data);

    console.log(`[SUCCESS] Архив сохранён: ${filename}`);
    return filename;

  } catch (error) {
    console.error('[ERROR]', error.response?.data || error.message);
    throw error;
  }
}

// ============================================
// 5. ОСНОВНОЙ ТЕСТОВЫЙ ЦИКЛ
// ============================================

async function runTest() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          OHIF Panorama Server - API Test                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Шаг 1: Проверить health
    console.log('┌─ STEP 1: Проверка подключения\n');
    const healthCheck = await axios.get(`${API_BASE}/health`);
    console.log('[OK] Сервер доступен');
    console.log(`    Uptime: ${healthCheck.data.uptime.toFixed(2)}s\n`);

    // Шаг 2: Запустить генерацию
    console.log('┌─ STEP 2: Запуск генерации панорамы\n');

    console.log('⚠️  ВНИМАНИЕ: Замените значения на реальные:');
    console.log('  - dicomInstanceUID: ID из сама базы');
    console.log('  - s3Path: путь до DICOM файла в S3');
    console.log('');
    console.log('Пример использования:');
    console.log(`
    const jobId = await generatePanorama();
    // Ждём обработки (может быть 1-5 минут)...
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Шаг 3: Проверить статус
    const status = await checkStatus(jobId);

    // Если status === 'success', скачиваем результаты
    if (status.status === 'success') {
      const filename = await downloadResults(jobId);
      console.log('✅ Готово!');
    }
    `);

    // Шаг 3: Список всех задач
    console.log('\n┌─ STEP 3: Список завершённых задач\n');
    await listJobs();

  } catch (error) {
    console.error('\n[FATAL ERROR]', error.message);
    process.exit(1);
  }
}

// ============================================
// EXPORT для использования в других модулях
// ============================================

module.exports = {
  generatePanorama,
  checkStatus,
  listJobs,
  downloadResults
};

// Запустить тест если файл запущен напрямую
if (require.main === module) {
  runTest().catch(console.error);
}
