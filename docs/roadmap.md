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

### DTCG emit

`emitDtcg` in `src/emit.ts`, opt-in via `outputs.dtcg` or `--dtcg` so no
project grows an artifact it did not ask for.

**The description is identity, not documentation.** The first pass had this
backwards — describing the recipe in `$description` and reserving
`$extensions` for machine data. The recipe is exactly the part that changes
when a name changes, so it is useless as a matching key. Inverted: a role's
description is its internal path (`label.primary`, unchanged when `omit`
emits it as `label`); a demand-driven step's is the roles that demand it
(`state.selected[light], label.primary[dark]`), unchanged when the
coordinate renumbers; a declared stop's is its ref. `$extensions` holds the
recipe, the public Figma name, per-mode values, and refs.

`changelog` is a reserved top-level key, validated for shape and never
interpreted, passed through to the DTCG root. Prose rather than a rename
schema: a changelog is *read*, a migration map is *executed*, and an
incomplete changelog is still useful where an incomplete migration map
silently corrupts bindings.

`buildLineage` moved from `render.ts` to `resolve.ts` — it is a fact about
the definition, not a preview concern, and the emit layer should not depend
on the preview layer.

### The systems tree and contained params

`systems` became a tree: a string is a constant, an object with `algorithm`
is a system, any other object is a group, and groups nest. Constants are
addressable by dotted path (`ink.body`) and referenceable from a role, which
retired the palettes-used-only-at-100% fiction that `compose` was being bent
into. Algorithm params moved into their own `params` block, so the reserved
key list can grow without colliding with a parameter name. Both old shapes
error with a pointer.

One meaning per separator: `.` navigates a namespace, `/` hands off to an
algorithm. That rule survives nesting — `palettes.sky/3` parses without
ambiguity — and it is why constant paths and role paths share a shape and
must not collide.

### The uncomposited form moved into the selector

`transparent(system/selector)` and the `resolveTranslucent` hook are gone.
An algorithm that composites publishes its layer as an ordinary selector —
`sky/3/ink`, `warm/red@6/top` — named from its own params.

The reason is that a core function's syntax promised generality it could not
have: `X(ref)` looked like it took any color but only worked on algorithms
that composite, and nothing at the call site said which those were. Two
alternatives were rejected on evidence. An explicit ground argument
(`unflatten(sky/3, sky.base)`) is decorative, because the ground is
determined by the ref. Recovering the layer by subtraction is numerically
dead: quantisation amplifies by 1/α, so at 3% a ±0.5 rounding error becomes
±16.7 per channel and `#001a28` comes back as `#111437`.

`transparent(name 70)` survives for constants, where it is a genuine pure
function of a color and an amount. The contract shrank: one method and one
grammar form removed, nothing added.

### Tests

`pnpm test` builds, then runs `node --test` over `test/*.test.ts` — 33 tests,
no new dependencies. They import from `dist/`, since Node's type stripping
does not remap a `.js` specifier onto a `.ts` file; building first means a
stale artifact cannot give a false pass, which is the failure mode that
fooled the dev server three times in one session.

Coverage is weighted to the grammar: every ref form, alias-versus-identity,
the params block, the constant/role collision, circular roles, ref counts,
raw hex, the comma diagnostic, determinism. One test pins a real regression —
deriving a public name from the parsed float turned `3.5` into
`3_5000000000000004`, and only Sunnyday's use of a fractional alpha caught it.

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
- **The bespoke `figma.json` payload is deleted**, once DTCG carried
  everything it did — collections (via group `$extensions`, aliases
  applied), modes, values, aliases. It was also the last always-on output,
  which is how an unasked-for artifact ended up untracked in Sunnyday's
  repo. `outputs.figma` now errors with a pointer to `dtcg`, following the
  repo's convention for removed spellings. The `figma` alias target stays:
  DTCG is what feeds Figma, so `alias: { css: light, figma: Light }` still
  means what it always did.

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
