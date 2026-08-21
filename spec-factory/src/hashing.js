import { createHash } from "node:crypto";

/**
 * Deterministically stringify an object by sorting keys recursively, so the
 * hash is stable across re-serialization regardless of insertion order.
 */
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashBundle(bundle) {
  const canonical = canonicalize(bundle);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function hashText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
