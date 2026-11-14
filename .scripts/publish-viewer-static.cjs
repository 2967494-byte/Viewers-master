#!/usr/bin/env node
// Publish a reviewed local production build to a separate Git deployment branch.
// This neither switches the source checkout nor pushes automatically.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'platform/app/dist');
const branch = 'codex/viewer-static-production';
const index = path.join(root, 'tmp', `publish-static-${process.pid}.index`);
const env = { ...process.env, GIT_INDEX_FILE: index };
const git = (args, input, extra = {}) => execFileSync('git', args, { cwd: root, env, input, ...extra }).toString().trim();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const source = git(['rev-parse', 'HEAD']);
if (git(['diff', '--name-only', 'HEAD', '--', 'extensions', 'platform', 'modes', '.scripts/test-orbital.cjs'], undefined, { env: process.env })) {
  throw new Error('Commit the reviewed viewer sources before publishing a build.');
}
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const main = html.match(/app\.bundle\.[a-f0-9]+\.js/)?.[0];
if (!main) throw new Error('Production entry not found.');
const files = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    const rel = path.relative(dist, file).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (rel === 'assets' || rel.startsWith('assets/') || rel === 'ort' || rel.startsWith('ort/') || rel === 'dicom-microscopy-viewer' || rel.startsWith('dicom-microscopy-viewer/')) collect(file);
    } else if (entry.isFile() && rel !== 'app-config.js') files.push({ file, rel });
  }
}
collect(dist);
const secretValues = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .map(line => line.match(/^\s*(?:S3_ACCESS_KEY|S3_SECRET_KEY)\s*=\s*(.*)$/)?.[1]?.trim().replace(/^["']|["']$/g, ''))
  .filter(value => value?.length >= 8).map(value => Buffer.from(value)) : [];
for (const { file, rel } of files) {
  const data = fs.readFileSync(file);
  if (secretValues.some(value => data.includes(value))) throw new Error(`Credential detected: ${rel}`);
  if (rel.endsWith('.js') && ['CPUStudyViewer', 'orbital-cpu-worker', 'orbital:cpu-worker'].some(value => data.includes(value))) throw new Error('Retired CPU experiment found.');
}
const metadata = { sourceCommit: source, createdAt: new Date().toISOString(), mainBundle: main,
  mainSha256: sha(fs.readFileSync(path.join(dist, main))), files: files.map(({ file, rel }) => ({ path: rel, sha256: sha(fs.readFileSync(file)) })) };
let parent;
try { parent = git(['rev-parse', '--verify', `refs/heads/${branch}`]); } catch { /* First publication creates an orphan deployment branch. */ }
try {
  git(['read-tree', '--empty']);
  const hashes = git(['hash-object', '-w', '--stdin-paths'], files.map(({ file }) => JSON.stringify(file.replaceAll('\\','/'))).join('\n')+'\n').split(/\r?\n/);
  const manifest = git(['hash-object', '-w', '--stdin'], JSON.stringify(metadata, null, 2)+'\n');
  const entries = files.map(({ rel }, i) => `100644 ${hashes[i]}\t${rel}\0`).join('') + `100644 ${manifest}\trelease.json\0`;
  git(['update-index', '-z', '--index-info'], entries);
  const tree = git(['write-tree']);
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], `deploy: ORBITAL web viewer from ${source.slice(0,12)}\n`);
  git(['update-ref', `refs/heads/${branch}`, commit, parent || '0'.repeat(40)]);
  console.log(JSON.stringify({ branch, commit, sourceCommit: source, fileCount: files.length, mainBundle: main, mainSha256: metadata.mainSha256 }, null, 2));
} finally {
  for (const file of [index, index+'.lock']) if (fs.existsSync(file)) fs.unlinkSync(file);
}
