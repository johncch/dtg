# dtg

**A design token should be an address in a parameter space, not an entry in
a list.**

`@fifthrevision/dtg` turns color rules into design tokens. You write a YAML
definition describing how your colors are _made_, and it compiles
deterministically into CSS variables, a DTCG token file, and a browsable
dev server.

## Why dtg exists

When I design a UI, one of the first things I do is land on a color system. I
start with a few selected swatches, then put them through an algorithm to
generate the palette. The palette then gets put into Figma and code.

The problem arises when I need to make a change to the system. Say I need more
or less contrast between two elements. To do that, I have to reverse-engineer
the color and algorithm, or eyeball a new color. Over time, these changes
accumulate into drift and mistakes, and keeping Figma and code aligned becomes
a pain.

The thought arises: if the colors came from a system, why don't we encode the
system in the process? Then dtg was born.

## The idea

dtg begins with how a color is made. You declare a _system_: an algorithm
plus a few anchors.

```yaml
systems:
  sky:
    algorithm: ink-ramp
    params: { base: "#fafdff", ink: "#001a28" }
```

That system can produce any step on demand. `sky/3` is 3% ink over the
base. `sky/3.5` is 3.5%. The selector is a coordinate on a continuous ramp,
not a position in a list. A step exists because something references it,
and disappears when nothing does.

Two things follow from this model.

**The token name is the recipe.** `light-15` is not the fifteenth color. It
is 15% ink. You can read the derivation off the name, and you can read a
role's value off its own line plus the systems block, without tracing
anything.

**Tweaking happens in parameter space, not color space.** Change the ink,
the base, or the hue shift, and every color derived from it regenerates,
byte for byte reproducibly. These are useful controls because they move the
system together. A color picker can change one value; a parameter can
change fifty while preserving the relationship between them.

The rule that holds the model together is simple: **raw hex is legal only
inside `systems`**. Semantic roles are made of references and derivations,
so every color traces back to an anchor. A literal is a value that has
forgotten its reason.

## Where the constraint belongs

dtg separates what a system can generate from what a product should use.
The ramp is an open space of possibilities. Semantic roles are the chosen
vocabulary: `surface.canvas`, `label.secondary`, `state.hover`. Components
consume those roles, and adding one is a deliberate design decision with a
name attached.

This puts the constraint around meaning, where it has the most leverage.
The system can generate any color it needs, while the set of roles stays as
small and intentional as the product requires.

The result is a two-tier model: systems and roles. Roles point directly
into systems, and each reference carries the reasoning. A new need can be
expressed as one new decision instead of a reclassification of the scale.

## How this relates to DTCG and Style Dictionary

DTCG and Style Dictionary store values and transform them between formats.
dtg sits upstream of that work. Its definition holds recipes and
relationships, and the file of values is an output. In a Style Dictionary
pipeline, dtg can generate the input. Its concern is where the values come
from and how they remain coherent as the system changes.

## Principles

1. **Open vocabulary, fixed contract.** Domains, roles, systems, algorithm
   params, and selectors can grow with the project. The plumbing stays
   stable so the tooling can remain generic.
2. **Deterministic generation.** The same definition produces the same
   bytes. The definition is data; expressions are parsed rather than
   evaluated as code.
3. **Explicit references.** A role's output is readable from its own line
   plus the systems block. The definition shows its reasoning.
4. **Demand-driven primitives.** A step exists because a ref demands it.
   Declared palettes emit in full when the palette itself is the product.
5. **Declared overrides.** Hand-tuned hexes live in the definition, where
   they can be understood and eventually promoted into the system.
6. **Growth from real needs.** Repeated derivations are signals that a new
   system or algorithm has emerged. The vocabulary grows from use.

## Status

0.1. The grammar, resolver, built-in algorithms, dev server, and the CSS
and DTCG emitters work and are in production use on one real design system.
The next work is multi-file definitions, design-tool sync, and the `check`
command. See the roadmap at the bottom.

---

# Mechanics

## Install

```
pnpm add -D @fifthrevision/dtg
```

## Commands

```
dtg dev  [--port <n>]                              # browse ramps, deltaE, lineage; live-reloads on save
dtg emit [--live] [--css <path>]                   # generate the CSS
         [--css-format <plain|tailwind>]           # default plain
         [--dtcg <path>]                           # DTCG; written only when asked
```

Definition resolution: `--definition <file>` if given; else the
`definitions` entry in `dtg.yaml`; else discover `design-tokens/*.dtg.yaml`.
The CSS output defaults to `design-tokens/tokens.generated.css`, beside the
definitions. DTCG is written only when you name a path for it.

