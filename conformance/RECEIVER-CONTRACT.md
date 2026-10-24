# Query, cancellation, typed results and receiver authority — proposal

Status: FUEGO-FLOW-002, review candidate 4 for normative contract 0.1.0. **Unpromoted. No production receiver.** Wire shapes and seven vectors are unchanged from candidate 3; original-handle reply validation is corrected. The inherited graph/primitive subset remains unchanged. New controls are versioned separately as `fuego-nero-flow-control/0.1-candidate.1`, results as `fuego-nero-flow-result/0.1-candidate.1` and replies as `fuego-nero-flow-reply/0.1-candidate.1`. Shared integration waits for Nero accept/change and a promoted package pin.

## Message identities and bounded values

| Message | Fields/checks | Meaning |
| --- | --- | --- |
| Invoke (inherited) | Scope, caller/root/parent/node, immutable definition/revision/semantic digest, device/binding, inputs, mode, authority reference, deadline, invocation ID/idempotency key and execution digest | Ask to admit that exact work; not an authorization proof |
| Query | Exact original invocation ID, idempotency key, execution digest, scope/caller/target/mode; current read authority reference, command ID, bounded deadline and command digest | Inspect original admission/receipt/outcome without resubmitting |
| Cancel | Same handle as query, current cancel authority, its own command ID/digest | Fence new local admission/dispatch and request stop; pending is not stop confirmation |
| Result | Exact invocation/definition/revision/semantic digest, scope/caller/target/mode, sequence, outcome/reason, typed outputs and result digest | Authenticated execution-owner evidence; not an arbitrary caller assertion |
| Reply | Exact command ID/digest and invocation handle, found/not-found observation, optional matching receipt/result, reply digest | Protected snapshot of retained knowledge; no instruction to retry effects |

Every message uses the inherited 256 KiB canonical-object/depth/visit limits and closed schemas. Outputs contain at most 16 unique declared scalar ports; each string is at most 2,048 UTF-8 bytes. Completed outputs must exactly match the pinned graph output interface; no undeclared/missing/duplicate/wrong-type ports. Failed/interrupted/uncertain/cancelled results carry **no successful outputs**. Rich partial artifacts and structured results need another versioned extension; nothing is truncated or converted to strings here.

Each new message's digest hashes the whole object excluding its own digest field. Query/cancel use `commandDigest`, result uses `resultDigest`, reply uses `replyDigest`. Original three digest projections and fixture bytes remain unchanged. Command/result/reply fixture hashes must agree in both language implementations before consuming them.

`execution-failed` is added to receipt reasons for failed typed results. Completed means reason `none`; failed `execution-failed`; interrupted `interrupted`; uncertain `effect-unknown`; cancelled `stop-confirmed`. This is a proposed vocabulary extension, not silent compatibility with candidate-2 receivers. A checksum detects mismatch, not message authenticity.

## Trusted identity and permission intersection

Body `callerId`, scope, target and `authorityRef` are claims to match against authenticated transport/current grant stores. The adapter supplies **separate trusted server and device contexts**, including actual principal, scope, target binding, expiry, mode, allowed operations, exact permitted flow revisions and permitted dependency capability/revision/digest/effect. Both contexts must independently allow invocation. No union, publisher-team shortcut or self-reported caller is accepted. The receiver does not accept a context object from a browser or workflow argument.

The offline model uses obvious `trusted-*-fixture` source markers to label authored inputs. **These strings establish no trust** and the model API is not safe as an exposed endpoint. No context builder, SDK ActionRun validation, gRPC identity binding, signature/key verification or live grant-store adapter exists in this package. Nero's actual local integration continues to derive caller identity from the existing authoritative ActionRun, separately from these fixtures.

Invoke additionally requires the exact flow/revision/semantic pin, all invoked dependencies/effects allowed by **both** server and device contexts, current local online/unlocked execution eligibility, and current bounded leases. Query/cancel require their own current operations and exact owner/caller/binding; device execution eligibility may be offline/locked because reading a receipt or fencing admission need not use the desktop. Receiver communication availability remains separate from an execution capability being unavailable.

Result ingestion uses a distinct authenticated execution-owner context allowing `report-result`, with current unrevoked device identity/lease and exact scope/device/binding/mode. An end-user caller cannot report results. Revoking a flow's invoke permission must not erase a legitimate already-issued outcome; a valid execution owner can still settle it through the result lane. Device identity revocation still blocks that identity. Current policy may deny an end-user query after revocation while preserving internal reconciliation evidence. Automatic lease revocation/stop and privileged owner repair paths are required production integration, not implemented by the model.

