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
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
```

That system can produce any step on demand. `sky(3)` is 3% ink over the
base. `sky(3.5)` is 3.5%. The selector is a coordinate on a continuous ramp,
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

The rule that holds the model together is simple: **a raw color is legal
only inside `palette` and `systems`**. Semantic roles are made of references and derivations,
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

## Starting from the colors you have

Most palettes were picked, not derived. dtg does not ask you to invent a
recipe before you start.

**Bring the palette as it is.** Put your hexes in `palette`, name your
roles, and point them at those colors. A definition with no systems is
valid: you get roles, modes, CSS and DTCG output, and the browser on day
one.

```yaml
palette:
  gray:
    50: "#f7f8f9"
    100: "#eef0f2"
    300: "#c9ced3"
    500: "#8a929a"
    900: "#1d2125"

core:
  surface:
    canvas: [gray.50]
    card: [gray.100]
  separator: [gray.300]
  label:
    secondary: [gray.500]
    primary: [gray.900]
```

**Promote ramps into systems.** Where a group of picks is really a ramp,
replace it with a system and compare the two in `dtg dev`. Pin a step that
must stay exact with `overrides`. The role names don't change, so neither
does any component that uses them.

```yaml
systems:
  gray:
    algorithm: tint
    params: { base: "#ffffff", tint: "#1d2125" }
    overrides: { "7": "#eef0f2" }

core:
  surface:
    canvas: [gray(3)]
    card: [gray(7)]
  separator: [gray(22)]
  label:
    secondary: [gray(52)]
    primary: [gray(100)]
```

**Keep real picks as picks.** A brand color handed over by a designer
belongs in `palette`. dtg only asks that roles point at it rather than
repeat it.

## How this relates to DTCG and Style Dictionary

DTCG and Style Dictionary store values and transform them between formats.
dtg sits upstream of that work. Its definition holds recipes and
relationships, and the file of values is an output. In a Style Dictionary
pipeline, dtg can generate the input. Its concern is where the values come
from and how they remain coherent as the system changes.

## Principles

1. **Open vocabulary, fixed contract.** Collections, groups, roles, systems, algorithm
   params, and selectors can grow with the project. The plumbing stays
   stable so the tooling can remain generic.
2. **Deterministic generation.** The same definition produces the same
   bytes. The definition is data; expressions are parsed rather than
   evaluated as code.
3. **Explicit references.** A role's output is readable from its own line
   plus the systems block. The definition shows its reasoning.
4. **Demand-driven primitives.** A step exists because a ref demands it, or
   because its system lists it under `emit` when the steps themselves are
   the product.
5. **Declared overrides.** Hand-tuned colors live in the definition, where
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
dtg init                                           # write a placeholder dtg.config.yaml here
dtg --version                                      # or -v; --help or -h lists every flag
dtg dev  [--port <n>]                              # browse and edit: ramps, deltaE, lineage, roles
         [--build]                                 # also write the outputs when the definition file changes
dtg build [--watch] [--css <path>]                 # generate the CSS
          [--css-format <plain|tailwind>]          # default plain
          [--dtcg <path>]                          # DTCG; written only when asked
dtg docs --out <dir> [--editable]                  # a copy of the browser, to publish
```

`dtg docs` writes the browser as plain files: `index.html`, `state.json`
and `ui/`. Any static host serves it, from any folder — a site's `public/`
directory, or GitHub Pages. Everything you can look at in `dtg dev` is
there. It is read-only unless you pass `--editable`: then visitors can edit
the colors, undo and redo, but only in their own page; nothing is saved, and
a reload starts over from the published definition. Pages are addressed in
the fragment (`#/system/theme`), so deep links work on a host that knows
nothing of the app.

`dtg dev --build` writes the same outputs `dtg build` does, once at startup and
again whenever the definition file changes — a save from the app or an edit
by hand. They follow the file, never the unsaved edits on top of it. It is a
flag only, asked for per run: no setting in `dtg.config.yaml` turns it on, so
opening a definition never overwrites the files an app ships.

Definition resolution: `--definition <file>` if given; else the
`definitions` entry in `dtg.config.yaml`. There is no default place dtg looks:
`dtg init` writes a `dtg.config.yaml` to fill in. The CSS output defaults to
`tokens.generated.css` beside the definition. DTCG is written only when you
name a path for it.

## Project layout

The files can live wherever the project keeps its styles; `dtg.config.yaml` at the
root says where. One arrangement:

```
design-tokens/
  colors.dtg.yaml          # the definition (decisions)
  tokens.generated.css     # generated, committed, never hand-edited
  tokens.json              # generated DTCG, committed — opt in via dtg.config.yaml
dtg.config.yaml            # names the definition and the outputs
```

`dtg.config.yaml` for that arrangement:

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

