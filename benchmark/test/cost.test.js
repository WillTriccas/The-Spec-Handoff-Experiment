import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCostUsd, amortizedSpecAuthoringShareUsd } from "../src/cost.js";

function fullyPricedModel(overrides = {}) {
  return {
    pricingAsOf: "2025-01-01",
    source: "https://example.local/pricing",
    rateType: "list",
    inputPerMillionTokens: 1,
    outputPerMillionTokens: 2,
    ...overrides
  };
}

test("returns null when the model is not present in costs config", () => {
  const cost = computeCostUsd({
    modelId: "unknown-model",
    inputTokens: 1000,
    outputTokens: 1000,
    costsConfig: { models: {} }
  });
  assert.strictEqual(cost, null);
});

test("returns null unless pricingAsOf/source/rateType/base rates are all present", () => {
  const costsConfig = { models: { m: { pricingAsOf: "2025-01-01", inputPerMillionTokens: 1, outputPerMillionTokens: 2 } } };
  const cost = computeCostUsd({ modelId: "m", inputTokens: 1000, outputTokens: 1000, costsConfig });
  assert.strictEqual(cost, null, "missing source/rateType should still block cost computation");
});

test("computes cost from base input/output rates when fully priced", () => {
  const costsConfig = { models: { m: fullyPricedModel() } };
  const cost = computeCostUsd({ modelId: "m", inputTokens: 1_000_000, outputTokens: 1_000_000, costsConfig });
  assert.strictEqual(cost, 3); // 1*1 + 2*1
});

test("cached input tokens require their own configured rate, and are never silently priced at the base input rate", () => {
  const costsConfig = { models: { m: fullyPricedModel() } };
  const cost = computeCostUsd({
    modelId: "m",
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 1_000_000,
    costsConfig
  });
  assert.strictEqual(cost, null);
});

test("cached input tokens are priced correctly once a cached rate is configured", () => {
  const costsConfig = { models: { m: fullyPricedModel({ cachedInputPerMillionTokens: 0.5 }) } };
  const cost = computeCostUsd({
    modelId: "m",
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 1_000_000,
    costsConfig
  });
  assert.strictEqual(cost, 0.5);
});

test("reasoning output tokens require their own configured rate", () => {
  const costsConfig = { models: { m: fullyPricedModel() } };
  const cost = computeCostUsd({
    modelId: "m",
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 1_000_000,
    costsConfig
  });
  assert.strictEqual(cost, null);
});

test("reasoning output tokens are priced correctly once a reasoning rate is configured", () => {
  const costsConfig = { models: { m: fullyPricedModel({ reasoningOutputPerMillionTokens: 4 }) } };
  const cost = computeCostUsd({
    modelId: "m",
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 1_000_000,
    costsConfig
  });
  assert.strictEqual(cost, 4);
});

test("a flat per-run charge is added on top of token-metered cost", () => {
  const costsConfig = { models: { m: fullyPricedModel({ flatChargeUsd: 10 }) } };
  const cost = computeCostUsd({ modelId: "m", inputTokens: 1_000_000, outputTokens: 0, costsConfig });
  assert.strictEqual(cost, 11); // 1 + 10
});

test("an amortized spec-authoring share is added for spec lanes when provided", () => {
  const costsConfig = { models: { m: fullyPricedModel() } };
  const cost = computeCostUsd({
    modelId: "m",
    inputTokens: 1_000_000,
    outputTokens: 0,
    costsConfig,
    specAuthoringShareUsd: 2.5
  });
  assert.strictEqual(cost, 3.5); // 1 + 2.5
});

test("a priced spec-lane run stays unpriced when authoring cost is unavailable", () => {
  const costsConfig = { models: { m: fullyPricedModel() } };
  const cost = computeCostUsd({
    modelId: "m",
    inputTokens: 1_000_000,
    outputTokens: 0,
    costsConfig,
    specAuthoringShareUsd: null,
    requiresSpecAuthoringCost: true
  });
  assert.strictEqual(cost, null);
});

test("amortizedSpecAuthoringShareUsd is null unless authoringEffort.estimatedCostUsd is a number", () => {
  assert.strictEqual(amortizedSpecAuthoringShareUsd({ estimatedCostUsd: null }, 3), null);
  assert.strictEqual(amortizedSpecAuthoringShareUsd(null, 3), null);
  assert.strictEqual(
    amortizedSpecAuthoringShareUsd({
      estimatedCostUsd: 30,
      inputTokens: 100,
      outputTokens: 50,
      costEvidenceRef: "billing/authoring.json",
      costMethod: "metered-provider-usage"
    }, 3),
    10
  );
});

test("amortizedSpecAuthoringShareUsd is null for a non-positive or non-integer repetitionsPerLane", () => {
  const effort = {
    estimatedCostUsd: 30,
    inputTokens: 100,
    outputTokens: 50,
    costEvidenceRef: "billing/authoring.json",
    costMethod: "metered-provider-usage"
  };
  assert.strictEqual(amortizedSpecAuthoringShareUsd(effort, 0), null);
  assert.strictEqual(amortizedSpecAuthoringShareUsd(effort, -1), null);
  assert.strictEqual(amortizedSpecAuthoringShareUsd(effort, 1.5), null);
});

test("authoring cost is unavailable without positive independently referenced evidence", () => {
  assert.strictEqual(
    amortizedSpecAuthoringShareUsd({
      estimatedCostUsd: 0,
      inputTokens: 100,
      outputTokens: 50,
      costEvidenceRef: "billing/authoring.json",
      costMethod: "metered-provider-usage"
    }, 3),
    null
  );
  assert.strictEqual(
    amortizedSpecAuthoringShareUsd({
      estimatedCostUsd: 30,
      inputTokens: 100,
      outputTokens: 50
    }, 3),
    null
  );
});

test("returns null when inputTokens or outputTokens are missing", () => {
  const costsConfig = { models: { m: fullyPricedModel() } };
  assert.strictEqual(computeCostUsd({ modelId: "m", inputTokens: null, outputTokens: 100, costsConfig }), null);
  assert.strictEqual(computeCostUsd({ modelId: "m", inputTokens: 100, outputTokens: null, costsConfig }), null);
});
