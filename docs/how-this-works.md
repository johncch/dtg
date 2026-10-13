# How dtg works

The design doc. The README argues *why* the system is shaped this way; this
file records *what was settled* and the reasoning behind it, so decisions do
not get quietly re-litigated. Read it before changing the grammar, the
resolver, or an algorithm.

## The two-tier model

**Systems** are color generators: an algorithm plus parameters, able to
produce colors on demand. **Semantic roles** are the design decisions: each
role points at system steps (or derives from them), one ref per mode.

There is deliberately no middle tier, no `elevation-1..4` scale sitting
between systems and roles. Intermediate taxonomies force every new need
through a classification argument before it can ship, and rigid tier systems
break down as a project evolves. Roles point directly into systems; the ref
itself carries the reasoning.

A large definition is a ceiling, not a floor. A new project starts around
fifteen lines and grows one line at a time. **Tooling must never assume any
section, domain, or role exists.** It renders and emits exactly what is
declared.

## The grammar

Canonical. The README carries the user-facing version of the same rules.

- `dtg: 1` is the grammar version. The resolver assumes 1 with a warning when
  absent, and errors on versions it does not understand.
- `modes: [light, dark]` sets the order role ref tuples are read in. The
  longform is a map, `light:` / `dark-hc: { extends: dark, scheme: dark }`,
  both keys optional. A mode with no `extends` is a **root** and names every
  color. A mode that extends another says only what differs: a role tuple
  must reach the last root mode, modes after it may be left off, and `~`
  holds the place of an extending mode that says nothing. A silent mode takes
  its parent's *ref*, resolved again in its own mode, so overriding one role
  moves every role pointing at it. A parent is declared above its child. A
  mode name cannot be a number: a map hands number-like keys back sorted, and
  mode order decides which ref lands in which mode. `scheme` (`light` or
  `dark`) is declared, never read off the name, and comes along through
  `extends`.
- How `extends` reaches each format. Nested CSS selects a mode's block for
  the mode and everything extending it (`.dark, .dark-hc { … }`), then the
  child's block holds only what it declared; `scheme` becomes
  `color-scheme` in that block. Flat CSS and SCSS have no cascade, so they
  leave out a role only when its value is its parent's by construction — an
  inherited role whose target moved is written. DTCG fills every mode and
  records `inherits: { dark-hc: dark }`. What applies `.dark` to an element
  is the app's business, not the definition's.
- `systems` is a tree of three node kinds, discriminated without extra
  syntax: a **string** is a constant, an object with **`algorithm`** is a
  system, any other object is a **group**. Groups nest, so a constant's
  identity is its dotted path.
