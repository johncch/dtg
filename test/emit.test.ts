import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolveDefinition } from "../dist/resolve.js";
import { dtcgClipped, emitCss, emitDtcg, emitScss } from "../dist/emit.js";

const SRC = `
dtg: 1
modes: [light, dark]
changelog:
  - 2026-08-16: shadow.2 became shadow.3
palette:
  paper: "#ffffff"
  reds:
    alias: warm
    rose: "#ff0000"

systems:
  sky:
    algorithm: tint
    alias: light
    params: { base: "#fafdff", tint: "#001a28" }
roles:
  surface:
    canvas: [sky(3), sky(8)]
    flat: [paper, reds.rose]
`;
const resolved = resolveDefinition(SRC);
const NS = "com.fifthrevision.dtg";

describe("css", () => {
  test("plain puts primitives in :root; tailwind wraps them in @theme", () => {
    const plain = emitCss(resolved, "plain");
    const tw = emitCss(resolved, "tailwind");
    assert.ok(plain.includes(":root {\n  /* sky (tint) */"));
    assert.ok(!plain.includes("@theme"));
    assert.ok(tw.includes("@theme {"));
    assert.ok(tw.includes("@theme inline {"));
  });

  test("emitted names use aliases; values agree across formats", () => {
    const css = emitCss(resolved, "plain");
    assert.ok(css.includes("--color-light-3: #f3f6f9;"));
    assert.ok(css.includes("--color-warm-rose: #ff0000;"));
    assert.ok(css.includes("--surface-flat: var(--color-paper);"));
  });

  test("emit is a pure function of the definition", () => {
    assert.equal(
      emitCss(resolved, "plain"),
      emitCss(resolveDefinition(SRC), "plain"),
    );
  });
});

describe("dtcg", () => {
  test("identity rides in the extension, not the recipe", () => {
    const d = emitDtcg(resolved) as any;
    // a role's identity is its internal path, untouched by alias/omit
    assert.equal(d.roles.surface.canvas.$extensions[NS].id, "surface.canvas");
    // a demand-driven step's is who demands it, so renumbering is safe
    assert.equal(d.systems.sky["3"].$extensions[NS].id, "surface.canvas[light]");
    // $description is the author's, and absent when they wrote none
    assert.equal(d.roles.surface.canvas.$description, undefined);
    // the volatile recipe lives in extensions instead
    assert.equal(d.systems.sky["3"].$extensions[NS].ref, "sky(3)");
    assert.equal(d.systems.sky["3"].$extensions[NS].name, "light/3");
  });

  test("groups nest rather than embedding dotted keys", () => {
    const d = emitDtcg(resolved) as any;
    assert.deepEqual(Object.keys(d.systems.static), ["paper", "reds"]);
    assert.equal(d.systems.static.reds.rose.$value.hex, "#ff0000");
    assert.equal(d.roles.surface.flat.$value, "{systems.static.paper}");
  });

  test("the changelog rides at the root, uninterpreted", () => {
    const d = emitDtcg(resolved) as any;
    assert.deepEqual(d.$extensions[NS].changelog, [
      { date: "2026-08-16", note: "shadow.2 became shadow.3" },
    ]);
  });

  test("no changelog means the key is absent, not empty", () => {
    const without = SRC.replace(
      "changelog:\n  - 2026-08-16: shadow.2 became shadow.3\n",
      "",
    );
    const d = emitDtcg(resolveDefinition(without)) as any;
    assert.equal("changelog" in d.$extensions[NS], false);
  });

  test("a system named static is preserved beside constants", () => {
    const collision = resolveDefinition(`
dtg: 1
palette:
  paper: "#ffffff"

systems:
  static:
    algorithm: tint
    params: { base: "#ffffff", tint: "#000000" }
roles:
  surface:
    shade: static(10)
    paper: paper
`);
    const d = emitDtcg(collision) as any;
    assert.equal(d.systems.static["10"].$value.hex, "#e6e6e6");
    assert.equal(d.systems.static.paper.$value.hex, "#ffffff");
  });
});

