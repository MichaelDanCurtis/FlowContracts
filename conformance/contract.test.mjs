import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schema } from './build-schema.mjs';
import { definition, invocation, receipt } from './create-fixtures.mjs';
import { canonical, hash, sealDefinition, validateDefinition, sealInvocation, validateInvocation, validateShape, compareReceipts } from './contract.mjs';
const clone = structuredClone;
const changeDefinition = f => { const d = clone(definition); f(d); return sealDefinition(d); };
const changeInvocation = f => { const d = clone(invocation); f(d); return sealInvocation(d); };
const rejectsDefinition = (name, f, code) => test(name, () => assert.throws(() => validateDefinition(changeDefinition(f)), new RegExp(code)));

test('checked-in schema is generated from the exact reviewed builder', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('./schema.json', import.meta.url))), schema);
});
test('golden definition and invocation are fixed independent artifacts', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('./fixtures/definition.json', import.meta.url))), definition);
  assert.deepEqual(JSON.parse(readFileSync(new URL('./fixtures/invocation.json', import.meta.url))), invocation);
  assert.deepEqual(validateDefinition(definition), { profile: 'local-ephemeral', nodeCount: 5, declaredModelCalls: 0, publishedRevision: true, readiness: 'unresolved', grantsTransferred: false });
  assert.equal(validateInvocation(invocation, definition).admission, 'not-performed');
});
test('canonical encoding sorts keys, preserves Unicode and rejects non-JSON values', () => {
  assert.equal(canonical({ z: [null, true, 3], a: 'café 🔥' }), '{"a":"café 🔥","z":[null,true,3]}');
  assert.equal(hash({ b: 2, a: 1 }), hash({ a: 1, b: 2 }));
  assert.equal(canonical({'\ue000': 1, '\u{10000}': 2}), '{"\u{10000}":2,"\ue000":1}');
  assert.notEqual(hash('é'), hash('e\u0301'));
  for (const invalid of [NaN, Infinity, -0, 1.2, 2 ** 53, undefined, new Date(), '\ud800', { value: undefined }, JSON.parse('{"__proto__":1}'), Array(2)]) assert.throws(() => canonical(invalid));
  let executed = false;
  assert.throws(() => canonical({ get value() { executed = true; return 1; } }));
  assert.equal(executed, false);
});
test('layout/title changes alter content but preserve executable semantics', () => {
  const edited = changeDefinition(d => { d.presentation.nodes[0].x = 50; d.metadata.title = 'Renamed'; });
  assert.notEqual(edited.digests.content, definition.digests.content);
  assert.equal(edited.digests.semantic, definition.digests.semantic);
});
test('dependency and profile edits change semantic digest', () => {
  for (const mutate of [d => { d.dependencies[0].revision = '2'; }, d => { d.profile = 'server-durable'; }]) {
    const edited = changeDefinition(mutate); validateDefinition(edited);
    assert.notEqual(edited.digests.semantic, definition.digests.semantic);
  }
});
test('changed content without new digest is rejected', () => {
  const d = clone(definition); d.metadata.title = 'tamper'; assert.throws(() => validateDefinition(d), /FLOW_DIGEST/);
});
rejectsDefinition('duplicate stable node IDs rejected', d => d.graph.nodes[1].id = 'start', 'FLOW_NODE_DUPLICATE');
rejectsDefinition('cycles and second incoming edge rejected', d => d.graph.edges.push({ source: 'mock', target: 'map', branch: 'next' }), 'FLOW_JOIN');
rejectsDefinition('unknown edge target rejected', d => d.graph.edges[0].target = 'absent', 'FLOW_EDGE');
rejectsDefinition('unconnected node rejected at its broken outgoing edge', d => d.graph.edges.splice(1, 1), 'FLOW_BRANCH');
rejectsDefinition('branching without explicit condition rejected', d => d.graph.edges[0].branch = 'yes', 'FLOW_BRANCH');
rejectsDefinition('unknown durable node remains unsupported', d => d.graph.nodes[1].kind = 'timer', 'FLOW_SHAPE');
rejectsDefinition('missing mapped output rejected', d => d.graph.nodes[1].arguments[0].binding.port = 'missing', 'FLOW_MAPPING_SOURCE');
rejectsDefinition('future-node mapping rejected', d => d.graph.nodes[1].arguments[0].binding.node = 'mock', 'FLOW_MAPPING_SOURCE');
rejectsDefinition('mapping type mismatch rejected', d => d.graph.nodes[1].arguments[0].binding = { literal: 3 }, 'FLOW_MAPPING_TYPE');
rejectsDefinition('missing required mapping rejected', d => d.graph.nodes[1].arguments = [], 'FLOW_ARGUMENT');
rejectsDefinition('duplicate input mappings rejected', d => d.graph.nodes[1].arguments.push(d.graph.nodes[1].arguments[0]), 'FLOW_ARGUMENT_DUPLICATE');
rejectsDefinition('missing/null are distinct and not coerced', d => d.graph.nodes[1].arguments[0].binding = { literal: null }, 'FLOW_MAPPING_TYPE');
rejectsDefinition('literal plus reference ambiguity rejected', d => d.graph.nodes[1].arguments[0].binding.literal = 'ambiguous', 'FLOW_SHAPE');
rejectsDefinition('UTF8 byte limit prevents Unicode text overflow', d => d.graph.nodes[1].arguments[0].binding = { literal: '🔥'.repeat(513) }, 'FLOW_SHAPE|FLOW_TEXT_BYTES');
test('exact 2048-byte literal accepted', () => validateDefinition(changeDefinition(d => { d.graph.nodes[1].arguments[0].binding = { literal: '🔥'.repeat(512) }; })));
rejectsDefinition('node count bound enforced', d => { for (let i = 0; i < 65; i++) d.graph.nodes.push(clone(d.graph.nodes[0])); }, 'FLOW_SHAPE');
rejectsDefinition('no hidden extra fields or embedded grants', d => d.grants = ['all'], 'FLOW_SHAPE');
rejectsDefinition('embedded dependency token rejected', d => d.dependencies[0].token = 'synthetic', 'FLOW_SHAPE');
rejectsDefinition('unknown schema revision rejected', d => d.schemaVersion = 'future', 'FLOW_SHAPE');
rejectsDefinition('unpinned dependency rejected', d => delete d.dependencies[0].digest, 'FLOW_SHAPE');
rejectsDefinition('unknown dependency reference rejected', d => d.graph.nodes[3].dependency = 'missing', 'FLOW_CAPABILITY');
rejectsDefinition('device slot cannot impersonate account slot', d => d.bindingSlots[0].kind = 'account', 'FLOW_CAPABILITY');
rejectsDefinition('capability config cannot hide in deterministic map', d => d.graph.nodes[1].dependency = 'mockEcho', 'FLOW_NODE_CONFIG');
rejectsDefinition('step budget cannot understate graph', d => d.policy.maxSteps = 1, 'FLOW_STEP_BUDGET');
rejectsDefinition('model calls cannot hide in ordinary route', d => d.policy.maxModelCalls = 1, 'FLOW_SHAPE');
rejectsDefinition('presentation cannot refer to nonexistent nodes', d => d.presentation.nodes[0].id = 'other', 'FLOW_PRESENTATION');
test('identity or scope mismatch cannot become structural admission', () => {
  for (const mutate of [v => { v.revisionId = 'other'; }, v => { v.scope.id = 'other'; }, v => { v.inputs[0].value = null; }]) {
    assert.throws(() => validateInvocation(changeInvocation(mutate), definition));
  }
  assert.throws(() => validateInvocation(invocation, changeDefinition(d => { d.metadata.lifecycle = 'draft'; })), /FLOW_NOT_PUBLISHED/);
});
test('fixture/live, target, authority and deadline changes invalidate invocation digest', () => {
  for (const mutate of [v => { v.mode = 'live'; }, v => { v.target.deviceId = 'other'; }, v => { v.authorityRef = 'other'; }, v => { v.deadline = '2031-01-01T00:00:00.000Z'; }]) {
    const v = clone(invocation); mutate(v);
    assert.throws(() => validateInvocation(v, definition), /FLOW_EXECUTION_DIGEST/);
    assert.notEqual(sealInvocation(v).executionDigest, invocation.executionDigest);
  }
});
test('receipt sequence duplicates accepted; changed identity and stale events rejected', () => {
  const previous = receipt('accepted', 0);
  assert.equal(compareReceipts(previous, clone(previous)), 'duplicate');
  assert.equal(compareReceipts(previous, receipt('started', 1)), 'advance');
  assert.throws(() => compareReceipts(previous, receipt('started', 0)), /FLOW_RECEIPT_SEQUENCE/);
  assert.throws(() => compareReceipts(previous, { ...receipt('started', 1), executionDigest: 'sha256:' + 'b'.repeat(64) }), /FLOW_RECEIPT_IDENTITY/);
});
test('uncertain outcome cannot restart or become accepted; reconciliation can settle it', () => {
  const uncertain = receipt('uncertain', 3, 'effect-unknown');
  for (const outcome of ['accepted', 'started', 'cancel-pending']) assert.throws(() => compareReceipts(uncertain, receipt(outcome, 4)), /FLOW_RECEIPT_TRANSITION/);
  assert.equal(compareReceipts(uncertain, receipt('completed', 4)), 'advance');
  assert.throws(() => compareReceipts(receipt('completed', 4), receipt('started', 5)), /FLOW_RECEIPT_TRANSITION/);
});
test('cancel request is pending until stop confirmation or truthful completion', () => {
  const pending = receipt('cancel-pending', 2);
  assert.throws(() => compareReceipts(pending, receipt('cancelled', 3)), /FLOW_STOP_UNCONFIRMED/);
  assert.equal(compareReceipts(pending, receipt('cancelled', 3, 'stop-confirmed')), 'advance');
  assert.equal(compareReceipts(pending, receipt('completed', 3)), 'advance');
});
test('normal-looking unknown receipt fields rejected', () => {
  assert.throws(() => validateShape({ ...receipt('accepted', 0), bearer: 'synthetic' }, 'receipt'), /FLOW_SHAPE/);
});
test('deterministic boolean branch has two explicit routes, each ending in typed result', () => {
  const d = changeDefinition(d => {
    const boolean = { name: 'test', type: 'boolean' };
    d.graph.nodes = [
      { id: 'start', kind: 'input', version: 1, inputs: [], outputs: [boolean], arguments: [] },
      { id: 'choose', kind: 'condition', version: 1, inputs: [boolean], outputs: [], arguments: [{ port: 'test', binding: { node: 'start', port: 'test' } }] },
      ...['yesResult', 'noResult'].map((id, i) => ({ id, kind: 'result', version: 1, inputs: [{ name: 'message', type: 'string' }], outputs: [{ name: 'message', type: 'string' }], arguments: [{ port: 'message', binding: { literal: i ? 'no' : 'yes' } }] })),
    ];
    d.interface.inputs = [boolean]; d.dependencies = []; d.bindingSlots = [];
    d.graph.edges = [{ source: 'start', target: 'choose', branch: 'next' }, { source: 'choose', target: 'yesResult', branch: 'yes' }, { source: 'choose', target: 'noResult', branch: 'no' }];
    d.presentation.nodes = d.graph.nodes.map(n => ({ id: n.id, label: n.id, x: 0, y: 0 }));
  });
  assert.equal(validateDefinition(d).nodeCount, 4);
  const malformed = clone(d); malformed.graph.edges[2].branch = 'yes';
  assert.throws(() => validateDefinition(sealDefinition(malformed)), /FLOW_BRANCH/);
});
test('null is accepted only by an explicitly null-typed port', () => {
  const d = changeDefinition(d => {
    for (const n of d.graph.nodes) { for (const p of [...n.inputs, ...n.outputs]) p.type = 'null'; }
    for (const p of [...d.interface.inputs, ...d.interface.outputs]) p.type = 'null';
  });
  const v = changeInvocation(v => { v.semanticDigest = d.digests.semantic; v.inputs[0].value = null; });
  assert.equal(validateInvocation(v, d).structurallyValid, true);
});
