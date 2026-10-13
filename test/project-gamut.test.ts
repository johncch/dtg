import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolveDefinition } from "../dist/resolve.js";
import { formatColor } from "../dist/color-math.js";

const SRC = `
dtg: 1
modes: [light]
systems:
  paper: "#ffffff"
  vivid: color(display-p3 1 0 0)
  unreal: oklch(0.7 0.4 150)
  plain:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
  wide:
    algorithm: tint
    params: { base: "#ffffff", tint: color(display-p3 0 1 0) }
roles:
  surface:
    a: [plain(3)]
    b: [wide(10)]
`;

const gamutWarnings = (gamut?: "srgb" | "display-p3") =>
  resolveDefinition(SRC, [], gamut).warnings.filter((w) => w.includes("the project's gamut"));

describe("the project gamut is a ceiling", () => {
  test("display-p3, the default, flags only what no P3 screen shows", () => {
    assert.deepEqual(gamutWarnings(), [
      `constant "unreal" is outside display-p3, the project's gamut`,
    ]);
    assert.deepEqual(gamutWarnings("display-p3"), gamutWarnings());
  });

  test("srgb flags every authored color that leaves sRGB, naming the constant or the param", () => {
    assert.deepEqual(gamutWarnings("srgb"), [
      `constant "vivid" is outside srgb, the project's gamut`,
      `constant "unreal" is outside srgb, the project's gamut`,
      'system "wide" param `tint` is outside srgb, the project\'s gamut',
    ]);
  });

  test("it warns without altering: values resolve the same under either gamut", () => {
    const values = (gamut: "srgb" | "display-p3") => {
      const resolved = resolveDefinition(SRC, [], gamut);
      return [
        ...resolved.statics.map((c) => formatColor(c.color, "display-p3")),
        ...resolved.systems.flatMap((s) => s.steps.map((step) => formatColor(step.color, "display-p3"))),
      ];
    };
    assert.deepEqual(values("srgb"), values("display-p3"));
  });
});
