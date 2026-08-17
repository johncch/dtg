# How the color system works

`design/` holds a code-first design-token system: the color palette as
**decisions in one file** (`colors/definition.yaml`), compiled
deterministically into everything downstream — CSS variables, studio
previews, Figma variables. It replaces the old workflow (generate colors in
a standalone app → paste into Figma → re-export to CSS), where the
*reasoning* behind every value evaporated at each boundary.

The right mental model is dbt, not a design tool: the definition file is
the models, refs are `ref()`, algorithms are macros, the resolver is
`compile`, emitters are materialization. Deterministic compilation of
declarative decisions, with docs and previews derived from the graph. AI's
role in the pipeline is editing the definition and ferrying outputs — it
never invents a color value; generation is code.

This is **tooling, not a Sunnyday feature**. Nothing under `app/` imports
it; the app consumes only generated artifacts. See "Tool / client split"
below.

## The two-tier model

**Primitives** are color *systems*: an algorithm plus parameters that can
produce colors on demand. **Semantic roles** are the design decisions: each
role points at primitive steps (or derives from them), one ref per mode.

There is deliberately no middle tier (no `elevation-1..4` scale between
primitives and semantics). Intermediate taxonomies force every new need
through a classification argument before it can ship, and rigid tier
systems break down as projects evolve. Semantic roles point directly into
systems; the ref itself carries the reasoning.

Sunnyday's definition is large because it transcribes months of accumulated
decisions — **it is a ceiling, not a floor**. A new project starts with ~15
lines and grows one line at a time. Tooling must never assume any domain or
role exists; it renders and emits exactly what is declared.

## The grammar

