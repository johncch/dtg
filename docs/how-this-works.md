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
- `modes: [light, dark]` sets the order role ref tuples are read in.
- `systems`: `name → hex` for a static, or `name → { algorithm, ...params }`.
  Reserved keys addressed to the tool, never the algorithm: `algorithm`,
  `alias` (public-name override), `overrides` (selector → hex, pinning a
  step's flattened value). Every other key passes through untouched.
- `defaults`: shared params per algorithm, merged under each system's own
  params. One copy of each number.
- Sections: every top-level key other than `dtg`/`modes`/`defaults`/`systems`
  is a section. Arbitrary name, becomes a Figma collection, holds
  `domain → role → [ref per mode]`. A role may also be
  `{ refs, alias?, omit? }`. `alias` (on the systems block, a system, a
  section, a domain, or a role; string or per-target map) replaces a public
  name; `omit: true` drops a segment. Refs always use internal names. That is
  the *entire* role grammar. No flags, no options, no other object form.
- A **ref** is one of:
  - `system/selector`, where everything after the slash belongs to the
    algorithm (`sky/3.5` is 3.5% ink over base, `theme/600` is a stop name,
    `shadow/40` is a 40% opacity overlay)
  - `domain.role`, aliasing another semantic decision in the same mode
  - `transparent(system/selector)`, the step's unflattened form
- **Raw hex is legal only inside `systems`.** The semantic tier points and
  derives; every color traces back to an anchor. This is the core invariant:
  a literal is a value that has forgotten its reason.

Two removed spellings are still detected and error with a pointer, rather
than being silently ignored: a top-level `emit:` block (replaced by inline
`alias`/`omit`) and `emits:` on a system (renamed to `alias`). Keep that
pattern for any future grammar change.

## Algorithms

Three built-ins, each *total*, with no optional-parameter modes.

- **`ink-ramp`** (`base`, `ink`, both required): ink composited over base;
  the selector is the ink's alpha percent. The token name doubles as the
  recipe, so `light-15` is 15% ink. Steps are opaque surface colors, and the
  ramp also backs `transparent()`.
- **`oklch-scale`** (`base`, `toward: [light, dark]`, `hueShift`, `stops`):
  blends from the 500 base in OKLCH. Stop names are numeric; below 500 blends
  toward `toward[0]`, above toward `toward[1]`, and a stop's value is the
  fraction of base remaining (1 being the base itself). `hueShift` 0 locks
  every stop to the base hue, 100 follows the natural interpolated hue path.
- **`overlay`** (`color`): color at selector % opacity, never flattened.
  Shadows and scrims. This is why `shadow` is not a baseless ink-ramp: what
  kind of value a system produces is the **algorithm's nature**, declared
  once in the systems block, never a per-role flag.

### The algorithm contract

`src/contract.ts` defines `AlgorithmImpl`:

- `description` is one short paragraph, rendered in the browsing UI.
- `declaredSelectors(params)` returns the selectors this system publishes
  regardless of demand (a public palette), or `null` for demand-driven
  systems whose steps exist only because refs ask for them. Call
  `assertKnownParams` from here so param typos fail once per system rather
  than silently.
- `resolveStep(params, selector)` returns `{ css, opaque }` and throws with a
  human-readable message on a bad selector or bad params.
- `resolveTranslucent(params, selector)` is optional. Its absence means the
  system has nothing to unflatten, and `transparent()` on it is an error.

`transparent()` is an algorithm *capability*, not a generic color function,
because flattening destroys information: you cannot recover ink and alpha
from a flattened hex. The system re-runs the recipe and stops before
compositing.

The registry is open. `resolveDefinition(yaml, extraAlgorithms)` merges
project algorithms over built-ins, so a project can bring its own generation
methods, or shadow a built-in by name.

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
   (`primary-translucent: [transparent(sky/15), ...]`), so twinship stays
   recoverable by inspection.
5. **Overrides pin flattened hexes only.** `transparent()` always follows
   pure ink math, and the resolver warns when the two overlap. Hand-tunes are
   explicit, visible, and survive regeneration. Exceptions either get
   promoted into the system later or stay flagged, never silent.
6. **Demand-driven primitives.** An ink-ramp step exists because a ref
   demands it; there is no maintained step list. Declared palettes
   (oklch-scale stops) are the exception, emitting in full as public
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
- `config.ts` — `dtg.yaml` and convention discovery. Precedence is CLI flags,
  then `dtg.yaml`, then defaults.
- `resolve.ts` — the grammar lives here. YAML in, `ResolvedDefinition` out
  (systems with their steps, statics, sections, roles with a ref per mode,
  plus accumulated warnings). Public-name resolution is here too:
  `aliasedName`, `publicSystemName`, `publicRoleName`.
- `contract.ts` — the `AlgorithmImpl` interface and `assertKnownParams`.
- `algorithms/` — the three built-ins.
- `color-math.ts` — hex parsing, compositing, and the OKLCH and OKLAB math.
- `emit.ts` — the CSS and `figma.json` emitters.
- `render.ts`, `dev-server.ts`, `watch.ts` — the browsing UI, its HTTP and SSE
  server, and definition file watching.

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
      naming is inline via `alias` and `omit`. Emit also writes `figma.json`:
      a deterministic variable payload (collections, modes, hex values,
      aliases by name) for a courier to replay. An agent may ferry the
      payload; it never invents values.
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
- [ ] Figma sync. `emit` already writes the payload (collections, modes,
      values, aliases by name, no file IDs). Delivery paths, ranked: (1) an
      agent courier replaying the payload through a plugin console, required
      for a first sync that must reconcile drifted names in an existing file,
      where renaming keeps variable IDs so mockups stay wired and anything
      ambiguous is skipped and reported; (2) the endgame, a thin plugin
      fetching `/figma.json` from the dev server, putting the reconcile loop
      behind a button inside Figma with no Enterprise plan and no agent; (3)
      DTCG export plus Figma's official import plugin is seed-only, since it
      only adds and never updates, so it cannot sync. Every path is Plugin
      API underneath: the REST variables API is Enterprise-only in both
      directions.
- [ ] `check` command: definition versus emitted artifact drift, inert
      overrides, longhand-sugar detection.
- [ ] Custom algorithm loading from a project path. `resolveDefinition`
      already accepts a registry; the CLI does not load one yet.
- [ ] Playground (parked). The tool's edge over a picker is that play happens
      in parameter and ref space rather than color space. Candidates: a ΔE
      and contrast comparator that accepts refs rather than hexes (compare
      `sky/8` against `night/8`, asking whether the modes step at the same
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
