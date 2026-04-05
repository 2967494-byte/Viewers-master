/**
 * Panorama Generator — browser-side
 *
 * Известные проблемы WebGL:
 * 1. gl.readPixels() на canvas с preserveDrawingBuffer=false даёт чёрный вне текущего кадра
 * 2. EVENTS.IMAGE_RENDERED не всегда срабатывает для VTK 3D вьюпортов
 *
 * Решение: viewport.canvas из Cornerstone3D + синхронное gl.readPixels()
 * вызванное сразу внутри render() колбэка через requestAnimationFrame.
 */

import { getRenderingEngines } from '@cornerstonejs/core';
import { vec3, mat4 } from 'gl-matrix';

// ─── Конфигурация ────────────────────────────────────────────────────────────

export interface PanoramaConfig {
  startAngleDeg: number;
  endAngleDeg: number;
  stepDeg: number;
  stripWidth: number;
  renderDelayMs: number;
  /** Срезать заднюю половину черепа плоскостью VTK (clipping plane) */
  enableClipping: boolean;
}

export const DEFAULT_CONFIG: PanoramaConfig = {
  startAngleDeg: -50,
  endAngleDeg: 50,
  stepDeg: 1,
  stripWidth: 0,
  renderDelayMs: 30,
  enableClipping: true,
};

function reportProgress(pct: number, label: string) {
  const cb = (window as any).__panoramaProgressCallback;
  if (typeof cb === 'function') cb(pct, label);
}

function isAborted(): boolean {
  return !!(window as any).__panoramaAbort;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Поиск вьюпорта ──────────────────────────────────────────────────────────

function find3DViewport(): any | null {
  const engines = getRenderingEngines();
  for (const engine of engines) {
    const viewports = engine.getViewports() as any[];
    const vp = viewports.find(v => v.type === 'volume3d')
      ?? viewports.find(v => v.constructor?.name === 'VolumeViewport3D');
    if (vp) return vp;
  }
  return null;
}

// ─── VTK Clipping plane ──────────────────────────────────────────────────────

/**
 * Добавляет ploskost' отсечения к мапперу каждого actorа вьюпорта.
 *
 * Плоскость проходит через focalPoint;
 * нормаль направлена от focalPoint -> camera (сохраняет фронтальную половину).
 *
 * VTK сохраняет то’ что на положительной стороне нормали (dot > 0),
 * убирает то’ что на отрицательной (dot < 0 = сетка за focalPoint дальне).
 */
function applyFrontClipping(
  viewport: any,
  focalPoint: number[],
  cameraPosition: number[]
): void {
  try {
    const dx = cameraPosition[0] - focalPoint[0];
    const dy = cameraPosition[1] - focalPoint[1];
    const dz = cameraPosition[2] - focalPoint[2];
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (len < 1e-6) return;

    const nx = dx / len, ny = dy / len, nz = dz / len;
    const ox = focalPoint[0], oy = focalPoint[1], oz = focalPoint[2];

    const actors = viewport.getActors?.() as any[] | undefined;
    if (!actors?.length) {
      console.warn('[Panorama] Clipping: getActors вернул пустой массив');
      return;
    }

    let applied = 0;
    actors.forEach((entry: any) => {
      const mapper = entry?.actor?.getMapper?.();
      if (!mapper?.addClippingPlane) return;

      // Создаём plane-like объект, совместимый с VTK.js mapper API
      // VTK.js принимает объект с методами getNormal() / getOrigin() / evaluateFunction()
      const plane = {
        evaluateFunction: (x: number, y: number, z: number) =>
          nx * (x - ox) + ny * (y - oy) + nz * (z - oz),
        evaluateGradient: () => [nx, ny, nz],
        getNormal: () => [nx, ny, nz],
        getOrigin: () => [ox, oy, oz],
        isA: () => true,
      };

      mapper.addClippingPlane(plane);
      applied++;
    });

    console.log(`[Panorama] Clipping: применено к ${applied} actor(ов)`);
  } catch (e) {
    console.warn('[Panorama] Clipping ошибка:', e);
  }
}

function removeAllClipping(viewport: any): void {
  try {
    const actors = viewport.getActors?.() as any[] | undefined;
    actors?.forEach((entry: any) => {
      entry?.actor?.getMapper?.()?.removeAllClippingPlanes?.();
    });
  } catch (e) {
    console.warn('[Panorama] removeAllClipping ошибка:', e);
  }
}

// ─── Вращение камеры ─────────────────────────────────────────────────────────

function orbitCamera(
  viewport: any,
  angleDeg: number,
  basePos: number[],
  baseFocal: number[],
  baseViewUp: number[]   // ось вращения = сохранённый viewUp камеры
) {
  const radians = (angleDeg * Math.PI) / 180;

  // Нормализуем ось вращения (up вектор камеры)
  const axis = vec3.normalize(vec3.create(), vec3.fromValues(baseViewUp[0], baseViewUp[1], baseViewUp[2]));

  const offset = vec3.fromValues(
    basePos[0] - baseFocal[0],
    basePos[1] - baseFocal[1],
    basePos[2] - baseFocal[2]
  );
  const rotMat = mat4.create();
  mat4.fromRotation(rotMat, radians, axis);
  const rotated = vec3.create();
  vec3.transformMat4(rotated, offset, rotMat);

  viewport.setCamera({
    position: [baseFocal[0] + rotated[0], baseFocal[1] + rotated[1], baseFocal[2] + rotated[2]] as any,
    viewUp: baseViewUp as any,   // сохраняем оригинальный viewUp — не меняем!
  });
}

// ─── Захват кадра ────────────────────────────────────────────────────────────

/**
 * Стратегия 1: WebGL gl.readPixels() — работает если вызвать синхронно после render
 */
function tryWebGLReadPixels(canvas: HTMLCanvasElement): ImageData | null {
  try {
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const { width, height } = canvas;
    if (!width || !height) return null;

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Проверка — не всё ли нули
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 100) sum += pixels[i];
    if (sum === 0) {
      console.warn('[Panorama] gl.readPixels вернул нули, пробуем 2D контекст');
      return null;
    }

    // WebGL: пиксели читаются снизу вверх — переворачиваем
    const flipped = new Uint8ClampedArray(width * height * 4);
    const rowBytes = width * 4;
    for (let row = 0; row < height; row++) {
      const src = (height - 1 - row) * rowBytes;
      flipped.set(pixels.subarray(src, src + rowBytes), row * rowBytes);
    }
    return new ImageData(flipped, width, height);
  } catch (e) {
    console.warn('[Panorama] WebGL readPixels ошибка:', e);
    return null;
  }
}

