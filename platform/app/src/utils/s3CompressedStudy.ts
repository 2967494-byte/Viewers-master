/** Versioned contract shared with the future HOT compressor and CRM. No raw fallback. */
export const COMPRESSED_VIEWER_DIRECTORY = '_viewer';
export const COMPRESSED_POINTER_FILE = 'representations.json';

type ReadJson = (key: string, progress?: (progress: any) => void) => Promise<any>;

export function compressedStudyRoot(prefix: string): string {
  const parts = prefix.replace(/\/$/, '').split('/');
  if (parts[0] !== 'hot' || parts.some(part => !part || part === '.' || part === '..' || /[\\%?#:]/.test(part))) {
    throw new Error('Укажите путь исследования hot/.../appt_.../');
  }
  const appointment = parts.findIndex(part => /^appt_[\w-]+$/i.test(part));
  if (appointment < 1) throw new Error('В пути HOT не найден корень исследования appt_...');
  return parts.slice(0, appointment + 1).join('/') + '/';
}

function relativeKey(base: string, value: unknown): string {
  if (typeof value !== 'string' || !value || /[\\%?#:]/.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Некорректный путь в описании сжатой серии');
  }
  return base + value;
}

function expiry(value: unknown): number {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw new Error('В описании сжатой серии отсутствует срок хранения');
  if (time <= Date.now()) throw new Error('Срок хранения сжатой серии истёк');
  return time;
}

function version(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim()) {
    throw new Error('В описании отсутствует версия исходного исследования');
  }
  return String(value);
}

function missing(error: any): boolean {
  return error?.$metadata?.httpStatusCode === 404 || error?.status === 404 ||
    error?.name === 'NoSuchKey' || error?.name === 'NotFound';
}

export async function loadCompressedStudy(
  prefix: string,
  readJson: ReadJson,
  onProgress?: (progress: any) => void,
  expectedSourceVersion?: string | number
): Promise<{ instances: any[]; indexPrefix: string; indexKey: string; representationId: string; expiresAt: number }> {
  const root = compressedStudyRoot(prefix);
  const viewerRoot = root + COMPRESSED_VIEWER_DIRECTORY + '/';
  let pointer: any;
  try {
    pointer = await readJson(viewerRoot + COMPRESSED_POINTER_FILE, onProgress);
  } catch (error) {
    if (missing(error)) throw new Error('Сжатая серия ещё не подготовлена. Просмотр станет доступен после подготовки.');
    throw error;
  }
  if (pointer?.schemaVersion !== 1) throw new Error('Не поддерживается формат описания сжатой серии');
  const sourceVersion = version(pointer.sourceVersion);
  if (expectedSourceVersion != null && sourceVersion !== String(expectedSourceVersion)) {
    throw new Error('Сжатая серия относится к предыдущей версии исследования');
  }
  const pointerExpiry = expiry(pointer.expiresAt);
  if (!Array.isArray(pointer.representations)) throw new Error('Некорректный список сжатых серий');
  const ready = pointer.representations.filter(item => item?.status === 'ready');
  const selected = ready.find(item => item.id === pointer.defaultRepresentationId) || ready[0];
  if (!selected) throw new Error('Сжатая серия ещё не готова к просмотру');
  if (typeof selected.id !== 'string' || !selected.id) throw new Error('Не указан идентификатор сжатой серии');
  const manifestKey = relativeKey(viewerRoot, selected.manifest);
  if (!manifestKey.endsWith('/manifest.json')) throw new Error('Не найден manifest сжатой серии');
  const generationRoot = manifestKey.slice(0, -'manifest.json'.length);
  const manifest = await readJson(manifestKey, onProgress);
  if (manifest?.schemaVersion !== 1 || manifest.status !== 'ready' || manifest.id !== selected.id) {
    throw new Error('Сжатая серия не опубликована полностью');
  }
  if (version(manifest.sourceVersion) !== sourceVersion) throw new Error('Версия сжатой серии не совпадает с источником');
  const expiresAt = Math.min(pointerExpiry, expiry(manifest.expiresAt));
  if (manifest.profile?.codec !== 'jpeg2000' && manifest.profile?.codec !== 'htj2k') {
    throw new Error('Неподдерживаемый профиль сжатой серии');
  }
  if (!Array.isArray(manifest.series) || !manifest.series.length) throw new Error('В сжатой версии нет готовых серий');
  const instances: any[] = [];
  const seenPaths = new Set<string>();
  const seenSops = new Set<string>();
  const seenIndices = new Set<string>();
  for (const series of manifest.series) {
    if (!Number.isSafeInteger(series.instanceCount) || series.instanceCount < 1) throw new Error('Не указано число DICOM-файлов сжатой серии');
    const indexKey = relativeKey(generationRoot, series.index);
    if (!indexKey.endsWith('/ohif_metadata.json') || seenIndices.has(indexKey)) throw new Error('Некорректный индекс сжатой серии');
    seenIndices.add(indexKey);
    const index = await readJson(indexKey, onProgress);
    if (!Array.isArray(index) || index.length !== series.instanceCount) throw new Error('Сжатая серия неполная: число файлов не совпадает с описанием');
    const indexRoot = indexKey.slice(0, -'ohif_metadata.json'.length);
    for (const item of index) {
      const key = relativeKey(indexRoot, item?._url || item?.url);
      const sop = item?.SOPInstanceUID || item?.['00080018']?.Value?.[0];
      if (!key.endsWith('.dcm') || !sop || seenPaths.has(key) || seenSops.has(sop)) throw new Error('В индексе сжатой серии есть некорректные или повторные DICOM');
      seenPaths.add(key); seenSops.add(sop);
      // Only local relative object keys are accepted. External URLs and raw HOT
      // image IDs cannot escape the published generation through metadata.
      instances.push({ ...item, url: undefined, _url: key });
    }
  }
  if (expiresAt <= Date.now()) throw new Error('Срок хранения сжатой серии истёк');
  return { instances, indexPrefix: root, indexKey: manifestKey, representationId: selected.id, expiresAt };
}
