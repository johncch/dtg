import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatColor, isOpaque, parseColor } from "../dist/color-math.js";
import {
  publicPath,
  publicSystemName,
  resolveDefinition,
} from "../dist/resolve.js";
import { emitCss, emitDtcg } from "../dist/emit.js";
import { readGradient, writeGradient } from "../dist/ref-functions.js";

const BASE = `
dtg: 1
modes: [light, dark]
palette:
  paper: "#ffffff"
  reds:
    rose: "#ff0000"
    dawn: "#fa0000"

systems:
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

  test("transparent() takes anything that resolves to a color", () => {
    const r = withRoles(`
s:
  d:
    veil: [transparent(reds.dawn 20), transparent(generated.sky(3) 40)]
    ink: [transparent(#000000 50), transparent(oklch(0 0 0) 50)]
    faint: [transparent(generated.sky(3 tint) 50), transparent(transparent(paper 50) 50)]
`);
    const [veil, ink, faint] = r.roles;
    assert.equal(formatColor(veil.perMode[0].color, "srgb"), "rgba(250, 0, 0, 0.2)");
    assert.equal(formatColor(veil.perMode[1].color, "srgb"), "rgba(243, 246, 249, 0.4)");
    assert.deepEqual(veil.perMode[1].target, {
      kind: "transparent",
      of: { kind: "step", system: "generated.sky", selector: "3" },
      alpha: 40,
    });
    assert.equal(formatColor(ink.perMode[0].color, "srgb"), "rgba(0, 0, 0, 0.5)");
    assert.equal(formatColor(ink.perMode[1].color, "srgb"), "rgba(0, 0, 0, 0.5)");
    assert.equal(faint.perMode[0].color.alpha, 0.015);
    assert.equal(faint.perMode[1].color.alpha, 0.25);
  });

  test("transparent() over a role follows it mode by mode", () => {
    const r = withRoles(`
s:
  d:
    card: [paper, reds.rose]
    scrim: [transparent(d.card 80), transparent(d.card 80)]
`);
    const scrim = r.roles[1];
    assert.equal(formatColor(scrim.perMode[0].color, "srgb"), "rgba(255, 255, 255, 0.8)");
    assert.equal(formatColor(scrim.perMode[1].color, "srgb"), "rgba(255, 0, 0, 0.8)");
    assert.throws(
      () =>
        withRoles(`
s:
  d:
    a: [transparent(d.b 50), paper]
    b: [transparent(d.a 50), paper]
`),
      /circular role reference: d\.a → d\.b → d\.a/,
    );
  });

  test("transparent() emits its value and demands nothing", () => {
    const r = resolveDefinition(`
dtg: 1
modes: [light]
palette:
  quiet:
    emit: false
    mist: "#eeeeee"
systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
roles:
  d:
    veil: [transparent(sky(3) 40)]
    haze: [transparent(quiet.mist 40)]
`);
    assert.deepEqual(r.systems[0].steps, []);
    assert.equal(r.statics[0].emitted, false);
    const css = emitCss(r, "plain");
    assert.ok(css.includes("--d-veil: rgba(243, 246, 249, 0.4);"));
    assert.ok(!css.includes("--color-sky-3"));
    assert.ok(!css.includes("--color-quiet-mist"));
  });

  test("transparent() without something to fade and an opacity says what it takes", () => {
    for (const ref of ["transparent(generated.sky(3))", "transparent(paper 40 50)"]) {
      assert.throws(
        () =>
          withRoles(`
s:
  d:
    veil: [${ref}, transparent(paper 40)]
`),
        /takes a color or a gradient, then an opacity/,
      );
    }
  });

  test("gradient() lays colors along a line", () => {
    const r = withRoles(`
s:
  d:
    card: [paper, reds.rose]
    hero:
      - gradient(paper generated.sky(3) 40% transparent(reds.rose 50) 100% angle=90deg)
      - "gradient(d.card
          #000000)"
    echo: [d.hero, d.hero]
`);
    const [, hero, echo] = r.roles;
    const light = hero.perMode[0];
    assert.equal(light.kind, "gradient");
    if (light.kind !== "gradient") return;
    assert.deepEqual(light.geometry, { kind: "linear", angle: 90 });
    assert.deepEqual(light.target, { kind: "gradient", of: null });
    assert.deepEqual(light.stops.map((stop) => stop.position), [null, 40, 100]);
    assert.deepEqual(light.stops.map((stop) => stop.color.target.kind), ["constant", "step", "transparent"]);
    const dark = hero.perMode[1];
    if (dark.kind !== "gradient") return assert.fail("dark is a gradient too");
    assert.deepEqual(dark.geometry, { kind: "linear", angle: 180 });
    assert.equal(formatColor(dark.stops[0].color.color, "srgb"), "#ff0000");
    assert.equal(echo.perMode[0].kind, "gradient");
    assert.equal(echo.perMode[0].target.kind, "role");
    assert.deepEqual(r.systems[0].steps.map((step) => step.selector), ["3"]);
  });

  test("gradient() goes out from a point or around one, repeats, and names its space", () => {
    const r = resolveDefinition(`
dtg: 1
modes: [light]
palette: { paper: "#ffffff", rose: "#ff0000" }
roles:
  d:
    spot: [gradient(paper rose 80% kind=radial shape=circle size=closest-side x=30% y=20%)]
    glow: [gradient(paper rose kind=radial)]
    dial: [gradient(paper rose paper kind=conic angle=90deg x=25%)]
    spin: [gradient(paper rose kind=conic)]
    bars: [gradient(paper 0% rose 10% repeat=true space=oklch angle=45deg)]
    veil: [transparent(d.spot 50)]
`);
    const css = emitCss(r, "plain");
    for (const line of [
      "--d-spot: radial-gradient(circle closest-side at 30% 20%, var(--color-paper), var(--color-rose) 80%);",
      "--d-glow: radial-gradient(ellipse farthest-corner at 50% 50%, var(--color-paper), var(--color-rose));",
      "--d-dial: conic-gradient(from 90deg at 25% 50%, var(--color-paper), var(--color-rose), var(--color-paper));",
      "--d-spin: conic-gradient(from 0deg at 50% 50%, var(--color-paper), var(--color-rose));",
      "--d-bars: repeating-linear-gradient(45deg in oklch, var(--color-paper) 0%, var(--color-rose) 10%);",
      "--d-veil: radial-gradient(circle closest-side at 30% 20%, rgba(255, 255, 255, 0.5), rgba(255, 0, 0, 0.5) 80%);",
    ]) {
      assert.ok(css.includes(line), line);
    }
    const spot = (emitDtcg(r) as any).roles.d.spot.$extensions["com.fifthrevision.dtg"].gradients.light;
    assert.deepEqual(spot, { kind: "radial", shape: "circle", size: "closest-side", x: 30, y: 20, repeat: false, space: null });
  });

  describe("a gradient named in the palette", () => {
    const source = (palette: string, roles: string) => `
dtg: 1
modes: [light, dark]
palette:
  paper: "#ffffff"
  rose: "#ff0000"
  quiet:
    emit: false
    mist: "#eeeeee"
    haze: gradient(quiet.mist paper)
${palette}
systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
roles:
  d:
${roles}
`;

    test("is pointed at by its path and restyled by gradient()", () => {
      const r = resolveDefinition(
        source(
          `  brand: gradient(paper rose 60% transparent(rose 20) kind=radial shape=circle x=30% repeat=true)`,
          `    hero: [brand, brand]
    banner: [gradient(brand x=10% repeat=false), gradient(brand kind=linear angle=45deg)]
    veil: [transparent(brand 50), transparent(gradient(brand kind=conic) 50)]`,
        ),
      );
      assert.deepEqual(r.problems, []);
      assert.deepEqual(r.gradients.map((named) => [named.path, named.emitted]), [["quiet.haze", false], ["brand", true]]);
      assert.equal(r.statics.find((constant) => constant.path === "quiet.mist")?.emitted, false);
      const [hero, banner, veil] = r.roles;
      assert.deepEqual(hero.perMode[0].target, { kind: "constant", name: "brand" });
      const [kept, changed] = banner.perMode;
      if (kept.kind !== "gradient" || changed.kind !== "gradient") return assert.fail("both are gradients");
      assert.deepEqual(kept.geometry, { kind: "radial", shape: "circle", size: "farthest-corner", x: 10, y: 50 });
      assert.equal(kept.repeat, false);
      assert.deepEqual(changed.geometry, { kind: "linear", angle: 45 });
      assert.equal(changed.repeat, true);
      assert.deepEqual(kept.stops.map((stop) => stop.position), [null, 60, null]);
      assert.deepEqual(kept.target, { kind: "gradient", of: { kind: "constant", name: "brand" } });
      const css = emitCss(r, "plain");
      for (const line of [
        "--gradient-brand: repeating-radial-gradient(circle farthest-corner at 30% 50%, var(--color-paper), var(--color-rose) 60%, rgba(255, 0, 0, 0.2));",
        "--d-hero: var(--gradient-brand);",
        "--d-banner: radial-gradient(circle farthest-corner at 10% 50%, var(--color-paper), var(--color-rose) 60%, rgba(255, 0, 0, 0.2));",
        "--d-banner: repeating-linear-gradient(45deg, var(--color-paper), var(--color-rose) 60%, rgba(255, 0, 0, 0.2));",
        "--d-veil: repeating-radial-gradient(circle farthest-corner at 30% 50%, rgba(255, 255, 255, 0.5), rgba(255, 0, 0, 0.5) 60%, rgba(255, 0, 0, 0.1));",
        "--d-veil: repeating-conic-gradient(from 0deg at 50% 50%, rgba(255, 255, 255, 0.5), rgba(255, 0, 0, 0.5) 60%, rgba(255, 0, 0, 0.1));",
      ]) {
        assert.ok(css.includes(line), line);
      }
      assert.ok(!css.includes("quiet"));
      assert.ok(css.indexOf("--gradient-brand") > css.indexOf("--color-rose"));
      void veil;
    });

    test("in an emit: false group, emits with its colors once a role points at it", () => {
      const css = emitCss(resolveDefinition(source("", "    fog: [quiet.haze, quiet.haze]")), "plain");
      assert.ok(css.includes("--color-quiet-mist: #eeeeee;"));
      assert.ok(css.includes("--gradient-quiet-haze: linear-gradient(180deg, var(--color-quiet-mist), var(--color-paper));"));
      assert.ok(css.includes("--d-fog: var(--gradient-quiet-haze);"));
    });

    test("is written for Tailwind and DTCG", () => {
      const r = resolveDefinition(source("  brand: gradient(paper rose angle=90deg)", "    hero: [brand, brand]"));
      const tailwind = emitCss(r, "tailwind");
      assert.ok(tailwind.includes("@theme {\n  /* statics */\n  --color-paper: #ffffff;\n  --color-rose: #ff0000;\n}\n\n:root {\n  /* gradients */\n  --gradient-brand:"));
      assert.ok(tailwind.includes("@utility bg-brand {\n  background-image: var(--gradient-brand);\n}"));
      assert.ok(tailwind.includes("@utility bg-d-hero {\n  background-image: var(--d-hero);\n}"));
      const d = emitDtcg(r) as any;
      assert.equal(d.systems.static.brand.$type, "gradient");
      assert.equal(d.systems.static.brand.$value[0].color, "{systems.static.paper}");
      assert.deepEqual(d.systems.static.brand.$extensions["com.fifthrevision.dtg"].gradient, { kind: "linear", angle: 90, repeat: false, space: null });
      assert.equal(d.roles.d.hero.$value, "{systems.static.brand}");
    });

    test("holds only the palette's own colors", () => {
      const refused: [string, RegExp][] = [
        ["gradient(paper sky(3))", /palette gradient "bad": sky\(3\) is not the palette's own/],
        ["gradient(paper d.card)", /palette gradient "bad": d\.card is not the palette's own/],
        ["gradient(quiet.haze angle=90deg)", /palette gradient "bad": gradient\(quiet\.haze angle=90deg\) is not the palette's own/],
      ];
      for (const [written, message] of refused) {
        assert.throws(() => resolveDefinition(source(`  bad: ${written}`, "    card: [paper, rose]")), message, written);
      }
      assert.throws(
        () => resolveDefinition(source("", "    card: [paper, rose]").replace('tint: "#001a28"', "tint: quiet.haze")),
        /no constant "quiet\.haze"/,
      );
    });
  });

  test("a gradient's text is taken apart and written back for an editor to change one piece", () => {
    const written = readGradient("gradient(d.card 0%  generated.sky(3 tint) transparent(reds.rose 50) 100% space=oklch angle=90deg)");
    assert.deepEqual(written?.stops, [
      { ref: "d.card", position: "0%" },
      { ref: "generated.sky(3 tint)", position: null },
      { ref: "transparent(reds.rose 50)", position: "100%" },
    ]);
    assert.deepEqual([...written!.named], [["space", "oklch"], ["angle", "90deg"]]);
    assert.equal(
      writeGradient(written!),
      "gradient(d.card 0% generated.sky(3 tint) transparent(reds.rose 50) 100% angle=90deg space=oklch)",
    );
    assert.equal(writeGradient(readGradient("gradient(brand kind=radial)")!), "gradient(brand kind=radial)");
    for (const unread of ["paper", "gradient(50% paper)", "gradient(paper angle=90deg shade)", "gradient(paper turn=1)"]) {
      assert.equal(readGradient(unread), null, unread);
    }
  });

  test("gradient() says what is wrong with it", () => {
    const refused: [string, RegExp][] = [
      ["gradient(paper)", /takes at least two colors, or one gradient to restyle — paper is a color/],
      ["gradient(90 paper reds.rose)", /bare number 90 — a position is written 90% and follows its color, and the angle is written angle=90deg/],
      ["gradient(90deg paper reds.rose)", /takes its angle as a named argument, after the colors — write angle=90deg/],
      ["gradient(angle=90deg paper reds.rose)", /got paper after a named argument — positional arguments come first and named ones last/],
      ["gradient(paper reds.rose angle=90)", /angle must be a number of degrees, as angle=90deg, got "90"/],
      ["gradient(paper reds.rose turn=1)", /has no argument named turn — it takes kind, angle, x, y, shape, size, repeat, space/],
      ["gradient(paper reds.rose kind=round)", /kind must be linear, radial or conic, got "round"/],
      ["gradient(paper reds.rose shape=circle)", /takes shape when kind is radial, and this one is linear/],
      ["gradient(paper reds.rose kind=radial angle=10deg)", /takes angle when kind is linear or conic, and this one is radial/],
      ["gradient(paper reds.rose kind=radial x=30)", /x and y are percents, as x=30% y=20%, got "30"/],
      ["gradient(paper reds.rose kind=radial size=big)", /size must be one of closest-side/],
      ["gradient(paper reds.rose repeat=yes)", /repeat is true or false, got "yes"/],
      ["gradient(paper reds.rose space=rgb)", /space must be one of srgb/],
      ["gradient(paper reds.rose angle=1deg angle=2deg)", /got angle twice/],
      ["gradient(10% paper reds.rose angle=90deg)", /position 10% has no color before it/],
      ["gradient(paper 10% 20% reds.rose)", /position 20% has no color before it/],
      ["gradient(paper d.other)", /got d\.other as a stop, and it is a gradient — a stop is a color; to restyle a gradient, give it alone/],
      ["gradient(d.other 50%)", /got d\.other as a stop, and it is a gradient/],
      ["gradient(paper #000000)", /an unquoted # after a space starts a YAML comment/],
    ];
    for (const [ref, message] of refused) {
      assert.throws(
        () =>
          withRoles(`
s:
  d:
    other: [gradient(paper reds.rose), gradient(paper reds.rose)]
    bad:
      - ${ref}
      - gradient(paper reds.rose)
`),
        message,
        ref,
      );
    }
    assert.throws(
      () => resolveDefinition(BASE.replace("  generated:", "  gradient:\n    algorithm: tint\n    params: { base: paper, tint: reds.rose }\n  generated:")),
      /that name is taken by gradient\(\)/,
    );
  });

  test("transparent() over a gradient fades every stop and demands nothing", () => {
    const r = resolveDefinition(`
dtg: 1
modes: [light]
palette: { paper: "#ffffff", rose: "#ff0000" }
systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
roles:
  d:
    hero: [gradient(paper rose 60% angle=45deg)]
    veil: [transparent(d.hero 50)]
    haze: [transparent(gradient(paper sky(3)) 20)]
`);
    const [, veil, haze] = r.roles.map((role) => role.perMode[0]);
    if (veil.kind !== "gradient" || haze.kind !== "gradient") return assert.fail("both are gradients");
    assert.deepEqual(veil.geometry, { kind: "linear", angle: 45 });
    assert.deepEqual(veil.stops.map((stop) => [formatColor(stop.color.color, "srgb"), stop.position]), [
      ["rgba(255, 255, 255, 0.5)", null],
      ["rgba(255, 0, 0, 0.5)", 60],
    ]);
    assert.deepEqual(veil.target, { kind: "transparent", of: { kind: "role", group: "d", role: "hero" }, alpha: 50 });
    assert.deepEqual(r.systems[0].steps, []);
    const css = emitCss(r, "plain");
    assert.ok(css.includes("--d-veil: linear-gradient(45deg, rgba(255, 255, 255, 0.5), rgba(255, 0, 0, 0.5) 60%);"));
    assert.ok(css.includes("--d-haze: linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(243, 246, 249, 0.2));"));
  });

  test("a role that is a gradient in one mode and a color in another resolves, with a problem that stops it being written", () => {
    const r = withRoles(`
s:
  d:
    hero: [gradient(paper reds.rose), paper]
    echo: [d.hero, d.hero]
`);
    assert.deepEqual(r.roles[0].perMode.map((entry) => entry.kind), ["gradient", "color"]);
    assert.deepEqual(r.roles[1].perMode.map((entry) => entry.kind), ["gradient", "color"]);
    assert.deepEqual(r.problems, [{ path: "d.hero", message: "A role must be all solid colors or all gradients." }]);
    assert.throws(() => emitCss(r, "plain"), /definition errors:\n- d\.hero: A role must be all solid colors or all gradients\./);
    assert.throws(() => emitDtcg(r), /A role must be all solid colors or all gradients/);
    assert.deepEqual(withRoles(`
s:
  d:
    hero: [paper, paper]
`).problems, []);
  });

  test("a number in a selector is one step however it is written", () => {
    const r = resolveDefinition(`
dtg: 1
modes: [light]
systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
    emit: ["08.50"]
    overrides: { "3.0": "#123456" }
roles:
  d:
    a: [sky(3)]
    b: [sky(3.0)]
    c: [sky(03 tint)]
    e: [sky(8.5)]
`);
    assert.deepEqual(r.systems[0].steps.map((step) => [step.selector, step.publicStep]), [
      ["3", "3"],
      ["3 tint", "3-tint"],
      ["8.5", "8_5"],
    ]);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.roles[1].perMode[0].ref, "sky(3.0)");
    assert.deepEqual(r.roles[1].perMode[0].target, { kind: "step", system: "sky", selector: "3" });
    const css = emitCss(r, "plain");
    assert.ok(css.includes("--color-sky-3: #123456;"));
    assert.ok(css.includes("--d-b: var(--color-sky-3);"));
    assert.ok(!css.includes("3_0"));
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

describe("literals", () => {
  test("a role can hold a hex or a color function", () => {
    const r = withRoles(`
s:
  d:
    ink: ["#123456", oklch(0.5 0.1 30)]
`);
    assert.equal(r.roles[0].perMode[0].target.kind, "literal");
    assert.equal(formatColor(r.roles[0].perMode[0].color, "srgb"), "#123456");
    assert.equal(r.roles[0].perMode[1].target.kind, "literal");
  });

  test("emits as a value, not a reference", () => {
    const r = withRoles(`
s:
  d:
    ink: ["#123456", "#654321"]
`);
    assert.match(emitCss(r, "plain"), /--d-ink: #123456;/);
    const dtcg = emitDtcg(r) as { s: { d: { ink: { $value: { hex: string } } } } };
    assert.equal(dtcg.s.d.ink.$value.hex, "#123456");
  });

  test("the same literal written twice warns", () => {
    const r = withRoles(`
s:
  d:
    ink: ["#123456", "#654321"]
    rule: ["#123456", "#abcdef"]
`);
    assert.ok(r.warnings.some((w) => /"?#123456"? is written in d\.ink\[light\] and d\.rule\[light\]/.test(w)));
  });

  test("a literal equal to a constant warns", () => {
    const r = withRoles(`
s:
  d:
    ink: ["#FFF", "#654321"]
`);
    assert.ok(r.warnings.some((w) => w.includes("is the constant `paper`")));
  });

  test("an inherited literal is not a repeat", () => {
    const r = resolveDefinition(`
dtg: 1
modes: { light: {}, dim: { extends: light } }
s:
  ink: ["#123456"]
`);
    assert.ok(!r.warnings.some((w) => w.includes("is written in")));
  });

  test("a system cannot take a color function's name", () => {
    assert.throws(
      () =>
        resolveDefinition(`
dtg: 1
palette: { paper: "#ffffff" }
systems:
  oklch: { algorithm: tint, params: { base: paper, tint: "#000000" } }
`),
      /that name is taken by the oklch\(\) color literal/,
    );
  });

  test("an unquoted hex is read as a comment and says so", () => {
    assert.throws(
      () =>
        resolveDefinition(`
dtg: 1
s:
  ink: #000000
`),
      /is empty — an unquoted # starts a YAML comment/,
    );
  });
});

describe("rejects", () => {
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
palette:
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

  test("overrides pin flattened steps with any opaque color", () => {
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
    const pinned = (override: string, gamut: "srgb" | "display-p3") =>
      formatColor(resolveDefinition(definition("10", override)).roles[0].perMode[0].color, gamut);
    assert.equal(pinned("#ff0000", "srgb"), "#ff0000");
    assert.equal(pinned("color(srgb 1 0 0)", "srgb"), "#ff0000");
    assert.equal(pinned("color(display-p3 0.2 0.52 1)", "display-p3"), "color(display-p3 0.2 0.52 1)");
    assert.equal(pinned("oklch(70% 0.1 40)", "srgb"), formatColor(parseColor("oklch(70% 0.1 40)", "x"), "srgb"));
    assert.throws(
      () => resolveDefinition(definition("10", "oklch(70% 0.1 40 / 0.5)")),
      /must be opaque/,
    );
    assert.throws(
      () => resolveDefinition(definition("10", "not a color")),
      /override "sky\(10\)"/,
    );
    assert.throws(
      () => resolveDefinition(definition("10 tint", "#ff0000")),
      /overrides pin flattened steps only/,
    );
  });
});

describe("roles written straight in a collection", () => {
  const SRC = `
dtg: 1
palette:
  ink: "#202020"
  paper: "#ffffff"
scheme:
  primary: [ink]
  on-primary: [paper]
  echo: [primary]
`;
  test("have no group, can be referenced by name, and emit by name", () => {
    const resolved = resolveDefinition(SRC);
    const echo = resolved.roles.find((role) => role.role === "echo")!;
    assert.equal(echo.group, "");
    assert.deepEqual(echo.perMode[0].target, { kind: "role", group: "", role: "primary" });
    const css = emitCss(resolved, "plain");
    assert.match(css, /--primary: var\(--color-ink\);/);
    assert.match(css, /--echo: var\(--primary\);/);
    assert.match(JSON.stringify(emitDtcg(resolved)), /"\{scheme\.primary\}"/);
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
palette:
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
palette: { ink: "#313133", paper: "#ffffff" }
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
        `dtg: 1\nmodes:\n${modes}\npalette: { ink: "#313133" }\nroles:\n  ${roles}\n`,
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
      () => resolveDefinition(`dtg: 1\nmodes: [light, 2]\npalette: { ink: "#313133" }\n`),
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
palette:
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
palette:
  ink: "#313133"
roles:
  label: { primary: ink }
`),
      /expected 2 refs \(one per mode: light, dark\), got a single value/,
    );
  });

  test("an empty modes list is still an error", () => {
    assert.throws(
      () => resolveDefinition(`dtg: 1\nmodes: []\npalette:\n  ink: "#313133"\nroles:\n  label: { primary: ink }`),
      /must be a non-empty list/,
    );
  });
});