/**
 * Стратегия 2: 2D getImageData — работает если canvas drawImage уже был вызван
 */
function try2DGetImageData(canvas: HTMLCanvasElement): ImageData | null {
  try {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let sum = 0;
    for (let i = 0; i < imgData.data.length; i += 100) sum += imgData.data[i];
    if (sum === 0) return null;

    return imgData;
  } catch (e) {
    return null;
  }
}

/**
 * Стратегия 3: drawImage на 2D промежуточный canvas
 */
function tryDrawImageCapture(source: HTMLCanvasElement): ImageData | null {
  try {
    const tmp = document.createElement('canvas');
    tmp.width = source.width;
    tmp.height = source.height;
    const ctx = tmp.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0);
    const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height);

    let sum = 0;
    for (let i = 0; i < imgData.data.length; i += 100) sum += imgData.data[i];
    if (sum === 0) return null;

    return imgData;
  } catch (e) {
    return null;
  }
}

/**
 * Главный метод захвата одного кадра.
 * Пробует все 3 стратегии последовательно.
 */
function captureCanvas(canvas: HTMLCanvasElement, label: string): ImageData | null {
  const gl = tryWebGLReadPixels(canvas);
  if (gl) {
    const px = gl.data;
    console.log(`[Panorama] ${label}: WebGL OK — центральный пиксель RGB(${px[px.length/2]},${px[px.length/2+1]},${px[px.length/2+2]})`);
    return gl;
  }

  const d2 = try2DGetImageData(canvas);
  if (d2) {
    const px = d2.data;
    const mid = Math.floor(px.length / 2);
    console.log(`[Panorama] ${label}: 2D OK — центральный пиксель RGB(${px[mid]},${px[mid+1]},${px[mid+2]})`);
    return d2;
  }

  const draw = tryDrawImageCapture(canvas);
  if (draw) { console.log(`[Panorama] ${label}: drawImage OK`); return draw; }

  console.warn(`[Panorama] ${label}: ВСЕ 3 стратегии вернули чёрный`);
  return null;
}

