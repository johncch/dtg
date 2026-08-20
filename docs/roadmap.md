# Roadmap

What is settled, what is next, and what was deliberately deferred. The
README carries a short public version; this is the working list.

## The layers

Naming them so they stop accreting silently. Six, not four.

1. **Color primitives** — `src/color-math.ts`. Composite, gamut, OKLab,
   deltaE. Internal today; must become public API before layer 2 is a real
   extension point for anyone outside this repo.
2. **Algorithms** — `src/contract.ts`, `src/algorithms/*`. Open registry.
3. **The definition language** — `src/resolve.ts`. The ref grammar, the
   two-tier model, modes, aliases, `omit`, overrides, demand-driven step
   collection, public-name derivation. The largest file and the actual
   product. Every blocked feature below lives here, not in algorithms.
4. **Preview and tweak** — `src/render.ts`, `src/dev-server.ts`. Currently
   hardcodes how a system is drawn; should be the algorithm's business.
5. **Emit** — `src/emit.ts`. A pure function of the definition. Same
   definition, same bytes.
6. **Reconcile** — does not exist. `check` (local artifact drift) and any
   future live sync. Not emit: reads state it did not produce, diffs, and
   decides what to overwrite. Different shape, different failure modes.

## Shipped

### Selector ownership

`publicStep` and `stepOrder` are optional hooks on `AlgorithmImpl`, defaulting
to today's behavior. The resolver derives a step's public name once, validates
it with `assertNameFragment`, and orders steps totally via `compareSteps` with
a raw-selector tiebreak.

Three copies of the name derivation existed, not the two identified in design:
`resolve.ts`, the CSS `var()` path in `emit.ts`, and `emit.ts` **again in the
Figma alias path**. The third would have emitted a primitive named `blush-100`
alongside an alias pointing at `blush@100` — a silently broken payload. All
three now read `step.publicStep`.

Verified byte-identical against Sunnyday: 74 primitives, 2 statics, 41 roles ×
2 modes, CSS and Figma payload both unchanged.

### `compose`

`src/algorithms/compose.ts`. Params `bottom` (required hex) and `tops` (name →
`{ color, alpha }`, both required — total, no optional-parameter modes).
Selector is `top` or `top@alpha`. `publicStep` maps `blush@3.5` → `blush-3_5`;
`stepOrder` sorts by declaration order then weight. `declaredSelectors` returns
`null` and carries the once-per-system validation, including inside each top,
so a typo'd `alpah:` fails loudly — the nested-param gap is closed.

Validated against fifthrevision's real palette: `#aa0000` at 5.9% over white
emits `#faf0f0`, exactly the site's shipped `$lightWarm-c1`, and `#00398e` at
3.5% emits `#f6f8fb`, exactly its third gradient stop. The derived inks
round-trip to the colors the site ships today.

### Plain-CSS emit

`emitCss` takes a `CssFormat`: `plain` (default) puts primitives in `:root`,
`tailwind` keeps the `@theme` wrapper and the `@theme inline` utility block.
`dtg.yaml` accepts `outputs.css` as a bare path or `{ path, format }`, and
`--css-format` overrides both.

**Plain is the default**, so a project that never opts in gets CSS a browser
can use. Tailwind consumers opt in explicitly — Sunnyday's `dtg.yaml` is
pinned to `format: tailwind`, verified emitting its `colors.generated.css`
byte-for-byte unchanged.

## Settled, not yet built

### DTCG emit with descriptions

Replaces bespoke Figma work for now. Emit standard DTCG — `$value`, `$type`,
`$description` — where the description carries the recipe and lineage
(`sky/3` → "3% ink over base", plus which roles demand it). An agent reads
that and does identify-and-replace against Figma or anywhere else, so no
Figma-specific integration ships until there is a reason.

Put machine-readable recipe data in namespaced `$extensions` rather than
prose, so it round-trips. Prose `$description` is for the agent's judgment.

## Later