describe("palette", () => {
  test("a color left in systems is pointed at the palette", () => {
    assert.throws(
      () => resolveDefinition(`dtg: 1\nsystems:\n  paper: "#ffffff"\n`),
      /"paper": a color with no recipe goes under `palette:` now/,
    );
  });

  test("a system in the palette is pointed back at systems", () => {
    assert.throws(
      () => resolveDefinition(`dtg: 1\npalette:\n  sky:\n    algorithm: tint\n`),
      /palette "sky": a palette holds colors and groups — a system goes under `systems`/,
    );
  });

  test("a palette color and a system cannot share a path", () => {
    assert.throws(
      () =>
        resolveDefinition(
          `dtg: 1\npalette:\n  sky: "#ffffff"\nsystems:\n  sky:\n    algorithm: overlay\n    params: { color: "#000000" }\n`,
        ),
      /"sky" is both a palette color and a system/,
    );
  });

  test("is not a section", () => {
    assert.deepEqual(resolveDefinition(`dtg: 1\npalette:\n  paper: "#ffffff"\n`).sections, []);
  });
});

describe("emit", () => {
  const withEmit = (emit: string) =>
    resolveDefinition(`dtg: 1
modes: [light]
systems:
  theme:
    algorithm: scale
    params: { base: "#03a2e8", toward: ["#ffffff", "#000000"] }
${emit}
s: { d: { r: [theme(250)] } }
`);
  const steps = (emit: string) =>
    withEmit(emit).systems[0].steps.map((step) => step.selector);

  test("a system publishes only what refs demand by default", () => {
    assert.deepEqual(steps(""), ["250"]);
  });

  test("and what its emit lists besides, in order", () => {
    assert.deepEqual(steps("    emit: [900, 50, 500]"), ["50", "250", "500", "900"]);
  });

  test("an emitted selector the algorithm cannot produce is an error", () => {
    assert.throws(() => withEmit("    emit: [1200]"), /system "theme" publish: .*stop must be a number 0–1000/);
  });

  test("emit is a list", () => {
    assert.throws(() => withEmit("    emit: 50"), /`publish` is a list of the selectors to publish/);
  });

  test("scale's old stops point at midpoint and emit", () => {
    assert.throws(
      () => resolveDefinition(`dtg: 1\ndefaults:\n  scale: { stops: { "500": 1 } }\nsystems:\n  theme:\n    algorithm: scale\n    params: { base: "#03a2e8", toward: ["#ffffff", "#000000"] }\n`),
      /scale's `stops` are gone .* `midpoint` shapes the curve, and the stops to publish are listed under `publish`/,
    );
  });
});