/**
 * Рендерит вьюпорт и захватывает кадр.
 * Вызываем gl/2d читалку СИНХРОННО внутри rAF — до очистки буфера браузером.
 */
function renderAndCapture(viewport: any, canvas: HTMLCanvasElement, label: string): Promise<ImageData | null> {
  return new Promise<ImageData | null>(resolve => {
    // Рендерим ВНУТРИ rAF, тут же читаем пиксели синхронно
    requestAnimationFrame(() => {
      viewport.render();
      // Пробуем прочитать прямо здесь, синхронно, внутри того же rAF
      const imgData = captureCanvas(canvas, label);
      resolve(imgData);
    });
  });
}

// ─── Диагностика ─────────────────────────────────────────────────────────────

async function diagnoseCapture(viewport: any): Promise<{ canvas: HTMLCanvasElement; working: boolean }> {
  console.log('[Panorama] === ДИАГНОСТИКА ===');

  // Способ 1: viewport.canvas (прямой доступ через Cornerstone)
  const vpCanvas = (viewport as any).canvas as HTMLCanvasElement | null;
  console.log('[Panorama] viewport.canvas:', vpCanvas?.width, 'x', vpCanvas?.height, vpCanvas?.constructor?.name);

  // Способ 2: element querySelectorAll canvas
  const elementCanvases = Array.from(
    ((viewport.element as HTMLElement)?.querySelectorAll('canvas') ?? [])
  ) as HTMLCanvasElement[];
  console.log('[Panorama] canvas внутри element:', elementCanvases.map(c => `${c.width}x${c.height}`));

  // Выбираем canvas для снимков
  const targetCanvas = vpCanvas ?? elementCanvases[0] ?? null;

  if (!targetCanvas) {
    console.error('[Panorama] Нет canvas для захвата!');
    return { canvas: null as any, working: false };
  }

  // Тестовый рендер + все 3 стратегии
  console.log(`[Panorama] Тестируем canvas ${targetCanvas.width}x${targetCanvas.height}`);

  const testResult = await renderAndCapture(viewport, targetCanvas, 'ТЕСТ');
  console.log('[Panorama] Тестовый кадр:', testResult ? `ДАННЫЕ ПОЛУЧЕНЫ (${testResult.width}x${testResult.height})` : 'ЧЁРНЫЙ/NULL');

  return { canvas: targetCanvas, working: testResult !== null };
}

// ─── Preview strip ────────────────────────────────────────────────────────────

function appendToStrip(imageData: ImageData, idx: number) {
  const strip = document.getElementById('panorama-frame-strip');
  if (!strip) return;
  const tmp = document.createElement('canvas');
  tmp.width = imageData.width;
  tmp.height = imageData.height;
  tmp.getContext('2d')!.putImageData(imageData, 0, 0);
  const img = document.createElement('img');
  img.src = tmp.toDataURL('image/jpeg', 0.4);
  img.style.cssText = 'height:60px;width:auto;object-fit:cover;flex-shrink:0;';
  img.title = `Кадр ${idx}`;
  strip.appendChild(img);
}

// ─── Склейка ─────────────────────────────────────────────────────────────────

interface FrameInfo { imageData: ImageData; index: number; }

/**
 * Рассчитывает идеальную ширину полосы для бездубликационной сшивки.
 *
 * Физика:
 * - Камера вращается на stepDeg° вокруг focalPoint
 * - Зубы находятся на радиусе r_arch от focalPoint
 * - Дуга зубной дуги за stepDeg = r_arch * stepDeg * PI/180 (в мировых единицах)
 * - В пикселях: arc_px = arc_wu * pixels_per_wu
 *
 * @param canvas      платно для получения размеров
 * @param savedCam    сохранённая камера (parallelScale, position, focalPoint)
 * @param stepDeg     шаг в градусах
 */
