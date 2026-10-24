import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, unlinkSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { verifySource } from '../scripts/verify-source.mjs';
const read = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url)));
test('assembly private metadata and exports exclude every production runtime/model entry', () => {
  const p = read('package.json');
  assert.equal(p.name, '@fuego-nero/flow-contract'); assert.equal(p.version, '0.1.0-alpha.1'); assert.equal(p.private, true);
  assert.deepEqual(p.exports, { './schema': './conformance/schema.json', './capabilities': './capabilities.json' });
  assert.equal(p.dependencies, undefined); assert.equal(p.license, undefined);
});
test('assembly requires complete negotiated pin and advertises no execution/auth/store', () => {
  const c = read('capabilities.json');
  assert.deepEqual(c.negotiationRequires, ['packageName', 'packageVersion', 'sourceManifestSHA256']);
  assert.deepEqual(c.executionRuntimes, []); assert.equal(c.authenticationImplementation, false); assert.equal(c.durableStoreImplementation, false);
  assert.deepEqual(c.receiptReasonExtensions, ['execution-failed']);
  assert.equal(c.grantSubjectNamespace, 'normalized-remote-fuego-caller'); assert.equal(c.sdkActorBindingImplemented, false);
});
test('assembly exhaustive source pins and exact accepted-candidate provenance verify', () => {
  const proof = verifySource(); assert.equal(proof.copiedCandidateFiles, 20); assert.match(proof.sourceManifestSHA256, /^[a-f0-9]{64}$/);
});
const root = fileURLToPath(new URL('../', import.meta.url));
function withCopy(check) {
  const temporary = mkdtempSync(join(tmpdir(), 'flow-contract-source-check-'));
  try {
    const isolated = join(temporary, 'source');
    cpSync(root, isolated, { recursive: true, filter: source => !source.split(sep).includes('.git') });
    check(isolated);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
test('assembly verifier rejects changed pinned source in an isolated copy', () => withCopy(isolated => {
  writeFileSync(join(isolated, 'conformance/receiver.mjs'), '// tampered fixture copy\n');
  assert.throws(() => verifySource(isolated), /ASSEMBLY_PIN/);
}));
test('assembly verifier rejects extra unlisted source in an isolated copy', () => withCopy(isolated => {
  writeFileSync(join(isolated, 'unreviewed.mjs'), '// unreviewed fixture copy\n');
  assert.throws(() => verifySource(isolated), /ASSEMBLY_UNLISTED/);
}));
test('assembly verifier rejects listed symlink escapes before reading bytes', () => withCopy(isolated => {
  const destination = join(isolated, 'conformance/receiver.mjs'); unlinkSync(destination);
  symlinkSync(join(root, 'conformance/receiver.mjs'), destination);
  assert.throws(() => verifySource(isolated), /ASSEMBLY_PATH/);
}));
