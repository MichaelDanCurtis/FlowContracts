import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, compareReceipts } from './contract.mjs';
import { receipt } from './create-fixtures.mjs';

test('peer R1: sparse array cannot disguise its hole using an extra property', () => {
  const array = new Array(1); array.extra = 7;
  assert.throws(() => canonical(array), /FLOW_JSON/);
});
test('peer R1: dense arrays reject extra properties without discarding them', () => {
  const array = [7]; array.extra = 8;
  assert.throws(() => canonical(array), /FLOW_JSON/);
});
test('peer R2: array index accessor is rejected before invoking getter', () => {
  let called = 0; const array = [];
  Object.defineProperty(array, '0', { enumerable: true, get() { called++; return 7; } });
  try { assert.throws(() => canonical(array), /FLOW_JSON/); }
  finally { assert.equal(called, 0, 'untrusted accessor must never execute'); }
});
test('peer R2: arrays reject symbol properties', () => {
  const array = [7]; array[Symbol('hidden')] = 8;
  assert.throws(() => canonical(array), /FLOW_JSON/);
});
test('peer R2: normal dense data arrays preserve every element', () => {
  assert.equal(canonical([1, null, '🔥', false]), '[1,null,"🔥",false]');
});
test('peer R3: malformed initial cancelled receipt is rejected before comparison', () => {
  assert.throws(() => compareReceipts(receipt('cancelled', 0), receipt('cancelled', 1, 'stop-confirmed')), /FLOW_STOP_UNCONFIRMED/);
});
test('peer R3: identical cancelled receipt without stop proof cannot bypass validation', () => {
  const bad = receipt('cancelled', 0);
  assert.throws(() => compareReceipts(bad, structuredClone(bad)), /FLOW_STOP_UNCONFIRMED/);
});
test('peer R3: valid stopped duplicate remains idempotent', () => {
  const stopped = receipt('cancelled', 0, 'stop-confirmed');
  assert.equal(compareReceipts(stopped, structuredClone(stopped)), 'duplicate');
});
test('related boundary: object hidden properties are not silently discarded', () => {
  const value = { visible: 1 }; Object.defineProperty(value, 'hidden', { value: 2 });
  assert.throws(() => canonical(value), /FLOW_JSON/);
});
test('related boundary: a Proxy cannot invoke traps during canonicalization', () => {
  let called = 0;
  const value = new Proxy([7], { get(target, key) { called++; return Reflect.get(target, key); } });
  assert.throws(() => canonical(value), /FLOW_JSON/);
  assert.equal(called, 0);
});
