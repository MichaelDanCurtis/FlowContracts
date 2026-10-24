# Fuego / Nero shared Flow contract assembly

Private local review assembly of **`@fuego-nero/flow-contract` `0.1.0-alpha.1`**.
Both products approved the location/name/governance and the source candidate for
offline conformance. **The assembled commit/manifest and normative amendment
still need both-owner acknowledgement before consumption or tagging.**

The single normative entry point remains
[Fuego Flow / Nero Flow contract](../Fuego/docs/specs/010-fuego-nero-flow-contract.md).
Runtime authority and product ownership remain there; this repository supplies
schemas, capabilities, golden fixtures and offline conformance code.

## What is included

- `conformance/schema.json`: the exact accepted candidate-4 JSON Schema.
- `capabilities.json`: explicit negotiated alpha identity and supported subset.
- `conformance/fixtures/`: seven golden digest projections/messages and receipts.
- `conformance/*.test.mjs`: the 99 accepted offline checks.
- `conformance/verify-goldens.py`: independent Python digest implementation.
- `conformance/receiver.mjs`: **bounded in-memory conformance model only**.
- `provenance.json`: exact source mapping to the accepted Fuego candidate;
  19 files copied byte-for-byte, including model documentation.
- `SOURCE-MANIFEST.json`: exhaustive source hashes, excluding itself and Git
  metadata to avoid self-reference. Its SHA-256 plus the Git commit form the pin.

The package exports **only JSON schema and capability metadata**. There is no
root runtime export and no receiver export. Directly importing fixture/model
files into an application would not provide authentication, persistence,
dispatch or a safe live receiver. Node codecs are offline references; browser
and Swift adapters must prove the same vectors and their own trusted boundaries.

## Verification

With Node 24+ and Python 3, run from this directory:

```sh
npm test
npm run verify:source
npm run verify:goldens
```

No dependency install is required. Tests do not run an agent, contact a service,
install a plugin, mutate an application profile or create a grant. Test output
and assembly receipts are retained in Fuego's coordination evidence, outside
this repository, so verification does not mutate the pinned source tree.

Canonicalization uses the agreed integer-only JSON domain, UTF-16 object-key
ordering, unchanged Unicode and ordered arrays. See the byte-preserved
[receiver contract](conformance/RECEIVER-CONTRACT.md) for control/result rules
and production gaps. Parsed `server-durable` definitions do **not** imply that a
durable graph engine is included. Rich values, agent/durable nodes, n8n import,
editor extraction and mobile execution are not supplied by this assembly.

## Joint ownership and negotiation

Fuego owns initial assembly and shared-envelope/control proposal editing; Nero
owns its local SDK adapter and Swift conformance. Both owners review exact
commit/manifest and tests before a consumed version/tag. A version string or
old wire-schema label alone is insufficient: negotiate package identity,
version and source-manifest SHA-256, including the `execution-failed` reason
extension. Old strict candidates are not silently compatible.

The first assembly has no remote, registry publication, new licensing decision,
product dependency or release tag. Source provenance is preserved; no third-party
runtime/editor code was imported. Any subsequent distribution or dependency
reuse needs its own applicable review. Each notarization submission still needs
Michael's approval.
