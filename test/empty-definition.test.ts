import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits } from "../dist/edit.js";
import { resolveDefinition } from "../dist/resolve.js";

describe("an empty definition", () => {
  test("resolves to nothing", () => {
    const resolved = resolveDefinition("");
    assert.deepEqual(resolved.problems, []);
    assert.deepEqual(resolved.roles, []);
  });

  test("gets each block it lacks as its first entry is added", () => {
    const text = applyEdits("", [
      { action: "add", target: { kind: "constant", path: "brand.blue" }, value: "#3366ff" },
      { action: "add", target: { kind: "system", path: "sky" }, value: JSON.stringify({ algorithm: "tint", params: { base: "brand.blue", tint: "brand.blue" } }) },
      { action: "add", target: { kind: "collection", name: "roles" }, value: "{}" },
      { action: "add", target: { kind: "role", section: "roles", path: "surface" }, value: JSON.stringify(["sky(10)"]) },
    ]);
    assert.equal(
      text,
      `palette:
  brand:
    blue: "#3366ff"

systems:
  sky:
    algorithm: tint
    params: { base: brand.blue, tint: brand.blue }

roles:
  surface: sky(10)
`,
    );
    assert.deepEqual(resolveDefinition(text).problems, []);
  });
});

describe("the grammar version", () => {
  test("goes at the top of a definition that does not say it", async () => {
    const { withGrammarVersion } = await import("../dist/edit.js");
    assert.equal(withGrammarVersion("palette:\n  ink: \"#000000\"\n"), "dtg: 1\n\npalette:\n  ink: \"#000000\"\n");
    assert.equal(withGrammarVersion(""), "dtg: 1\n");
    assert.equal(withGrammarVersion("dtg: 1\npalette: {}\n"), "dtg: 1\npalette: {}\n");
  });
});
