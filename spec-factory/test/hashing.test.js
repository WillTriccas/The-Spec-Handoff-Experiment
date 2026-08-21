import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, hashBundle, hashText } from "../src/hashing.js";

test("canonicalize sorts object keys regardless of insertion order", () => {
  const a = canonicalize({ b: 1, a: 2 });
  const b = canonicalize({ a: 2, b: 1 });
  assert.strictEqual(a, b);
});

test("canonicalize preserves array order", () => {
  const a = canonicalize({ items: [1, 2, 3] });
  const b = canonicalize({ items: [3, 2, 1] });
  assert.notStrictEqual(a, b);
});

test("hashBundle is deterministic for equivalent content regardless of key order", () => {
  const bundleA = { intent: { a: 1, b: 2 }, requirements: { items: [{ id: "R1" }] } };
  const bundleB = { requirements: { items: [{ id: "R1" }] }, intent: { b: 2, a: 1 } };
  assert.strictEqual(hashBundle(bundleA), hashBundle(bundleB));
});

test("hashBundle changes when content changes", () => {
  const bundleA = { intent: { a: 1 } };
  const bundleB = { intent: { a: 2 } };
  assert.notStrictEqual(hashBundle(bundleA), hashBundle(bundleB));
});

test("hashBundle produces a 64-character lowercase hex sha256", () => {
  const hash = hashBundle({ intent: { a: 1 } });
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test("hashText matches a known sha256 vector", () => {
  // sha256("") is a well-known constant.
  assert.strictEqual(
    hashText(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
});
