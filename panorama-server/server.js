/**
 * OHIF Panorama Micro Service
 * API сервер для генерации панорамных изображений
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const PanoramaGenerator = require('./lib/panorama-generator');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.static(process.env.OHIF_BUILD_PATH));

// Logger
const logDir = process.env.LOG_DIR || './logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFile = path.join(logDir, 'api.log');

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  console.log(logMessage);
  fs.appendFileSync(logFile, logMessage);
}

// ============================================
// API Endpoints
// ============================================

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * POST /api/panorama/generate
 * Генерирует панорамный снимок из 3D модели
 *
 * Body:
 * {
 *   "dicomInstanceUID": "1.2.3.4.5",
 *   "s3Path": "path/to/dicom.dcm",
 *   "rotationSteps": 36,           // optional, default 36
 *   "angleDelta": 10,              // optional, degree between shots, default 10
 *   "screenshotWidth": 1024,       // optional, default 1024
 *   "screenshotHeight": 768,       // optional, default 768
 *   "format": "png"                // optional, default png
 * }
 *
 * Response:
 * {
 *   "jobId": "uuid",
 *   "status": "processing|success|error",
 *   "message": "Description",
 *   "screenshotsCount": 36,
 *   "outputDir": "/path/to/screenshots",
 *   "s3Url": "s3://bucket/panorama/..."
 * }
 */
app.post('/api/panorama/generate', async (req, res) => {
  const {
    dicomInstanceUID,
    s3Path,
    rotationSteps = 36,
    angleDelta = 10,
    screenshotWidth = 1024,
    screenshotHeight = 768,
    format = 'png'
  } = req.body;

  // Валидация
  if (!dicomInstanceUID || !s3Path) {
    return res.status(400).json({
      status: 'error',
      message: 'Missing required fields: dicomInstanceUID, s3Path'
    });
  }

  const jobId = generateJobId();
  log(`[${jobId}] Начало генерации панорамы для ${dicomInstanceUID}`, 'INFO');

  // Запустить в фоне
  res.json({
    jobId,
    status: 'accepted',
    message: 'Panorama generation started',
    estimatedTime: `${rotationSteps * 2}-${rotationSteps * 3} seconds`
  });

  // Асинхронная обработка
  (async () => {
    try {
      const generator = new PanoramaGenerator({
        screenshotWidth,
        screenshotHeight,
        format
      });

      const result = await generator.generate({
        dicomInstanceUID,
        s3Path,
        rotationSteps,
        angleDelta,
        jobId
      });

      log(`[${jobId}] ✅ Панорама успешно создана. ${rotationSteps} снимков.`, 'INFO');

      // Сохранить результат в редис или БД (опционально)
      jobResults[jobId] = result;

    } catch (error) {
      log(`[${jobId}] ❌ Ошибка: ${error.message}`, 'ERROR');
      jobResults[jobId] = {
        jobId,
        status: 'error',
        message: error.message
      };
    }
  })();
});

/**
 * GET /api/panorama/status/:jobId
 * Проверить статус задачи
 */
app.get('/api/panorama/status/:jobId', (req, res) => {
  const { jobId } = req.params;

  if (!jobResults[jobId]) {
    return res.status(404).json({
      status: 'error',
      message: 'Job not found'
    });
  }

  res.json(jobResults[jobId]);
});

/**
 * GET /api/panorama/list
 * Список всех завершенных задач
 */
app.get('/api/panorama/list', (req, res) => {
  const list = Object.values(jobResults).map(job => ({
    jobId: job.jobId,
    status: job.status,
    dicomInstanceUID: job.dicomInstanceUID,
    createdAt: job.createdAt,
    screenshotsCount: job.screenshotsCount
  }));

  res.json({
    total: list.length,
    jobs: list
  });
});

/**
 * GET /api/panorama/download/:jobId
 * Скачать архив скриншотов
 */
app.get('/api/panorama/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobResults[jobId];

  if (!job || job.status !== 'success') {
    return res.status(404).json({
      status: 'error',
      message: 'Job not found or not completed'
    });
  }

  const zipPath = path.join(job.outputDir, `${jobId}.zip`);

  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({
      status: 'error',
      message: 'Archive not found'
    });
  }

  res.download(zipPath);
});

// ============================================
// Static serve OHIF
// ============================================

app.get('/', (req, res) => {
  res.sendFile(path.join(process.env.OHIF_BUILD_PATH, 'index.html'));
});

// ============================================
// Error Handling
// ============================================

app.use((err, req, res, next) => {
  log(`Ошибка: ${err.message}`, 'ERROR');
  res.status(500).json({
    status: 'error',
    message: err.message
  });
});

// ============================================
// Server Start
// ============================================

// Storage для результатов (в реальном приложении - Redis или БД)
const jobResults = {};

function generateJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const server = app.listen(PORT, () => {
  log(`🚀 OHIF Panorama Server запущен на http://localhost:${PORT}`, 'INFO');
  log(`📁 OHIF Build: ${process.env.OHIF_BUILD_PATH}`, 'INFO');
  log(`📦 S3 Bucket: ${process.env.S3_BUCKET}`, 'INFO');
  log(`📸 Screenshots Dir: ${process.env.SCREENSHOTS_DIR}`, 'INFO');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  log('SIGTERM получен, завершаю сервер...', 'INFO');
  server.close(() => {
    log('Сервер остановлен', 'INFO');
    process.exit(0);
  });
});

module.exports = app;
