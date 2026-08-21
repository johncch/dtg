import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatColor, isOpaque } from "../dist/color-math.js";
import {
  publicPath,
  publicSystemName,
  resolveDefinition,
} from "../dist/resolve.js";

const BASE = `
dtg: 1
modes: [light, dark]
systems:
  paper: "#ffffff"
  reds:
    rose: "#ff0000"
    dawn: "#fa0000"
  generated:
    alias: test
    sky:
      algorithm: ink-ramp
      params: { base: "#fafdff", ink: "#001a28" }
`;

const withRoles = (roles: string) => resolveDefinition(BASE + roles);

describe("refs", () => {
  test("a bare name is a constant; a dotted name is one in a group", () => {
    const r = withRoles(`
s:
  d:
    flat: [paper, reds.rose]
`);
    assert.equal(formatColor(r.roles[0].perMode[0].color, "srgb"), "#ffffff");
    assert.equal(formatColor(r.roles[0].perMode[1].color, "srgb"), "#ff0000");
    assert.equal(r.roles[0].perMode[0].target.kind, "constant");
  });

  test("dots walk the tree, the slash hands off to the algorithm", () => {
    const r = withRoles(`
s:
  d:
    tinted: [generated.sky/3, generated.sky/8]
`);
    assert.equal(formatColor(r.roles[0].perMode[0].color, "srgb"), "#f3f6f9");
    assert.equal(r.systems[0].system, "generated.sky");
  });

  test("an alias renames on emit and never changes the identity", () => {
    const r = withRoles(`
s:
  d:
    tinted: [generated.sky/3, generated.sky/3]
`);
    assert.equal(r.systems[0].system, "generated.sky");
    assert.equal(publicSystemName(r.systems[0], "css", "-"), "test-sky");
    const rose = r.statics.find((c) => c.path === "reds.rose")!;
    assert.equal(publicPath(rose.segments, "css", "-"), "reds-rose");
  });

  test("the uncomposited form is a selector, not a core function", () => {
    const r = withRoles(`
s:
  d:
    veil: [generated.sky/3/ink, generated.sky/8/ink]
`);
    assert.equal(formatColor(r.roles[0].perMode[0].color, "srgb"), "rgba(0, 26, 40, 0.03)");
    assert.equal(isOpaque(r.roles[0].perMode[0].color), false);
  });

  test("transparent() is a utility on constants only", () => {
    const r = withRoles(`
s:
  d:
    veil: [transparent(reds.dawn 20), transparent(paper 40)]
`);
    assert.equal(formatColor(r.roles[0].perMode[0].color, "srgb"), "rgba(250, 0, 0, 0.2)");
    assert.throws(
      () =>
        withRoles(`
s:
  d:
    veil: [transparent(generated.sky/3), transparent(paper 40)]
`),
      /takes a constant and an opacity/,
    );
  });

  test("roles can point at other roles", () => {
    const r = withRoles(`
s:
  d:
    base: [paper, paper]
    echo: [d.base, d.base]
`);
    assert.equal(formatColor(r.roles[1].perMode[0].color, "srgb"), "#ffffff");
    assert.equal(r.roles[1].perMode[0].target.kind, "role");
  });
});