## Project layout

```
design-tokens/
  colors.dtg.yaml          # the definition (decisions)
  tokens.generated.css     # generated, committed, never hand-edited
  tokens.json              # generated DTCG, committed — opt in via dtg.yaml
dtg.yaml                   # optional; only needed off-convention
```

`dtg.yaml`, when present:

```yaml
definitions: design-tokens/ # a dir (globs *.dtg.yaml) or an explicit file
outputs:
  css: design-tokens/tokens.generated.css
  dtcg: design-tokens/tokens.json # omit and no DTCG is written
```

The CSS output also takes a long form, for a project on Tailwind v4:

```yaml
outputs:
  css:
    path: app/colors.generated.css
    format: tailwind # default: plain
```

Precedence: CLI flags, then `dtg.yaml`, then convention defaults.

## The definition file

A new project can start around fifteen lines and grow one decision at a
time. The example below shows the full shape, but each section is optional.

```yaml
dtg: 1 # grammar version

modes: [light, dark]

systems:
  white: "#ffffff" # a constant: a role can point straight at it
  ink:               # a group: constants nest, addressed by path
    body: "#313133"
    muted: "#828282"
  sky: # a system: an object with `algorithm`
    algorithm: ink-ramp
    params: { base: "#fafdff", ink: "#001a28" }
  night:
    algorithm: ink-ramp
    params: { base: "#151c1f", ink: "#001a28" }
  theme:
    algorithm: oklch-scale
    params: { base: "#03a2e8" }
  shadow:
    algorithm: overlay
    params: { color: "#000000" }

defaults: # shared params, per algorithm
  oklch-scale:
    toward: ["#fafdff", "#001a28"]
    hueShift: 15
    stops: { "50": 0.05, "500": 1, "950": 0.05 }

core: # any non-reserved top-level key is a section you name;
  surface: #   each section becomes a design-tool collection
    canvas: [sky/3, night/0] # one ref per mode
    card: [sky/0, night/4]
    floating: [surface.card, night/6] # roles can point at roles
  state:
    hover: [sky/3/ink, night/3.5/ink] # ink-ramp's uncomposited form
    veil: [transparent(white 70), transparent(ink.body 40)]
  label:
    primary: # omit drops the segment: emits --label
      omit: true
      refs: [night/0, sky/0]
    secondary: [ink.muted, ink.muted] # emits --label-secondary
```

### Grammar

- `dtg: 1` declares the grammar version. The resolver warns when it is
  missing and refuses versions it does not understand.
- **`systems`** is a tree of three node kinds, told apart with no extra
  syntax. A **string** is a constant. An object with **`algorithm`** is a
  system. Any other object is a **group**, and groups nest.
- A system node's keys belong to the tool: `algorithm` names the algorithm,
  `params` holds its inputs, `alias` overrides the public name, `overrides`
  pins a step's flattened value. Params live in their own block so this list
  can grow without ever colliding with a parameter name, and built-ins
  reject unknown params so typos fail loudly.
- **`defaults`** holds shared params per algorithm, merged under each
  system's own params. One copy of each number.
- A **ref** is one of:
  - `paper`, or `ink.body` — a constant, by path
  - `sky/3` — a step. Dots walk the systems tree; the slash hands off, and
    everything after it belongs to the algorithm (`sky/3` is 3% ink,
    `sky/3/ink` is that ink uncomposited, `theme/600` is a stop name,
    `warm/red@6` is a compose anchor at 6%)
  - `domain.role` — another decision in the same mode
  - `transparent(paper 70)` — a constant at an opacity. Constants only:
    they have no recipe, so this is a plain function of a color and an
    amount. A system's uncomposited form is a selector instead, because it
    re-runs the recipe rather than transforming the output.
- One meaning per separator: **`.` navigates, `/` hands off.**
- **Raw hex is legal only inside `systems`.**
- A **role** is a list of refs, one per mode, or `{ refs, alias?, omit? }`
  when its public name diverges. This is the complete role grammar.
- **`changelog`** is an optional list of `<date>: <note>` entries, passed
  through to the DTCG output untouched. It is prose for whoever replays the
  system into a design tool — "renamed `shadow.2` to `shadow.3`, rename in
  Figma rather than recreate" — and the resolver never interprets it.
- **Sections are yours.** Top-level keys other than
  `dtg`/`modes`/`defaults`/`systems`/`changelog` are sections: arbitrary
  names, each emitted as a design-tool collection. CSS names never include the section. Role
  paths (`domain.role`) must be unique across sections so refs stay
  unambiguous.
