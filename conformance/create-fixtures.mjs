import { mkdirSync, writeFileSync } from 'node:fs';
import { sealDefinition, sealInvocation } from './contract.mjs';
const port = (name = 'message', type = 'string') => ({ name, type });
const p = port();
const node = (id, kind, source) => ({ id, kind, version: 1,
  inputs: kind === 'input' ? [] : [p], outputs: [p],
  arguments: source ? [{ port: 'message', binding: { node: source, port: 'message' } }] : [],
});
export const definition = sealDefinition({
  schemaVersion: 'fuego-nero-flow/0.1-candidate.1', contractRevision: '0.1.0',
  definitionId: 'flow-fixture-hello', revisionId: 'revision-1', profile: 'local-ephemeral',
  metadata: { title: 'Review a fixture message', description: 'Synthetic typed input through mapping and review to a pinned mock capability. No live tools.',
    owner: { scope: 'personal', id: 'fixture-owner' },
    origin: { product: 'fuego', deviceId: 'fixture-device', authorId: 'fixture-author' },
    lifecycle: 'published', visibility: 'private' },
  interface: { inputs: [p], outputs: [p] },
  graph: {
    nodes: [node('start', 'input'), node('map', 'map', 'start'), node('review', 'review', 'map'),
      { ...node('mock', 'capability', 'review'), dependency: 'mockEcho', bindingSlot: 'desktop', effect: 'read' },
      node('done', 'result', 'mock')],
    edges: [['start', 'map'], ['map', 'review'], ['review', 'mock'], ['mock', 'done']].map(([source, target]) => ({ source, target, branch: 'next' })),
  },
  dependencies: [{ id: 'mockEcho', capability: 'fixture.echo', revision: '1', digest: 'sha256:' + 'a'.repeat(64) }],
  bindingSlots: [{ id: 'desktop', kind: 'device' }],
  policy: { timeoutMs: 60000, maxSteps: 5, maxNesting: 0, maxModelCalls: 0 },
  presentation: { nodes: ['start', 'map', 'review', 'mock', 'done'].map((id, i) => ({ id, label: id, x: i * 100, y: 0 })) },
});
export const invocation = sealInvocation({
  schemaVersion: 'fuego-nero-flow-invocation/0.1-candidate.1',
  invocationId: 'fixture-invocation-1', idempotencyKey: 'fixture-request-1', mode: 'fixture',
  scope: { kind: 'personal', id: 'fixture-owner' }, callerId: 'fixture-caller',
  rootRunId: 'fixture-root', parentRunId: 'fixture-parent', nodeId: 'callNero',
  definitionId: definition.definitionId, revisionId: definition.revisionId,
  semanticDigest: definition.digests.semantic,
  target: { deviceId: 'fixture-device', bindingRevision: 'fixture-binding-1' },
  deadline: '2030-01-01T00:00:00.000Z',
  inputs: [{ port: 'message', value: 'Synthetic hello — café 🔥' }], authorityRef: 'fixture-authority-only',
});
export const receipt = (outcome, sequence, reason = 'none') => ({
  schemaVersion: 'fuego-nero-flow-receipt/0.1-candidate.1', invocationId: invocation.invocationId,
  executionDigest: invocation.executionDigest, sequence, outcome, reason,
});
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
  for (const [name, value] of Object.entries({ definition, invocation,
    receipts: [receipt('accepted', 0), receipt('started', 1), receipt('cancel-pending', 2), receipt('uncertain', 3, 'effect-unknown'), receipt('completed', 4)] })) {
    writeFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
  }
}