- **Param schema on `AlgorithmImpl`.** One construct, three jobs: subsumes
  `assertKnownParams` (including nested params like compose's `tops`), tells
  `render.ts` that a param is a color instead of guessing with the
  `/^#[0-9a-fA-F]{6}$/` heuristic in `paramValue`, and supplies the control
  type and range that in-browser tweaking needs. Prerequisite for the
  tweaking item already on the README roadmap. Worth designing before
  compose hardens, since compose sets the nested-param precedent.
- **Gradients as a composition tier** above roles, not an algorithm.
  Gradient stops stay refs, so CSS emits a live
  `linear-gradient(178deg, var(--blush-4) 0%, …)`. Geometry (angle, stop
  positions) joins the parameter space.
- **Themes with inheritance.** `resolve.ts:428` enforces one ref per mode,
  which forces N-way duplication when a variant only differs in a few
  values. Wanted shape is `extends` plus overrides; CSS then emits the base
  in `:root` and each theme as a class carrying only its divergences, with
  the cascade performing the inheritance. Themeable `bottom` on compose
  turns a light/dark pair into one system.
- **SCSS emit** as a thin wrapper over the custom properties, plus a map for
  genuine build-time needs. Not Sass variables as the primary target —
  those are compile-time and would preserve the per-theme-stylesheet
  architecture that runtime custom properties delete.
- **p3 parity.** Emit an `@supports (color: color(display-p3 1 1 1))` block
  that redefines the same custom properties, so consumers are untouched.
  Nearly free once on custom properties; effectively impossible with Sass
  variables without duplicating every rule. Needs gamut support in
  `color-math.ts`, which is sRGB-only today.
- **JSON / `_data` emit** for consumers that need values outside CSS.
- **Export `color-math.ts`** with a stability promise. A third-party
  algorithm author currently has no primitives and would reimplement the
  OKLab round-trip at `color-math.ts:36-60`.
- **CLI algorithm loading** from a project path. `resolveDefinition(yaml,
  extraAlgorithms)` already accepts a registry; the CLI cannot load one, so
  the extension point is library-only in practice.
- **`check` command.** Definition versus emitted artifact drift, inert
  overrides, longhand-sugar detection.
- **Preview rendering moves into the algorithm.** `stripFor` computes ΔE
  between adjacent steps, meaningful on a ramp and noise on a palette of
  unrelated hues. Same class of assumption as the selector leak.
- **Multi-file definitions.** Discovery exists; merging does not.

## Deferred

- **Figma-specific integration.** No plugin, no courier, no sync loop until
  there is a need. DTCG plus an agent covers it. When it returns it belongs
  in layer 6, not in emit.

## Open questions

- **Which gamut is the source of truth?** Deriving p3 from sRGB by component
  copy replicates a convention that buys nothing — identical components in
  display-p3 are a more saturated color, and for in-gamut sRGB a real
  conversion produces different numbers that look the same. The version
  worth building authors in OKLCH and renders per gamut, so p3 carries
  chroma sRGB cannot reach.
- **What space does `compose` composite in?** `alphaComposite`
  (`color-math.ts:32`) lerps in gamma-encoded sRGB bytes, which matches what
  a browser does for `rgba()` over a background and is the right default for
  parity. But the same file already does the linear/OKLab round-trip for
  `oklch-scale`. Once compose is a primitive the space becomes a real
  parameter, and it is entangled with the gamut question: compositing in
  sRGB then converting to p3 is not compositing in p3.
- **Should a system declare whether it is a ramp or a palette?** Would
  resolve the ΔE-on-a-palette problem honestly rather than per-algorithm
  render code. Confirmed empirically once `compose` shipped: the dev server
  prints a ΔE between `blush` and `blush@100`, and again between `blush@100`
  and `sky`, neither of which means anything on a palette of unrelated hues.
  Harmless — it is display only. Still not worth building yet; it is now a
  known leak rather than a suspected one.