function computeStripWidth(
  canvas: HTMLCanvasElement,
  savedCam: { parallelScale: number; position: number[]; focalPoint: number[] },
  stepDeg: number
): number {
  const { width: cW, height: cH } = canvas;
  const { parallelScale, position, focalPoint } = savedCam;

  // Пикселов на мировую единицу (из parallelScale = половина высоты сцены)
  const pixels_per_wu = cH / (2 * parallelScale);

  // Орбитальный радиус камеры
  const dx = position[0] - focalPoint[0];
  const dy = position[1] - focalPoint[1];
  const dz = position[2] - focalPoint[2];
  const r_camera = Math.sqrt(dx*dx + dy*dy + dz*dz);

  // Оценочный радиус зубной дуги от focalPoint
  // Для ЧБКТ челюсти: зубы находятся примерно в 10-15% от радиуса орбиты
  const r_arch = r_camera * 0.12;

  // Дуга зубной дуги за stepDeg в мировых единицах
  const arc_wu = r_arch * (stepDeg * Math.PI / 180);

  // Переводим в пиксели
  const strip_px = arc_wu * pixels_per_wu;

  console.log(`[Panorama] computeStripWidth: r_camera=${r_camera.toFixed(1)}, r_arch=${r_arch.toFixed(1)}, arc=${arc_wu.toFixed(2)}wu, strip=${strip_px.toFixed(1)}px`);

  return Math.max(1, Math.round(strip_px));
}

/**
 * Строит панорамный снимок:
 * 1. Обрезает каждый кадр вертикально — только зона челюстей
 * 2. Берёт центральную вертикальную полосу равную (в пикселях) дуге зубной дуги за один шаг
 * 3. Применяет нормализацию + гамма-коррекцию
 */
function buildPanorama(
  frames: FrameInfo[],
  stripWidthOverride: number,
  canvas: HTMLCanvasElement,
  savedCam: { parallelScale: number; position: number[]; focalPoint: number[] },
  stepDeg: number = DEFAULT_CONFIG.stepDeg
): string {
  if (frames.length === 0) throw new Error('Нет кадров');

  const frameW = frames[0].imageData.width;
  const frameH = frames[0].imageData.height;

  // Вертикальный кроп: зона челюстей
  const cropTop    = Math.floor(frameH * 0.25);
  const cropBottom = Math.floor(frameH * 0.85);
  const cropH = cropBottom - cropTop;

  // Ширина полосы: пошире — меньше швов
  // За основу: 1/3 ширины кадра / число кадров * 3
  const sw = stripWidthOverride > 0
    ? stripWidthOverride
    : computeStripWidth(canvas, savedCam, stepDeg);

  // Центр полосы в кадре
  const offsetX = Math.floor((frameW - sw) / 2);

  const panoW = sw * frames.length;
  const panoH = cropH;

  console.log(`[Panorama] buildPanorama: ${frames.length} кадров, sw=${sw}px, pano=${panoW}×${panoH}`);

  const out = document.createElement('canvas');
  out.width = panoW;
  out.height = panoH;
  const ctx = out.getContext('2d')!;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, panoW, panoH);

  frames.forEach(({ imageData }, i) => {
    const tmp = document.createElement('canvas');
    tmp.width = frameW;
    tmp.height = frameH;
    tmp.getContext('2d')!.putImageData(imageData, 0, 0);

    ctx.drawImage(
      tmp,
      offsetX, cropTop, sw, cropH,
      i * sw, 0, sw, panoH
    );
  });

  applyAutoLevels(ctx, panoW, panoH);

  return out.toDataURL('image/jpeg', 0.95);
}

function applyAutoLevels(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let min = 255, max = 0;

  // Считаем гистограмму яркости (игнорируем чёрные пиксели фона)
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    if (lum > 5 && lum < min) min = lum;
    if (lum > max) max = lum;
  }

  const range = max - min;
  if (range < 10) return;
  const scale = 255 / range;

  for (let i = 0; i < d.length; i += 4) {
    // Нормализация уровней
    let r = Math.min(255, Math.max(0, (d[i]     - min) * scale));
    let g = Math.min(255, Math.max(0, (d[i + 1] - min) * scale));
    let b = Math.min(255, Math.max(0, (d[i + 2] - min) * scale));

    // Гамма-коррекция для увеличения контраста мягких тканей
    const gamma = 0.75;
    r = Math.pow(r / 255, gamma) * 255;
    g = Math.pow(g / 255, gamma) * 255;
    b = Math.pow(b / 255, gamma) * 255;

    d[i]     = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
}

// ─── Главный экспорт ──────────────────────────────────────────────────────────

