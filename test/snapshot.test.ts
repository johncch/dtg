import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildLineage, resolveDefinition } from "../dist/resolve.js";
import { backgroundProbes, buildSnapshot } from "../dist/snapshot.js";

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
      { section: "roles", group: "surface", role: "canvas", mode: "light", translucent: false },
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

  test("a system lists which of its params carry a YAML anchor and which are aliases of one", () => {
    const text = `
dtg: 1
systems:
  red: { algorithm: curve, params: { anchor: "#ef4444", at: &at 400 }, emit: [500] }
  blue: { algorithm: curve, params: { anchor: "#3b82f6", at: *at }, emit: [500] }
`;
    const anchored = buildSnapshot({
      resolved: resolveDefinition(text),
      lineage: new Map(),
      error: null,
      stale: false,
      gamut: "display-p3",
      changes: [],
      definition: { path: "colors.dtg.yaml", text },
    });
    assert.deepEqual(anchored.systems.find((s) => s.system === "red")!.anchors, { at: { name: "at", role: "anchor" } });
    assert.deepEqual(anchored.systems.find((s) => s.system === "blue")!.anchors, { at: { name: "at", role: "alias" } });
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
      snapshot.constants.map((c) => [c.path, c.cssName, c.written, c.usedBy.length]),
      [["paper", "paper", "#ffffff", 2]],
    );
    const tint = snapshot.roles.find((r) => r.role === "tint")!;
    assert.equal(tint.group, "surface");
    assert.deepEqual(tint.perMode[1].target, {
      kind: "role",
      group: "surface",
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

describe("modes and their backgrounds", () => {
  const snapshotOf = (text: string, backgroundOverrides = {}) => {
    const resolved = resolveDefinition(text, [], "display-p3", backgroundProbes(backgroundOverrides));
    return buildSnapshot({
      resolved,
      lineage: buildLineage(resolved),
      error: null,
      stale: false,
      gamut: "display-p3",
      changes: [],
      definition: { path: "colors.dtg.yaml", text },
      backgroundOverrides,
    });
  };
  const THEMED = `
dtg: 1
modes:
  light: { scheme: light }
  dark: { scheme: dark }
  night: { extends: dark }
palette:
  white: "#ffffff"
  soot: "#111111"
  black: "#000000"
roles:
  surface:
    canvas: [white, soot, black]
`;

  test("a declared scheme picks the background, and an extending mode inherits it", () => {
    const { modeDetails, backgrounds } = snapshotOf(THEMED);
    assert.deepEqual(
      modeDetails.map((mode) => [mode.name, mode.extends, mode.scheme, mode.schemeInferred, mode.backgroundWritten]),
      [
        ["light", null, "light", false, "#ffffff"],
        ["dark", null, "dark", false, "#000000"],
        ["night", "dark", "dark", false, "#000000"],
      ],
    );
    assert.deepEqual(
      backgrounds.map((background) => [background.modes, background.written]),
      [[["light"], "#ffffff"], [["dark", "night"], "#000000"]],
    );
  });

  test("a mode that never said is read from its colors, and says so", () => {
    const { modeDetails } = snapshotOf(`
dtg: 1
modes: [day, dusk]
palette:
  white: "#ffffff"
  snow: "#f4f4f4"
  ink: "#111111"
  night: "#101114"
  slate: "#1a1c20"
  fog: "#f0f0f0"
roles:
  surface:
    canvas: [white, night]
    card: [snow, slate]
  label:
    primary: [ink, fog]
`);
    assert.deepEqual(
      modeDetails.map((mode) => [mode.name, mode.scheme, mode.schemeInferred]),
      [
        ["day", "light", true],
        ["dusk", "dark", true],
      ],
    );
  });

  test("an override replaces the scheme's background and is marked", () => {
    const { modeDetails, backgrounds, warnings } = snapshotOf(THEMED, { dark: "#101114" });
    const dark = modeDetails.find((mode) => mode.name === "dark")!;
    assert.equal(dark.backgroundWritten, "#101114");
    assert.equal(dark.backgroundOverridden, true);
    assert.equal(modeDetails.find((mode) => mode.name === "night")!.backgroundOverridden, false);
    assert.deepEqual(
      backgrounds.map((background) => background.modes),
      [["light"], ["dark"], ["night"]],
    );
    assert.deepEqual(warnings, []);
  });

  test("an override can be a constant, a role in that mode, or a step no role demands", () => {
    const { modeDetails, warnings } = snapshotOf(
      `
dtg: 1
modes:
  light: { scheme: light }
  dark: { scheme: dark }
palette:
  white: "#ffffff"
  black: "#000000"
systems:
  night:
    algorithm: tint
    params: { base: "#101114", tint: "#ffffff" }
roles:
  surface:
    canvas: [white, black]
`,
      { light: "surface.canvas", dark: "night(4)" },
    );
    assert.deepEqual(warnings, []);
    const [light, dark] = modeDetails;
    assert.equal(light.backgroundWritten, "surface.canvas");
    assert.deepEqual(light.background, resolveDefinition("dtg: 1\npalette:\n  white: \"#ffffff\"\n").statics[0].color);
    assert.equal(dark.backgroundWritten, "night(4)");
    assert.notEqual(dark.background.coords[0], 0, "the step resolved rather than falling back on black");
    assert.equal(dark.backgroundProblem, null);
    const { modeDetails: byConstant } = snapshotOf(THEMED, { dark: "soot" });
    assert.equal(byConstant[1].backgroundWritten, "soot");
    assert.equal(byConstant[1].backgroundProblem, null);
  });

  test("an override that comes to nothing falls back on the scheme's background and says why", () => {
    const { modeDetails, warnings, backgrounds } = snapshotOf(THEMED, { dark: "sky(3)", light: "paper" });
    const [light, dark] = modeDetails;
    assert.equal(dark.backgroundWritten, "sky(3)");
    assert.deepEqual(dark.background.coords, [0, 0, 0]);
    assert.match(dark.backgroundProblem ?? "", /sky/);
    assert.match(light.backgroundProblem ?? "", /paper/);
    assert.equal(warnings.length, 2);
    assert.deepEqual(
      backgrounds.map((background) => background.modes),
      [["light"], ["dark", "night"]],
    );
  });

  test("an override for a mode the definition does not have is a warning", () => {
    const { warnings } = snapshotOf(THEMED, { white: "#ffffff" });
    assert.deepEqual(warnings, ['dev.backgrounds: no mode named "white"']);
  });

  test("a definition without modes has one light mode on white", () => {
    const { modeDetails, backgrounds } = snapshotOf(`
dtg: 1
palette:
  ink: "#000000"
`);
    assert.deepEqual(
      modeDetails.map((mode) => [mode.name, mode.scheme, mode.schemeInferred]),
      [["default", "light", true]],
    );
    assert.deepEqual(backgrounds.map((background) => background.modes), [["default"]]);
  });
});
