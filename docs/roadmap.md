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

### `blend` (was `compose`)

`src/algorithms/blend.ts`. Params `base` (required hex) and `toward` (name →
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
dead: quantization amplifies by 1/α, so at 3% a ±0.5 rounding error becomes
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

### Color tools in the dev server

`/colors` is a picker: a space dropdown (OKLCH / OKLab / sRGB / P3), a 2D
field parameterized by that space with the sRGB gamut boundary drawn as a
contour, and a third-axis slider painted with the colors it selects. It
reports the expected ΔE of any gamut mapping, so "these look the same" can be
distinguished from "this display is not showing P3" — with a primaries strip
as the calibration.

`/blend` shows one mix carried out in all four spaces at once.

Both `import` from `/color-math.js`, which the dev server serves straight out
of `dist/` — it has no node specifiers, so the pages and the emitters run the
same implementation rather than a second copy.

The gamut layer under them: `inGamut`, `gamutMap` (CSS Color 4 chroma
reduction), `maxChroma`, `encodeIn`, `formatIn`, `mixIn`, OKLab↔OKLCH. The
primary matrices are derived from primaries and a shared D65 rather than
pasted, because published rounded matrices do not share a white point and
white landed at 1.00013 in P3 — which made every in-gamut check near white a
coin toss.

### One seam, recorded

`color-math` owns color; algorithms own vocabulary. Measured before
deciding: `overlay` is 23 lines of its own and contains no arithmetic,
`ink-ramp` 53, `oklch-scale` 63, `blend` 171 of which roughly 70 is preview
UI — against 351 lines of primitives. The architecture was already this; what
was missing was the rule written down and one leak closed.

The leak: formatting a translucent color existed in four places (three
algorithms and the resolver) and they disagreed about whether alpha arrived
as a percent or a fraction. Now `translucent()` in `color-math`, with a test
asserting all three algorithms agree.

Rejected: folding `ink-ramp`/`overlay` into `blend` as configuration. They
compute the same bytes but define different selector grammars, and
`--color-light-15` only reads as "15% ink" because ink-ramp's selector is a
bare number. Configuration that changes syntax is worse than four small files.

### Wide-gamut input and output

`parseColor` replaced `assertHex`, so a definition can anchor on
`oklch(L C H)`, `oklab(L a b)`, `color(srgb ...)` or `color(display-p3 ...)`
as well as hex. A color keeps the space it was written in rather than being
canonicalized, and a transform runs in the widest gamut its inputs use — one
P3 anchor widens the whole operation, because compositing it in sRGB would
clip it before the arithmetic ran. Observable: P3 red at 60% over white lands
on `#ff7070`, where sRGB red lands on `#ff6666`.

Emit writes those colors twice. The sRGB pass gamut-maps them as before, then
an `@supports (color: color(display-p3 1 1 1))` block redefines the same
custom properties at full strength — so consumers are untouched, and a browser
that cannot parse `color()` keeps the fallback. Only values that actually
leave sRGB are repeated; a definition authored entirely in sRGB emits no layer
at all, which is why both real definitions stayed byte-identical.

This retired the `emittable` flag on `BLEND_SPACES`, whose whole purpose was
gating `display-p3` until this fallback existed. All four blend spaces are
now selectable.

DTCG values moved to the stable 2025.10 color object — `{colorSpace,
components, alpha?, hex}` — where a plain hex string is no longer valid.
`components` is an RGB triple 0..1, which is exactly what Figma's plugin API
takes, so a courier writes it in with no conversion.

Every color in one emit shares a single `colorSpace`, set by
`outputs.dtcg.colorSpace` or `--dtcg-color-space` (default `srgb`). That is
not a simplification: Figma holds one color profile per *document* and
interprets every stored triple in it, so a value tagged with some other space
would have to be converted on the way in, and choosing per color by what fits
would make that per token. The space is a property of the destination file,
not of the color.

`hex` byte-encodes those same components rather than rendering the color into
sRGB. Figma's own hex field is document-relative — it shows the stored triple,
whatever profile reads it — so a hex pinned to sRGB would disagree with what
Figma displays. It is derived from the *rounded* components so a consumer that
byte-encodes them itself lands on the same value; `sky/3` sits exactly on 242.5
and would otherwise round one way from the float and the other from the
published component.

The consequence to know: an in-gamut color gets different components in each
space — `#b30a0a` is `[0.702, 0.039, 0.039]` in srgb and
`[0.643, 0.142, 0.104]` in display-p3, hex `#b30a0a` and `#a4241b`. The same
color; wider primaries need less of them.

### What Figma actually does with it

Tested against Figma Desktop through the figma-console MCP, 2026-08-21:

- **`colorSpace: "srgb"` imports `components` directly**, at full float
  precision — hex is not needed and hex's 8 bits would be a downgrade.
- **`colorSpace: "display-p3"` is refused.** With `hex` present the importer
  uses it; without one it *skips the value and leaves the variable white*,
  which is worse than being wrong because it looks deliberate. This is why hex
  has to byte-encode components: it is the only channel a P3 export has.
- **Import never converts.** It writes raw numbers, so they must already be in
  the document's profile.
- **`documentColorProfile` is readable but has no setter** — an agent cannot
  put a file into P3, a person must, and Figma's own dialog offers Convert
  (rewrite values, keep appearance) or Assign (keep values, change appearance).
  Convert quantizes everything to 8 bits.
- Figma's own sRGB→P3 conversion matches `color-math.ts` byte for byte on
  every color tried (`#b30a0a`→`#a4241b`, `#ff0000`→`#ea3323`,
  `#ff3428`→`#eb4938`), and a P3 export re-imported into a converted document
  lands bit-identical to what Figma produced itself.

### The mode axis is a rendering, not a structure

Three emitters were each answering "what do I do with N values per role" their
own way — CSS made selectors, DTCG made a mode map, and a flat Sass emitter
would have made separate files. A fourth format would have invented a fourth
answer. That is a grammar/output mismatch, and adding an emitter per output
shape is brute force.

So the axis is named and chosen instead: `nested` puts each mode in its own
structure and the consumer picks by being inside it; `flat` folds the mode into
the name and the consumer picks by naming it. Set per output —
`outputs.css.modes`, or `--css-modes`.

A format supports what it can express. CSS does both and defaults to `nested`,
since the cascade is the point of custom properties. **SCSS is flat and only
flat** — a Sass variable is compile-time and has no structure to nest a mode
into. That is not a limitation to route around: a project whose themes are
separate stylesheets, chosen server-side, gets nothing from runtime
indirection. `emitScss` is a format, not a second structural answer, which is
why it is about twenty lines.

## Later

- **Write the definition back from the browser.** The tuner already renders
  an algorithm's params as live controls and re-runs the algorithm
  server-side; what is missing is the return path — POST a param change and
  have the server rewrite the definition comment-preservingly, via the yaml
  document API. The file stays the single source of truth and the browser
  becomes another editor of it. Needs the param schema below to know which
  controls are safe to write.
- **Param schema on `AlgorithmImpl`.** One construct, three jobs: subsumes
  `assertKnownParams` (including nested params like blend's `toward`), tells
  `render.ts` that a param is a color instead of guessing with the
  `/^#[0-9a-fA-F]{6}$/` heuristic in `paramValue`, and supplies the control
  type and range that in-browser tweaking needs. Prerequisite for the
  tweaking item already on the README roadmap. Worth designing before
  blend hardens, since it sets the nested-param precedent.
- **Gradients as a composition tier** above roles, not an algorithm.
  Gradient stops stay refs, so CSS emits a live
  `linear-gradient(178deg, var(--blush-4) 0%, …)`. Geometry (angle, stop
  positions) joins the parameter space.
- **Themes with inheritance.** `resolve.ts:428` enforces one ref per mode,
  which forces N-way duplication when a variant only differs in a few
  values. Wanted shape is `extends` plus overrides; CSS then emits the base
  in `:root` and each theme as a class carrying only its divergences, with
  the cascade performing the inheritance. A themeable `base` on blend
  turns a light/dark pair into one system.
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
- ~~What space does the blend happen in?~~ **Answered.** It is a declared
  param, `space`, defaulting to `srgb`. The four options are CSS's own
  interpolation spaces and they land in genuinely different places: the same
  anchor at 6% over white gives `#faf0f0` in srgb, `#fbf8f8` in srgb-linear,
  `#fdf2f0` in oklab. Only srgb reproduces what a browser or design tool
  renders, which is why it is the default and why fifthrevision needs it.
  Two findings settled it. Mixing toward a neutral is a *radial* path in
  OKLab's (a,b) plane — white is exactly (1,0,0) — so OKLab holds hue to four
  decimals where srgb rotates it 11°. And a P3 output is not a re-encoding of
  the srgb output, it is the same recipe re-run in P3, so the compositing
  space follows the output target rather than being a separate choice.
- **Should a system declare whether it is a ramp or a palette?** Would
  resolve the ΔE-on-a-palette problem honestly rather than per-algorithm
  render code. Confirmed empirically once `compose` shipped: the dev server
  prints a ΔE between `blush` and `blush@100`, and again between `blush@100`
  and `sky`, neither of which means anything on a palette of unrelated hues.
  Harmless — it is display only. Still not worth building yet; it is now a
  known leak rather than a suspected one.
