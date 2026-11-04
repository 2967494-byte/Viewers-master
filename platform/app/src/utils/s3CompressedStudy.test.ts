import { compressedStudyRoot, loadCompressedStudy } from './s3CompressedStudy';

const root = 'hot/2026/11/04/pat_1/appt_2/';
const pointerKey = root + '_viewer/representations.json';
const manifestKey = root + '_viewer/1/j2k20/g1/manifest.json';
const indexKey = root + '_viewer/1/j2k20/g1/series/ohif_metadata.json';
const future = () => new Date(Date.now() + 60000).toISOString();
function fixture() {
  const objects: Record<string, any> = {
    [pointerKey]: { schemaVersion: 1, sourceVersion: 1, expiresAt: future(), defaultRepresentationId: 'j2k20',
      representations: [{ id: 'j2k20', status: 'ready', manifest: '1/j2k20/g1/manifest.json' }] },
    [manifestKey]: { schemaVersion: 1, sourceVersion: 1, id: 'j2k20', status: 'ready', expiresAt: future(),
      profile: { codec: 'jpeg2000', targetRatio: 20 }, series: [{ index: 'series/ohif_metadata.json', instanceCount: 2 }] },
    [indexKey]: [1, 2].map(i => ({ _url: `instances/${i}.dcm`, '00080018': { Value: [`1.2.${i}`] } })),
  };
  const read = jest.fn(async (key: string) => {
    if (!(key in objects)) throw Object.assign(new Error('missing'), { status: 404 });
    return objects[key];
  });
  return { objects, read };
}

it('opens only the published generation from an appointment or nested Data path', async () => {
  const { read } = fixture();
  const result = await loadCompressedStudy(root + 'scan/Data/', read, undefined, 1);
  expect(read.mock.calls.map(call => call[0])).toEqual([pointerKey, manifestKey, indexKey]);
  expect(result.instances.map(item => item._url)).toEqual([1, 2].map(i => root + `_viewer/1/j2k20/g1/series/instances/${i}.dcm`));
  expect(result.representationId).toBe('j2k20');
});

it.each(['archive/appt_2/', 'hot/../appt_2/', 'hot/appt_2/%2e%2e/', 'hot/appt_2/../', 'hot/no_appointment/'])('rejects ambiguous or escaping prefixes: %s', prefix => {
  expect(() => compressedStudyRoot(prefix)).toThrow();
});

it('does not probe original metadata or DICOM when the pointer is absent', async () => {
  const { objects, read } = fixture(); delete objects[pointerKey];
  await expect(loadCompressedStudy(root, read)).rejects.toThrow('ещё не подготовлена');
  expect(read).toHaveBeenCalledTimes(1);
});

it('rejects access errors without treating them as preparation in progress', async () => {
  const read = jest.fn().mockRejectedValue(Object.assign(new Error('AccessDenied'), { status: 403 }));
  await expect(loadCompressedStudy(root, read)).rejects.toThrow('AccessDenied');
  expect(read).toHaveBeenCalledTimes(1);
});

it.each(['queued', 'running', 'failed'])('does not open %s generations', async status => {
  const { objects, read } = fixture(); objects[pointerKey].representations[0].status = status;
  await expect(loadCompressedStudy(root, read)).rejects.toThrow('ещё не готова');
  expect(read).toHaveBeenCalledTimes(1);
});

it('rejects a previous source version provided by CRM', async () => {
  const { read } = fixture();
  await expect(loadCompressedStudy(root, read, undefined, 2)).rejects.toThrow('предыдущей версии');
  expect(read).toHaveBeenCalledTimes(1);
});

it('rejects a manifest from another source version', async () => {
  const { objects, read } = fixture(); objects[manifestKey].sourceVersion = 2;
  await expect(loadCompressedStudy(root, read)).rejects.toThrow('не совпадает');
});

it.each([pointerKey, manifestKey])('rejects expired %s', async key => {
  const { objects, read } = fixture(); objects[key].expiresAt = '2020-01-01T00:00:00Z';
  await expect(loadCompressedStudy(root, read)).rejects.toThrow('истёк');
});

it('rejects incomplete series and duplicate DICOM instances', async () => {
  const { objects, read } = fixture(); objects[indexKey].pop();
  await expect(loadCompressedStudy(root, read)).rejects.toThrow('неполная');
  objects[indexKey].push(objects[indexKey][0]);
  await expect(loadCompressedStudy(root, read)).rejects.toThrow('повторные');
});

it.each(['../../Data/1.dcm', 'https://example.org/1.dcm', '/hot/appt_2/Data/1.dcm', 'orbitals3:raw', '%2e%2e/Data/1.dcm'])('rejects metadata that escapes the compressed generation: %s', path => {
  const { objects, read } = fixture(); objects[indexKey][0]._url = path;
  return expect(loadCompressedStudy(root, read)).rejects.toThrow('Некорректный путь');
});