describe("wide-gamut emit", () => {
  const wide = resolveDefinition(`
dtg: 1
modes: [light, dark]
palette:
  paper: "#ffffff"
  ghost: "color(srgb 1 0 0 / 0.5)"
  vivid: "color(display-p3 1 0 0)"
  lush: "oklch(0.72 0.28 145)"
  brand: "#b30a0a"

systems:
  wide:
    algorithm: tint
    params: { base: "#ffffff", tint: "color(display-p3 1 0 0)" }
roles:
  surface:
    a: [wide(60), brand]
    veil: [transparent(vivid 30), transparent(paper 30)]
`);

  test("the sRGB pass comes first, so a browser without color() keeps it", () => {
    const css = emitCss(wide, "plain");
    assert.ok(css.indexOf("--color-wide-60: #ff7070;") < css.indexOf("@supports"));
  });

  test("@supports redefines the same property at full strength", () => {
    const css = emitCss(wide, "plain");
    assert.ok(css.includes("@supports (color: color(display-p3 1 1 1)) {"));
    assert.ok(css.includes("--color-wide-60: color(display-p3 0.9736 0.336 0.3401);"));
  });

  test("an in-gamut color is not repeated — it renders the same either way", () => {
    const layer = emitCss(wide, "plain").split("@supports")[1];
    assert.ok(!layer.includes("--color-paper"));
  });

  test("an inlined role value is repeated; a var() reference is not", () => {
    const layer = emitCss(wide, "plain").split("@supports")[1];
    assert.ok(layer.includes("--surface-veil: color(display-p3 1 0 0 / 0.3);"));
    assert.ok(!layer.includes("--surface-a"));
  });

  test("an all-sRGB definition emits no layer at all", () => {
    assert.ok(!emitCss(resolved, "plain").includes("@supports"));
    assert.ok(!emitCss(resolved, "tailwind").includes("@supports"));
  });

  test("components are Figma's rgb triple, so a courier needs no conversion", () => {
    const out = emitDtcg(wide) as any;
    assert.deepEqual(out.systems.static.paper.$value, {
      colorSpace: "srgb",
      components: [1, 1, 1],
      hex: "#ffffff",
    });
  });

  test("alpha is its own property; hex stays 6-digit so it cannot contradict it", () => {
    const ghost = (emitDtcg(wide) as any).systems.static.ghost.$value;
    assert.equal(ghost.alpha, 0.5);
    assert.equal(ghost.hex, "#ff0000");
  });

  test("every color shares one space, so a courier never converts", () => {
    for (const space of ["srgb", "display-p3"] as const) {
      const out = emitDtcg(wide, space) as any;
      const spaces = Object.values(out.systems.static as Record<string, any>)
        .map((t) => t.$value.colorSpace);
      assert.deepEqual(new Set(spaces), new Set([space]));
      assert.equal(out.$extensions[NS].colorSpace, space);
    }
  });

  test("an oklch anchor lands in an rgb space — Figma cannot store oklab", () => {
    const lush = (emitDtcg(wide) as any).systems.static.lush.$value;
    assert.equal(lush.colorSpace, "srgb");
  });

  test("a P3 export is exact where an sRGB export had to gamut-map", () => {
    const asSrgb = (emitDtcg(wide, "srgb") as any).systems.static.vivid.$value;
    const asP3 = (emitDtcg(wide, "display-p3") as any).systems.static.vivid.$value;
    assert.notDeepEqual(asSrgb.components, [1, 0, 0]);
    assert.deepEqual(asP3.components, [1, 0, 0]);
  });

  test("an in-gamut color still changes components between spaces", () => {
    // Same color, wider primaries — it takes less of them to reach it.
    const asSrgb = (emitDtcg(wide, "srgb") as any).systems.static.brand.$value;
    const asP3 = (emitDtcg(wide, "display-p3") as any).systems.static.brand.$value;
    assert.notDeepEqual(asSrgb.components, asP3.components);
    assert.notEqual(asSrgb.hex, asP3.hex);
  });

  test("hex byte-encodes components, so the two never disagree", () => {
    const encode = (c: number[]) =>
      "#" + c.map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
    for (const space of ["srgb", "display-p3"] as const) {
      const out = emitDtcg(wide, space) as any;
      for (const token of Object.values(out.systems.static as Record<string, any>)) {
        assert.equal(encode(token.$value.components), token.$value.hex);
      }
    }
  });
});