export async function generatePanorama(config: Partial<PanoramaConfig> = {}): Promise<string> {
  const cfg: PanoramaConfig = { ...DEFAULT_CONFIG, ...config };
  delete (window as any).__panoramaAbort;

  reportProgress(5, 'Поиск 3D вьюпорта...');

  const viewport = find3DViewport();
  if (!viewport) {
    throw new Error('Не найден 3D вьюпорт. Откройте исследование в 3D режиме.');
  }
  console.log('[Panorama] Вьюпорт:', viewport.constructor?.name, viewport.type);

  reportProgress(8, 'Камера...');
  await sleep(200);

  const cam = (viewport as any).getCamera();
  if (!cam?.position || !cam?.focalPoint) {
    throw new Error('Не удалось получить камеру 3D вьюпорта.');
  }

  const savedCam = {
    position: [...cam.position] as number[],
    focalPoint: [...cam.focalPoint] as number[],
    viewUp: cam.viewUp ? [...cam.viewUp] as number[] : [0, 1, 0] as number[],
    parallelScale: cam.parallelScale,
  };
  console.log('[Panorama] Камера сохранена:', savedCam);

  // Диагностика и выбор canvas
  reportProgress(10, 'Диагностика canvas...');
  const { canvas, working } = await diagnoseCapture(viewport);

  if (!canvas) {
    throw new Error('Canvas не найден. Проверьте что 3D вьюпорт отображается на экране.');
  }

  if (!working) {
    throw new Error(
      'ДИАГНОСТИКА НЕ ПРОШЛА: все стратегии захвата вернули чёрный кадр.\n\n' +
      'Смотрите Console (F12) — там есть подробности.\n\n' +
      'Возможные причины:\n' +
      '• Chrome требует флаг --disable-webgl-image-chromium-image-resources (редко)\n' +
      '• Тип canvas не WebGL (необычная конфигурация)\n' +
      '• 3D вьюпорт не инициализирован — подождите загрузки объёма и повторите'
    );
  }

  // Генерация кадров
  const angles: number[] = [];
  for (let a = cfg.startAngleDeg; a <= cfg.endAngleDeg; a += cfg.stepDeg) {
    angles.push(parseFloat(a.toFixed(2)));
  }

  const frames: FrameInfo[] = [];
  let blackCount = 0;

  reportProgress(12, `Съёмка ${angles.length} кадров...`);

  for (let i = 0; i < angles.length; i++) {
    if (isAborted()) {
      restoreCam(viewport, savedCam);
      throw new Error('Отменено пользователем');
    }

    const angleDeg = angles[i];
    const pct = 12 + Math.round((i / angles.length) * 76);
    reportProgress(pct, `Снимок ${i + 1}/${angles.length} (${angleDeg >= 0 ? '+' : ''}${angleDeg}°)`);

    // Передаём savedCam.viewUp как ось вращения — предотвращает gimbal lock
    orbitCamera(viewport, angleDeg, savedCam.position, savedCam.focalPoint, savedCam.viewUp);

    // Добавляем clipping plane если включено
    if (cfg.enableClipping) {
      // Текущая позиция камеры (после поворота) — используем для направления нормали
      const currentCam = (viewport as any).getCamera();
      applyFrontClipping(viewport, savedCam.focalPoint, currentCam?.position ?? savedCam.position);
    }

    const imgData = await renderAndCapture(viewport, canvas, `кадр${i + 1}`);

    // Убираем clipping plane после захвата
    if (cfg.enableClipping) {
      removeAllClipping(viewport);
    }
    if (!imgData) {
      blackCount++;
      continue;
    }

    frames.push({ imageData: imgData, index: i });
    appendToStrip(imgData, i + 1);

    await sleep(cfg.renderDelayMs);
  }

  console.log(`[Panorama] Итог: ${frames.length} OK, ${blackCount} чёрных`);

  restoreCam(viewport, savedCam);

  if (frames.length < 3) {
    throw new Error(
      `Слишком мало непустых кадров: ${frames.length}/${angles.length} (чёрных: ${blackCount}).\n` +
      'Смотрите Console (F12) для деталей.'
    );
  }

  reportProgress(90, `Склейка ${frames.length} кадров...`);
  await sleep(30);

  const result = buildPanorama(frames, cfg.stripWidth, canvas, savedCam, cfg.stepDeg);
  reportProgress(100, `Готово! ${frames.length} кадров`);
  return result;
}

function restoreCam(viewport: any, saved: any) {
  try {
    viewport.setCamera({
      position: saved.position,
      focalPoint: saved.focalPoint,
      viewUp: saved.viewUp,
      ...(saved.parallelScale ? { parallelScale: saved.parallelScale } : {}),
    });
    viewport.render();
  } catch (e) {
    console.warn('[Panorama] Не удалось восстановить камеру:', e);
  }
}
