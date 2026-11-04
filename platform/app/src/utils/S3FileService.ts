import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-browser';
import { metadataIndexPrefixes } from './s3MetadataIndex';
import { compressedStudyRoot } from './s3CompressedStudy';

export type MetadataIndexProgress = {
  phase: 'search' | 'download';
  completedCandidates: number;
  totalCandidates: number;
  loadedBytes: number;
  totalBytes?: number;
  elapsedMs: number;
};

type S3RuntimeConfig = {
  endpoint?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  concurrency?: number;
  downloadConcurrency?: number;
  processConcurrency?: number;
  metadataTimeoutMs?: number;
};

function readRuntimeConfig(): S3RuntimeConfig {
  const cfg = (typeof window !== 'undefined' && (window as any).config?.s3) || {};
  const session = (() => {
    try {
      const raw = sessionStorage.getItem('orbital.s3.credentials');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();
  return {
    endpoint:
      cfg.endpoint ||
      process.env.S3_ENDPOINT ||
      process.env.S3_ENDPOINT_URL ||
      'https://storage.yandexcloud.net',
    bucket:
      cfg.bucket ||
      process.env.S3_BUCKET ||
      process.env.S3_BUCKET_NAME ||
      'orbital3d-hot-storage',
    accessKeyId:
      cfg.accessKeyId || session.accessKeyId || process.env.S3_ACCESS_KEY || '',
    secretAccessKey:
      cfg.secretAccessKey ||
      session.secretAccessKey ||
      process.env.S3_SECRET_KEY ||
      '',
    region: cfg.region || 'ru-central1',
    concurrency: Number(cfg.concurrency) || 8,
    downloadConcurrency: Number(cfg.downloadConcurrency) || Number(cfg.concurrency) || 8,
    processConcurrency: Number(cfg.processConcurrency) || 8,
    metadataTimeoutMs: Number(cfg.metadataTimeoutMs) || 20000,
  };
}

function encodeS3Path(key: string): string {
  return key
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

async function bodyToPrefixBlob(body: any, maxBytes: number): Promise<Blob> {
  const limit = Math.max(1, maxBytes);

  // Prefer streaming + early cancel (works without Range CORS).
  if (body && typeof body.getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (received < limit) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        const need = limit - received;
        if (value.byteLength <= need) {
          chunks.push(value);
          received += value.byteLength;
        } else {
          chunks.push(value.subarray(0, need));
          received += need;
          break;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch (_cancelError) {
        /* ignore */
      }
    }
    return new Blob(chunks as BlobPart[], { type: 'application/dicom' });
  }

  // SdkStreamMixin / fetch body
  if (body && typeof body.transformToByteArray === 'function') {
    const bytes: Uint8Array = await body.transformToByteArray();
    return new Blob([bytes.subarray(0, Math.min(limit, bytes.byteLength))], {
      type: 'application/dicom',
    });
  }

  const full = await new Response(body as any).arrayBuffer();
  return new Blob([full.slice(0, Math.min(limit, full.byteLength))], {
    type: 'application/dicom',
  });
}

export class S3FileService {
  private client: S3Client | null = null;
  private clientKey = '';
  private activeDownloads = 0;
  private downloadQueue: Array<() => void> = [];
  private studyAccess: { expiresAt: number; resources: Map<string, string> } | null = null;

  /** Short-lived, exact-object access returned by the future authenticated CRM resolver. */
  setStudyAccess(prefix: string, resources: Record<string, string>, expiresAt: string): void {
    const scope = compressedStudyRoot(this.normalizePrefix(prefix)) + '_viewer/';
    const deadline = Date.parse(expiresAt);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error('Срок доступа к исследованию истёк');
    const endpoint = new URL(this.getSettings().endpoint!);
    const entries = Object.entries(resources || {});
    if (!entries.length || entries.length > 30000) throw new Error('Не предоставлен доступ к файлам сжатой серии');
    const checked = new Map<string, string>();
    for (const [key, value] of entries) {
      const url = new URL(value);
      const localTest = endpoint.hostname === '127.0.0.1' && url.hostname === '127.0.0.1';
      if (!key.startsWith(scope) || key.split('/').some(part => !part || part === '.' || part === '..') ||
        /[\\%?#:]/.test(key) || url.origin !== endpoint.origin ||
        (url.protocol !== 'https:' && !localTest) || url.username || url.password || url.hash ||
        url.pathname !== `${endpoint.pathname.replace(/\/$/, '')}/${encodeURIComponent(this.bucket())}/${encodeS3Path(key)}`) {
        throw new Error('Некорректный доступ к файлам сжатой серии');
      }
      checked.set(key, url.href);
    }
    this.studyAccess = { expiresAt: deadline, resources: checked };
  }

  clearStudyAccess(): void { this.studyAccess = null; }

  private async requestObject(key: string, signal?: AbortSignal): Promise<any> {
    if (!this.studyAccess) {
      return this.getClient().send(new GetObjectCommand({ Bucket: this.bucket(), Key: key }),
        signal ? { abortSignal: signal } : undefined);
    }
    if (this.studyAccess.expiresAt <= Date.now()) throw new Error('Срок доступа к исследованию истёк. Откройте его заново из личного кабинета.');
    const url = this.studyAccess.resources.get(key);
    if (!url) throw new Error('Нет разрешения на файл сжатой серии');
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw Object.assign(new Error(`Ошибка доступа к файлу сжатой серии (${response.status})`), { status: response.status });
    return { Body: response.body, ContentLength: Number(response.headers.get('content-length')) || undefined };
  }

  /** Exact JSON object only: no parents, no ListObjects, no per-DICOM header scan. */
  async getJsonObject(key: string, onProgress?: (progress: MetadataIndexProgress) => void): Promise<any> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    let timedOut = false;
    const started = performance.now();
    const deadline = Math.max(1000, Math.min(120000, this.getSettings().metadataTimeoutMs || 20000));
    const reset = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => { timedOut = true; controller.abort(); }, deadline);
    };
    reset();
    try {
      const response = await this.requestObject(key, controller.signal);
      if (!response.Body) throw new Error('Пустой ответ S3');
      const reader = response.Body.getReader?.();
      let text: string;
      if (reader) {
        const chunks: string[] = [];
        const decoder = new TextDecoder();
        let bytes = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 32 * 1024 * 1024) { controller.abort(); throw new Error('Индекс сжатой серии слишком большой'); }
            chunks.push(decoder.decode(value, { stream: true })); reset();
            onProgress?.({ phase: 'download', loadedBytes: bytes, totalBytes: response.ContentLength,
              completedCandidates: 0, totalCandidates: 1, elapsedMs: Math.round(performance.now() - started) });
          }
          chunks.push(decoder.decode()); text = chunks.join('');
        } finally { reader.releaseLock(); }
      } else text = await new Response(response.Body).text();
      return JSON.parse(text);
    } catch (error) {
      if (timedOut) throw new Error('S3 не отвечает при чтении описания сжатой серии');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  private getSettings() {
    return readRuntimeConfig();
  }

  getConcurrency(): number {
    return this.getDownloadConcurrency();
  }

  getDownloadConcurrency(): number {
    return Math.max(1, Math.min(16, this.getSettings().downloadConcurrency || 8));
  }

  getProcessConcurrency(): number {
    return Math.max(2, Math.min(16, this.getSettings().processConcurrency || 8));
  }

  hasCredentials(): boolean {
    if (this.studyAccess && this.studyAccess.expiresAt > Date.now()) return true;
    const s = this.getSettings();
    return Boolean(s.accessKeyId && s.secretAccessKey);
  }

  setSessionCredentials(accessKeyId: string, secretAccessKey: string) {
    this.clearStudyAccess();
    sessionStorage.setItem(
      'orbital.s3.credentials',
      JSON.stringify({ accessKeyId, secretAccessKey })
    );
    this.client = null;
    this.clientKey = '';
  }

  private getClient(): S3Client {
    const s = this.getSettings();
    const key = `${s.endpoint}|${s.bucket}|${s.accessKeyId}|${s.region}`;
    if (!this.client || this.clientKey !== key) {
      this.client = new S3Client({
        endpoint: s.endpoint,
        region: s.region,
        credentials: {
          accessKeyId: s.accessKeyId || '',
          secretAccessKey: s.secretAccessKey || '',
        },
        forcePathStyle: true,
        maxAttempts: 2,
      });
      this.clientKey = key;
      console.log('S3 Service Init:', {
        endpoint: s.endpoint,
        bucket: s.bucket,
        accessKeySet: !!s.accessKeyId,
        downloadConcurrency: this.getDownloadConcurrency(),
        forcePathStyle: true,
      });
    }
    return this.client;
  }

  private bucket(): string {
    return this.getSettings().bucket || 'orbital3d-hot-storage';
  }

  normalizePrefix(input: string): string {
    let prefix = (input || '').trim();
    if (!prefix) return '';
    prefix = prefix.replace(/^s3:\/\//i, '');
    const bucket = this.bucket();
    if (prefix.startsWith(`${bucket}/`)) {
      prefix = prefix.slice(bucket.length + 1);
    }
    prefix = prefix.replace(/^\/+/, '');
    if (prefix && !prefix.endsWith('/')) prefix += '/';
    return prefix;
  }

  private async withRetries<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    delay = 300
  ): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err: any) {
        lastError = err;
        const status = err?.$metadata?.httpStatusCode || err?.status;
        const isNetworkError =
          err.name === 'FetchError' ||
          err.name === 'TypeError' ||
          err.message?.includes('Failed to fetch') ||
          err.message?.includes('NetworkError') ||
          status === 503 ||
          status === 500 ||
          status === 429;
        if (isNetworkError && attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, delay * Math.pow(2, attempt)));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  /** Optional wadouri fallback; pixels preferably go through orbitals3 loader. */
  async getSignedGetUrl(key: string, expiresIn = 3600): Promise<string> {
    const s = this.getSettings();
    const endpoint = new URL(s.endpoint || 'https://storage.yandexcloud.net');
    const bucket = this.bucket();
    const path = `/${encodeURIComponent(bucket)}/${encodeS3Path(key)}`;

    const signer = new SignatureV4({
      credentials: {
        accessKeyId: s.accessKeyId || '',
        secretAccessKey: s.secretAccessKey || '',
      },
      region: s.region || 'ru-central1',
      service: 's3',
      sha256: Sha256,
      uriEscapePath: false,
    });

    const request = new HttpRequest({
      method: 'GET',
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      path,
      headers: { host: endpoint.hostname },
    });

    const signed = await signer.presign(request, { expiresIn });
    const qs = new URLSearchParams();
    if (signed.query) {
      for (const [k, v] of Object.entries(signed.query)) {
        if (Array.isArray(v)) v.forEach(item => qs.append(k, String(item)));
        else if (v !== undefined) qs.append(k, String(v));
      }
    }
    return `${signed.protocol}//${signed.hostname}${signed.path}?${qs.toString()}`;
  }

  async getSignedGetUrls(keys: string[], expiresIn = 3600): Promise<string[]> {
    const urls = new Array<string>(keys.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(16, keys.length) }, async () => {
        while (true) {
          const i = next++;
          if (i >= keys.length) return;
          urls[i] = await this.getSignedGetUrl(keys[i], expiresIn);
        }
      })
    );
    return urls;
  }

  /**
   * Read only the first maxBytes for DICOM header indexing.
   * 1) Try HTTP Range (fast if CORS allows it)
   * 2) Else full GET + abort stream after maxBytes (no Range header needed)
   */
  async getObjectPrefix(key: string, maxBytes: number): Promise<Blob> {
    const limit = Math.max(1, maxBytes);

    try {
      const ranged = await this.withRetries(() =>
        this.getClient().send(
          new GetObjectCommand({
            Bucket: this.bucket(),
            Key: key,
            Range: `bytes=0-${limit - 1}`,
          })
        )
      );
      if (!ranged.Body) throw new Error('Response body is undefined');
      const blob = await new Response(ranged.Body as any).blob();
      // Some endpoints ignore Range and return the whole object — trim.
      if (blob.size > limit) {
        return blob.slice(0, limit, 'application/dicom');
      }
      return blob;
    } catch (rangeErr) {
      console.warn('S3 Range prefix failed, using stream abort:', key, rangeErr);
      const full = await this.withRetries(() =>
        this.getClient().send(
          new GetObjectCommand({
            Bucket: this.bucket(),
            Key: key,
          })
        )
      );
      if (!full.Body) throw new Error('Response body is undefined');
      return bodyToPrefixBlob(full.Body, limit);
    }
  }

  async getObjectAsBlob(key: string): Promise<Blob> {
    // Cornerstone may enqueue 50+ images at once. Bound actual SDK transfers,
    // including consumption of their bodies, so the first slices get bandwidth.
    await new Promise<void>(resolve => {
      this.downloadQueue.push(resolve);
      this.drainDownloads();
    });
    try {
      const response = await this.requestObject(key);
      if (!response.Body) throw new Error('Response body is undefined');
      return await new Response(response.Body as any).blob();
    } finally {
      this.activeDownloads--;
      this.drainDownloads();
    }
  }

  private drainDownloads() {
    while (this.downloadQueue.length && this.activeDownloads < this.getDownloadConcurrency()) {
      this.activeDownloads++;
      this.downloadQueue.shift()!();
    }
  }

  async listPrefixes(prefix = ''): Promise<{ folders: string[]; files: string[] }> {
    const normalized = this.normalizePrefix(prefix);
    const command = new ListObjectsV2Command({
      Bucket: this.bucket(),
      Prefix: normalized,
      Delimiter: '/',
    });
    const response = await this.withRetries(() => this.getClient().send(command));
    const folders = response.CommonPrefixes?.map(cp => cp.Prefix).filter(Boolean) || [];
    const files =
      response.Contents?.filter(c => c.Key !== normalized)
        .map(c => c.Key)
        .filter(Boolean) || [];
    return { folders, files };
  }

  async listAllObjects(prefix: string): Promise<string[]> {
    const normalized = this.normalizePrefix(prefix);
    let continuationToken: string | undefined;
    const allKeys: string[] = [];
    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket(),
        Prefix: normalized,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });
      const response = await this.withRetries(() => this.getClient().send(command));
      allKeys.push(...(response.Contents?.map(c => c.Key).filter(Boolean) || []));
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    return allKeys;
  }

  /**
   * Look for ohif_metadata.json in the load prefix and parent folders.
   * Uploader often writes it next to the study root, while the UI path is .../Data/.
   * Example:
   *   load:   hot/.../appt_x/patient/Data/
   *   index:  hot/.../appt_x/ohif_metadata.json
   */
  async getMetadataIndex(
    prefix: string,
    onProgress?: (progress: MetadataIndexProgress) => void
  ): Promise<{ instances: any[]; indexPrefix: string; indexKey: string } | null> {
    const normalized = this.normalizePrefix(prefix);
    const candidates = metadataIndexPrefixes(normalized);
    const controllers = candidates.map(() => new AbortController());
    const started = performance.now();
    let completed = 0;
    let finished = false;
    const timeoutMs = Math.max(1000, Math.min(120000, this.getSettings().metadataTimeoutMs || 20000));
    const notify = (phase: 'search' | 'download', loadedBytes = 0, totalBytes?: number) =>
      !finished && onProgress?.({ phase, loadedBytes, totalBytes, completedCandidates: completed,
        totalCandidates: candidates.length, elapsedMs: Math.round(performance.now() - started) });

    const probe = async (cand: string, i: number) => {
      const indexKey = `${cand}ohif_metadata.json`;
      const controller = controllers[i];
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout>;
      const resetDeadline = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      };
      resetDeadline();
      try {
        const response = await this.getClient().send(
          new GetObjectCommand({ Bucket: this.bucket(), Key: indexKey }),
          { abortSignal: controller.signal }
        );
        if (!response.Body) throw new Error('Пустой ответ S3 при чтении индекса');
        let text: string;
        let bytes = 0;
        const reader = (response.Body as ReadableStream<Uint8Array>).getReader?.();
        if (reader) {
          const decoder = new TextDecoder();
          const chunks: string[] = [];
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              chunks.push(decoder.decode(value, { stream: true }));
              resetDeadline();
              notify('download', bytes, response.ContentLength);
            }
            chunks.push(decoder.decode());
            text = chunks.join('');
          } finally { reader.releaseLock(); }
        } else {
          text = await new Response(response.Body as any).text();
          bytes = new TextEncoder().encode(text).byteLength;
        }
        const instances = JSON.parse(text);
        if (!Array.isArray(instances) || !instances.length) {
          throw new Error('ohif_metadata.json должен содержать непустой массив DICOM-объектов');
        }
        console.info('[orbital-s3] metadata index ready', {
          instances: instances.length, bytes, elapsedMs: Math.round(performance.now() - started),
        });
        return { instances, indexPrefix: cand, indexKey };
      } catch (err: any) {
        if (timedOut) throw new Error('S3 не отвечает при чтении индекса метаданных. Проверьте соединение и CORS; пофайловая индексация не запущена.');
        const status = err?.$metadata?.httpStatusCode;
        if (status === 404 || err?.name === 'NoSuchKey' || err?.name === 'NotFound') return null;
        throw err;
      } finally {
        clearTimeout(timer);
        completed++;
        notify('search');
      }
    };
    notify('search');
    // Probe only two locations simultaneously; a valid appointment-root index
    // need not wait for an inaccessible/missing Data/ object to time out.
    const errors: unknown[] = [];
    for (let offset = 0; offset < candidates.length; offset += 2) {
      const batch = candidates.slice(offset, offset + 2).map((cand, j) =>
        probe(cand, offset + j).then(result => {
          if (!result) throw null;
          return result;
        }).catch(err => { if (err) errors.push(err); throw err; })
      );
      try {
        const found = await Promise.any(batch);
        finished = true;
        controllers.forEach(controller => controller.abort());
        return found;
      } catch (_batchError) {
        if (errors.length) {
          finished = true;
          controllers.forEach(controller => controller.abort());
          throw errors[0];
        }
        // Only genuine 404/NoSuchKey results permit trying remaining parents.
      }
    }
    // CORS/auth/network/invalid JSON is not evidence of a missing index. Avoid
    // silently downloading hundreds of DICOM headers after such a failure.
    finished = true;
    if (errors.length) throw errors[0];
    return null;
  }
}

export const s3FileService = new S3FileService();
export default s3FileService;