Fixture and live mode are included in invocation/control/result/reply identity and must match the receiver environment and trusted context. Any fixture-to-live change requires new separately authorized admission; a simulation result cannot settle a live execution.

## Idempotency, cancellation and uncertainty

1. Deduplication scope is `(owner scope, caller, target device + binding revision, idempotency key)`. A second identity index is `(owner scope, caller, target device, invocation ID)` so changing a binding/key cannot reuse an old invocation ID. Compare the full pinned execution digest; same key or ID with different content is a conflict. Different owner/caller domains are isolated and checked before lookup/disclosure.
2. The caller retains the original invocation handle and canonical request before sending. Lost admission response is resolved by query or exact duplicate delivery under current authority. Do not regenerate IDs, change deadlines or silently pick another device to retry an uncertain write. An execution deadline expiring does not expire receipt-query rights; a fresh read command/current authority can inspect the old record.
3. A `not-found` reply is a time-bounded observation of that receiver's retained ledger, **never proof that no external effect occurred** and never permission for automatic retry. This remains true if a local process restarted and lost an in-memory map. Production restart must retain or reconcile original records and detect loss/restore generation before admitting replacements.
4. Cancel received before invoke creates a pre-admission **tombstone** for both deduplication identities, with its exact original execution digest. It fences a reordered invoke and can report stopped because this owner never admitted it. Production must commit that fence durably before acknowledging `cancelled`.
5. Cancel after acceptance creates `cancel-pending`; duplicate cancel does not advance sequence or dispatch a new effect. Offline execution owners can leave it pending. The server invalidates future dispatch authority immediately, while separately reconciling actual child stop. A caller request is not stop proof. Late completion can truthfully settle a pending cancel.
6. Uncertain/interrupted outcomes retain the original handle/effect evidence and cannot transition back to accepted/started to replay. Subsequent authenticated reconciliation may settle completed/failed/cancelled. Same result/sequence/digest is idempotent; a changed output under the same sequence is a conflict.
7. Command IDs are scoped to owner/caller/target. Reusing one with different content or operation is rejected. Replies echo the exact command digest, so a stale response cannot be attached to a different query/cancel. Queries may return newer retained state for an unchanged query command; a reply digest/receipt sequence identifies that observation.

The client validates the retained original invocation's shape/execution digest and the query/cancel command digest, then joins owner/caller/device/binding/mode/invocation/idempotency/execution identity **before** processing either a found or not-found reply. A self-consistent command/reply pair for another handle cannot be displayed as the original invocation's outcome. Current query authority reference and command deadline are deliberately outside the original-handle equality check, so a fresh read lease can inspect expired work without replacing its execution identity.

The model is bounded to 64 invocation/tombstone records and 128 control identities and fails closed on capacity. It deliberately never evicts unresolved work. These are **fixture-model limits**, not production sizing. Production retention/compaction must preserve unresolved effect fences and active dependencies; a full ledger needs an actionable state and policy rather than forgetting old IDs.

## Durable receiver acceptance required before integration

`ReceiverModel` stores Maps in one process and increments a **synthetic dispatch-intent counter**. It has no worker runner and makes no external calls. Its acceptance/stop receipts are fixture observations, never production durable acknowledgements. The following gates remain unimplemented:

- One transactional durable store for admission, deduplication, control tombstones, event/result sequence and dispatch outbox. A persistence failure must stop acknowledgement and dependent dispatch. A post-commit response loss must resolve through the original receipt.
- Fenced scheduler/receiver ownership and recovery generation. Atomic compare-and-set must hold across concurrent processes, not just synchronous methods. Restore cannot revive revoked input or release unresolved effects as retryable.
- Actual bridge/service authentication and live local ActionRun/current grant checks; immediate local input pause, server lease revocation and execution-owner stop evidence.
- Kill/restart and storage-failure injection with the real store, including pre-admission cancel, result/stop ordering, record retention and authenticated late reconciliation.
- Checkpoint-free local receipt storage. No intermediate node variables/continuation are retained for Nero local graph resume. Fuego's parent graph owns durable waits/child handles.

No schema, type or passing in-memory test closes these gates. Production Fuego integration will reuse its canonical run/lease/outbox/approval authority; a new graph adapter must not create another live scheduler.
