// Offline review implementation: validates definitions, but executes no graph or tool.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { types } from 'node:util';
const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));
const fail = code => { throw new Error(code); };
const own = (value, key) => Object.hasOwn(value, key);
const scalarType = value => value === null ? 'null' : typeof value === 'number' ? 'integer' : typeof value;

// Closed integer-only JSON domain avoids cross-language float formatting ambiguity.
// No Unicode normalization. Object keys sort by UTF-16 code units; arrays retain order.
export function canonical(value) {
  let visits = 0;
  function encode(v, depth) {
    if (++visits > 12000 || depth > 32) fail('FLOW_LIMIT');
    if (v !== null && typeof v === 'object' && types.isProxy(v)) fail('FLOW_JSON');
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail('FLOW_NUMBER');
      return JSON.stringify(v);
    }
    if (typeof v === 'string') {
      if (!v.isWellFormed()) fail('FLOW_UNICODE');
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype || v.length > 1024) fail('FLOW_JSON');
      const keys = Reflect.ownKeys(v);
      if (keys.length !== v.length + 1 || keys.some(k => typeof k !== 'string' || (k !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)))) fail('FLOW_JSON');
      const encoded = [];
      for (let i = 0; i < v.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
        if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail('FLOW_JSON');
        encoded.push(encode(descriptor.value, depth + 1));
      }
      return '[' + encoded.join(',') + ']';
    }
    if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      const keys = Reflect.ownKeys(v);
      if (keys.some(k => typeof k !== 'string')) fail('FLOW_JSON');
      return '{' + keys.sort().map(k => {
        const descriptor = Object.getOwnPropertyDescriptor(v, k);
        if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable || ['__proto__', 'prototype', 'constructor'].includes(k)) fail('FLOW_JSON');
        return encode(k, depth + 1) + ':' + encode(descriptor.value, depth + 1);
      }).join(',') + '}';
    }
    fail('FLOW_JSON');
  }
  const text = encode(value, 0);
  if (Buffer.byteLength(text) > 262144) fail('FLOW_LIMIT');
  return text;
}
export const hash = value => 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex');