describe("blend is gone", () => {
  test("and points at a group of tints", () => {
    assert.throws(
      () =>
        resolveDefinition(
          `dtg: 1\nsystems:\n  warm:\n    algorithm: blend\n    params: { base: "#ffffff", toward: { red: "#b30a0a" } }\n`,
        ),
      /`blend` is gone .* `warm-wash: \{ red: \{ algorithm: tint, params: \{ base, tint \} \} \}`\. Refs move from `warm\(red 6\)` to `warm-wash\.red\(6\)`, and the `alpha` form is `tint`/,
    );
  });
});

describe("params", () => {
  test("are listed in the order the algorithm declares them, shared defaults or not", () => {
    const resolved = resolveDefinition(`dtg: 1
defaults:
  scale: { midpoint: 0.4, hueShift: 15, toward: ["#ffffff", "#000000"] }
systems:
  theme:
    algorithm: scale
    params: { base: "#03a2e8" }
`);
    assert.deepEqual(Object.keys(resolved.systems[0].params), ["base", "toward", "hueShift", "midpoint"]);
  });
});

describe("description", () => {
  const SRC = `dtg: 1
modes: [light]
palette:
  hues:
    description: Picked by hand.
    sky: "#03a2e8"
systems:
  washes:
    description: Tints over paper.
    sky:
      description: The sky wash.
      algorithm: tint
      params: { base: "#ffffff", tint: hues.sky }
roles:
  surface:
    description: Where things sit.
    canvas: { refs: [washes.sky(6)], description: The page. }
`;
  const resolved = resolveDefinition(SRC);

  test("is kept on systems, roles, and groups of each kind", () => {
    assert.equal(resolved.systems[0].description, "The sky wash.");
    assert.equal(resolved.roles[0].description, "The page.");
    assert.deepEqual(resolved.groupDescriptions, {
      systems: { washes: "Tints over paper." },
      palette: { hues: "Picked by hand." },
      roles: { surface: "Where things sit." },
    });
  });

  test("is a reserved key, never read as a color, a system or a role", () => {
    assert.deepEqual(resolved.statics.map((constant) => constant.path), ["hues.sky"]);
    assert.deepEqual(resolved.roles.map((role) => role.role), ["canvas"]);
  });

  test("is text", () => {
    assert.throws(() => resolveDefinition(SRC.replace("description: The page.", "description: 3")), /`description` is text/);
  });
});
