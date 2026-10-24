// OFFLINE CONFORMANCE MODEL. No transport, trusted-context construction,
// durable database, actual dispatch, native keys or production imports exist here.
import { canonical, hash, validateShape, validateInvocation, sealInvocation, compareReceipts } from './contract.mjs';
const fail = code => { throw new Error(code); };
const equal = (a, b) => canonical(a) === canonical(b);
const copy = structuredClone;
const opKey = v => canonical([v.scope, v.callerId, v.target, v.commandId]);
const requestKey = v => canonical([v.scope, v.callerId, v.target, v.idempotencyKey]);
// Invocation identity survives binding changes: same ID/new binding is a conflict.
const identityKey = v => canonical([v.scope, v.callerId, v.target.deviceId, v.invocationId]);
const timestamp = text => {
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== text) fail('FLOW_DEADLINE');
  return ms;
};
const remaining = (text, now) => {
  if (!Number.isSafeInteger(now)) fail('FLOW_CLOCK');
  const value = timestamp(text) - now;
  if (value <= 0 || value > 300000) fail('FLOW_EXPIRED_OR_UNBOUNDED');
};
function seal(v, field) { const { [field]: ignored, ...rest } = copy(v); return { ...rest, [field]: hash(rest) }; }
function digest(v, field) { if (seal(v, field)[field] !== v[field]) fail('FLOW_MESSAGE_DIGEST'); }
export const sealCommand = v => seal(v, 'commandDigest');
export const sealResult = v => seal(v, 'resultDigest');
export const sealReply = v => seal(v, 'replyDigest');
export function validateCommand(v) {
  validateShape(v, 'command'); digest(v, 'commandDigest'); timestamp(v.deadline);
}
export function validateResult(v, invocation, definition) {
  validateInvocation(invocation, definition);
  validateShape(v, 'result'); digest(v, 'resultDigest');
  for (const key of ['scope', 'callerId', 'invocationId', 'executionDigest', 'definitionId', 'revisionId', 'semanticDigest', 'target', 'mode']) {
    if (!equal(v[key], invocation[key])) fail('FLOW_RESULT_JOIN');
  }
  if (definition.definitionId !== v.definitionId || definition.revisionId !== v.revisionId || definition.digests.semantic !== v.semanticDigest) fail('FLOW_RESULT_JOIN');
  const reasons = { completed: 'none', failed: 'execution-failed', interrupted: 'interrupted', uncertain: 'effect-unknown', cancelled: 'stop-confirmed' };
  if (v.reason !== reasons[v.outcome]) fail('FLOW_RESULT_REASON');
  const ports = new Map(definition.interface.outputs.map(p => [p.name, p.type]));
  if (new Set(v.outputs.map(p => p.port)).size !== v.outputs.length) fail('FLOW_RESULT_OUTPUT');
  if (v.outcome !== 'completed' && v.outputs.length !== 0) fail('FLOW_RESULT_OUTPUT');
  if (v.outcome === 'completed') {
    if (ports.size !== v.outputs.length) fail('FLOW_RESULT_OUTPUT');
    for (const p of v.outputs) {
      const type = p.value === null ? 'null' : typeof p.value === 'number' ? 'integer' : typeof p.value;
      if (!ports.has(p.port) || ports.get(p.port) !== type) fail('FLOW_RESULT_OUTPUT');
    }
  }
}
export function validateReply(v, command, invocation, definition) {
  validateCommand(command);
  validateShape(invocation, 'invocation');
  if (sealInvocation(invocation).executionDigest !== invocation.executionDigest) fail('FLOW_EXECUTION_DIGEST');
  for (const key of ['scope', 'callerId', 'invocationId', 'idempotencyKey', 'executionDigest', 'target', 'mode']) {
    if (!equal(command[key], invocation[key])) fail('FLOW_REPLY_INVOCATION');
  }
  validateShape(v, 'reply'); digest(v, 'replyDigest');
  for (const key of ['commandId', 'commandDigest', 'operation', 'scope', 'callerId', 'invocationId', 'executionDigest', 'target', 'mode']) {
    if (!equal(v[key], command[key])) fail('FLOW_REPLY_JOIN');
  }
  if (v.observation === 'not-found') {
    if (v.operation === 'cancel' || v.receipt || v.result) fail('FLOW_REPLY_STATE');
    return { mayRetryEffects: false, observationOnly: true };
  }
  if (!v.receipt) fail('FLOW_REPLY_STATE');
  if (v.receipt.invocationId !== v.invocationId || v.receipt.executionDigest !== v.executionDigest) fail('FLOW_REPLY_JOIN');
  compareReceipts(v.receipt, v.receipt);
  if (v.result) {
    validateResult(v.result, invocation, definition);
    if (v.result.sequence !== v.receipt.sequence || v.result.outcome !== v.receipt.outcome || v.result.reason !== v.receipt.reason) fail('FLOW_REPLY_STATE');
  } else if (['completed', 'failed', 'interrupted', 'uncertain'].includes(v.receipt.outcome)) fail('FLOW_REPLY_STATE');
  return { mayRetryEffects: false, observationOnly: true };
}

