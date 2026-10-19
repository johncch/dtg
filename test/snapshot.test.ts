import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildLineage, resolveDefinition } from "../dist/resolve.js";
import { buildSnapshot } from "../dist/snapshot.js";

const SRC = `
dtg: 1
modes: [light, dark]
palette:
  paper: "#ffffff"

systems:
  sky:
    algorithm: tint
    alias: light
    params: { base: "#fafdff", tint: "#001a28" }
    overrides: { "8": "#e0e6ea" }
  mix:
    algorithm: tint
    params: { base: "#ffffff", tint: "#ff0000" }
roles:
  surface:
    canvas: [sky(3), sky(8)]
    flat: [paper, paper]
    tint: [mix(6), surface.canvas]
`;
const resolved = resolveDefinition(SRC);
const lineage = buildLineage(resolved);
const snapshot = buildSnapshot({
  resolved,
  lineage,
  error: null,
  stale: false,
  gamut: "display-p3",
  changes: [],
  definition: { path: "colors.dtg.yaml", text: SRC },
});

describe("snapshot", () => {
  test("survives JSON unchanged", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  });

  test("a system carries its emitted name, steps and who demands them", () => {
    const sky = snapshot.systems.find((s) => s.system === "sky")!;
    assert.equal(sky.cssName, "light");
    assert.equal(sky.algorithm, "tint");
    assert.deepEqual(
      sky.steps.map((step) => step.selector),
      ["3", "8"],
    );
    assert.deepEqual(sky.steps[0].usedBy, [
      { domain: "surface", role: "canvas", mode: "light", translucent: false },
    ]);
  });

  test("a system lists the options of its choice params", () => {
    const curved = buildSnapshot({
      resolved: resolveDefinition(`
dtg: 1
systems:
  blue: { algorithm: curve, params: { anchor: "#3b82f6" }, emit: [500] }
`),
      lineage: new Map(),
      error: null,
      stale: false,
      gamut: "display-p3",
      changes: [],
      definition: { path: "colors.dtg.yaml", text: "" },
    });
    assert.deepEqual(curved.systems[0].choices, { gamut: ["srgb", "display-p3"] });
    assert.deepEqual(snapshot.systems[0].choices, {});
  });

  test("an overridden step keeps what the algorithm generated", () => {
    const sky = snapshot.systems.find((s) => s.system === "sky")!;
    assert.equal(sky.steps[0].generated, null);
    assert.notEqual(sky.steps[1].generated, null);
    assert.notDeepEqual(sky.steps[1].generated, sky.steps[1].color);
  });

  test("a system lists which params are colors and where each was written", () => {
    const scaledSource = `
dtg: 1
modes: [light]
defaults:
  scale:
    toward: ["#ffffff", "#000000"]
    hueShift: 0
systems:
  theme:
    algorithm: scale
    params: { base: "#03a2e8" }
`;
    const scaled = buildSnapshot({
      resolved: resolveDefinition(scaledSource),
      lineage: new Map(),
      error: null,
      stale: false,
      gamut: "display-p3",
      changes: [],
      definition: { path: "colors.dtg.yaml", text: scaledSource },
    }).systems[0];
    assert.deepEqual(
      scaled.colorParams.map((param) => [param.path, param.from]),
      [
        ["base", "system"],
        ["toward.0", "defaults"],
        ["toward.1", "defaults"],
      ],
    );
    assert.deepEqual(
      snapshot.systems.map((s) => [s.system, s.colorParams.map((param) => param.path)]),
      [
        ["sky", ["base", "tint"]],
        ["mix", ["base", "tint"]],
      ],
    );
  });

  test("constants and roles", () => {
    assert.deepEqual(
      snapshot.constants.map((c) => [c.path, c.cssName, c.usedBy.length]),
      [["paper", "paper", 2]],
    );
    const tint = snapshot.roles.find((r) => r.role === "tint")!;
    assert.equal(tint.domain, "surface");
    assert.deepEqual(tint.perMode[1].target, {
      kind: "role",
      domain: "surface",
      role: "canvas",
    });
  });

  test("carries the server's error and stale flags, and the project gamut", () => {
    const failed = buildSnapshot({
      resolved,
      lineage,
      error: "boom",
      stale: true,
      gamut: "srgb",
      changes: [],
      definition: { path: "colors.dtg.yaml", text: SRC },
    });
    assert.equal(failed.error, "boom");
    assert.equal(failed.stale, true);
    assert.equal(failed.gamut, "srgb");
  });
});

describe("a palette color's uses", () => {
  test("include the system params that name it", () => {
    const source = `dtg: 1
palette:
  hues: { emit: false, red: "#b30a0a" }
systems:
  wash:
    algorithm: tint
    params: { base: "#ffffff", tint: hues.red }
`;
    const red = buildSnapshot({
      resolved: resolveDefinition(source),
      lineage: new Map(),
      error: null,
      stale: false,
      gamut: "display-p3",
      changes: [],
      definition: { path: "colors.dtg.yaml", text: source },
    }).constants.find((constant) => constant.path === "hues.red")!;
    assert.deepEqual(red.paramOf, [{ system: "wash", param: "tint" }]);
  });
});
