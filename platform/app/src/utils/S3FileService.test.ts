import { S3FileService } from './S3FileService';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: (...args) => mockSend(...args) })),
  GetObjectCommand: jest.fn().mockImplementation(input => ({ input })),
  ListObjectsV2Command: jest.fn().mockImplementation(input => ({ input })),
}));
jest.mock('@smithy/signature-v4', () => ({ SignatureV4: jest.fn() }));
jest.mock('@smithy/protocol-http', () => ({ HttpRequest: jest.fn() }));
jest.mock('@aws-crypto/sha256-browser', () => ({ Sha256: jest.fn() }));

const missing = () => Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
const found = () => ({ Body: { content: '[{"_url":"Data/a.dcm"}]' } });

beforeAll(() => {
  (global as any).TextEncoder = require('util').TextEncoder;
  (global as any).Response = class {
    constructor(private body) {}
    async text() { return this.body.content; }
    async blob() { await this.body.complete; return new Blob(['dcm']); }
  };
});
beforeEach(() => {
  mockSend.mockReset();
  (window as any).config = { s3: { downloadConcurrency: 2 } };
});
afterEach(() => jest.useRealTimers());

it('finds the appointment index without waiting for a stuck Data/ probe and aborts it', async () => {
  let aborted = false;
  mockSend.mockImplementation((command, options) => {
    if (command.input.Key === 'hot/appt_1/ohif_metadata.json') return Promise.resolve(found());
    return new Promise((_, reject) => options.abortSignal.addEventListener('abort', () => {
      aborted = true;
      reject(new Error('aborted'));
    }));
  });
  const result = await new S3FileService().getMetadataIndex('hot/appt_1/scan/Data/');
  expect(result.indexPrefix).toBe('hot/appt_1/');
  expect(aborted).toBe(true);
  expect(mockSend).toHaveBeenCalledTimes(2);
});

it('permits slow-path indexing only when all candidate indices are genuinely missing', async () => {
  mockSend.mockRejectedValue(missing());
  await expect(new S3FileService().getMetadataIndex('hot/appt_1/scan/Data/')).resolves.toBeNull();
  expect(mockSend).toHaveBeenCalledTimes(3);
});

it.each([
  new TypeError('Failed to fetch'),
  Object.assign(new Error('AccessDenied'), { $metadata: { httpStatusCode: 403 } }),
])('surfaces connection/CORS/auth errors instead of silently triggering full indexing', async error => {
  mockSend.mockRejectedValue(error);
  await expect(new S3FileService().getMetadataIndex('hot/appt_1/Data/')).rejects.toBe(error);
  expect(mockSend).toHaveBeenCalledTimes(2);
});

it('rejects malformed JSON explicitly', async () => {
  mockSend.mockResolvedValue({ Body: { content: '{broken' } });
  await expect(new S3FileService().getMetadataIndex('hot/appt_1/')).rejects.toThrow();
});

it('bounds a hung index request with an abort deadline', async () => {
  jest.useFakeTimers();
  mockSend.mockImplementation((_, options) => new Promise((__, reject) => {
    options.abortSignal.addEventListener('abort', () => reject(new Error('abort')));
  }));
  const pending = expect(new S3FileService().getMetadataIndex('hot/appt_1/')).rejects.toThrow('S3 не отвечает');
  jest.advanceTimersByTime(20000);
  await pending;
});

it('holds a download slot until the object body is fully consumed', async () => {
  const releases: Array<() => void> = [];
  mockSend.mockImplementation(() => Promise.resolve({ Body: {
    complete: new Promise<void>(resolve => releases.push(resolve)),
  } }));
  const service = new S3FileService();
  const requests = ['a', 'b', 'c'].map(key => service.getObjectAsBlob(key));
  await Promise.resolve(); await Promise.resolve();
  expect(mockSend).toHaveBeenCalledTimes(2);
  releases[0]();
  await requests[0];
  await Promise.resolve();
  expect(mockSend).toHaveBeenCalledTimes(3);
  releases.slice(1).forEach(release => release());
  await Promise.all(requests);
});

it('removes cancelled queued transfers without starting them or losing a download slot', async () => {
  (window as any).config = { s3: { downloadConcurrency: 1 } };
  let finish: () => void;
  mockSend.mockResolvedValueOnce({ Body: { complete: new Promise<void>(resolve => { finish = resolve; }) } })
    .mockResolvedValue({ Body: {} });
  const service = new S3FileService(), controller = new AbortController();
  const first = service.getObjectAsBlob('first');
  const cancelled = service.getObjectAsBlob('cancelled', controller.signal);
  const rejected = expect(cancelled).rejects.toHaveProperty('name', 'AbortError');
  const last = service.getObjectAsBlob('last');
  controller.abort(); await rejected; await Promise.resolve();
  expect(mockSend).toHaveBeenCalledTimes(1);
  finish(); await first; await last;
  expect(mockSend.mock.calls.map(([command]) => command.input.Key)).toEqual(['first', 'last']);
});

it('uses only exact short-lived CRM object grants and never falls back to SDK credentials', async () => {
  const service = new S3FileService();
  const key = 'hot/appt_1/_viewer/representations.json';
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, body: { content: '{"schemaVersion":1}' }, headers: { get: () => null } });
  service.setStudyAccess('hot/appt_1/', { [key]: `https://storage.yandexcloud.net/orbital3d-hot-storage/${key}?X-Amz-Signature=test` }, new Date(Date.now() + 60000).toISOString());
  await expect(service.getJsonObject(key)).resolves.toEqual({ schemaVersion: 1 });
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('X-Amz-Signature=test'), expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
  await expect(service.getObjectAsBlob('hot/appt_1/Data/1.dcm')).rejects.toThrow('Нет разрешения');
  expect(mockSend).not.toHaveBeenCalled();
});

it.each([
  ['hot/appt_1/Data/1.dcm', 'https://storage.yandexcloud.net/orbital3d-hot-storage/hot/appt_1/Data/1.dcm'],
  ['hot/appt_1/_viewer/1.dcm', 'https://example.org/orbital3d-hot-storage/hot/appt_1/_viewer/1.dcm'],
  ['hot/appt_1/_viewer/../Data/1.dcm', 'https://storage.yandexcloud.net/orbital3d-hot-storage/hot/appt_1/Data/1.dcm'],
])('rejects a grant outside the compressed scope or trusted storage host', (key, url) => {
  expect(() => new S3FileService().setStudyAccess('hot/appt_1/', { [key]: url }, new Date(Date.now() + 60000).toISOString())).toThrow('Некорректный доступ');
});

it('rejects expired CRM grants', () => {
  expect(() => new S3FileService().setStudyAccess('hot/appt_1/', {}, '2020-01-01T00:00:00Z')).toThrow('истёк');
});
