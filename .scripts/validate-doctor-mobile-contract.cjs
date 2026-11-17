/* Offline contract/fixture checks. This is not an API or iOS end-to-end test. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');
const root = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const spec = read('docs/specs/doctor-mobile-v1.openapi.json');
const data = read('docs/specs/doctor-mobile-v1-examples/contract-examples.json');
const copy = value => JSON.parse(JSON.stringify(value));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`OK ${name}`); }
function rewrite(value) {
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
  return typeof value === 'string' && value.startsWith('#/components/schemas/')
    ? value.replace('#/components/schemas/', '#/definitions/') : value;
}
const ajv = new Ajv({ allErrors: true, format: 'full' });
const schemaId = 'urn:orbital:doctor-mobile:proposed:v1';
ajv.addSchema({ $id: schemaId, definitions: rewrite(spec.components.schemas) });
const validators = Object.fromEntries(Object.keys(spec.components.schemas).map(name =>
  [name, ajv.compile({ $ref: `${schemaId}#/definitions/${name}` })]));
const examples = Object.fromEntries(data.examples.map(e => [e.name, e.value]));
function schema(name, value) {
  assert(validators[name](value), `${name}: ${ajv.errorsText(validators[name].errors)}`);
}
check('OpenAPI local references, paths, operation IDs and security schemes', () => {
  assert.equal(spec.openapi, '3.0.3');
  assert.equal(spec['x-contract-status'], 'proposed-not-implemented');
  const ids = new Set();
  for (const [route, methods] of Object.entries(spec.paths)) for (const op of Object.values(methods)) {
    assert(!ids.has(op.operationId)); ids.add(op.operationId);
    for (const name of [...route.matchAll(/\{([^}]+)\}/g)].map(m => m[1])) {
      assert(op.parameters.some(p => p.name === name && p.in === 'path' && p.required));
    }
    for (const scheme of (op.security || spec.security)) {
      for (const name of Object.keys(scheme)) assert(spec.components.securitySchemes[name]);
    }
  }
  function refs(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert(value.$ref.startsWith('#/'));
      let target = spec;
      for (const part of value.$ref.slice(2).split('/')) target = target?.[part];
      assert(target, `Unresolved ${value.$ref}`);
    }
    Object.values(value).forEach(refs);
  }
  refs(spec);
});
for (const example of data.examples) check(`schema ${example.name}`, () => schema(example.schema, example.value));

const publicKey = crypto.createPublicKey({ key: data.testPublicKey, format: 'jwk' });
const testTime = Date.parse(data.fixedTestTime) / 1000;
function verifyGrant(token, expectedBundle, inventoryHash, deviceId, now = testTime) {
  const parts = token.split('.'); assert.equal(parts.length, 3);
  const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
  assert.equal(header.alg, 'ES256'); assert.equal(header.kid, data.testPublicKey.kid);
  const signature = Buffer.from(parts[2], 'base64url'); assert.equal(signature.length, 64);
  assert(crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]),
    { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature), 'Bad signature');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  schema('OfflineGrantClaims', claims);
  assert.equal(claims.iss, examples.me.serverOrigin);
  assert.equal(claims.aud, 'orbital.doctor.ios.offline');
  assert(claims.nbf <= now && now < claims.exp && claims.iat <= now);
  assert.equal(claims.deviceId, deviceId);
  assert.equal(claims.inventorySha256, inventoryHash);
  for (const [key, value] of Object.entries(expectedBundle)) assert.equal(claims[key], value, `Binding ${key}`);
  return claims;
}
function verifyMembership(inventory, grant) {
  for (const [key, value] of Object.entries(grant.bundle)) {
    if (!['userId', 'doctorId'].includes(key)) assert.equal(inventory[key], value, `Inventory ${key}`);
  }
  assert.equal(inventory.files.length, inventory.fileCount);
  assert.equal(inventory.files.reduce((n, f) => n + f.bytes, 0), inventory.totalBytes);
  assert.equal(new Set(inventory.files.map(f => f.path)).size, inventory.fileCount);
  assert.equal(new Set(inventory.files.map(f => f.fileId)).size, inventory.fileCount);
  assert.equal(new Set(grant.resources.map(f => f.fileId)).size, inventory.fileCount);
  assert.deepEqual(inventory.files.map(f => f.fileId).sort(), grant.resources.map(f => f.fileId).sort());
  assert.equal(inventory.files.filter(f => f.kind === 'manifest').length, 1);
  assert.equal(inventory.files.find(f => f.kind === 'manifest').path, 'manifest.json');
  assert(!inventory.files.some(f => /(?:^|\/)(?:representations|download-inventory)\.json$/.test(f.path)));
}
const fixtureRoot = path.join(root, data.fixtureRoot);
const haveBinaries = fs.existsSync(path.join(fixtureRoot, 'synthetic-study-a'));
for (const label of ['a', 'b']) {
  const inv = examples[label + '-inventory'], grant = examples[label + '-grant'];
  check(`${label} generation/resource membership and signed offline binding`, () => {
    verifyMembership(inv, grant);
    const claims = verifyGrant(grant.offlineGrant, grant.bundle, grant.inventory.sha256, data.deviceId);
    assert.equal(new Date(claims.exp * 1000).toISOString(), new Date(grant.offlineAccessUntil).toISOString());
    assert.equal(examples[label + '-descriptor'].inventorySha256, grant.inventory.sha256);
  });
  if (haveBinaries) check(`${label} exact inventory bytes, all file hashes and HEX index membership`, () => {
    const gen = path.join(fixtureRoot, 'synthetic-study-' + label, '_viewer', inv.sourceVersion, inv.representationId, inv.generationId);
    const invBytes = fs.readFileSync(path.join(gen, 'download-inventory.json'));
    assert.equal(invBytes.length, grant.inventory.bytes); assert.equal(hash(invBytes), grant.inventory.sha256);
    assert.deepEqual(JSON.parse(invBytes), inv);
    const resolvedGen = path.resolve(gen) + path.sep;
    for (const file of inv.files) {
      const target = path.resolve(gen, file.path);
      assert(target.startsWith(resolvedGen));
      const bytes = fs.readFileSync(target);
      assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256);
    }
    const sopUids = new Set();
    for (const series of inv.series) {
      const rows = JSON.parse(fs.readFileSync(path.join(gen, series.indexPath)));
      assert.equal(rows.length, series.instanceCount);
      assert.equal(rows.length, inv.files.filter(f => f.seriesId === series.id && f.kind === 'dicom').length);
      for (const row of rows) {
        assert(!row.StudyInstanceUID && !row.SeriesInstanceUID && !row.SOPInstanceUID && !row['7FE00010']);
        assert.equal(row['0020000E'].Value[0], series.seriesInstanceUid);
        const sop = row['00080018'].Value[0]; assert(!sopUids.has(sop)); sopUids.add(sop);
        const filePath = path.posix.join(path.posix.dirname(series.indexPath), row._url);
        assert(inv.files.some(f => f.kind === 'dicom' && f.path === filePath));
      }
    }
  });
}
check('A and B cannot share patient, study, series, prefix or inventory hash', () => {
  for (const key of ['patientId', 'appointmentId', 'studyId', 'sourceVersion', 'generationId', 'bundleId'])
    assert.notEqual(examples['a-inventory'][key], examples['b-inventory'][key]);
  assert.notEqual(examples['a-inventory'].series[0].seriesInstanceUid, examples['b-inventory'].series[0].seriesInstanceUid);
  assert.notEqual(examples['a-descriptor'].bundleRelativePath, examples['b-descriptor'].bundleRelativePath);
  assert.notEqual(examples['a-grant'].inventory.sha256, examples['b-grant'].inventory.sha256);
});
check('schema rejects path traversal, absolute and encoded paths', () => {
  for (const badPath of ['../other.dcm', '/etc/passwd', 's/../x.dcm', 's\\x.dcm', 'https://x/y', 's/%2e%2e/x', 's//x']) {
    const file = { ...examples['a-inventory'].files[0], path: badPath };
    assert.equal(validators.InventoryFile(file), false, badPath);
  }
});
check('reject mixed bundle, duplicate file and wrong total', () => {
  assert.throws(() => verifyMembership(examples['a-inventory'], examples['b-grant']));
  let bad = copy(examples['a-inventory']); bad.files[1] = bad.files[0];
  assert.throws(() => verifyMembership(bad, examples['a-grant']));
  bad = copy(examples['a-inventory']); bad.totalBytes++;
  assert.throws(() => verifyMembership(bad, examples['a-grant']));
});
check('reject wrong device, expired grant, tampered payload and unknown key', () => {
  const grant = examples['a-grant'], bundle = grant.bundle, ih = grant.inventory.sha256;
  assert.throws(() => verifyGrant(grant.offlineGrant, bundle, ih, crypto.randomUUID()));
  assert.throws(() => verifyGrant(grant.offlineGrant, bundle, ih, data.deviceId, Date.parse(grant.offlineAccessUntil) / 1000));
  const parts = grant.offlineGrant.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url')); payload.doctorId = 'different-doctor';
  const tampered = [parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.');
  assert.throws(() => verifyGrant(tampered, bundle, ih, data.deviceId));
  const header = JSON.parse(Buffer.from(parts[0], 'base64url')); header.kid = 'unknown';
  const unknown = [Buffer.from(JSON.stringify(header)).toString('base64url'), parts[1], parts[2]].join('.');
  assert.throws(() => verifyGrant(unknown, bundle, ih, data.deviceId));
});
async function checkLegacyParser() {
  if (!haveBinaries) return;
  const ts = require('typescript');
  const vm = require('node:vm');
  const file = path.join(root, 'platform/app/src/utils/s3CompressedStudy.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const exported = {};
  vm.runInNewContext(code, { exports: exported, Date }, { filename: file });
  for (const label of ['a', 'b']) {
    const fixture = path.join(fixtureRoot, 'synthetic-study-' + label);
    const binding = JSON.parse(fs.readFileSync(path.join(fixture, 'mobile-binding.example.json')));
    const prefix = binding.legacyImportStudyPrefix;
    const readJson = async key => {
      assert(key.startsWith(prefix));
      return JSON.parse(fs.readFileSync(path.join(fixture, key.slice(prefix.length))));
    };
    const parsed = await exported.loadCompressedStudy(prefix, readJson, undefined, binding.identity.sourceVersion);
    assert.equal(parsed.instances.length, examples[label + '-inventory'].series[0].instanceCount);
    assert.equal(parsed.indexPrefix, prefix);
    await assert.rejects(() => exported.loadCompressedStudy(prefix, readJson, undefined, 'wrong-source'));
    checks++; console.log(`OK ${label} existing compressed-study parser accepts layout and rejects wrong source`);
  }
}
checkLegacyParser().then(() => {
  console.log(`${checks} checks passed. ${Object.keys(validators).length} schemas compiled. Binary checks: ${haveBinaries ? 'included' : 'not run; generate fixtures first'}.`);
}).catch(error => { console.error(error); process.exitCode = 1; });
