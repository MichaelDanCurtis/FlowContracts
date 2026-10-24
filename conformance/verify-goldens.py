"""Independent standard-library check of the checked-in cross-language digest vectors.

Does not implement graph execution or admission. Python encoding deliberately
specifies UTF-16 key order; Python's normal sort_keys Unicode order is different.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parent


def canonical(value):
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, int):
        assert abs(value) <= 9007199254740991
        return str(value)
    if isinstance(value, str):
        value.encode("utf-8", errors="strict")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(canonical(k) + ":" + canonical(value[k]) for k in sorted(value, key=lambda k: k.encode("utf-16-be"))) + "}"
    raise ValueError("not candidate JSON")


def digest(value):
    return "sha256:" + hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def main():
    definition = json.loads((ROOT / "fixtures/definition.json").read_text())
    unsigned = {k: v for k, v in definition.items() if k != "digests"}
    semantic = {k: unsigned[k] for k in ("schemaVersion", "contractRevision", "profile", "interface", "graph", "dependencies", "bindingSlots", "policy")}
    assert digest(unsigned) == definition["digests"]["content"]
    assert digest(semantic) == definition["digests"]["semantic"]
    invocation = json.loads((ROOT / "fixtures/invocation.json").read_text())
    assert digest({k: v for k, v in invocation.items() if k != "executionDigest"}) == invocation["executionDigest"]
    assert canonical({"\ue000": 1, "\U00010000": 2}) == '{"\U00010000":2,"\ue000":1}'
    controls = {}
    for name, field in [("query", "commandDigest"), ("cancel", "commandDigest"), ("result", "resultDigest"), ("reply", "replyDigest")]:
        value = json.loads((ROOT / ("fixtures/" + name + ".json")).read_text())
        assert digest({k: v for k, v in value.items() if k != field}) == value[field]
        controls[name] = value[field]
    print(json.dumps({"crossLanguageGoldenDigests": "passed", "contentDigest": definition["digests"]["content"], "semanticDigest": definition["digests"]["semantic"], "executionDigest": invocation["executionDigest"], "controls": controls}, indent=2))


if __name__ == "__main__":
    main()