describe("rejects", () => {
  test("raw hex outside systems", () => {
    assert.throws(
      () =>
        withRoles(`
s:
  d:
    flat: ["#ff0000", "#ff0000"]
`),
      /raw hex is not allowed/,
    );
  });

  test("a role with the wrong number of refs", () => {
    assert.throws(
      () =>
        withRoles(`
s:
  d:
    flat: [paper]
`),
      /expected 2 refs/,
    );
  });

  test("a comma inside a flow list, with a diagnosis", () => {
    assert.throws(
      () =>
        withRoles(`
s:
  d:
    veil: [transparent(paper, 70), transparent(paper, 80)]
`),
      /comma inside a `\[ \]` list/,
    );
  });

  test("algorithm params outside the params block", () => {
    assert.throws(
      () =>
        resolveDefinition(`
dtg: 1
modes: [light]
systems:
  sky:
    algorithm: ink-ramp
    base: "#fafdff"
    ink: "#001a28"
s: { d: { r: [sky/3] } }
`),
      /moved into a `params` block/,
    );
  });

  test("a constant and a role sharing a path", () => {
    assert.throws(
      () =>
        resolveDefinition(`
dtg: 1
modes: [light]
systems:
  d:
    r: "#ffffff"
s:
  d:
    r: [d.r]
`),
      /both a constant and a role path/,
    );
  });

  test("circular role references", () => {
    assert.throws(
      () =>
        withRoles(`
s:
  d:
    a: [d.b, d.b]
    b: [d.a, d.a]
`),
      /circular role reference/,
    );
  });
});

describe("determinism", () => {
  test("resolving the same definition twice gives the same result", () => {
    const src =
      BASE +
      `
s:
  d:
    flat: [paper, reds.rose]
    tinted: [generated.sky/3, generated.sky/8]
`;
    assert.deepEqual(
      JSON.parse(JSON.stringify(resolveDefinition(src))),
      JSON.parse(JSON.stringify(resolveDefinition(src))),
    );
  });
});

describe("wide anchors that go nowhere", () => {
  const warn = (src: string) => resolveDefinition(src).warnings.join(" ");
  const def = (params: string) => `
dtg: 1
modes: [default]
systems:
  warm:
    algorithm: blend
    params: ${params}
roles:
  edge: { accent: [warm/red@100] }
`;

  test("warns when a wide anchor is flattened by an srgb transform", () => {
    assert.match(
      warn(def(`{ base: "#ffffff", toward: { red: "oklch(0.4854 0.2237 28.69)" } }`)),
      /outside srgb, but its transform runs in srgb/,
    );
  });

  test("silent when the transform runs wide enough to keep it", () => {
    for (const space of ["display-p3", "display-p3-linear", "oklab"]) {
      assert.doesNotMatch(
        warn(def(`{ space: ${space}, base: "#ffffff", toward: { red: "oklch(0.4854 0.2237 28.69)" } }`)),
        /extra gamut is discarded/,
        space,
      );
    }
  });

  test("srgb-linear warns too — the clip is on the way in, not the path", () => {
    assert.match(
      warn(def(`{ space: srgb-linear, base: "#ffffff", toward: { red: "oklch(0.4854 0.2237 28.69)" } }`)),
      /extra gamut is discarded/,
    );
  });

  test("fires on the anchor, not on whichever steps happen to be demanded", () => {
    // A pale tint is inside sRGB whatever the anchor was; the loss already
    // happened when the anchor was clipped on the way in.
    const pale = `
dtg: 1
modes: [default]
systems:
  warm:
    algorithm: blend
    params: { base: "#ffffff", toward: { red: "oklch(0.4854 0.2237 28.69)" } }
roles:
  surface: { tint: [warm/red@6] }
`;
    assert.match(warn(pale), /extra gamut is discarded/);
  });

  test("silent when nothing was wide to begin with", () => {
    assert.doesNotMatch(
      warn(def(`{ base: "#ffffff", toward: { red: "#b30a0a" } }`)),
      /extra gamut is discarded/,
    );
  });

  test("ink-ramp cannot discard it — it widens to fit its inputs", () => {
    // Only blend takes an explicit `space`; the other algorithms transform in
    // the widest gamut their inputs use, so there is nothing to warn about.
    assert.doesNotMatch(
      warn(`
dtg: 1
modes: [default]
systems:
  ramp:
    algorithm: ink-ramp
    params: { base: "#ffffff", ink: "color(display-p3 1 0 0)" }
roles:
  edge: { accent: [ramp/2] }
`),
      /extra gamut is discarded/,
    );
  });
});
