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
      algorithm: tint
      params: { base: "#fafdff", tint: "#001a28" }
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
    tinted: [generated.sky(3), generated.sky(8)]
`);
    assert.equal(formatColor(r.roles[0].perMode[0].color, "srgb"), "#f3f6f9");
    assert.equal(r.systems[0].system, "generated.sky");
  });

  test("an alias renames on emit and never changes the identity", () => {
    const r = withRoles(`
s:
  d:
    tinted: [generated.sky(3), generated.sky(3)]
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
    veil: [generated.sky(3 tint), generated.sky(8 tint)]
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
    veil: [transparent(generated.sky(3)), transparent(paper 40)]
`),
      /takes a constant and an opacity/,
    );
  });

  test("spacing inside a selector does not make a second step", () => {
    const r = withRoles(`
s:
  d:
    veil: [generated.sky( 3  tint ), generated.sky(3 tint)]
`);
    assert.equal(r.systems[0].steps.length, 1);
    assert.equal(r.systems[0].steps[0].selector, "3 tint");
  });

  test("the slash spelling is refused with the new one spelled out", () => {
    const refused = (ref: string, pointer: RegExp) =>
      assert.throws(() => withRoles(`\ns:\n  d:\n    r: ["${ref}", paper]\n`), pointer);
    refused("generated.sky/3", /old spelling — write generated\.sky\(3\)/);
    refused("generated.sky/3.5/ink", /write generated\.sky\(3\.5 ink\)/);
    refused("warm/red@6/alpha", /write warm\(red 6 alpha\)/);
  });

  test("a comma inside a selector is pointed at", () => {
    assert.throws(
      () => withRoles(`\ns:\n  d:\n    r: ["generated.sky(3, tint)", paper]\n`),
      /separates with a comma — write spaces, as generated\.sky\(3 tint\)/,
    );
    assert.throws(
      () => withRoles(`\ns:\n  d:\n    r: [generated.sky(3, tint)]\n`),
      /was cut short/,
    );
  });

  test("the old algorithm names are refused with the new ones", () => {
    const using = (algorithm: string) => `
dtg: 1
defaults:
  ${algorithm}: { base: "#ffffff" }
systems:
  sky:
    algorithm: ${algorithm}
`;
    assert.throws(() => resolveDefinition(using("ink-ramp")), /system "sky": `ink-ramp` was renamed to `tint`/);
    assert.throws(() => resolveDefinition(using("oklch-scale")), /defaults: `oklch-scale` was renamed to `scale`/);
  });

  test("no system can be named transparent", () => {
    assert.throws(
      () =>
        resolveDefinition(`
dtg: 1
systems:
  transparent:
    algorithm: overlay
    params: { color: "#000000" }
`),
      /that name is taken by transparent\(\)/,
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
    algorithm: tint
    base: "#fafdff"
    tint: "#001a28"
s: { d: { r: [sky(3)] } }
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

  test("overrides remain six-digit hexes on flattened steps", () => {
    const definition = (selector: string, override: string) => `
dtg: 1
systems:
  sky:
    algorithm: tint
    params: { base: "#ffffff", tint: "#000000" }
    overrides: { "${selector}": ${JSON.stringify(override)} }
roles:
  surface: { shade: sky(${selector}) }
`;
    assert.throws(
      () => resolveDefinition(definition("10", "color(srgb 1 0 0)")),
      /expected a 6-digit hex color/,
    );
    assert.throws(
      () => resolveDefinition(definition("10 tint", "#ff0000")),
      /overrides pin flattened steps only/,
    );
    assert.equal(
      formatColor(
        resolveDefinition(definition("10", "#ff0000")).roles[0].perMode[0]
          .color,
        "srgb",
      ),
      "#ff0000",
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
    tinted: [generated.sky(3), generated.sky(8)]
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
  edge: { accent: [warm(red 100)] }
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
  surface: { tint: [warm(red 6)] }
`;
    assert.match(warn(pale), /extra gamut is discarded/);
  });

  test("silent when nothing was wide to begin with", () => {
    assert.doesNotMatch(
      warn(def(`{ base: "#ffffff", toward: { red: "#b30a0a" } }`)),
      /extra gamut is discarded/,
    );
  });

  test("tint cannot discard it — it widens to fit its inputs", () => {
    // Only blend takes an explicit `space`; the other algorithms transform in
    // the widest gamut their inputs use, so there is nothing to warn about.
    assert.doesNotMatch(
      warn(`
dtg: 1
modes: [default]
systems:
  ramp:
    algorithm: tint
    params: { base: "#ffffff", tint: "color(display-p3 1 0 0)" }
roles:
  edge: { accent: [ramp(2)] }
`),
      /extra gamut is discarded/,
    );
  });
});