describe("dtcg gamut warning", () => {
  const wide = resolveDefinition(`
dtg: 1
modes: [light]
palette:
  brand: "#b30a0a"
  vivid: "color(display-p3 1 0 0)"

systems:
  ramp:
    algorithm: tint
    params: { base: "#ffffff", tint: "color(display-p3 1 0 0)" }
roles:
  label:
    a: [brand]
    b: [vivid]
    c: [ramp(90)]
`);

  test("names the colors an sRGB export has to gamut-map", () => {
    const clipped = dtcgClipped(wide, "srgb");
    assert.ok(clipped.includes("vivid"));
    assert.ok(clipped.includes("ramp(90)"));
  });

  test("an in-gamut color is not reported — it loses nothing", () => {
    assert.ok(!dtcgClipped(wide, "srgb").includes("brand"));
  });

  test("a P3 export loses nothing, so it reports nothing", () => {
    assert.deepEqual(dtcgClipped(wide, "display-p3"), []);
  });

  test("an all-sRGB definition is silent in either space", () => {
    assert.deepEqual(dtcgClipped(resolved, "srgb"), []);
    assert.deepEqual(dtcgClipped(resolved, "display-p3"), []);
  });
});

describe("the mode axis", () => {
  test("nested puts each mode in its own selector", () => {
    const css = emitCss(resolved, "plain", "nested");
    assert.ok(css.includes("--surface-canvas: var(--color-light-3);"));
    assert.ok(css.includes(".dark {"));
    assert.ok(!css.includes("--light-surface-canvas"));
  });

  test("flat folds the mode into the name, in one selector", () => {
    const css = emitCss(resolved, "plain", "flat");
    assert.ok(css.includes("--light-surface-canvas:"));
    assert.ok(css.includes("--dark-surface-canvas:"));
    assert.ok(!css.includes(".dark {"));
  });

  test("both renderings carry the same values", () => {
    const grab = (css: string, re: RegExp) =>
      [...css.matchAll(re)].map((m) => m[1]);
    const nested = grab(emitCss(resolved, "plain", "nested"), /--surface-canvas: (.+);/g);
    const flat = grab(emitCss(resolved, "plain", "flat"), /--(?:light|dark)-surface-canvas: (.+);/g);
    assert.deepEqual(nested, flat);
  });

  test("scss is flat because a Sass variable has nothing to nest into", () => {
    const scss = emitScss(resolved);
    assert.ok(scss.includes("$light-surface-canvas:"));
    assert.ok(scss.includes("$dark-surface-canvas:"));
  });

  test("scss resolves references — there is no var() to defer to", () => {
    const scss = emitScss(resolved);
    assert.ok(!scss.includes("var("));
    assert.match(scss, /\$light-surface-canvas: #[0-9a-f]{6};/);
  });

  test("flat role aliases point at the target in the same mode", () => {
    const aliases = resolveDefinition(`
dtg: 1
modes: [light, dark]
palette:
  ink: "#111111"
  paper: "#ffffff"
roles:
  label:
    base: [ink, paper]
    echo: [label.base, label.base]
`);
    const css = emitCss(aliases, "plain", "flat");
    assert.ok(css.includes("--light-label-echo: var(--light-label-base);"));
    assert.ok(css.includes("--dark-label-echo: var(--dark-label-base);"));
    assert.ok(!css.includes("var(--label-base)"));
  });

  test("nested role aliases keep the unprefixed cascade name", () => {
    const aliases = resolveDefinition(`
dtg: 1
modes: [light, dark]
palette: { ink: "#111111" }
roles:
  label:
    base: [ink, ink]
    echo: [label.base, label.base]
`);
    assert.match(
      emitCss(aliases, "plain", "nested"),
      /--label-echo: var\(--label-base\);/,
    );
  });
});

describe("~ across the formats", () => {
  const omitted = resolveDefinition(`
dtg: 1
modes:
  warm:
  cooldusk: { extends: warm }
  dark:
palette:
  ink: "#313133"
  paper: "#ffffff"
roles:
  surface:
    canvas: [paper, ink, ink]
  label:
    primary: [ink, ~, paper]
`);

  test("nested css leaves the mode out — the cascade is the inheritance", () => {
    const css = emitCss(omitted, "plain", "nested");
    const start = css.indexOf("\n.cooldusk {");
    const dusk = css.slice(start, css.indexOf("}", start));
    assert.ok(dusk.includes("--surface-canvas"));
    assert.ok(!dusk.includes("--label-primary"));
  });

  test("flat css emits no variable for an omitted mode", () => {
    const css = emitCss(omitted, "plain", "flat");
    assert.ok(css.includes("--cooldusk-surface-canvas:"));
    assert.ok(!css.includes("--cooldusk-label-primary:"));
  });

  test("flat Tailwind does not wire a utility for an omitted mode", () => {
    const css = emitCss(omitted, "tailwind", "flat");
    assert.ok(css.includes("--color-warm-label-primary:"));
    assert.ok(!css.includes("--color-cooldusk-label-primary:"));
  });

  test("a flat role alias follows an inherited target back to the mode that declared it", () => {
    const aliases = resolveDefinition(`
dtg: 1
modes:
  light:
  dark: { extends: light }
palette: { ink: "#313133" }
roles:
  label:
    base: [ink, ~]
    echo: [label.base, label.base]
`);
    const css = emitCss(aliases, "plain", "flat");
    assert.ok(!css.includes("--dark-label-base:"));
    assert.ok(css.includes("--dark-label-echo: var(--light-label-base);"));
  });

  test("scss likewise", () => {
    const scss = emitScss(omitted);
    assert.ok(scss.includes("$cooldusk-surface-canvas:"));
    assert.ok(!scss.includes("$cooldusk-label-primary:"));
  });

  test("dtcg expands every mode — Figma fills an unset mode with white", () => {
    const ext = (emitDtcg(omitted) as any).roles.label.primary.$extensions[NS];
    assert.equal(Object.keys(ext.modes).length, 3);
    assert.equal(ext.modes.cooldusk, ext.modes.warm);
    assert.deepEqual(ext.inherits, { cooldusk: "warm" });
  });
});

describe("emit with no modes", () => {
  const flat = resolveDefinition(`
dtg: 1
palette:
  ink: "#313133"
roles:
  ink:
    primary: ink
`);

  test("no mode prefix — there is no axis to disambiguate", () => {
    assert.ok(emitScss(flat).includes("$ink-primary:"));
    assert.ok(!emitScss(flat).includes("$default-"));
  });

  test("flat and nested coincide", () => {
    assert.equal(emitCss(flat, "plain", "flat"), emitCss(flat, "plain", "nested"));
  });
});

describe("nested role paths", () => {
  const nested = resolveDefinition(`
dtg: 1
palette:
  ink: "#112233"
roles:
  label:
    strong:
      base: ink
      echo: label.strong.base
`);

  test("css preserves a nested role-to-role alias", () => {
    const css = emitCss(nested);
    assert.ok(css.includes("--label-strong-echo: var(--label-strong-base);"));
  });

  test("dtcg preserves a nested role-to-role alias", () => {
    const d = emitDtcg(nested) as any;
    assert.equal(
      d.roles.label.strong.echo.$value,
      "{roles.label.strong.base}",
    );
  });
});

describe("a mode that extends a mode other than the first", () => {
  const hc = resolveDefinition(`
dtg: 1
modes:
  light: { scheme: light }
  dark: { scheme: dark }
  dark-hc: { extends: dark }
palette: { ink: "#313133", paper: "#ffffff", loud: "#000000" }
roles:
  surface:
    card: [paper, ink, loud]
    floating: [surface.card, surface.card]
  label:
    primary: [ink, paper]
    echo: [label.primary, label.primary]
`);

  test("nested css selects a mode's block for every mode that extends it", () => {
    assert.equal(
      emitCss(hc, "plain", "nested").split("\n\n").slice(2).join("\n\n"),
      `:root {
  color-scheme: light;
  --surface-card: var(--color-paper);
  --surface-floating: var(--surface-card);
  --label-primary: var(--color-ink);
  --label-echo: var(--label-primary);
}

.dark, .dark-hc {
  color-scheme: dark;
  --surface-card: var(--color-ink);
  --surface-floating: var(--surface-card);
  --label-primary: var(--color-paper);
  --label-echo: var(--label-primary);
}

.dark-hc {
  --surface-card: var(--color-loud);
}
`,
    );
  });

  test("flat css writes an inherited role whose target moved, and only that", () => {
    const css = emitCss(hc, "plain", "flat");
    assert.ok(css.includes("--dark-hc-surface-card: var(--color-loud);"));
    assert.ok(css.includes("--dark-hc-surface-floating: var(--dark-hc-surface-card);"));
    assert.ok(!css.includes("--dark-hc-label-primary:"));
    assert.ok(!css.includes("--dark-hc-label-echo:"));
    assert.ok(!css.includes("color-scheme"));
  });

  test("scss likewise", () => {
    const scss = emitScss(hc);
    assert.ok(scss.includes("$dark-hc-surface-floating: #000000;"));
    assert.ok(!scss.includes("$dark-hc-label-echo:"));
  });

  test("dtcg names the mode each silent mode tracks", () => {
    const roles = (emitDtcg(hc) as any).roles;
    assert.deepEqual(roles.surface.floating.$extensions[NS].inherits, { "dark-hc": "dark" });
    assert.equal(roles.surface.card.$extensions[NS].inherits, undefined);
  });

  test("a chain selects the root's block for every descendant", () => {
    const chained = resolveDefinition(`
dtg: 1
modes:
  light:
  dim: { extends: light }
  dimmer: { extends: dim }
palette: { ink: "#313133", paper: "#ffffff" }
roles:
  label:
    primary: [ink, paper, ink]
`);
    const css = emitCss(chained, "plain", "nested");
    assert.ok(css.includes("\n:root, .dim, .dimmer {"));
    assert.ok(css.includes("\n.dim, .dimmer {"));
    assert.ok(css.includes("\n.dimmer {"));
  });
});

describe("a palette group marked emit: false", () => {
  const SRC = `dtg: 1
palette:
  white: "#ffffff"
  hues:
    emit: false
    sky: "#03a2e8"
    rose: "#e0115f"
systems:
  sky:
    algorithm: tint
    params: { base: hues.sky, tint: "#001a28" }
roles:
  surface: { canvas: sky(3), accent: hues.rose }
`;
  const css = emitCss(resolveDefinition(SRC), "plain");

  test("is an input: its colors feed systems without emitting", () => {
    assert.ok(!css.includes("--color-hues-sky"));
    assert.ok(css.includes("--color-white: #ffffff;"));
  });

  test("still emits a color a role points at", () => {
    assert.ok(css.includes("--color-hues-rose: #e0115f;"));
  });

  test("takes only true or false", () => {
    assert.throws(() => resolveDefinition(SRC.replace("emit: false", "emit: no-thanks")), /`emit` on a group is true or false/);
  });
});

describe("a hand-written description", () => {
  const d = emitDtcg(
    resolveDefinition(`dtg: 1
modes: [light]
palette:
  hues:
    description: The anchors, judged together.
    sky: "#03a2e8"
systems:
  wash:
    description: A tint for surfaces.
    algorithm: tint
    params: { base: "#ffffff", tint: hues.sky }
roles:
  surface:
    canvas: { refs: [wash(6)], description: The page itself. }
    accent: [hues.sky]
`),
  ) as any;

  test("is a role's, a system's steps', and a palette group's colors' $description", () => {
    assert.equal(d.roles.surface.canvas.$description, "The page itself.");
    assert.equal(d.systems.wash["6"].$description, "A tint for surfaces.");
    assert.equal(d.systems.static.hues.sky.$description, "The anchors, judged together.");
  });
});
