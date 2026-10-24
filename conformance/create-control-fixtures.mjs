import { writeFileSync } from 'node:fs';
import { definition, invocation } from './create-fixtures.mjs';
import { sealCommand, sealResult, ReceiverModel } from './receiver.mjs';
export const now = Date.parse('2029-12-31T23:59:00.000Z');
export const query = sealCommand({
  schemaVersion: 'fuego-nero-flow-control/0.1-candidate.1', commandId: 'fixture-query-1', operation: 'query',
  ...Object.fromEntries(['scope', 'callerId', 'invocationId', 'idempotencyKey', 'executionDigest', 'target', 'mode', 'deadline', 'authorityRef'].map(k => [k, structuredClone(invocation[k])])),
});
export const cancel = sealCommand({ ...query, commandId: 'fixture-cancel-1', operation: 'cancel' });
export const result = sealResult({
  schemaVersion: 'fuego-nero-flow-result/0.1-candidate.1',
  ...Object.fromEntries(['scope', 'callerId', 'invocationId', 'executionDigest', 'definitionId', 'revisionId', 'semanticDigest', 'target', 'mode'].map(k => [k, structuredClone(invocation[k])])),
  sequence: 1, outcome: 'completed', reason: 'none', outputs: [{ port: 'message', value: 'Synthetic hello — café 🔥' }],
});
export const authority = {
  source: 'trusted-server-fixture', principalId: invocation.callerId, scope: structuredClone(invocation.scope),
  target: structuredClone(invocation.target), mode: 'fixture', authorityRef: invocation.authorityRef,
  validUntil: invocation.deadline, operations: ['invoke', 'query', 'cancel'], revoked: false,
  flows: [{ definitionId: definition.definitionId, revisionId: definition.revisionId, semanticDigest: definition.digests.semantic }],
  capabilities: [{ ...definition.dependencies[0], effect: 'read' }],
};
export const local = { ...structuredClone(authority), source: 'trusted-device-fixture', online: true, unlocked: true };
export const producer = { source: 'trusted-receiver-fixture', operations: ['report-result'], scope: structuredClone(invocation.scope), target: structuredClone(invocation.target), mode: 'fixture', validUntil: invocation.deadline, revoked: false };
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const receiver = new ReceiverModel(); receiver.admit(invocation, definition, authority, local, now);
  receiver.settle(result, producer, now);
  const reply = receiver.control(query, authority, local, now);
  for (const [name, value] of Object.entries({ query, cancel, result, reply })) {
    writeFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
  }
}
