# dtg

**A design token should be an address in a parameter space, not an entry in
a list.**

`@fifthrevision/dtg` turns color rules into design tokens. You write a YAML
definition describing how your colors are _made_, and it compiles
deterministically into CSS variables, a Figma variable payload, and a
browsable dev server.

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
  sky: { algorithm: ink-ramp, base: "#fafdff", ink: "#001a28" }
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

0.1. The grammar, resolver, built-in algorithms, dev server, and CSS and
Figma emitters work and are in production use on one real design system.
The next work is multi-file definitions, Figma sync, and the `check`
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
dtg emit [--live] [--css <path>] [--figma <path>]  # generate CSS + Figma payload
```

Definition resolution: `--definition <file>` if given; else the
`definitions` entry in `dtg.yaml`; else discover `design-tokens/*.dtg.yaml`.
Outputs default to beside the definitions:
`design-tokens/tokens.generated.css` and `design-tokens/figma.json`.

## Project layout

```
design-tokens/
  colors.dtg.yaml          # the definition (decisions)
  tokens.generated.css     # generated, committed, never hand-edited
  figma.json               # generated, committed (see roadmap)
dtg.yaml                   # optional; only needed off-convention
```

`dtg.yaml`, when present:

```yaml
definitions: design-tokens/ # a dir (globs *.dtg.yaml) or an explicit file
outputs:
  css: design-tokens/tokens.generated.css
  figma: design-tokens/figma.json
```

Precedence: CLI flags, then `dtg.yaml`, then convention defaults.

## The definition file

A new project can start around fifteen lines and grow one decision at a
time. The example below shows the full shape, but each section is optional.

```yaml
dtg: 1 # grammar version

modes: [light, dark]

systems:
  sky: { algorithm: ink-ramp, base: "#fafdff", ink: "#001a28" }
  night: { algorithm: ink-ramp, base: "#151c1f", ink: "#001a28" }
  theme: { algorithm: oklch-scale, base: "#03a2e8" }
  shadow: { algorithm: overlay, color: "#000000" }
  white: "#ffffff" # statics: plain hex

defaults: # shared params, per algorithm
  oklch-scale:
    toward: ["#fafdff", "#001a28"]
    hueShift: 15
    stops: { "50": 0.05, "500": 1, "950": 0.05 }

core: # any non-reserved top-level key is a section you name;
  surface: #   each section becomes a Figma collection
    canvas: [sky/3, night/0] # one ref per mode
    card: [sky/0, night/4]
    floating: [surface.card, night/6] # roles can point at roles
  state:
    hover: [transparent(sky/3), transparent(night/3.5)]
  label:
    primary: # omit drops the segment: emits --label
      omit: true
      refs: [night/0, sky/0]
    secondary: [night/30, sky/40] # emits --label-secondary
```

### Grammar

- `dtg: 1` declares the grammar version. The resolver warns when it is
  missing and refuses versions it does not understand.
- **`systems`** declares color systems: `name` maps to
  `{ algorithm, ...params }`, or to a plain hex for a static. Reserved keys
  the tool owns: `algorithm`, `alias` (public-name override), `overrides`
  (selector to hex, pins a step's flattened value). Everything else passes
  through to the algorithm untouched, and built-ins reject unknown params
  so typos fail loudly.
- **`defaults`** holds shared params per algorithm, merged under each
  system's own params. One copy of each number.
- A **ref** is `system/selector` (everything after the slash belongs to the
  algorithm), or `domain.role` to alias another decision in the same mode,
  or `transparent(system/selector)` for a step's unflattened ink form.
- **Raw hex is legal only inside `systems`.**
- A **role** is a list of refs, one per mode, or `{ refs, alias?, omit? }`
  when its public name diverges. This is the complete role grammar.
- **Sections are yours.** Top-level keys other than
  `dtg`/`modes`/`defaults`/`systems` are sections: arbitrary names, each
  emitted as a Figma collection. CSS names never include the section. Role
  paths (`domain.role`) must be unique across sections so refs stay
  unambiguous.
- **`alias`** on any emitting key (a system, the systems block itself, a
  section, a domain, or a role) replaces its public name. A string for all
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
  is the ink's alpha percent, so the token name is the recipe. Steps are
  opaque surface colors. Backs `transparent()`.
- **`oklch-scale`** (`base`, `toward`, `hueShift`, `stops`): a chromatic
  scale blended from the base in OKLCH. Stops below 500 blend toward
  `toward[0]`, above toward `toward[1]`; a stop's value is the fraction of
  base remaining. `hueShift` 0 locks every stop to the base hue, 100
  follows the natural interpolated path. Declared stops emit in full, as a
  public palette.
- **`overlay`** (`color`): color at selector % opacity, never flattened.
  Shadows and scrims.

The algorithm determines what kind of value a ref produces. That behavior
is declared once in the systems block and applies everywhere the system is
used. A shadow, for example, uses `overlay` because overlays stay
translucent.

`transparent()` asks an algorithm for the unflattened form of a step. The
system re-runs its recipe and stops before compositing, preserving the ink
and its alpha rather than trying to recover them from a flattened hex.
Algorithms expose this capability when their recipes support it.

The registry is open: `resolveDefinition(yaml, extraAlgorithms)` merges
project algorithms over built-ins, so a project can bring its own
generation methods or shadow a built-in by name.

## Emit targets

- **CSS**: one generated file with an `@theme` primitives block (Tailwind
  v4), `:root` and `.dark` semantic blocks (step refs stay as `var()`
  chains; transparent and overlay values inline), and `@theme inline`
  utility wiring.
- **Figma**: a deterministic payload (`figma.json`) of collections, modes,
  values, and aliases-by-name, with no file IDs, for a courier (agent or
  plugin) to replay against a file via the Plugin API. The REST variables
  API is Enterprise-only, so every sync path runs through plugins.

## Roadmap

- Multi-file definitions (`shadows.dtg.yaml`, `type.dtg.yaml` as siblings,
  one resolver over all). Discovery exists; merging does not yet.
- Figma payload moves from `emit` to sync time. The payload belongs to the
  sync loop, generated by a future `dtg figma` whose `--dry-run` diffs
  against the live file, with the dev server serving it at `/figma.json`
  for a plugin courier. Kept as an emit artifact in 0.1 for simplicity.
- `check` command: definition versus emitted artifact drift, inert
  overrides, longhand-sugar detection.
- In-browser tweaking: controls POST param changes, the server rewrites the
  definition comment-preserving, the watcher re-resolves. The file stays
  the single source of truth and the browser is just another editor of it.
- Custom algorithm loading from a project path. The resolver API already
  accepts a registry; the CLI does not load one yet.