`gamut` is the widest colors the project means to author:

```yaml
gamut: srgb # default: display-p3
```

It is a ceiling, not a clamp. The picker in `dtg dev` stops at it, and a
color above it — a constant or a system input — is reported as a warning.
Nothing is altered: the color resolves and emits exactly as written until
you change it. Under the default, only colors no P3 screen can show warn.

`dev.backgrounds` is the page colors `dtg dev` can be looked at against, in
the order its selector lists them:

```yaml
dev:
  backgrounds:
    paper: "#ffffff"
    dusk: oklch(0.3 0.05 260)
```

The app's Settings page edits this list and writes each change to `dtg.config.yaml`
at once, creating the file if the project has none. It is config, not the
definition, so it is outside the app's unsaved changes and undo. Nothing
under `dev` affects what is emitted.

Precedence: CLI flags, then `dtg.config.yaml`, then convention defaults.

## The definition file

A new project can start around fifteen lines and grow one decision at a
time. The example below shows the full shape, but each part is optional.

```yaml
dtg: 1 # grammar version

modes: [light, dark]

palette:
  white: "#ffffff" # a constant: a role can point straight at it
  ink:               # a group: constants nest, addressed by path
    body: "#313133"
    muted: "#828282"

systems:
  sky: # a system: an object with `algorithm`
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
  night:
    algorithm: tint
    params: { base: "#151c1f", tint: "#001a28" }
  theme:
    algorithm: scale
    params: { base: "#03a2e8" }
    emit: [50, 500, 950] # published whether or not a role asks
  shadow:
    algorithm: overlay
    params: { color: "#000000" }

defaults: # shared params, per algorithm
  scale:
    toward: ["#fafdff", "#001a28"]
    hueShift: 15
    midpoint: 0.4

core: # any non-reserved top-level key is a collection you name;
  surface: #   a group: part of every role's name below it
    canvas: [sky(3), night(0)] # one ref per mode
    card: [sky(0), night(4)]
    floating: [surface.card, night(6)] # roles can point at roles
  state:
    hover: [sky(3 tint), night(3.5 tint)] # tint's uncomposited form
    veil: [transparent(white 70), transparent(ink.body 40)]
  label:
    primary: # omit drops the segment: emits --label
      omit: true
      refs: [night(0), sky(0)]
    secondary: [ink.muted, ink.muted] # emits --label-secondary
```

### Grammar

- `dtg: 1` declares the grammar version. The resolver warns when it is
  missing and refuses versions it does not understand.
- **`palette`** holds the colors you picked. A **string** is a constant and
  any other object is a **group**; groups nest. Every constant emits, unless
  its group says `emit: false` — then its colors are inputs for systems'
  params, emitted only if a role points at one. In
  `dtg dev`, each group is a palette: its page shows the colors side by side
  and lets you add, rename, lock and randomize them to judge them together.
- **`systems`** holds the recipes. An object with **`algorithm`** is a
  system; any other object is a group. A system can't share a path with a
  constant.
- A system node's keys belong to the tool: `algorithm` names the algorithm,
  `params` holds its inputs, `alias` overrides the public name, `overrides`
  pins a step's flattened value, and `emit` lists steps to publish whether
  or not a role asks for them — otherwise a system writes out only what
  roles point at. Params live in their own block so this list
  can grow without ever colliding with a parameter name, and built-ins
  reject unknown params so typos fail loudly.
- **`defaults`** holds shared params per algorithm, merged under each
  system's own params. One copy of each number.
- A **color param** is a color or a constant's path: `base: hues.sky`
  anchors a system on a palette color, and changing the constant moves it.
- A **ref** is one of:
  - `paper`, or `ink.body` — a constant, by path
  - `sky(3)` — a step. Dots walk the systems tree; the parentheses hand
    off, and everything inside them belongs to the algorithm, separated by
    spaces (`sky(3)` is 3% ink,
    `sky(3 tint)` is that ink uncomposited, `theme(600)` is a stop name,
    `warm-wash.red(6)` is a tint in a group, 6% red over its base)
  - `group.role` — another decision in the same mode (just `role` for one in no group)
  - `transparent(paper 70)` — a constant at an opacity. Constants only:
    they have no recipe, so this is a plain function of a color and an
    amount. A system's uncomposited form is a selector instead, because it
    re-runs the recipe rather than transforming the output.
- One meaning each: **`.` navigates, parentheses hand off.** Inside them,
  spaces separate — never commas, which end an item in a `[ ]` list.
- **A raw color is legal only inside `palette` and `systems`.** A color literal is
  `#rgb`, `#rrggbb`, `oklch(L C H)`, `oklab(L a b)`, `color(srgb r g b)` or
  `color(display-p3 r g b)`, each with an optional `/ alpha`. A color keeps
  the space it was written in, so a wide-gamut anchor is not clipped to sRGB
  on the way in — the transform runs in the widest space its inputs use.