// Both contexts MUST come from authenticated transport/current grant stores,
// never fields in the request. Fixtures stand in for those providers here.
export function authorize(request, operation, authority, local, now) {
  if (!authority || !local || authority.source !== 'trusted-server-fixture' || local.source !== 'trusted-device-fixture') fail('FLOW_UNTRUSTED_CONTEXT');
  remaining(authority.validUntil, now);
  remaining(local.validUntil, now);
  if (authority.revoked || local.revoked) fail('FLOW_REVOKED');
  if (authority.principalId !== request.callerId || !equal(authority.scope, request.scope) || !equal(local.scope, request.scope)) fail('FLOW_CALLER_SCOPE');
  if (!equal(authority.target, request.target) || !equal(local.target, request.target)) fail('FLOW_TARGET_BINDING');
  if (authority.mode !== request.mode || local.mode !== request.mode) fail('FLOW_MODE');
  if (authority.authorityRef !== request.authorityRef || !authority.operations.includes(operation) || !local.operations.includes(operation)) fail('FLOW_GRANT');
  // No online/unlocked requirement for reading retained receipts or cancelling.
  if (operation === 'invoke' && (!local.online || !local.unlocked)) fail('FLOW_TARGET_UNAVAILABLE');
}
function authorizeInvocation(invocation, definition, authority, local, now) {
  authorize(invocation, 'invoke', authority, local, now);
  for (const ctx of [authority, local]) {
    if (!ctx.flows.some(f => f.definitionId === invocation.definitionId && f.revisionId === invocation.revisionId && f.semanticDigest === invocation.semanticDigest)) fail('FLOW_FLOW_GRANT');
    for (const n of definition.graph.nodes.filter(n => n.kind === 'capability')) {
      const dep = definition.dependencies.find(d => d.id === n.dependency);
      if (!ctx.capabilities.some(c => c.capability === dep.capability && c.revision === dep.revision && c.digest === dep.digest && c.effect === n.effect)) fail('FLOW_DEPENDENCY_GRANT');
    }
  }
}
const projectedReceipt = value => ({
  schemaVersion: 'fuego-nero-flow-receipt/0.1-candidate.1', invocationId: value.invocationId,
  executionDigest: value.executionDigest, sequence: value.sequence, outcome: value.outcome, reason: value.reason,
});