- A system node's keys are the tool's: `algorithm` (a string naming it),
  `params` (the algorithm's inputs, in their own block), `alias`,
  `overrides`. Params are contained rather than passed through, so the
  reserved list can grow without colliding with a parameter name.
- `defaults`: shared params per algorithm, merged under each system's own
  params. One copy of each number.
- Sections: every top-level key other than
  `dtg`/`modes`/`defaults`/`systems`/`changelog` is a section. Arbitrary
  name, becomes a collection, holds `domain → role → [ref per mode]`. A
  role may also be `{ refs, alias?, omit? }`. `alias` (on a group, a
  system, the systems block, a section, a domain, or a role; string or
  per-target map) replaces a public name; `omit: true` drops a segment.
  Refs always use internal names. That is the *entire* role grammar. No
  flags, no options, no other object form.
- A **ref** is one of:
  - `paper`, `ink.body` — a constant by path
  - `system(selector)` — dots walk the tree, the parentheses hand off, and
    everything inside them belongs to the algorithm, its parts separated by
    spaces (`sky(3.5)` is 3.5% ink,
    `sky(3 tint)` that ink uncomposited, `theme(600)` a stop name,
    `warm(red 6)` a compose anchor at 6%)
  - `domain.role` — another decision in the same mode
  - `transparent(paper 70)` — a constant at an opacity, constants only.
    It is written like a system and read by the same parser, so no system
    can be named `transparent`
- **One meaning each: `.` navigates, parentheses hand off.** Inside them,
  spaces separate, as in CSS's own color functions — a comma would end the
  item in a `[ ]` list and force quotes around every ref. A constant
  path and a role path are the same shape, so the two namespaces must not
  collide; the resolver errors if they do.
- **Raw hex is legal only inside `systems`.** The semantic tier points and
  derives; every color traces back to an anchor. This is the core invariant:
  a literal is a value that has forgotten its reason.

Removed spellings are still detected and error with a pointer, rather than
being silently ignored: a top-level `emit:` block (replaced by inline
`alias`/`omit`), `emits:` on a system (renamed to `alias`), the algorithm
names `ink-ramp` and `oklch-scale` (now `tint` and `scale`), and the slash
spelling of a ref (`sky/3/ink`, now `sky(3 tint)`), where the error spells out
the replacement. Keep that pattern for any future grammar change.

## Algorithms

Three built-ins, each *total*, with no optional-parameter modes.

- **`tint`** (`base`, `tint`, both required): a tint composited over base;
  the selector is the tint's alpha percent. The token name doubles as the
  recipe, so `light-15` is 15% ink. Steps are opaque surface colors, and the
  ramp also backs `transparent()`.
- **`scale`** (`base`, `toward: [light, dark]`, `hueShift`, `stops`):
  blends from the 500 base in OKLCH. Stop names are numeric; below 500 blends
  toward `toward[0]`, above toward `toward[1]`, and a stop's value is the
  fraction of base remaining (1 being the base itself). `hueShift` 0 locks
  every stop to the base hue, 100 follows the natural interpolated hue path.
- **`overlay`** (`color`): color at selector % opacity, never flattened.
  Shadows and scrims. This is why `shadow` is not a baseless tint: what
  kind of value a system produces is the **algorithm's nature**, declared
  once in the systems block, never a per-role flag.

### The seam: color-math owns color, algorithms own vocabulary

`color-math.ts` holds every arithmetic operation and every color format.
An algorithm declares its params, declares what its selector is made of,
turns a selector into a color, and describes itself. Nothing else.

The algorithm chooses the vocabulary — which fields a selector has, what
they are called, which forms it offers. How a selector is *written* is
dtg's, in `selector.ts`, and so are the public name, the ordering and the
error messages that follow from it. This was reopened on purpose on
2026-10-12: algorithms used to parse their own selector text, which left
dtg able to read a ref but not to explain, draw or write one.

This is why the built-ins look redundant and are not. `tint` with one
ink, `blend` with one color to blend toward, and `overlay` all produce
byte-identical values — `rgba(0, 26, 40, 0.03)` for the same input, verified
in the tests. They differ in what a *reader* sees:

    tint      sky(3)          emits --color-light-3
    blend     sky(ink 3)      emits --color-light-ink-3
    overlay   shadow(3)       never flattens, and says so declaratively

`--color-light-15` only reads as "15% ink" because tint declares a
selector of one number. Folding these into one configurable algorithm would
put the selector's shape behind a param — configuration that changes syntax,
which is harder to read than four separately-named files of twenty to sixty
lines.

The failure mode to watch is the opposite one: arithmetic drifting *up* into
the algorithms. It has happened twice. `publicStep` was derived in three
places and one copy silently emitted a broken Figma alias. Formatting a
translucent color was implemented four times — three algorithms and the
resolver — and they disagreed about whether alpha arrived as a percent or a
fraction. Both are now single functions in `color-math.ts`. If you find
yourself writing color arithmetic or a color string inside
`algorithms/`, it belongs one level down.

### The algorithm contract

`src/contract.ts` defines `Algorithm`:

- `name` is what a system's `algorithm:` names.
- `description` is one short paragraph, rendered in the browsing UI.
- `params` declares each param's kind: a color, a number, a choice, or a
  list or map of those. dtg checks a system's params against it once —
  unknown, missing and malformed params all fail there — and hands every
  hook the parsed result: colors as colors, defaults filled in. It is also
  how dtg knows which params are colors, for the gamut warnings and for the
  browsing UI; the resolver adds whether each came from the system's own
  `params` or the shared `defaults` block.
- `selector(params)` returns the selector's shape: its `fields` in written
  order (a number in a range, or a choice among options the params supply)
  and the `forms` it offers.
- `emit` is optional: `"all"` writes out every option of a system's
  selector regardless of demand (a public palette); `"demanded"`, the
  default, writes only the steps refs ask for. It is neither a param nor
  part of the selector: it changes no color, and dtg reads it to decide
  what exists. What can be *addressed* is a separate matter and is the
  selector's — a list of stops, or any number in a range.
- `resolve(selector, params)` returns a color. The selector arrives parsed,
  one value per field plus `form`. It throws with a human-readable message
  on a selector the system cannot produce.
- `workingGamut(params)` is optional: the gamut the arithmetic runs in, when
  it has a fixed one.
- `preview` is optional and holds `shape`: a ramp, where neighbor deltas
  mean something, or a palette, where they do not.

There are no naming or ordering hooks. A step's public name is its fields
joined by `-`, then the form (`sky(3.5 tint)` emits as `3_5-tint`), and steps sort
field by field with the plain value before its forms. Add a hook when an
algorithm needs something else, not before.

An algorithm that composites publishes its layer as a further selector —
`sky(3 tint)`, `warm(red 6 top)`. That is not a core function, and was
deliberately not made one: `X(ref)` would promise it works on any color
while only working on algorithms that composite, with nothing at the call
site to say which. It cannot be a transformation of the output either,
because flattening destroys information: you cannot recover ink and alpha
from a flattened hex. The system re-runs the recipe and stops before
compositing.

The registry is open. `resolveDefinition(yaml, extraAlgorithms)` merges
project algorithms over built-ins, so a project can bring its own generation
methods, or shadow a built-in by name. Nothing loads one yet; the design for
doing so is in `project-algorithms.md`.

## Rules the design settled (and why)

1. **Rigidity comes from closed sets, so every set is open.** Sections,
   domains, roles, systems, algorithm params, selectors. What is fixed is
   only the plumbing contract that lets tooling stay generic.
2. **Determinism is non-negotiable.** Same definition, same bytes. The
   definition is data (YAML, no computation); expressions are parsed, never
   evaluated as code.
3. **Explicit over inferred.** A role's emitted value must be readable from
   its own line plus the systems block, never inferred from what a system
   happens to support, so an edit on one side cannot silently reinterpret the
   other.
4. **No sugar in the role grammar.** `translucent: true` (auto-twin) was
   designed and then deliberately killed: uniform `name: [refs]` beats saving
   two lines. Twins are declared as sibling roles
   (`primary-translucent: [sky(15 tint), ...]`), so twinship stays
   recoverable by inspection.
5. **Overrides pin flattened hexes only.** The uncomposited form always
   follows pure ink math, and the resolver warns when the two overlap. Hand-tunes are
   explicit, visible, and survive regeneration. Exceptions either get
   promoted into the system later or stay flagged, never silent.
6. **Demand-driven primitives.** A tint step exists because a ref
   demands it; there is no maintained step list. Declared palettes
   (scale stops) are the exception, emitting in full as public
   utilities. `transparent()` demands only the unflattened form, not the
   opaque step.
7. **Repetition is a promotion signal.** A derivation appearing twice is a
   named system trying to be born. New functions and algorithms arrive when a
   caller exists, never for symmetry. No generic `alpha()` until something
   needs it.

## Code map

ESM TypeScript in `src/`, with explicit `.js` extensions on relative imports
(NodeNext). `pnpm build` compiles to `dist/`; the `dtg` bin is `dist/cli.js`.
Consumers run `dist/`, so rebuild after edits or they see stale code.

- `cli.ts` — command dispatch and flag parsing for `dev` and `emit`.
- `outputs.ts` — writing the configured outputs for a resolved definition.
  `emit` calls it once, or on every change with `--live`; `dev --emit` calls
  it whenever the definition file changes. Outputs follow the file on disk,
  never the working copy's unsaved edits. Writing outputs is always an
  explicit action — `dtg emit`, or the `--emit` flag on one `dev` run. No
  setting in `dtg.yaml` can turn it on: a config file must not be able to
  overwrite the files an app ships.
- `config.ts` — `dtg.yaml` and convention discovery. Precedence is CLI flags,
  then `dtg.yaml`, then defaults.
- `resolve.ts` — the grammar lives here. YAML in, `ResolvedDefinition` out
  (systems with their steps, statics, sections, roles with a ref per mode,
  plus accumulated warnings). Public-name resolution is here too:
  `aliasedName`, `publicSystemName`, `publicRoleName`.
- `contract.ts` — the `Algorithm` interface.
- `params.ts` — a system's params checked against what its algorithm
  declares, and parsed.
- `selector.ts` — how a selector is written, and the public name and
  ordering that follow from it. The only file that knows the spelling.
- `algorithms/` — the three built-ins.
- `color-math.ts` — hex parsing, compositing, and the OKLCH and OKLAB math.
- `emit.ts` — the CSS and DTCG emitters.
- `dev-server.ts`, `watch.ts` — the HTTP and SSE server and definition file
  watching. The server holds no markup: it serves one HTML shell, the built
  browser bundle, and `/api/snapshot`.
- `edit.ts` — writing one value into the definition's text: an authored
  color, or the ref a role holds for a mode. The
  new value is spliced over the old one's exact span, so an edit is the
  one-line diff a person would have typed; re-serialising the YAML restyles
  the whole file. A ref edit can also carry `~`, putting a mode back to
  inheriting; a ref for a mode past the end of the role's list is added to
  it, with `~` holding any modes in between.
- `dev-settings.ts` — what a project keeps under `dev` in `dtg.yaml` for the
  app's own use: today the backgrounds to view against. The dev server reads
  it, watches it, and writes it straight to the file when the Settings page
  changes it. It is config, not the definition, so it stays out of the
  working copy and its undo, and `emit` never reads it.
- `working-copy.ts` — the file's text plus the edits not yet written to it.
  An edit names a color, not a line, so unsaved edits survive the file
  changing underneath them. The dev server holds one working copy, draws the
  app from it, and writes the file only when asked to save.
- `snapshot.ts` — the definition as plain JSON for the browser. Anything that
  needs an algorithm or an alias is worked out here; colors travel as exact
  values and the browser formats them.
- `ui/` (outside `src/`) — the browsing UI, a React app bundled by Vite into
  `dist/ui/`. It imports `color-math.ts` directly, so the pages and the
  emitters run the same arithmetic.

Errors accumulate rather than throwing on the first problem, so one resolve
reports everything wrong with a definition. Keep that.

## Verification

There are no unit tests. Verification is the dev server plus, when adopting
an existing palette, **parity against the shipped stylesheet**: resolve the
definition, compare emitted primitives byte for byte, and chase every
semantic `var()` chain to its final value.

Parity is a strong acceptance test because a correct migration produces a
knowable diff, not zero diff. Expect three categories, and expect to justify
each one:

- unreferenced primitives disappearing under demand-driven emission
- hand-tunes that survive as declared `overrides`
- hand-drift the system deliberately absorbs, which is the class of bug the
  tool exists to prevent

Anything outside those three is a real defect. Promoting this check into a
`check` command is on the roadmap.

## Roadmap

- [x] Definition grammar, resolver, built-in algorithms
- [x] Browsing dev server (`dtg dev`): overview strips, a page per system
      with demanded-by lineage, algorithm description and params, and
      adjacent-step OKLAB ΔE; a page per domain with side-by-side modes.
      User-defined page backgrounds (named, localStorage-persisted, sidebar
      switcher) so colors are judged on a chosen ground, with chrome flipping
      to a dark scheme on dark backgrounds. Stdlib HTTP plus SSE live-reload
      on definition edits; a resolve error keeps serving the last good state
      behind an error banner. Restart to pick up changes to the tool's own
      code.
- [x] CSS emitter (`dtg emit`): `@theme` primitives block, `:root` and
      `.dark` semantic blocks, `@theme inline` wiring for every role. Public
      naming is inline via `alias` and `omit`. `format: plain` (the default)
      emits primitives into `:root` instead, for any project not on
      Tailwind. Emit also writes DTCG when asked: the same collections,
      modes, values and aliases, plus `$description` as a stable identity —
      a role's internal path, a demand-driven step's lineage — so a courier
      can tell a rename from a create. An agent may ferry the payload; it
      never invents values.
- [ ] Multi-file definitions (`shadows.dtg.yaml`, `type.dtg.yaml` as
      siblings, one resolver over all). Discovery exists; merging does not.
- [ ] Designer tweaking in the browser: controls POST param changes, the
      server rewrites the definition (comment-preserving, via the yaml
      document API), the watcher re-resolves, the page reloads. The file
      stays the single source of truth; the browser is just another editor
      of it.
- [ ] Studio preview: apply resolved variables onto the document root so real
      components render under a proposed palette, plus auto-generated
      specimens (nested surfaces, labels at small sizes on every surface, 1px
      separators, states) for the portable case.
- [ ] Figma sync. `emit` already writes the payload as DTCG (collections
      via `$extensions`, modes, values, aliases by path, no file IDs).
      Delivery paths, ranked: (1) an
      agent courier replaying the payload through a plugin console, required
      for a first sync that must reconcile drifted names in an existing file,
      where renaming keeps variable IDs so mockups stay wired and anything
      ambiguous is skipped and reported; (2) the endgame, a thin plugin
      fetching `/figma.json` from the dev server, putting the reconcile loop
      behind a button inside Figma with no Enterprise plan and no agent; (3)
      Figma's *official* DTCG import plugin is seed-only, since it only adds
      and never updates — emitting DTCG does not change that, it only makes
      the payload standard for our own courier. Every path is Plugin
      API underneath: the REST variables API is Enterprise-only in both
      directions.
- [ ] `check` command: definition versus emitted artifact drift, inert
      overrides, longhand-sugar detection.
- [ ] Custom algorithm loading from a project path. `resolveDefinition`
      already accepts a registry; the CLI does not load one yet.
- [ ] Playground (parked). The tool's edge over a picker is that play happens
      in parameter and ref space rather than color space. Candidates: a ΔE
      and contrast comparator that accepts refs rather than hexes (compare
      `sky(8)` against `night(8)`, asking whether the modes step at the same
      rate); generated candidate ramps from structured randomization of
      algorithm params, rendered beside the current system with delta rows
      aligned; more generally, ephemeral browser-only systems with full
      instrumentation, promotable into the definition when they win. This
      subsumes the tweak panel, since a tweak is a one-parameter candidate.

## Process

Decisions in this file were reached deliberately and should be treated as
settled unless reopened on purpose. Extend the system the same way: agree on
the shape first, build in small steps, verify after each. The definition file
is the unit of change. If a proposed feature cannot be expressed as "edit one
line of YAML, regenerate," question the feature.
