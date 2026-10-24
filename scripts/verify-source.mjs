import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const sha = data => createHash('sha256').update(data).digest('hex');
export function verifySource(root = fileURLToPath(new URL('../', import.meta.url))) {
  root = realpathSync(root);
  const manifestBytes = readFileSync(resolve(root, 'SOURCE-MANIFEST.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== 'fuego-nero-flow.assembled-source.v1') throw new Error('ASSEMBLY_MANIFEST');
  const listed = new Set();
  for (const row of manifest.files) {
    if (typeof row.path !== 'string' || isAbsolute(row.path) || row.path.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('ASSEMBLY_PATH');
    const file = resolve(root, row.path), actual = realpathSync(file);
    if (!actual.startsWith(root + sep) || !lstatSync(file).isFile() || listed.has(row.path)) throw new Error('ASSEMBLY_PATH');
    const data = readFileSync(file);
    if (data.length !== row.bytes || sha(data) !== row.sha256) throw new Error('ASSEMBLY_PIN:' + row.path);
    listed.add(row.path);
  }
  const all = [];
  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (folder === root && entry.name === '.git') continue;
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        if (!entry.isFile()) throw new Error('ASSEMBLY_NONFILE');
        const name = relative(root, file).split(sep).join('/');
        if (name !== 'SOURCE-MANIFEST.json') all.push(name);
      }
    }
  }
  walk(root);
  if (all.length !== listed.size || all.some(p => !listed.has(p))) throw new Error('ASSEMBLY_UNLISTED');
  const origin = JSON.parse(readFileSync(resolve(root, 'provenance.json')));
  if (origin.sourceManifestSHA256 !== 'd09b278ee0708bca36d8a0a07c832e2e30c47352437bf2b950724607a1239018') throw new Error('ASSEMBLY_PROVENANCE');
  const candidateBytes = readFileSync(resolve(root, 'evidence/candidate-5-source-manifest.json'));
  if (sha(candidateBytes) !== origin.sourceManifestSHA256) throw new Error('ASSEMBLY_PROVENANCE');
  const candidate = JSON.parse(candidateBytes), used = new Set();
  for (const row of origin.copiedUnchanged) {
    const expected = manifest.files.find(f => f.path === row.destination);
    const original = candidate.files.find(f => f.path === row.source);
    if (!expected || !original || expected.bytes !== row.bytes || expected.sha256 !== row.sha256 || original.bytes !== row.bytes || original.sha256 !== row.sha256 || used.has(row.source)) throw new Error('ASSEMBLY_PROVENANCE');
    used.add(row.source);
  }
  if (candidate.files.length !== used.size + origin.omittedCandidateFiles.length || candidate.files.some(f => !used.has(f.path) && !origin.omittedCandidateFiles.includes(f.path))) throw new Error('ASSEMBLY_PROVENANCE');
  return { sourceFiles: listed.size, copiedCandidateFiles: origin.copiedUnchanged.length, sourceManifestSHA256: sha(manifestBytes) };
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.stdout.write(JSON.stringify(verifySource(), null, 2) + '\n');
}