export class ReceiverModel {
  #records = new Map(); #ids = new Map(); #commands = new Map(); #intentCount = 0;
  get syntheticDispatchIntents() { return this.#intentCount; }
  #lookup(value) {
    const a = this.#records.get(requestKey(value)), b = this.#ids.get(identityKey(value));
    if (a && b && a !== b) fail('FLOW_ID_CONTENT_CONFLICT');
    const record = a ?? b;
    if (record && (record.handle.executionDigest !== value.executionDigest || requestKey(record.handle) !== requestKey(value) || identityKey(record.handle) !== identityKey(value))) fail('FLOW_ID_CONTENT_CONFLICT');
    return record;
  }
  #save(value, record) {
    if (this.#records.size >= 64 || this.#ids.size >= 64) fail('FLOW_LEDGER_CAPACITY');
    this.#records.set(requestKey(value), record); this.#ids.set(identityKey(value), record);
  }
  admit(invocation, definition, authority, local, now) {
    validateInvocation(invocation, definition);
    authorizeInvocation(invocation, definition, authority, local, now);
    const existing = this.#lookup(invocation);
    if (existing) return { fresh: false, receipt: copy(existing.receipt), synthetic: true };
    remaining(invocation.deadline, now);
    const receipt = projectedReceipt({ ...invocation, sequence: 0, outcome: 'accepted', reason: 'none' });
    this.#save(invocation, { handle: copy(invocation), invocation: copy(invocation), definition: copy(definition), receipt });
    this.#intentCount++;
    return { fresh: true, receipt: copy(receipt), synthetic: true };
  }
  control(command, authority, local, now) {
    validateCommand(command); authorize(command, command.operation, authority, local, now); remaining(command.deadline, now);
    const previous = this.#commands.get(opKey(command));
    if (previous && previous !== command.commandDigest) fail('FLOW_COMMAND_CONFLICT');
    if (!previous && this.#commands.size >= 128) fail('FLOW_LEDGER_CAPACITY');
    let record = this.#lookup(command);
    if (command.operation === 'cancel' && !previous) {
      if (!record) {
        // Pre-admission cancellation fences a delayed invoke in this model.
        record = { handle: copy(command), receipt: projectedReceipt({ ...command, sequence: 0, outcome: 'cancelled', reason: 'stop-confirmed' }), tombstone: true };
        this.#save(command, record);
      } else if (['accepted', 'started'].includes(record.receipt.outcome)) {
        record.receipt = projectedReceipt({ ...command, sequence: record.receipt.sequence + 1, outcome: 'cancel-pending', reason: 'none' });
      }
    }
    this.#commands.set(opKey(command), command.commandDigest);
    return sealReply({
      schemaVersion: 'fuego-nero-flow-reply/0.1-candidate.1',
      ...Object.fromEntries(['commandId', 'commandDigest', 'operation', 'scope', 'callerId', 'invocationId', 'executionDigest', 'target', 'mode'].map(k => [k, command[k]])),
      observation: record ? 'found' : 'not-found',
      ...(record ? { receipt: copy(record.receipt), ...(record.result ? { result: copy(record.result) } : {}) } : {}),
    });
  }
  settle(result, producer, now) {
    validateShape(result, 'result'); digest(result, 'resultDigest');
    // Result producers are authenticated execution owners, not human callers.
    if (!producer || producer.revoked || producer.source !== 'trusted-receiver-fixture' || !producer.operations.includes('report-result') || !equal(producer.scope, result.scope) || !equal(producer.target, result.target) || producer.mode !== result.mode) fail('FLOW_RESULT_PRODUCER');
    remaining(producer.validUntil, now);
    const record = this.#ids.get(identityKey(result));
    if (!record || record.tombstone || !record.invocation) fail('FLOW_RESULT_UNKNOWN');
    validateResult(result, record.invocation, record.definition);
    if (record.result && record.result.sequence === result.sequence && record.result.resultDigest !== result.resultDigest) fail('FLOW_RESULT_CONFLICT');
    // A synthetic first result may imply started was observed by the execution
    // owner before a delayed status event; never reopen a terminal/uncertain run.
    let prior = record.receipt;
    if (prior.outcome === 'accepted' && result.outcome === 'completed') prior = { ...prior, outcome: 'started' };
    compareReceipts(prior, projectedReceipt(result));
    record.receipt = projectedReceipt(result); record.result = copy(result);
    return copy(record.receipt);
  }
}