- **`alias`** on any emitting key (a constant group, a system, the systems
  block itself, a section, a domain, or a role) replaces its public name. A string for all
  targets, or per-target: `alias: { css: light, figma: Light }`. Internal
  names are for pointing, public names are for emitting, refs always use
  internal names.
- **`omit: true`** on a domain or role drops that segment from public
  names, so `label.primary` with omit emits `--label` beside
  `--label-secondary`. The resolver rejects roles with both segments
  omitted, and any public-name collision aliasing or omission would create.

By default, everything emits verbatim. Aliases express structural
divergences, such as a system named `light` colliding with the mode, and
historical ones, such as shipped names that predate the definition.

## Built-in algorithms

Each built-in algorithm has one complete behavior.

- **`ink-ramp`** (`base`, `ink`): ink composited over a base. The selector
  is the ink's alpha percent, so the token name is the recipe — `sky/15` is
  15% ink. Adding `/ink` gives the same ink at the same alpha without the
  base, for a value that must sit over an unknown surface.
- **`oklch-scale`** (`base`, `toward`, `hueShift`, `stops`): a chromatic
  scale blended from the base in OKLCH. Stops below 500 blend toward
  `toward[0]`, above toward `toward[1]`; a stop's value is the fraction of
  base remaining. `hueShift` 0 locks every stop to the base hue, 100
  follows the natural interpolated path. Declared stops emit in full, as a
  public palette.
- **`compose`** (`bottom`, `tops`): a palette of named colors over one
  shared ground. The selector carries both coordinates — `warm/red@6` is
  that anchor at 6% over the ground, `warm/red@100` is the anchor itself —
  so one palette serves tints and full-strength use. `/top` gives the
  anchor uncomposited.
- **`overlay`** (`color`): color at selector % opacity, never flattened.
  Shadows and scrims.

The algorithm determines what kind of value a ref produces. That behavior
is declared once in the systems block and applies everywhere the system is
used. A shadow, for example, uses `overlay` because overlays stay
translucent.

An algorithm that composites can also publish the layer *before* it meets
the ground — `sky/3/ink`, `warm/red@6/top`. That is a selector rather than a
core function, because it re-runs the recipe rather than transforming the
output: the ink and its alpha cannot be recovered from a flattened hex, and
at low alpha the arithmetic is hopeless anyway. Each algorithm names the
form from its own params, and documents it in its description.

`transparent(name 70)` is the separate, ordinary thing: a constant at an
opacity. Constants have no recipe, so nothing is being un-done.

The registry is open: `resolveDefinition(yaml, extraAlgorithms)` merges
project algorithms over built-ins, so a project can bring its own
generation methods or shadow a built-in by name.

## Emit targets

- **CSS**: one generated file. `format: plain` (the default) emits a
  `:root` primitives block plus `:root` and `.dark` semantic blocks — step
  refs stay as `var()` chains, transparent and overlay values inline.
  `format: tailwind` instead wraps the primitives in `@theme` and appends
  `@theme inline` utility wiring. The Tailwind form relies on at-rules
  nothing else understands, so a browser outside a Tailwind build discards
  the primitives entirely; pick it only for a Tailwind v4 project.
- **DTCG**: standard design tokens, emitted only when a path is given.
  `$description` carries *identity*, not documentation — a role's internal
  path, or for a demand-driven step the roles that demand it, both of which
  survive the renames and renumberings that change public names.
  `$extensions` carries the recipe, which is the volatile part. Any
  `changelog` rides at the root. Aimed at an agent replaying the system into
  a design tool.
Both emitters are pure functions of the definition: same definition, same
bytes. Nothing reads the design tool's state, which is why sync is a
separate concern and not an emit target.

## Roadmap

- Multi-file definitions (`shadows.dtg.yaml`, `type.dtg.yaml` as siblings,
  one resolver over all). Discovery exists; merging does not yet.
- Design-tool sync. The DTCG file is the payload; delivery is an agent
  courier replaying it through a plugin console, since renaming preserves
  variable IDs and keeps mockups wired. A future `dtg check --dry-run`
  diffs against the live file. The REST variables API is Enterprise-only,
  so every path runs through plugins.
- `check` command: definition versus emitted artifact drift, inert
  overrides, longhand-sugar detection.
- In-browser tweaking: controls POST param changes, the server rewrites the
  definition comment-preserving, the watcher re-resolves. The file stays
  the single source of truth and the browser is just another editor of it.
- Custom algorithm loading from a project path. The resolver API already
  accepts a registry; the CLI does not load one yet.
