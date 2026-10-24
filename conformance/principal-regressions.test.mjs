import test from 'node:test';
import assert from 'node:assert/strict';
import { definition, invocation } from './create-fixtures.mjs';
import { authority, local, query, cancel, now } from './create-control-fixtures.mjs';
import { ReceiverModel } from './receiver.mjs';
const admitted = () => { const m = new ReceiverModel(); m.admit(invocation, definition, authority, local, now); return m; };
test('device grants for another normalized remote caller cannot admit work', () => {
  assert.throws(() => new ReceiverModel().admit(invocation, definition, authority, { ...local, principalId: 'another-caller' }, now), /FLOW_CALLER_SCOPE/);
});
test('device grants for another normalized remote caller cannot disclose query receipts', () => {
  assert.throws(() => admitted().control(query, authority, { ...local, principalId: 'another-caller' }, now), /FLOW_CALLER_SCOPE/);
});
test('device grants for another normalized remote caller cannot cancel work', () => {
  assert.throws(() => admitted().control(cancel, authority, { ...local, principalId: 'another-caller' }, now), /FLOW_CALLER_SCOPE/);
});
test('missing normalized local grant subject fails closed', () => {
  const missing = structuredClone(local); delete missing.principalId;
  assert.throws(() => new ReceiverModel().admit(invocation, definition, authority, missing, now), /FLOW_CALLER_SCOPE/);
});
test('raw SDK actor ID is not compared as though it were the normalized remote grant subject', () => {
  assert.throws(() => new ReceiverModel().admit(invocation, definition, authority, { ...local, principalId: 'local-sdk-plugin-actor' }, now), /FLOW_CALLER_SCOPE/);
});
test('matching normalized subject keeps independent local capability grants effective', () => {
  const m = admitted(); assert.equal(m.control(query, authority, local, now).observation, 'found');
  assert.throws(() => new ReceiverModel().admit(invocation, definition, authority, { ...local, capabilities: [] }, now), /FLOW_DEPENDENCY_GRANT/);
});
test('matching local subject cannot override a mismatched authenticated server principal', () => {
  assert.throws(() => new ReceiverModel().admit(invocation, definition, { ...authority, principalId: 'other' }, local, now), /FLOW_CALLER_SCOPE/);
});
