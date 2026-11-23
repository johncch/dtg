import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits } from "../dist/engine/edit.js";
import { resolveDefinition } from "../dist/engine/resolve.js";

const SRC = `dtg: 1
defaults:
  tone:
    chroma: 0.05
systems:
  primary:
    algorithm: tone
    params:
      anchor: "#6750a4"
      chroma: 0.09
      hue: 20
  error:
    algorithm: tone
    params: { anchor: "#ba1a1a", chroma: 0.2 }
`;

const param = (system: string, path: string) => ({ kind: "param", system, path }) as const;
const systemOf = (text: string, name: string) => resolveDefinition(text).systems.find((system) => system.system === name)!;

describe("a system's own param", () => {
  test("is removed whole, and falls back to defaults", () => {
    const text = applyEdits(SRC, [{ action: "remove", target: param("primary", "chroma") }]);
    assert.equal(text, SRC.replace("      chroma: 0.09\n", ""));
    const primary = systemOf(text, "primary");
    assert.equal(primary.params.chroma, 0.05);
    assert.ok(!primary.ownParams.includes("chroma"));
  });

  test("falls back to the algorithm's own when defaults has none", () => {
    const text = applyEdits(SRC, [{ action: "remove", target: param("primary", "hue") }]);
    assert.equal(text, SRC.replace("      hue: 20\n", ""));
    assert.ok(systemOf(text, "primary").defaultedParams.includes("hue"));
  });

  test("is removed from a flow map too", () => {
    const text = applyEdits(SRC, [{ action: "remove", target: param("error", "chroma") }]);
    assert.ok(text.includes(`params: { anchor: "#ba1a1a" }`));
  });

  test("set on a system that takes it from defaults is written there, leaving defaults alone", () => {
    const text = applyEdits(SRC, [{ action: "set", target: param("error", "hue"), value: "40" }]);
    assert.ok(text.includes(`params: { anchor: "#ba1a1a", chroma: 0.2, hue: 40 }`));
    assert.ok(text.includes("    chroma: 0.05\n"));
  });

  test("not written cannot be removed", () => {
    assert.throws(() => applyEdits(SRC, [{ action: "remove", target: param("error", "hue") }]), /nothing written for/);
  });

  test("part of a param cannot be removed on its own", () => {
    assert.throws(() => applyEdits(SRC, [{ action: "remove", target: param("primary", "chroma.from") }]), /removed whole/);
  });
});

describe("which params defaults covers", () => {
  test("is reported per system, whether or not the system writes them too", () => {
    assert.deepEqual(systemOf(SRC, "primary").paramsInDefaults, ["chroma"]);
    assert.deepEqual(systemOf(SRC, "error").paramsInDefaults, ["chroma"]);
  });
});

describe("a param that changes shape", () => {
  const SCALE = `dtg: 1
systems:
  theme:
    algorithm: scale
    params:
      base: "#03a2e8"
      toward: ["#fafdff", "#001a28"]
      midpoint: 0.4
`;
  const midpoint = param("theme", "midpoint");

  test("a number becomes a list in place", () => {
    assert.equal(applyEdits(SCALE, [{ action: "set", target: midpoint, value: "[0.35,0.4]" }]), SCALE.replace("midpoint: 0.4", "midpoint: [0.35, 0.4]"));
  });

  test("a list becomes a number in place", () => {
    const pair = SCALE.replace("midpoint: 0.4", "midpoint: [0.35, 0.4]");
    assert.equal(applyEdits(pair, [{ action: "set", target: midpoint, value: "0.5" }]), SCALE.replace("midpoint: 0.4", "midpoint: 0.5"));
  });
});
