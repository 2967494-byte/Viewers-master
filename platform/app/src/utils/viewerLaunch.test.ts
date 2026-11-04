import { validateViewerLaunch } from './viewerLaunch';

const launch = () => ({ schemaVersion: 1, viewerAvailable: true, s3Prefix: 'hot/appt_1/', sourceVersion: 1,
  access: { expiresAt: new Date(Date.now() + 60000).toISOString(), resources: { 'hot/appt_1/_viewer/representations.json': 'https://storage.yandexcloud.net/bucket/key' } } });

it('accepts an authorized launch with explicit readiness and source version', () => {
  expect(validateViewerLaunch(launch()).s3Prefix).toBe('hot/appt_1/');
});
it('rejects old base64-prefix-style payloads without authorization', () => {
  expect(() => validateViewerLaunch({ prefix: 'hot/appt_1/' })).toThrow('формат');
});
it('rejects not-ready access and missing versions', () => {
  expect(() => validateViewerLaunch({ ...launch(), viewerAvailable: false })).toThrow('ещё не подготовлена');
  expect(() => validateViewerLaunch({ ...launch(), sourceVersion: undefined })).toThrow('версия');
});
it('rejects expired or missing object grants', () => {
  const value = launch(); value.access.expiresAt = '2020-01-01T00:00:00Z';
  expect(() => validateViewerLaunch(value)).toThrow('истёк');
  expect(() => validateViewerLaunch({ ...launch(), access: { ...launch().access, resources: {} } })).toThrow('Не предоставлен');
});
