/**
 * Panorama Generator
 * Логика для генерации панорамных снимков с помощью Puppeteer & OHIF
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const AWS = require('aws-sdk');
const axios = require('axios');

class PanoramaGenerator {
  constructor(options = {}) {
    this.screenshotWidth = options.screenshotWidth || 1024;
    this.screenshotHeight = options.screenshotHeight || 768;
    this.format = options.format || 'png';
    this.chromiumPath = process.env.CHROMIUM_PATH || null;

    // AWS S3
    this.s3 = new AWS.S3({
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      region: process.env.S3_REGION || 'ru-msk',
      endpoint: process.env.S3_ENDPOINT,
      s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
    });

    this.s3Bucket = process.env.S3_BUCKET;
    this.s3Prefix = process.env.S3_PREFIX || 'panorama/';

    // Directories
    this.screenshotsDir = process.env.SCREENSHOTS_DIR || './screenshots';
    this.dataDir = process.env.DATA_DIR || './data';

    // Ensure directories exist
    [this.screenshotsDir, this.dataDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  log(jobId, message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${jobId}] [${level}] ${message}`);
  }

  /**
   * Основной метод генерации
   */
  async generate({ dicomInstanceUID, s3Path, rotationSteps = 36, angleDelta = 10, jobId }) {
    let browser;
    let jobOutputDir;

    try {
      this.log(jobId, `Начальные параметры: шагов=${rotationSteps}, угол=${angleDelta}°`, 'INFO');

      // 1. Скачать DICOM с S3
      const localDicomPath = await this.downloadDicomFromS3(s3Path, jobId);
      this.log(jobId, `✅ DICOM скачан: ${localDicomPath}`, 'INFO');

      // 2. Запустить браузер
      browser = await this.launchBrowser(jobId);
      this.log(jobId, `✅ Браузер запущен`, 'INFO');

      // 3. Открыть OHIF с DICOM
      const page = await browser.newPage();
      await page.setViewport({
        width: this.screenshotWidth,
        height: this.screenshotHeight,
        deviceScaleFactor: 1
      });

      const ohifUrl = await this.setupOHIFPage(page, dicomInstanceUID, jobId);
      this.log(jobId, `✅ OHIF загружен: ${ohifUrl}`, 'INFO');

      // 4. Создать директорию для скриншотов
      jobOutputDir = path.join(this.screenshotsDir, jobId);
      if (!fs.existsSync(jobOutputDir)) {
        fs.mkdirSync(jobOutputDir, { recursive: true });
      }

      // 5. Цикл вращения и снятия скриншотов
      const screenshots = await this.captureRotationShots(
        page,
        jobOutputDir,
        rotationSteps,
        angleDelta,
        jobId
      );

      this.log(jobId, `✅ Скриншоты сняты: ${screenshots.length} файлов`, 'INFO');

      // 6. Загрузить результаты на S3
      const s3Paths = await this.uploadScreenshotsToS3(screenshots, jobId);
      this.log(jobId, `✅ Загружено на S3: ${s3Paths.length} файлов`, 'INFO');

      // 7. Архивировать локальные скриншоты (опционально)
      // const zipPath = await this.createZipArchive(jobOutputDir, jobId);

      // Закрыть браузер
      await browser.close();

      return {
        jobId,
        status: 'success',
        dicomInstanceUID,
        screenshotsCount: screenshots.length,
        outputDir: jobOutputDir,
        s3Urls: s3Paths,
        createdAt: new Date().toISOString()
      };

    } catch (error) {
      this.log(jobId, `❌ Критическая ошибка: ${error.message}`, 'ERROR');
      this.log(jobId, error.stack, 'ERROR');

      if (browser) {
        try {
          await browser.close();
        } catch (e) {
          this.log(jobId, `Ошибка при закрытии браузера: ${e.message}`, 'WARN');
        }
      }

      throw error;
    }
  }

  /**
   * Скачать DICOM с S3
   */
  async downloadDicomFromS3(s3Path, jobId) {
    try {
      const Key = s3Path.replace('s3://', '').replace(`${this.s3Bucket}/`, '');
      const localPath = path.join(this.dataDir, path.basename(s3Path));

      this.log(jobId, `Загрузка DICOM из S3: s3://${this.s3Bucket}/${Key}`, 'INFO');

      const params = {
        Bucket: this.s3Bucket,
        Key
      };

      const data = await this.s3.getObject(params).promise();
      fs.writeFileSync(localPath, data.Body);

      return localPath;
    } catch (error) {
      throw new Error(`Ошибка загрузки DICOM: ${error.message}`);
    }
  }

  /**
   * Запустить Chromium браузер
   */
  async launchBrowser(jobId) {
    try {
      const launchOptions = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process=false'
        ]
      };

      if (this.chromiumPath) {
        launchOptions.executablePath = this.chromiumPath;
      }

      this.log(jobId, `Запуск браузера с параметрами:`, 'DEBUG');
      const browser = await puppeteer.launch(launchOptions);

      return browser;
    } catch (error) {
      throw new Error(`Ошибка запуска браузера: ${error.message}`);
    }
  }

  /**
   * Настроить страницу OHIF и загрузить DICOM
   */
  async setupOHIFPage(page, dicomInstanceUID, jobId) {
    try {
      const baseUrl = process.env.OHIF_PUBLIC_URL || 'http://localhost:3000';
      const ohifUrl = `${baseUrl}/viewer?StudyInstanceUIDs=${dicomInstanceUID}`;

      this.log(jobId, `Переход на URL: ${ohifUrl}`, 'INFO');

      await page.goto(ohifUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // Ждём загрузки 3D viewport
      await page.waitForFunction(
        () => {
          // Проверим, загрузился ли кортекс 3D (зависит от OHIF версии)
          return (
            window.cornerstone3D ||
            document.querySelector('[data-cy="3d-volume-viewport"]') ||
            document.querySelector('.viewport-3d') ||
            document.querySelector('canvas')
          );
        },
        { timeout: 30000 }
      );

      this.log(jobId, `✅ OHIF полностью загружен`, 'INFO');

      return ohifUrl;
    } catch (error) {
      throw new Error(`Ошибка загрузки OHIF: ${error.message}`);
    }
  }

  /**
   * Захват снимков во время вращения
   */
  async captureRotationShots(page, outputDir, rotationSteps, angleDelta, jobId) {
    const screenshots = [];
    const canvases = await page.$$('canvas');

    if (canvases.length === 0) {
      throw new Error('Не найдены canvas элементы для скриншотов');
    }

    this.log(jobId, `Найдено ${canvases.length} canvas элементов`, 'INFO');

    try {
      // Инъектируем код для управления камерой
      await page.evaluateOnNewDocument(() => {
        window.panoramaRotationDelta = 0;
      });

      for (let i = 0; i < rotationSteps; i++) {
        const angle = i * angleDelta;
        const percent = Math.round((i / rotationSteps) * 100);

        this.log(jobId, `📸 Снимок ${i + 1}/${rotationSteps} (${angle}°) [${percent}%]`, 'INFO');

        // Выполнить вращение камеры
        await page.evaluate((delta) => {
          // Cornerstone3D API для вращения
          if (window.cornerstone3D) {
            const viewportElement = document.querySelector('[data-cy="3d-volume-viewport"]');
            if (viewportElement && viewportElement._element) {
              const renderer = viewportElement._element.renderer;
              if (renderer && renderer.getActiveCamera) {
                const camera = renderer.getActiveCamera();
                // Вращение вокруг вертикальной оси (Y)
                camera.azimuth(delta);
                renderer.resetCamera();
              }
            }
          }

          // Альтернативный подход - Three.js
          if (window.THREE) {
            const scene = window.scene;
            if (scene && scene.children[0]) {
              scene.children[0].rotation.y += (delta * Math.PI) / 180;
            }
          }
        }, angleDelta);

        // Ждём перерисовки
        await new Promise(resolve => setTimeout(resolve, 500));

        // Снять скриншот первого canvas
        const canvasHandle = canvases[0];
        const screenshot = await page.evaluate((el) => {
          // Получить canvas в браузере
          const canvas = document.querySelector('canvas');
          if (!canvas) return null;
          return canvas.toDataURL('image/png');
        });

        if (screenshot) {
          const screenshotPath = path.join(outputDir, `shot-${String(i).padStart(3, '0')}-${angle}deg.png`);
          const base64Data = screenshot.replace(/^data:image\/png;base64,/, '');
          fs.writeFileSync(screenshotPath, base64Data, 'base64');
          screenshots.push(screenshotPath);

          this.log(jobId, `  → Сохранено: ${path.basename(screenshotPath)}`, 'DEBUG');
        }
      }

      this.log(jobId, `✅ Все ${rotationSteps} снимков завершены`, 'INFO');

      return screenshots;
    } catch (error) {
      throw new Error(`Ошибка захвата снимков: ${error.message}`);
    }
  }

  /**
   * Загрузить скриншоты на S3
   */
  async uploadScreenshotsToS3(screenshotPaths, jobId) {
    const uploadedPaths = [];

    for (let i = 0; i < screenshotPaths.length; i++) {
      const localPath = screenshotPaths[i];
      const filename = path.basename(localPath);
      const s3Key = `${this.s3Prefix}${jobId}/${filename}`;

      try {
        const fileContent = fs.readFileSync(localPath);

        await this.s3.putObject({
          Bucket: this.s3Bucket,
          Key: s3Key,
          Body: fileContent,
          ContentType: 'image/png',
          Metadata: {
            'Job-Id': jobId,
            'Upload-Time': new Date().toISOString()
          }
        }).promise();

        const s3Url = `s3://${this.s3Bucket}/${s3Key}`;
        uploadedPaths.push(s3Url);

        const percent = Math.round(((i + 1) / screenshotPaths.length) * 100);
        this.log(jobId, `  → Загружено на S3: ${filename} [${percent}%]`, 'DEBUG');
      } catch (error) {
        this.log(jobId, `  ⚠️  Ошибка загрузки ${filename}: ${error.message}`, 'WARN');
      }
    }

    return uploadedPaths;
  }

  /**
   * Создать ZIP архив скриншотов (опционально)
   */
  async createZipArchive(outputDir, jobId) {
    // TODO: реализовать если нужно
    return `${outputDir}.zip`;
  }
}

module.exports = PanoramaGenerator;
