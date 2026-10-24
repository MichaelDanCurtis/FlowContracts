// Review candidate only. Keep this builder and its checked-in JSON in agreement.
import { writeFileSync } from 'node:fs';
const ref = name => ({ $ref: `#/$defs/${name}` });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const text = (maxLength = 128) => ({ type: 'string', minLength: 1, maxLength });
const key = { ...text(80), pattern: '^[A-Za-z][A-Za-z0-9_-]*$' };
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const choices = values => ({ type: 'string', enum: values });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const digest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const scalar = { oneOf: [{ type: 'string', maxLength: 2048 }, { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 }, { type: 'boolean' }, { type: 'null' }] };
const defs = {
  scalar,
  port: object({ name: key, type: choices(['string', 'integer', 'boolean', 'null']) }),
  binding: { oneOf: [object({ literal: ref('scalar') }), object({ node: key, port: key })] },
  argument: object({ port: key, binding: ref('binding') }),
  node: object({
    id: key, kind: choices(['input', 'map', 'condition', 'capability', 'review', 'result']),
    version: { const: 1 }, inputs: list(ref('port'), 16), outputs: list(ref('port'), 16),
    arguments: list(ref('argument'), 16),
    // Only capability nodes carry a dependency and abstract device binding slot.
    dependency: key, bindingSlot: key,
    effect: choices(['read', 'write']),
  }, ['id', 'kind', 'version', 'inputs', 'outputs', 'arguments']),
  edge: object({ source: key, target: key, branch: choices(['next', 'yes', 'no']) }),
  dependency: object({ id: key, capability: text(160), revision: text(), digest }),
  slot: object({ id: key, kind: choices(['device', 'agent', 'account', 'workspace', 'artifact']) }),
  envelope: object({
    schemaVersion: { const: 'fuego-nero-flow/0.1-candidate.1' },
    contractRevision: { const: '0.1.0' }, definitionId: text(), revisionId: text(),
    profile: choices(['local-ephemeral', 'server-durable']),
    metadata: object({
      title: text(80), description: text(512),
      owner: object({ scope: choices(['personal', 'workspace']), id: text() }),
      origin: object({ product: choices(['nero', 'fuego']), deviceId: text(), authorId: text() }),
      lifecycle: choices(['draft', 'published', 'deprecated', 'archived']),
      visibility: { const: 'private' },
    }),
    interface: object({ inputs: list(ref('port'), 16), outputs: list(ref('port'), 16) }),
    graph: object({ nodes: list(ref('node'), 64, 2), edges: list(ref('edge'), 96, 1) }),
    dependencies: list(ref('dependency'), 32), bindingSlots: list(ref('slot'), 16),
    policy: object({
      timeoutMs: integer(1, 300000), maxSteps: integer(1, 64), maxNesting: integer(0, 8),
      maxModelCalls: { const: 0 },
    }),
    presentation: object({ nodes: list(object({ id: key, label: text(80), x: integer(-100000, 100000), y: integer(-100000, 100000) }), 64) }),
    digests: object({ content: digest, semantic: digest }),
  }),
  invocation: object({
    schemaVersion: { const: 'fuego-nero-flow-invocation/0.1-candidate.1' },
    invocationId: text(), idempotencyKey: text(), mode: choices(['fixture', 'live']),
    scope: object({ kind: choices(['personal', 'workspace']), id: text() }),
    callerId: text(), rootRunId: text(), parentRunId: text(), nodeId: key,
    definitionId: text(), revisionId: text(), semanticDigest: digest,
    target: object({ deviceId: text(), bindingRevision: text() }),
    deadline: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' },
    inputs: list(object({ port: key, value: ref('scalar') }), 16),
    // This is a reference checked by the receiver, never an embedded bearer grant.
    authorityRef: text(), executionDigest: digest,
  }),
  receipt: object({
    schemaVersion: { const: 'fuego-nero-flow-receipt/0.1-candidate.1' },
    invocationId: text(), executionDigest: digest, sequence: integer(0, 9007199254740991),
    outcome: choices(['rejected', 'accepted', 'started', 'completed', 'failed', 'interrupted', 'uncertain', 'cancel-pending', 'cancelled']),
    reason: choices(['none', 'invalid-definition', 'missing-grant', 'target-unavailable', 'expired', 'effect-unknown', 'interrupted', 'stop-confirmed', 'id-content-conflict']),
  }),
};
const target = object({ deviceId: text(), bindingRevision: text() });
const scope = object({ kind: choices(['personal', 'workspace']), id: text() });
const deadline = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' };
defs.command = object({
  schemaVersion: { const: 'fuego-nero-flow-control/0.1-candidate.1' },
  commandId: text(), operation: choices(['query', 'cancel']),
  scope, callerId: text(), invocationId: text(), idempotencyKey: text(), executionDigest: digest,
  target, mode: choices(['fixture', 'live']), deadline, authorityRef: text(), commandDigest: digest,
});
defs.result = object({
  schemaVersion: { const: 'fuego-nero-flow-result/0.1-candidate.1' },
  scope, callerId: text(), invocationId: text(), executionDigest: digest,
  definitionId: text(), revisionId: text(), semanticDigest: digest, target,
  mode: choices(['fixture', 'live']), sequence: integer(0, 9007199254740991),
  outcome: choices(['completed', 'failed', 'interrupted', 'uncertain', 'cancelled']),
  reason: choices(['none', 'execution-failed', 'effect-unknown', 'interrupted', 'stop-confirmed']),
  outputs: list(object({ port: key, value: ref('scalar') }), 16), resultDigest: digest,
});
// Failed results need an explicit failure reason in their projected receipt.
defs.receipt.properties.reason.enum.push('execution-failed');
defs.reply = object({
  schemaVersion: { const: 'fuego-nero-flow-reply/0.1-candidate.1' },
  commandId: text(), commandDigest: digest, operation: choices(['query', 'cancel']),
  invocationId: text(), executionDigest: digest, scope, callerId: text(), target,
  mode: choices(['fixture', 'live']), observation: choices(['found', 'not-found']),
  // Not-found has no receipt/result; optional presence is checked semantically.
  receipt: ref('receipt'), result: ref('result'), replyDigest: digest,
}, ['schemaVersion', 'commandId', 'commandDigest', 'operation', 'invocationId', 'executionDigest', 'scope', 'callerId', 'target', 'mode', 'observation', 'replyDigest']);
export const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:fuego-nero-flow:review-candidate:0.1.0-proposal-5',
  ...ref('envelope'), $defs: defs,
};
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  writeFileSync(new URL('./schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n', { flag: 'w' });
}