The complete grammar (also documented in the definition file's header):

- `dtg: 1` — the grammar version (added pre-0.1.0; resolver assumes 1 with
  a warning when absent).
- `modes: [light, dark]` — role ref tuples read in this order.
- `primitives`: `name → hex` (a static) or `name → { algorithm, ...params }`.
  Reserved keys addressed to the tool, never the algorithm: `algorithm`,
  `emits` (public-name override, e.g. sky publishes as `light` to keep
  shipped CSS names stable), `overrides` (selector → hex, pins a step's
  flattened value). Every other key passes through to the algorithm
  untouched.
- `defaults`: shared params per algorithm, merged under each primitive's
  own params. One copy of each number.
- Sections: every top-level key other than dtg/modes/defaults/systems is
  a section (arbitrary name, becomes a Figma collection) holding
  `domain → role → [ref per mode]`. A role may also be
  `{ refs, alias?, omit? }`. `alias` (on systems, sections, domains,
  roles; string or per-target map) replaces a public name; `omit: true`
  drops a segment. Refs always use internal names. That is the *entire* role
  grammar — no flags, no options, no object form.
- A **ref** is one of:
  - `system/selector` — everything after the slash belongs to the
    algorithm (`sky/3.5` = 3.5% ink over base; `theme/600` = a stop name;
    `shadow/40` = 40% opacity overlay)
  - `domain.role` — alias another semantic decision (same mode)
  - `transparent(system/selector)` — the step's unflattened form
- **Raw hex is legal only inside `primitives`.** The semantic tier points
  and derives; every color traces back to an anchor. This is the system's
  core invariant — a literal is a value that has forgotten its reason.

## Algorithms

Three built-ins, each *total* (no optional-parameter modes):

- **`ink-ramp`** (`base`, `ink`, both required): ink composited over base;
  selector = ink alpha %. The token name doubles as the recipe: `light-15`
  is 15% ink. Steps are opaque surface colors; the ramp also backs
  `transparent()`.
- **`oklch-scale`** (`base`, `toward: [light, dark]`, `hueShift`, `stops`):
  blend from the 500 base in OKLCH. Stop names are numeric: < 500 blends
  toward `toward[0]`, > 500 toward `toward[1]`; the stop's value is the
  fraction of base (1 = the base itself). `hueShift` 0 locks every stop to
  the base hue; 100 follows the natural interpolated hue path.
- **`overlay`** (`color`): color at selector % opacity, never flattened.
  Shadows and scrims. This is why shadow is *not* a baseless ink-ramp: what
  kind of value a system produces is the **algorithm's nature**, declared
  once in the primitives block — never a per-role flag.

The registry is open: `resolveDefinition(yaml, extraAlgorithms)` merges
project algorithms over built-ins, so each project can bring its own
generation methods (or shadow a built-in by name).

`transparent()` is an algorithm *capability* (`resolveTranslucent`), not a
generic color function, because flattening destroys information: you cannot
recover `rgba(ink, α)` from the flattened hex. The system re-runs the
recipe and stops before compositing. Algorithms without an unflattened form
(oklch-scale, overlay — whose steps are already unflattened) reject it.

## Rules the design settled (and why)

1. **Rigidity comes from closed sets, so every set is open**: domains,
   roles, systems, algorithm params, selectors. What's fixed is only the
   plumbing contract that lets tooling be generic.
2. **Determinism is non-negotiable.** Same definition → same bytes. The
   definition is data (YAML, no computation); expressions are parsed, not
   evaluated as code.
3. **Explicit over inferred.** A role's emitted value must be readable from
   its own line plus the primitives block — never inferred from what a
   primitive happens to support, so an edit on one side can't silently
   reinterpret the other.
4. **No sugar in the role grammar.** `translucent: true` (auto-twin) was
   designed and then deliberately killed: uniform `name: [refs]` beats
   saving two lines. Twins are declared as sibling roles
   (`primary-translucent: [transparent(sky/15), ...]`) — twinship is
   recoverable by inspection.
5. **Overrides pin flattened hexes only.** `transparent()` always follows
   pure ink math (the resolver warns when they overlap). Hand-tunes are
   explicit, visible, and survive regeneration; exceptions either get
   promoted into the system later or stay flagged, never silent.
6. **Demand-driven primitives**: an ink-ramp step exists because a ref
   demands it — there is no maintained step list. Declared palettes
   (oklch-scale stops) are the exception: they emit in full as public
   utilities. `transparent()` demands only the unflattened form, not the
   opaque primitive.
7. **Repetition is a promotion signal**: a derivation appearing twice is a
   named system trying to be born. New functions/algorithms arrive when a
   caller exists, never for symmetry (no generic `alpha()` until something
   needs it).

## Sunnyday's parameters (provenance)

The definition was *recovered*, not invented: the shipped `app.css` palette
was numerically fitted in Aug 2026 and reproduces byte-exactly from three
anchors and one ink — sky base `#fafdff`, night base `#151c1f`, ink
`#001a28` (dark side of the chromatic scales blends toward the same ink),
hueShift 15. Facts a future session should not re-litigate:

- `sky/3` override (`#f3f8fb`): shipped slightly cooler than generated;
  hand-tuned, kept.
- Shipped `light-9_5` duplicated `light-8` — a paste bug; dropped
  (unreferenced). `light-2`'s old hand-tune also died unreferenced.
- Shipped dark `separator-secondary-translucent` was `0.07` against an
  opaque twin at step 8 — judged a hand-drift mistake and **absorbed** to
  `0.08`. The system exists to prevent exactly this class of drift.
- ~14 shipped primitives are unreferenced by any CSS or code and vanish
  under demand-driven emission. Expected, verified against a usage grep.
- The `emits: light/dark` renames keep shipped names stable; John may
  rename the keyword (and possibly the published names) later.

## Tool / client split

The tool is extracted: it lives at `~/Projects/dtg` as
**`@fifthrevision/dtg`** (dtg = design token generator), its own git repo
with its own README documenting the generic grammar and commands. Sunnyday
consumes it as a devDependency — currently `link:../../dtg` (axle-style
local dev); switch to the published registry version once John publishes
0.1.0. The `pnpm design` script invokes the `dtg` bin, whose defaults match
this repo's layout (`design/colors/definition.yaml`,
`app/colors.generated.css`).

What remains in this repo is the client side only:

```
design/
  colors/      ← Sunnyday's definition.yaml + figma.json (+ custom
                 algorithms/, the day one exists)
  how-this-works.md
```

Iterating on the tool itself happens in `~/Projects/dtg` (`pnpm build`
there; the link picks it up — the built `dist/` is what runs, so rebuild
after tool edits).

## Verifying changes

