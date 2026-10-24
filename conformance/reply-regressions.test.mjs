import test from 'node:test';
import assert from 'node:assert/strict';
import { definition, invocation } from './create-fixtures.mjs';
import { query, authority, local, now } from './create-control-fixtures.mjs';
import { sealInvocation } from './contract.mjs';
import { ReceiverModel, sealCommand, sealReply, validateReply } from './receiver.mjs';
const observation = command => sealReply({
  schemaVersion: 'fuego-nero-flow-reply/0.1-candidate.1',
  ...Object.fromEntries(['commandId', 'commandDigest', 'operation', 'scope', 'callerId', 'invocationId', 'executionDigest', 'target', 'mode'].map(k => [k, command[k]])),
  observation: 'not-found',
});
const changes = {
  invocationId: v => { v.invocationId = 'other'; },
  idempotencyKey: v => { v.idempotencyKey = 'other'; },
  executionDigest: v => { v.executionDigest = 'sha256:' + 'b'.repeat(64); },
  callerId: v => { v.callerId = 'other'; },
  scope: v => { v.scope.id = 'other'; },
  device: v => { v.target.deviceId = 'other'; },
  binding: v => { v.target.bindingRevision = 'other'; },
  mode: v => { v.mode = 'live'; },
};
for (const [name, mutate] of Object.entries(changes)) {
  test(`original handle: reject unrelated ${name} even with a matching query/reply pair`, () => {
    const q = structuredClone(query); mutate(q); const command = sealCommand(q);
    assert.throws(() => validateReply(observation(command), command, invocation, definition), /FLOW_REPLY_INVOCATION/);
  });
}
test('original handle: validate the command digest before trusting its echo', () => {
  const command = { ...query, commandId: 'tampered' };
  assert.throws(() => validateReply(observation(command), command, invocation, definition), /FLOW_MESSAGE_DIGEST/);
});
test('original handle: reject a tampered original canonical invocation', () => {
  const original = structuredClone(invocation); original.inputs[0].value = 'tampered';
  assert.throws(() => validateReply(observation(query), query, original, definition), /FLOW_EXECUTION_DIGEST/);
});
test('original handle: reject a resealed replacement invocation', () => {
  const original = structuredClone(invocation); original.inputs[0].value = 'replacement';
  assert.throws(() => validateReply(observation(query), query, sealInvocation(original), definition), /FLOW_REPLY_INVOCATION/);
});
test('original handle: current read authority/deadline can rotate without replacing work identity', () => {
  const m = new ReceiverModel(); m.admit(invocation, definition, authority, local, now);
  const a = { ...authority, authorityRef: 'new-current-read-grant' };
  const command = sealCommand({ ...query, commandId: 'fresh-read', authorityRef: a.authorityRef, deadline: new Date(now + 30000).toISOString() });
  const reply = m.control(command, a, local, now);
  assert.equal(validateReply(reply, command, invocation, definition).mayRetryEffects, false);
});