describe("a mode that extends another", () => {
  const SRC = `
dtg: 1
modes:
  light:
  dark:
    scheme: dark
  light-hc:
    extends: light
  dark-hc:
    extends: dark
systems:
  ink: "#313133"
  paper: "#ffffff"
  loud: "#000000"
roles:
  surface:
    card: [paper, ink, ~, loud]
    floating: [surface.card, surface.card]
  label:
    primary: [ink, paper, loud]
    spelled: [ink, paper, ink, paper]
`;
  const r = resolveDefinition(SRC);
  const role = (n: string) => r.roles.find((x) => x.role === n)!;
  const colors = (n: string) =>
    role(n).perMode.map((entry) => formatColor(entry.color, "srgb"));

  test("the longform records each mode's parent, and a scheme comes along", () => {
    assert.deepEqual(r.modes, ["light", "dark", "light-hc", "dark-hc"]);
    assert.deepEqual(r.modeDetails, [
      { name: "light", extends: undefined, scheme: undefined },
      { name: "dark", extends: undefined, scheme: "dark" },
      { name: "light-hc", extends: "light", scheme: undefined },
      { name: "dark-hc", extends: "dark", scheme: "dark" },
    ]);
  });

  test("a list is every mode a root", () => {
    assert.deepEqual(withRoles("").modeDetails, [
      { name: "light", extends: undefined, scheme: undefined },
      { name: "dark", extends: undefined, scheme: undefined },
    ]);
  });

  test("~ and a tuple that stops early both take the parent's ref", () => {
    assert.deepEqual(role("card").inherited, [false, false, true, false]);
    assert.deepEqual(role("primary").inherited, [false, false, false, true]);
    assert.deepEqual(role("floating").inherited, [false, false, true, true]);
    assert.deepEqual(colors("card"), ["#ffffff", "#313133", "#ffffff", "#000000"]);
    assert.deepEqual(colors("primary"), ["#313133", "#ffffff", "#000000", "#ffffff"]);
  });

  test("an inherited ref resolves again in the mode that inherited it", () => {
    // dark-hc never mentions floating, but it changed what floating points at.
    assert.deepEqual(colors("floating"), ["#ffffff", "#313133", "#ffffff", "#000000"]);
  });

  test("spelling the same value out is not the same as inheriting it", () => {
    // Coincidence and intent are different facts; only silence declares the second.
    assert.deepEqual(role("spelled").inherited, [false, false, false, false]);
  });

  test("a mode can extend a mode that extends", () => {
    const chained = resolveDefinition(`
dtg: 1
modes:
  dark:
  dim: { extends: dark }
  dimmer: { extends: dim }
systems: { ink: "#313133", paper: "#ffffff" }
roles:
  label:
    primary: [ink]
    accent: [ink, paper]
`);
    const accent = chained.roles.find((x) => x.role === "accent")!;
    assert.deepEqual(accent.inherited, [false, false, true]);
    assert.equal(formatColor(accent.perMode[2].color, "srgb"), "#ffffff");
  });

  const modesError = (modes: string, roles = "label: { primary: [ink, ink] }") =>
    () =>
      resolveDefinition(
        `dtg: 1\nmodes:\n${modes}\nsystems: { ink: "#313133" }\nroles:\n  ${roles}\n`,
      );

  test("a root mode has to name a color", () => {
    assert.throws(
      modesError("  light:\n  dark:", "label: { primary: [ink, ~] }"),
      /mode "dark" is `~` but extends nothing/,
    );
    assert.throws(
      modesError("  light:\n  dark:", "label: { primary: [~, ink] }"),
      /mode "light" is `~` but extends nothing/,
    );
  });

  test("a tuple has to reach the last root mode", () => {
    assert.throws(
      modesError(
        "  light:\n  light-hc: { extends: light }\n  dark:",
        "label: { primary: [ink, ink] }",
      ),
      /expected 3 refs \(one per mode\), got 2/,
    );
    assert.throws(
      modesError(
        "  light:\n  dark:\n  dark-hc: { extends: dark }",
        "label: { primary: [ink] }",
      ),
      /expected 2 to 3 refs/,
    );
  });

  test("a parent is declared above its child", () => {
    assert.throws(
      modesError("  dark-hc: { extends: dark }\n  dark:"),
      /extends "dark", which is not a mode declared above it/,
    );
  });

  test("a mode name cannot be a number, in either form", () => {
    assert.throws(modesError("  light:\n  2:"), /a mode name cannot be a number/);
    assert.throws(
      () => resolveDefinition(`dtg: 1\nmodes: [light, 2]\nsystems: { ink: "#313133" }\n`),
      /a mode name cannot be a number/,
    );
  });

  test("unknown keys and schemes fail loudly", () => {
    assert.throws(
      modesError("  light:\n  dark: { extend: light }"),
      /mode "dark": unknown key "extend" \(known: extends, scheme\)/,
    );
    assert.throws(
      modesError("  light:\n  dark: { scheme: night }"),
      /scheme must be one of light, dark, got "night"/,
    );
  });
});

describe("a definition with no modes", () => {
  const SRC = `
dtg: 1
systems:
  ink: "#313133"
  paper: "#ffffff"
roles:
  warmdusk:
    canvas: paper
  ink:
    primary: ink
`;
  test("a role is a bare color when there is no axis to spread across", () => {
    const r = resolveDefinition(SRC);
    assert.equal(r.roles.length, 2);
    assert.equal(formatColor(r.roles[0].perMode[0].color, "srgb"), "#ffffff");
  });

  test("the single mode is implicit, so the pipeline needs no special case", () => {
    assert.deepEqual(resolveDefinition(SRC).modes, ["default"]);
  });

  test("a list still works — one entry", () => {
    assert.equal(resolveDefinition(SRC.replace("canvas: paper", "canvas: [paper]")).roles.length, 2);
  });

  test("a bare color is refused once an axis exists", () => {
    assert.throws(
      () => resolveDefinition(`
dtg: 1
modes: [light, dark]
systems:
  ink: "#313133"
roles:
  label: { primary: ink }
`),
      /expected 2 refs \(one per mode: light, dark\), got a single value/,
    );
  });

  test("an empty modes list is still an error", () => {
    assert.throws(
      () => resolveDefinition(`dtg: 1\nmodes: []\nsystems:\n  ink: "#313133"\nroles:\n  label: { primary: ink }`),
      /must be a non-empty list/,
    );
  });
});