The acceptance test while migrating is **parity with shipped `app.css`**:
resolve the definition, compare emitted primitives byte-for-byte, and chase
every semantic `var()` chain to its final value. Current status: 75/75
primitives match; 77/78 semantic mode-values match (the one diff is the
absorbed `0.07`). Re-derive the check with a scratch script against
`resolveDefinition` — or promote it into the tool as a `check` command
(roadmap). Per repo convention there are no unit tests for design-system
work; the studio page and parity checks are the verification surface.

## Roadmap

- [x] Definition grammar + resolver + built-in algorithms
- [x] Browsing dev server (`pnpm design dev` → `dtg dev`, port 4401):
      overview strips, a page per system with
      demanded-by lineage, algorithm description (from the algorithm's
      `description` field) + params, and adjacent-step OKLAB ΔE; a page
      per domain with side-by-side modes. User-defined page backgrounds
      (named, localStorage-persisted, sidebar switcher) so colors are
      judged on a chosen ground; chrome flips to a dark scheme on dark
      backgrounds. Stdlib HTTP + SSE live-reload on definition edits;
      resolve errors keep serving the last good state with an error
      banner. Restart it to pick up changes to the tool's own code.
- [ ] Designer tweaking in the browser: controls POST param changes → the
      server rewrites definition.yaml (comment-preserving via the yaml doc
      API) → watcher re-resolves → reload. The file stays the single
      source of truth; the browser is just another editor of it.
- [x] CSS emitter (`pnpm design emit`): writes `app/colors.generated.css`
      (checked in, like `models.generated.ts`) — `@theme` primitives,
      `:root`/`.dark` semantic blocks, `@theme inline` wiring for every
      role. `app.css` imports it; the hand-maintained color sections are
      gone. Cutover verified var-by-var against the old file: 170 final
      values identical, 1 changed (the absorbed 0.07 separator alpha), 14
      unreferenced primitives dropped — exactly the predicted diff. Public
      naming is inline: `alias` on emitting keys, `omit: true` to drop a
      segment (label.primary + omit → --label). Emit also writes
      `design/colors/figma.json`: a deterministic variable payload
      (collections, modes, hex values, aliases-by-name) for a courier —
      an agent replaying it through figma-console's batch APIs now, a
      direct bridge client later. AI ferries the payload; it never
      invents values.
- [ ] Studio preview: apply resolved variables onto the document root so
      real components render under a proposed palette (edit YAML → HMR);
      auto-generated specimens (surfaces nested, labels at 13px/11px on
      every surface, 1px separators, states) for the portable case.
- [ ] Figma sync. `emit` already writes `design/colors/figma.json` (the
      payload: collections, modes, values, aliases-by-name — no file IDs).
      Delivery paths, ranked: (1) agent courier replaying the payload via
      figma-console batch APIs — required for the first sync, which must
      reconcile drifted names in the existing file (rename keeps variable
      IDs so mockups stay wired; skip-and-report anything ambiguous, incl.
      stale Figma-only roles like Label/Link, Surface/Tooltip,
      Label/Inverse/*, Surface/Background — John chose update-in-place +
      leave-and-report); (2) endgame: our own thin plugin fetching
      /figma.json from the dev server — the reconcile loop as a button
      inside Figma, no Enterprise, no agent; (3) DTCG export + Figma's
      official import plugin is SEED-ONLY — John confirms it only adds,
      never updates, so it can't sync. Every path is Plugin API underneath;
      the REST variables API is Enterprise-only both directions. First
      push deliberately deferred pending John's go.
- [ ] `check` command (drift, inert overrides, longhand-sugar detection)
- [ ] Rename `emits` (word TBD by John)
- [ ] Playground (idea, parked): the tool's edge over pickers is that play
      happens in parameter/ref space, not color space. Candidates: a
      ΔE/contrast comparator that accepts refs, not just hexes (compare
      sky/8 vs night/8 — "do my modes step at the same rate?"); generated
      candidate ramps (structured randomization of algorithm params)
      rendered side-by-side with the current system, delta rows aligned;
      generally, ephemeral browser-only systems with full instrumentation,
      promotable into definition.yaml when they win. Subsumes the designer
      tweak-panel: a tweak is a one-parameter candidate.

## Process

Decisions in this file were reached in long-form conversation with John and
should be treated as settled unless he reopens them. Extend the system the
same way: agree on the shape in conversation first, build in small steps,
verify parity after each. The definition file is the unit of change — if a
proposed feature can't be expressed as "edit one line of YAML, regenerate,"
question the feature.
