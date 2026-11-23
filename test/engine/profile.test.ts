import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { profileOf, resolveDefinition } from "../../dist/engine/resolve.js";
import { formatColor, hexToOklab } from "../../dist/engine/color-math.js";

const systemOf = (yaml: string) => resolveDefinition(`dtg: 1\n${yaml}`).systems[0];
const near = (a: number, b: number, within = 1e-4) => Math.abs(a - b) <= within;
const sampleAt = (profile: NonNullable<ReturnType<typeof profileOf>>, at: number) =>
  profile.samples.find((sample) => sample.at === at)!;

describe("profile", () => {
  test("is measured from what the algorithm makes, so a scale's midpoint shows in its lightness", () => {
    const system = systemOf(`
systems:
  theme:
    algorithm: scale
    params: { base: "#03a2e8", toward: ["#fafdff", "#001a28"], midpoint: 0.4 }
`);
    const profile = profileOf(system, new Map())!;
    assert.deepEqual(profile.lanes.map((lane) => lane.channel), ["oklab.l", "oklch.c", "oklch.h"]);
    assert.equal(profile.along, "stop");
    assert.deepEqual(profile.span, { min: 0, max: 1000 });
    assert.equal(profile.samples.length, 201);
    const light = hexToOklab("#fafdff")[0];
    const base = hexToOklab("#03a2e8")[0];
    assert.ok(near(sampleAt(profile, 250).values[0]!, light + 0.4 * (base - light)));
  });

  test("tone measures lightness as L*, so every step sits on its own tone", () => {
    const system = systemOf(`
systems:
  primary:
    algorithm: tone
    params: { anchor: "#6750a4", chroma: 0.09 }
`);
    const profile = profileOf(system, new Map())!;
    assert.deepEqual(profile.lanes.map((lane) => lane.channel), ["cielab.l", "oklch.c", "oklch.h"]);
    assert.equal(profile.lanes[0].label, "Tone (L*)");
    for (const sample of profile.samples) assert.ok(near(sample.values[0]!, sample.at, 0.05), `tone ${sample.at}`);
  });

  test("an overlay is profiled in opacity alone, the one thing it varies", () => {
    const system = systemOf(`
systems:
  shadow:
    algorithm: overlay
    params: { color: "#000000" }
`);
    const profile = profileOf(system, new Map())!;
    assert.deepEqual(profile.lanes.map((lane) => lane.channel), ["alpha"]);
    assert.equal(sampleAt(profile, 0).values[0], 0);
    assert.equal(sampleAt(profile, 100).values[0], 1);
  });

  test("an opaque ramp has no opacity lane", () => {
    const system = systemOf(`
systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
`);
    assert.ok(!profileOf(system, new Map())!.lanes.some((lane) => lane.channel === "alpha"));
  });

  test("marks are the emitted steps as resolved, so an override sits off the line", () => {
    const system = systemOf(`
systems:
  theme:
    algorithm: scale
    params: { base: "#03a2e8", toward: ["#fafdff", "#001a28"] }
    overrides: { "700": "#ff0000" }
    publish: [300, 700]
`);
    const profile = profileOf(system, new Map())!;
    assert.deepEqual(profile.marks.map((mark) => [mark.at, mark.step]), [[300, "300"], [700, "700"]]);
    const overridden = profile.marks.find((mark) => mark.at === 700)!;
    assert.equal(formatColor(overridden.color, "srgb"), "#ff0000");
    assert.ok(!near(overridden.values[0]!, sampleAt(profile, 700).values[0]!, 0.01));
    assert.ok(near(profile.marks[0].values[0]!, sampleAt(profile, 300).values[0]!));
  });

  test("has nothing to draw when the selector is more than one number", () => {
    const system = systemOf(`
systems:
  theme:
    algorithm: scale
    params: { base: "#03a2e8", toward: ["#fafdff", "#001a28"] }
`);
    const fields = [...system.selector.fields, { name: "extra", kind: "number" as const, min: 0, max: 1 }];
    assert.equal(profileOf({ ...system, selector: { ...system.selector, fields } }, new Map()), null);
  });
});