- A **role** is a list of refs, one per mode, or `{ refs, alias?, omit?,
  description? }` when it needs more. This is the complete role grammar.
- **`description`** is your own note, as text, on a system, a role, or a
  group in `palette`, `systems` or a collection. `dtg dev` shows it beside what
  it describes, and DTCG carries it as `$description`. It is a reserved key
  in those places, so nothing can be named `description`.
- **`modes`** is a list of names, or a map when a mode needs more:
  `dark-hc: { extends: dark, scheme: dark }`. A mode that extends another
  says only what differs. A role's list must reach the last mode that
  extends nothing; modes after it may be left off, and `~` holds the place
  of an extending mode that says nothing. A silent mode takes its parent's
  ref, resolved again in its own mode, so overriding one role moves every
  role that points at it.
- **`changelog`** is an optional list of `<date>: <note>` entries, passed
  through to the DTCG output untouched. It is prose for whoever replays the
  system into a design tool — "renamed `shadow.2` to `shadow.3`, rename in
  Figma rather than recreate" — and the resolver never interprets it.
- **Collections are yours.** Top-level keys other than
  `dtg`/`modes`/`defaults`/`palette`/`systems`/`changelog` are collections:
  arbitrary names, each emitted as a design-tool collection. Inside one,
  roles may sit in groups, which nest; a role in no group is fine.
- **A top-level block is a container, never a name.** `palette`, `systems`
  and every collection hold things; they never appear in refs or in emitted
  names, and everything below them does. So `hues.green` in the palette
  emits `--color-hues-green`, `warm.sky(3)` emits `--color-warm-sky-3`, and
  `surface.canvas` in the `core` collection emits `--surface-canvas`. Only
  Figma has containers, so only Figma sees the collection: `core`, holding
  `surface/canvas`. Because refs leave the collection out, a role's path
  (`group.role`) must be unique across collections.
- **`alias`** on any emitting key (a constant group, a system, the systems
  block itself, a collection, a group, or a role) replaces its public name. A string for all
  targets, or per-target: `alias: { css: light, figma: Light }`. Internal
  names are for pointing, public names are for emitting, refs always use
  internal names.
- **`omit: true`** on a group or role drops that segment from public
  names, so `label.primary` with omit emits `--label` beside
  `--label-secondary`. The resolver rejects roles with both segments
  omitted, and any public-name collision aliasing or omission would create.

By default, everything emits verbatim. Aliases express structural
divergences, such as a system named `light` colliding with the mode, and
historical ones, such as shipped names that predate the definition.

## Built-in algorithms

Each built-in algorithm has one complete behavior.

- **`tint`** (`base`, `tint`): a tint composited over a base. The selector
  is the tint's alpha percent, so the token name is the recipe — `sky(15)` is
  15% tint. Adding `tint` — `sky(15 tint)` — gives the tint alone at the same
  alpha, without the base, for a value that must sit over an unknown surface.
- **`scale`** (`base`, `toward`, `hueShift`, `midpoint`): a chromatic
  scale through the base in OKLCH. The selector is any stop from 0 to 1000:
  0 is `toward[0]`, 500 the base, 1000 `toward[1]`. `midpoint` is how much
  of the base shows at 250 and 750 — 0.5 is an even line, lower keeps the
  ends paler and deeper for longer. `hueShift` 0 locks every stop to the
  base hue, 100 follows the natural interpolated path. List the stops to
  publish under `emit`.
- **Several tints over one ground** are a group of tints, one per color,
  each naming its colors from the palette:

  ```yaml
  warm-wash:
    red:  { algorithm: tint, params: { base: paper, tint: warm.red } }
    blue: { algorithm: tint, params: { base: paper, tint: warm.blue } }
  ```

  `warm-wash.red(6)` is 6% red over paper. This replaced the `blend`
  algorithm, which did the same with the color's name inside the selector.
- **`overlay`** (`color`): color at selector % opacity, never flattened.
  Shadows and scrims.

The algorithm determines what kind of value a ref produces. That behavior
is declared once in the systems block and applies everywhere the system is
used. A shadow, for example, uses `overlay` because overlays stay
translucent.

An algorithm that composites can also publish the layer *before* it meets
the ground — `sky(3 tint)`, `warm(red 6 top)`. That is a selector rather than a
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
  `$description` is your `description`, where you wrote one. Identity
  rides in `$extensions` as `id` — a role's internal path, or for a
  demand-driven step the roles that use it, both of which survive the
  renames and renumberings that change public names — beside the recipe,
  which is the volatile part. Any
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
  accepts a registry; the CLI does not load one yet. Designed in
  `docs/project-algorithms.md`.
