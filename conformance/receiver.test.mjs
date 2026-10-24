import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { definition, invocation } from './create-fixtures.mjs';
import { sealInvocation, sealDefinition } from './contract.mjs';
import { query, cancel, result, authority, local, producer, now } from './create-control-fixtures.mjs';
import { ReceiverModel, sealCommand, sealResult, sealReply, validateCommand, validateResult, validateReply } from './receiver.mjs';
const copy = structuredClone;
const changed = (value, mutate, seal) => { const v = copy(value); mutate(v); return seal(v); };
const model = () => new ReceiverModel();
const admitted = () => { const m = model(); m.admit(invocation, definition, authority, local, now); return m; };
const command = (v, mutate) => changed(v, mutate, sealCommand);
const output = mutate => changed(result, mutate, sealResult);

test('new fixed query/cancel/result/reply fixtures are stable', () => {
  for (const [name, value] of Object.entries({ query, cancel, result })) assert.deepEqual(JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url))), value);
  const m = admitted(); m.settle(result, producer, now);
  assert.deepEqual(m.control(query, authority, local, now), JSON.parse(readFileSync(new URL('./fixtures/reply.json', import.meta.url))));
});
test('lost admission acknowledgement reconciles by original identity; duplicate creates no intent', () => {
  const m = model(); m.admit(invocation, definition, authority, local, now); // caller discards response
  const reply = m.control(query, authority, local, now);
  assert.equal(reply.receipt.outcome, 'accepted');
  assert.deepEqual(validateReply(reply, query, invocation, definition), { mayRetryEffects: false, observationOnly: true });
  assert.equal(m.admit(invocation, definition, authority, local, now).fresh, false);
  assert.equal(m.syntheticDispatchIntents, 1);
});
test('same idempotency key with changed inputs cannot create replacement work', () => {
  const m = admitted(); const changedInvocation = changed(invocation, v => { v.inputs[0].value = 'different'; }, sealInvocation);
  assert.throws(() => m.admit(changedInvocation, definition, authority, local, now), /FLOW_ID_CONTENT_CONFLICT/);
  assert.equal(m.syntheticDispatchIntents, 1);
});
test('same invocation ID with a different request key cannot bypass deduplication', () => {
  const m = admitted(); const v = changed(invocation, v => { v.idempotencyKey = 'new'; }, sealInvocation);
  assert.throws(() => m.admit(v, definition, authority, local, now), /FLOW_ID_CONTENT_CONFLICT/);
});
test('not-found query is observation only, never permission to retry effects', () => {
  const reply = model().control(query, authority, local, now);
  assert.equal(reply.observation, 'not-found');
  assert.equal(validateReply(reply, query, invocation, definition).mayRetryEffects, false);
});
test('pre-admission cancellation fences a delayed original invocation', () => {
  const m = model(); const reply = m.control(cancel, authority, local, now);
  assert.equal(reply.receipt.outcome, 'cancelled');
  assert.equal(reply.receipt.reason, 'stop-confirmed');
  validateReply(reply, cancel, invocation, definition);
  assert.equal(m.admit(invocation, definition, authority, local, now).fresh, false);
  assert.equal(m.syntheticDispatchIntents, 0);
});
test('cancellation after admission stays pending and duplicates do not advance sequence', () => {
  const m = admitted(); const first = m.control(cancel, authority, local, now), second = m.control(cancel, authority, local, now);
  assert.equal(first.receipt.outcome, 'cancel-pending'); assert.equal(first.receipt.sequence, second.receipt.sequence);
  assert.equal(m.syntheticDispatchIntents, 1);
});
test('late completion after cancellation remains a truthful completion', () => {
  const m = admitted(); m.control(cancel, authority, local, now);
  m.settle(output(v => { v.sequence = 2; }), producer, now);
  const reply = m.control(query, authority, local, now); validateReply(reply, query, invocation, definition);
  assert.equal(reply.receipt.outcome, 'completed');
});
test('confirmed stop can settle pending cancellation without completed outputs', () => {
  const m = admitted(); m.control(cancel, authority, local, now);
  m.settle(output(v => { v.sequence = 2; v.outcome = 'cancelled'; v.reason = 'stop-confirmed'; v.outputs = []; }), producer, now);
  assert.equal(m.control(query, authority, local, now).receipt.outcome, 'cancelled');
});
test('uncertain result is retained and duplicate admission never reopens it', () => {
  const m = admitted(); m.settle(output(v => { v.outcome = 'uncertain'; v.reason = 'effect-unknown'; v.outputs = []; }), producer, now);
  assert.equal(m.admit(invocation, definition, authority, local, now).receipt.outcome, 'uncertain');
  m.settle(output(v => { v.sequence = 2; }), producer, now);
  assert.equal(m.syntheticDispatchIntents, 1);
});
test('query and cancellation operate without an unlocked/online execution capability', () => {
  const m = admitted(); const offline = { ...local, online: false, unlocked: false };
  assert.equal(m.control(query, authority, offline, now).observation, 'found');
  assert.equal(m.control(cancel, authority, offline, now).receipt.outcome, 'cancel-pending');
  assert.throws(() => model().admit(invocation, definition, authority, offline, now), /FLOW_TARGET_UNAVAILABLE/);
});
test('self-reported caller ID cannot override authenticated fixture principal', () => {
  const impostor = command(query, v => { v.callerId = 'impostor'; });
  assert.throws(() => admitted().control(impostor, authority, local, now), /FLOW_CALLER_SCOPE/);
});
test('cross-owner scope is rejected before disclosing whether a record exists', () => {
  const cross = command(query, v => { v.scope.id = 'another-owner'; });
  for (const m of [model(), admitted()]) assert.throws(() => m.control(cross, authority, local, now), /FLOW_CALLER_SCOPE/);
});
test('query permission does not grant cancellation or invocation', () => {
  const readOnly = { ...authority, operations: ['query'] }; const m = admitted();
  assert.equal(m.control(query, readOnly, local, now).observation, 'found');
  assert.throws(() => m.control(cancel, readOnly, local, now), /FLOW_GRANT/);
  assert.throws(() => model().admit(invocation, definition, readOnly, local, now), /FLOW_GRANT/);
});
test('current server and local grants both gate invocation', () => {
  for (const which of ['server', 'device']) {
    const a = copy(authority), b = copy(local); (which === 'server' ? a : b).capabilities = [];
    assert.throws(() => model().admit(invocation, definition, a, b, now), /FLOW_DEPENDENCY_GRANT/);
  }
});
test('capability effect or dependency pin mismatch cannot amplify access', () => {
  for (const mutate of [v => { v.effect = 'write'; }, v => { v.digest = 'sha256:' + 'c'.repeat(64); }, v => { v.revision = 'other'; }]) {
    const a = copy(authority); mutate(a.capabilities[0]);
    assert.throws(() => model().admit(invocation, definition, a, local, now), /FLOW_DEPENDENCY_GRANT/);
  }
});
test('exact current flow grant is required in addition to capability grants', () => {
  const b = copy(local); b.flows = [];
  assert.throws(() => model().admit(invocation, definition, authority, b, now), /FLOW_FLOW_GRANT/);
});
test('revocation denies reads/cancel too; receipts remain available to later authorized repair', () => {
  const m = admitted();
  for (const op of [query, cancel]) assert.throws(() => m.control(op, { ...authority, revoked: true }, local, now), /FLOW_REVOKED/);
  assert.equal(m.control(query, authority, local, now).receipt.outcome, 'accepted');
});
test('current query authority can rotate while original execution digest remains fixed', () => {
  const m = admitted(); const rotated = { ...authority, authorityRef: 'fixture-authority-2' };
  const q = command(query, v => { v.authorityRef = rotated.authorityRef; v.commandId = 'rotated-query'; });
  assert.equal(m.control(q, rotated, local, now).executionDigest, invocation.executionDigest);
});
test('wrong device or binding revision is rejected', () => {
  for (const mutate of [v => { v.target.deviceId = 'other'; }, v => { v.target.bindingRevision = 'other'; }]) {
    assert.throws(() => admitted().control(command(query, mutate), authority, local, now), /FLOW_TARGET_BINDING/);
  }
});
test('fixture request cannot use a live context', () => {
  assert.throws(() => model().admit(invocation, definition, { ...authority, mode: 'live' }, { ...local, mode: 'live' }, now), /FLOW_MODE/);
});
test('expired or unbounded authority/command prevents new control', () => {
  const m = admitted();
  assert.throws(() => m.control(query, authority, local, now + 60001), /FLOW_EXPIRED_OR_UNBOUNDED/);
  assert.throws(() => m.control(command(query, v => { v.deadline = '2031-01-01T00:00:00.000Z'; }), authority, local, now), /FLOW_EXPIRED_OR_UNBOUNDED/);
});
test('expired execution can still be queried with fresh read authority/deadline', () => {
  const m = admitted(), later = now + 120000, until = new Date(later + 60000).toISOString();
  const q = command(query, v => { v.deadline = until; v.commandId = 'after-expiry'; });
  assert.equal(m.control(q, { ...authority, validUntil: until }, { ...local, validUntil: until }, later).receipt.outcome, 'accepted');
});
test('same control ID with changed content is rejected across query/cancel', () => {
  const m = admitted(); m.control(query, authority, local, now);
  assert.throws(() => m.control(command(query, v => { v.operation = 'cancel'; }), authority, local, now), /FLOW_COMMAND_CONFLICT/);
});
test('completed output is validated against the pinned graph interface', () => {
  validateResult(result, invocation, definition);
  for (const mutate of [v => { v.outputs[0].value = null; }, v => { v.outputs = []; }, v => { v.outputs.push(copy(v.outputs[0])); }, v => { v.outputs[0].port = 'missing'; }]) {
    assert.throws(() => validateResult(output(mutate), invocation, definition), /FLOW_RESULT_OUTPUT/);
  }
});
test('typed result strings retain UTF8 byte bounds', () => {
  assert.throws(() => validateResult(output(v => { v.outputs[0].value = '🔥'.repeat(513); }), invocation, definition), /FLOW_SHAPE|FLOW_TEXT_BYTES/);
});
test('failure or stop outcomes cannot masquerade as completed outputs', () => {
  assert.throws(() => validateResult(output(v => { v.outcome = 'failed'; v.reason = 'execution-failed'; }), invocation, definition), /FLOW_RESULT_OUTPUT/);
  assert.throws(() => validateResult(output(v => { v.outcome = 'cancelled'; v.outputs = []; }), invocation, definition), /FLOW_RESULT_REASON/);
});
test('stale revision/result mode/device/digest are rejected independently of checksum', () => {
  for (const mutate of [v => { v.revisionId = 'other'; }, v => { v.mode = 'live'; }, v => { v.target.deviceId = 'other'; }, v => { v.executionDigest = 'sha256:' + 'c'.repeat(64); }]) {
    assert.throws(() => validateResult(output(mutate), invocation, definition), /FLOW_RESULT_JOIN/);
  }
});
test('human caller fixture cannot report a device result', () => {
  assert.throws(() => admitted().settle(result, authority, now), /FLOW_RESULT_PRODUCER/);
});
test('result producer context must match exact target, scope and mode', () => {
  for (const mutate of [p => { p.mode = 'live'; }, p => { p.target.bindingRevision = 'other'; }, p => { p.scope.id = 'other'; }]) {
    const p = copy(producer); mutate(p); assert.throws(() => admitted().settle(result, p, now), /FLOW_RESULT_PRODUCER/);
  }
});
test('valid late device result can settle after an invocation grant is revoked', () => {
  const m = admitted(); m.settle(result, producer, now);
  assert.throws(() => m.control(query, { ...authority, revoked: true }, local, now), /FLOW_REVOKED/);
  assert.equal(m.control(query, authority, local, now).result.outcome, 'completed');
});
test('same sequence different output is a conflict; exact result duplicate is harmless', () => {
  const m = admitted(); m.settle(result, producer, now); m.settle(result, producer, now);
  assert.throws(() => m.settle(output(v => { v.outputs[0].value = 'changed'; }), producer, now), /FLOW_RESULT_CONFLICT/);
});
test('reply must join exact command and cannot invent a terminal result', () => {
  const m = admitted(); m.settle(result, producer, now); const reply = m.control(query, authority, local, now);
  assert.throws(() => validateReply(sealReply({ ...reply, commandId: 'other' }), query, invocation, definition), /FLOW_REPLY_JOIN/);
  const missing = copy(reply); delete missing.result;
  assert.throws(() => validateReply(sealReply(missing), query, invocation, definition), /FLOW_REPLY_STATE/);
});
test('message digest detects post-seal mutation and extra credential fields', () => {
  const q = copy(query); q.operation = 'cancel'; assert.throws(() => validateCommand(q), /FLOW_MESSAGE_DIGEST/);
  assert.throws(() => validateCommand(sealCommand({ ...query, token: 'synthetic' })), /FLOW_SHAPE/);
});
test('new admissions and cancellation tombstones obey bounded ledger capacity', () => {
  const m = model();
  for (let i = 0; i < 64; i++) {
    const v = changed(invocation, v => { v.invocationId = 'invocation-' + i; v.idempotencyKey = 'request-' + i; }, sealInvocation);
    m.admit(v, definition, authority, local, now);
  }
  const q = command(cancel, v => { v.invocationId = 'new'; v.idempotencyKey = 'new'; });
  assert.throws(() => m.control(q, authority, local, now), /FLOW_LEDGER_CAPACITY/);
  assert.equal(m.syntheticDispatchIntents, 64);
});
test('expired local grant cannot inherit fresh server authority', () => {
  const stale = { ...local, validUntil: new Date(now - 1).toISOString() };
  assert.throws(() => model().admit(invocation, definition, authority, stale, now), /FLOW_EXPIRED_OR_UNBOUNDED/);
  assert.throws(() => admitted().control(query, authority, stale, now), /FLOW_EXPIRED_OR_UNBOUNDED/);
});
test('result producer identity is current and unrevoked independently of flow invocation grants', () => {
  assert.throws(() => admitted().settle(result, { ...producer, revoked: true }, now), /FLOW_RESULT_PRODUCER/);
  assert.throws(() => admitted().settle(result, { ...producer, validUntil: new Date(now - 1).toISOString() }, now), /FLOW_EXPIRED_OR_UNBOUNDED/);
  assert.throws(() => admitted().settle(result, producer), /FLOW_CLOCK/);
});