// Validator for the finite vocabulary emitted by build-schema.mjs, not a general
// JSON Schema library. Unknown keywords fail closed so schema growth needs review.
const keywords = new Set(['$ref', 'oneOf', 'const', 'enum', 'type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum']);
function check(v, s, depth = 0) {
  if (depth > 64) fail('FLOW_SCHEMA_DEPTH');
  for (const k of Object.keys(s)) if (!keywords.has(k)) fail('FLOW_SCHEMA_KEYWORD');
  if (s.$ref) {
    const name = s.$ref.slice('#/$defs/'.length);
    if (!s.$ref.startsWith('#/$defs/') || !own(schema.$defs, name)) fail('FLOW_SCHEMA_REF');
    return check(v, schema.$defs[name], depth + 1);
  }
  if (s.oneOf) {
    const matches = s.oneOf.filter(branch => { try { check(v, branch, depth + 1); return true; } catch { return false; } });
    if (matches.length !== 1) fail('FLOW_SHAPE');
    return;
  }
  if (own(s, 'const') && v !== s.const) fail('FLOW_SHAPE');
  if (s.enum && !s.enum.includes(v)) fail('FLOW_SHAPE');
  if (!s.type) return;
  const validType = s.type === 'object' ? v !== null && !Array.isArray(v) && typeof v === 'object'
    : s.type === 'array' ? Array.isArray(v) : s.type === 'integer' ? Number.isSafeInteger(v)
    : s.type === 'null' ? v === null : typeof v === s.type;
  if (!validType) fail('FLOW_SHAPE');
  if (s.type === 'object') {
    for (const k of s.required ?? []) if (!own(v, k)) fail('FLOW_SHAPE');
    for (const k of Object.keys(v)) {
      if (!own(s.properties, k)) fail('FLOW_SHAPE');
      check(v[k], s.properties[k], depth + 1);
    }
  } else if (s.type === 'array') {
    if (v.length < (s.minItems ?? 0) || v.length > s.maxItems) fail('FLOW_SHAPE');
    for (const item of v) check(item, s.items, depth + 1);
  } else if (s.type === 'string') {
    const length = [...v].length;
    if (length < (s.minLength ?? 0) || length > (s.maxLength ?? Infinity) || (s.pattern && !new RegExp(s.pattern).test(v))) fail('FLOW_SHAPE');
    // Existing Nero action transport measures bytes, not Unicode scalar count.
    if (s.maxLength === 2048 && Buffer.byteLength(v) > 2048) fail('FLOW_TEXT_BYTES');
  } else if (s.type === 'integer' && (v < s.minimum || v > s.maximum)) fail('FLOW_SHAPE');
}
export function validateShape(value, kind) {
  canonical(value);
  if (!['envelope', 'invocation', 'receipt', 'command', 'result', 'reply'].includes(kind)) fail('FLOW_SCHEMA_REF');
  check(value, schema.$defs[kind]);
}
function unique(rows, key, code) {
  if (new Set(rows.map(row => row[key])).size !== rows.length) fail(code);
}
function ports(rows) { unique(rows, 'name', 'FLOW_PORT_DUPLICATE'); return new Map(rows.map(p => [p.name, p.type])); }
export function semanticProjection(definition) {
  return Object.fromEntries(['schemaVersion', 'contractRevision', 'profile', 'interface', 'graph', 'dependencies', 'bindingSlots', 'policy'].map(k => [k, definition[k]]));
}
export function sealDefinition(value) {
  const { digests: ignored, ...unsigned } = structuredClone(value);
  return { ...unsigned, digests: { content: hash(unsigned), semantic: hash(semanticProjection(unsigned)) } };
}
export function validateDefinition(d) {
  validateShape(d, 'envelope');
  const expected = sealDefinition(d).digests;
  if (d.digests.content !== expected.content || d.digests.semantic !== expected.semantic) fail('FLOW_DIGEST');
  const { nodes, edges } = d.graph;
  unique(nodes, 'id', 'FLOW_NODE_DUPLICATE'); unique(d.dependencies, 'id', 'FLOW_DEPENDENCY_DUPLICATE'); unique(d.bindingSlots, 'id', 'FLOW_SLOT_DUPLICATE');
  const byId = new Map(nodes.map(n => [n.id, n]));
  const inputs = new Map(nodes.map(n => [n.id, ports(n.inputs)]));
  const outputs = new Map(nodes.map(n => [n.id, ports(n.outputs)]));
  const roots = nodes.filter(n => n.kind === 'input');
  if (roots.length !== 1) fail('FLOW_ROOT');
  const root = roots[0];
  const incoming = new Map(nodes.map(n => [n.id, []]));
  const outgoing = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) fail('FLOW_EDGE');
    incoming.get(e.target).push(e); outgoing.get(e.source).push(e);
  }
  for (const n of nodes) {
    const parents = incoming.get(n.id), children = outgoing.get(n.id);
    if (parents.length !== (n.id === root.id ? 0 : 1)) fail('FLOW_JOIN');
    if (n.kind === 'result' ? children.length !== 0 : n.kind === 'condition' ? children.length !== 2 : children.length !== 1) fail('FLOW_BRANCH');
    const branches = children.map(e => e.branch).sort();
    if (n.kind === 'condition' ? branches.join(',') !== 'no,yes' : branches.some(b => b !== 'next')) fail('FLOW_BRANCH');
  }
  const visited = new Set();
  function visit(id) { if (visited.has(id)) fail('FLOW_CYCLE'); visited.add(id); for (const e of outgoing.get(id)) visit(e.target); }
  visit(root.id);
  if (visited.size !== nodes.length) fail('FLOW_UNREACHABLE');
  if (d.policy.maxSteps < nodes.length) fail('FLOW_STEP_BUDGET');
  ports(d.interface.inputs); ports(d.interface.outputs);
  if (root.inputs.length || root.arguments.length || canonical(root.outputs) !== canonical(d.interface.inputs)) fail('FLOW_INTERFACE');
  for (const n of nodes) {
    const input = inputs.get(n.id), output = outputs.get(n.id);
    unique(n.arguments, 'port', 'FLOW_ARGUMENT_DUPLICATE');
    if (n.arguments.length !== input.size) fail('FLOW_ARGUMENT');
    const ancestors = new Set(); let current = n.id;
    while (incoming.get(current).length) { current = incoming.get(current)[0].source; ancestors.add(current); }
    for (const arg of n.arguments) {
      const b = arg.binding; let type;
      if (own(b, 'literal')) type = scalarType(b.literal);
      else {
        if (!ancestors.has(b.node) || !outputs.get(b.node)?.has(b.port)) fail('FLOW_MAPPING_SOURCE');
        type = outputs.get(b.node).get(b.port);
      }
      if (!input.has(arg.port) || input.get(arg.port) !== type) fail('FLOW_MAPPING_TYPE');
    }
    if (n.kind === 'capability') {
      if (!d.dependencies.some(dep => dep.id === n.dependency) || !d.bindingSlots.some(s => s.id === n.bindingSlot && s.kind === 'device') || !n.effect) fail('FLOW_CAPABILITY');
    } else if (['dependency', 'bindingSlot', 'effect'].some(k => own(n, k))) fail('FLOW_NODE_CONFIG');
    if (n.kind === 'condition' && (canonical(n.inputs) !== canonical([{ name: 'test', type: 'boolean' }]) || output.size)) fail('FLOW_CONDITION');
    if (['map', 'review', 'result'].includes(n.kind) && canonical(n.inputs) !== canonical(n.outputs)) fail('FLOW_PASSTHROUGH');
    if (n.kind === 'result' && canonical(n.outputs) !== canonical(d.interface.outputs)) fail('FLOW_INTERFACE');
  }
  unique(d.presentation.nodes, 'id', 'FLOW_PRESENTATION');
  if (d.presentation.nodes.length !== nodes.length || d.presentation.nodes.some(n => !byId.has(n.id))) fail('FLOW_PRESENTATION');
  return { profile: d.profile, nodeCount: nodes.length, declaredModelCalls: 0, publishedRevision: d.metadata.lifecycle === 'published', readiness: 'unresolved', grantsTransferred: false };
}
export function sealInvocation(value) {
  const { executionDigest: ignored, ...unsigned } = structuredClone(value);
  return { ...unsigned, executionDigest: hash(unsigned) };
}
export function validateInvocation(value, definition) {
  validateDefinition(definition); validateShape(value, 'invocation');
  if (sealInvocation(value).executionDigest !== value.executionDigest) fail('FLOW_EXECUTION_DIGEST');
  if (value.definitionId !== definition.definitionId || value.revisionId !== definition.revisionId || value.semanticDigest !== definition.digests.semantic) fail('FLOW_REVISION');
  if (definition.metadata.lifecycle !== 'published') fail('FLOW_NOT_PUBLISHED');
  if (value.scope.kind !== definition.metadata.owner.scope || value.scope.id !== definition.metadata.owner.id) fail('FLOW_SCOPE');
  unique(value.inputs, 'port', 'FLOW_INPUT_DUPLICATE');
  const required = ports(definition.interface.inputs);
  if (value.inputs.length !== required.size || value.inputs.some(p => !required.has(p.port) || scalarType(p.value) !== required.get(p.port))) fail('FLOW_INPUT_TYPE');
  if (new Date(value.deadline).toISOString() !== value.deadline) fail('FLOW_DEADLINE');
  // This result is structural validity, NOT live admission or current authorization.
  return { structurallyValid: true, admission: 'not-performed', mode: value.mode };
}
// Pure receipt comparison. No persistence, dedup store, scheduler or retry action.
export function compareReceipts(previous, next) {
  validateShape(previous, 'receipt'); validateShape(next, 'receipt');
  for (const receipt of [previous, next]) {
    if (receipt.outcome === 'cancelled' && receipt.reason !== 'stop-confirmed') fail('FLOW_STOP_UNCONFIRMED');
  }
  if (previous.invocationId !== next.invocationId || previous.executionDigest !== next.executionDigest) fail('FLOW_RECEIPT_IDENTITY');
  if (next.sequence === previous.sequence && canonical(next) === canonical(previous)) return 'duplicate';
  if (next.sequence <= previous.sequence) fail('FLOW_RECEIPT_SEQUENCE');
  const allowed = {
    accepted: ['started', 'failed', 'interrupted', 'uncertain', 'cancel-pending', 'cancelled'],
    started: ['completed', 'failed', 'interrupted', 'uncertain', 'cancel-pending'],
    'cancel-pending': ['cancelled', 'uncertain', 'completed', 'failed', 'interrupted'],
    uncertain: ['completed', 'failed', 'cancelled', 'interrupted'],
    interrupted: ['completed', 'failed', 'cancelled', 'uncertain'],
  };
  if (!allowed[previous.outcome]?.includes(next.outcome)) fail('FLOW_RECEIPT_TRANSITION');
  return 'advance';
}
