# How dtg works

The design doc. The README argues _why_ the system is shaped this way; this file
records _what was settled_ and the reasoning behind it, so decisions do not get
quietly re-litigated. Read it before changing the grammar, the resolver, or an
algorithm.

## The two-tier model

**Systems** are color generators: an algorithm plus parameters, able to produce
colors on demand. **Semantic roles** are the design decisions: each role points
at system steps (or derives from them), one ref per mode.

There is deliberately no middle tier, no `elevation-1..4` scale sitting between
systems and roles. Intermediate taxonomies force every new need through a
classification argument before it can ship, and rigid tier systems break down as
a project evolves. Roles point directly into systems; the ref itself carries the
reasoning.

A large definition is a ceiling, not a floor. A new project starts around
fifteen lines and grows one line at a time. **Tooling must never assume any
collection, group, or role exists.** It renders and emits exactly what is
declared.

## The grammar

Canonical. The README carries the user-facing version of the same rules.

- `dtg: 1` is the grammar version. The resolver assumes 1 when it is absent, and
  errors on versions it does not understand. The editor writes `dtg: 1` into a
  definition without one when it saves it.
- `modes: [light, dark]` sets the order role ref tuples are read in. The
  longform is a map, `light:` / `dark-hc: { extends: dark, scheme: dark }`, both
  keys optional. A mode with no `extends` is a **root** and names every color. A
  mode that extends another says only what differs: a role tuple must reach the
  last root mode, modes after it may be left off, and `~` holds the place of an
  extending mode that says nothing. A silent mode takes its parent's _ref_,
  resolved again in its own mode, so overriding one role moves every role
  pointing at it. A parent is declared above its child. A mode name cannot be a
  number: a map hands number-like keys back sorted, and mode order decides which
  ref lands in which mode. `scheme` (`light` or `dark`) is declared, never read
  off the name, and comes along through `extends`.
- How `extends` reaches each format. Nested CSS selects a mode's block for the
  mode and everything extending it (`.dark, .dark-hc { … }`), then the child's
  block holds only what it declared; `scheme` becomes `color-scheme` in that
  block. Flat CSS and SCSS have no cascade, so they leave out a role only when
  its value is its parent's by construction — an inherited role whose target
  moved is written. DTCG fills every mode and records
  `inherits: { dark-hc: dark }`. What applies `.dark` to an element is the app's
  business, not the definition's.
- `palette` holds the colors picked by hand: a **string** is a constant (or,
  starting `gradient(`, a gradient made of them), any other object a **group**,
  and groups nest, so a constant's identity is its dotted path. Every constant
  is published, unless its group says `publish: false`: then its colors are
  inputs, published only when a role points at one, since a reference always
  publishes what it names. `transparent()` around one is a value, not a
  reference, and publishes nothing. A group of constants is a palette in
  `dtg edit`. It is read before `systems`, so a param can name any constant
  wherever it is written. A string left in `systems` is refused with a pointer
  here.
- `systems` holds the recipes: an object with **`algorithm`** is a system, any
  other object a **group**. A constant path and a system path cannot be the
  same, so a ref never has to guess. The file reads in the order it resolves:
  picks, then recipes, then decisions.
- A system node's keys are the tool's: `algorithm` (a string naming it),
  `params` (the algorithm's inputs, in their own block), `alias`, `overrides`,
  `publish`. `publish` lists selectors the system publishes whether or not a ref
  asks — `publish: [50, 100, 500]` — each checked against the algorithm's
  selector and named by the usual rule. What a system writes out is that list
  plus what refs demand; an algorithm never decides it. Params are contained
  rather than passed through, so the reserved list can grow without colliding
  with a parameter name.
- `defaults`: shared params per algorithm, merged under each system's own
  params. One copy of each number.
- `description`: the author's own note, as text, on a system, a role, or a group
  in `palette`, `systems` or a collection. Reserved in those places, the same as
  `alias`. It changes no color and nothing reads it but people: the app shows
  it, and DTCG carries it as `$description`. A palette color is a bare string
  with nowhere to put one, so its group's description stands in.
- A color param, in a system's `params` or in `defaults`, is a color or the path
  of a constant (`base: hues.sky`), so a system's anchor can come from a
  palette. Only constants: they are literals, so the chain ends after one hop
  and no cycle is possible. Letting a param name a system step would need
  systems resolved in dependency order and a cycle error first.
- **A top-level block is a container, never a name.** Settled 2026-10-19.
  `palette`, `systems` and every collection hold things; none appears in a ref
  or an emitted name, and everything below them does: palette and system groups,
  role groups, the leaf. Only Figma has containers, so only it sees a
  collection, as the collection itself. Naming the top-level block in every name
  was considered and turned down: it would make `systems.sky` the default
  spelling of every step, break both shipped projects' names and refs, and still
  leave Figma's collection as the exception.
- **CSS names a color as the definition does; Tailwind's names live in the
  `tailwind` output.** Settled 2026-11-22. `outputs.css` writes `palette.white`
  as `--white` and `sky(10)` as `--sky-10`. `outputs.tailwind` writes them as
  `--color-white` and `--color-sky-10` in `@theme`, and a palette gradient as
  `--gradient-<path>`, because those namespaces are what make Tailwind's
  utilities. Until then a fixed `--color-` prefix was on every primitive in
  every CSS, and `format: tailwind` was a setting on the one CSS output: a
  convention only Tailwind needed, in a file that has no `@theme`. A primitive
  and a role now share one namespace, so the resolver refuses a step, a palette
  color or a palette gradient that publishes a role's name; Tailwind's
  `@theme inline` wiring (`--color-<role>`) made that a clash there already.
- Collections: every top-level key other than
  `dtg`/`modes`/`defaults`/`palette`/`systems`/`changelog` is a collection.
  Arbitrary name, becomes a design-tool collection, holds
  `group → role → [ref per mode]`, where groups nest and are optional. A role
  may also be `{ refs, alias?, description? }`. `alias` (on a group, a
  system, the systems block, a collection, a group, or a role; string or
  per-target map) replaces a public name. `virtual: true` on a role group or
  a palette group leaves it out of every name below it. A system group has no
  `virtual`: its steps are published only when something asks for them. Refs
  always use internal names.
- **A group's own color is its `$root`.** Settled 2026-11-23, following the
  DTCG format's `$root`. `label: { $root: [...], secondary: [...] }` publishes
  `--label` beside `--label-secondary`, in a role group or a palette group.
  It is pointed at, edited and renamed by the group's path (`label`), never
  `label.$root`, so a ref and a path stay one string; DTCG writes it under
  `$root`, where a reference to the group finds it. It replaced `omit: true`
  on a role, which did the same by dropping the role's own name, and
  `virtual` replaced `omit` on groups. No other name may start with `$`. That is the _entire_ role grammar. No flags, no
  options, no other object form.
- A **ref** is one of:
  - `paper`, `ink.body` — a constant by path
  - `system(selector)` — dots walk the tree, the parentheses hand off, and
    everything inside them belongs to the algorithm, its parts separated by
    spaces (`sky(3.5)` is 3.5% ink, `sky(3 tint)` that ink uncomposited,
    `theme(600)` a stop name, `warm-wash.red(6)` a tint in a group)
  - `group.role` — another decision in the same mode; just `role` for one
    written straight in its collection
  - `transparent(paper 70)` — a color at an opacity, or a gradient with every
    stop at it. Inside it goes any ref that resolves to a color: a constant, a
    literal, a step (`transparent(sky(500) 70)`), or another role, which is
    followed mode by mode. The opacity is the last word, and it multiplies an
    alpha the color already has. It is written like a system, so no system can
    be named `transparent`
  - a literal — `"#000000"`, `rgb(0 0 0)`, `oklch(0 0 0)`, `color(display-p3 1 0 0)` — emitted
    as its value. Hex takes an alpha as CSS does, in a fourth or eighth digit
    (`"#00000080"`); the others take it after `/`. The same parser reads it, so
    no system can be named `rgb`, `rgba`, `oklch`, `oklab` or `color` either.
    `rgba()` is CSS's other name for `rgb()`. Commas are refused, as everywhere
    inside parentheses, with the spaced spelling in the error
  - `gradient(paper 0% sky(500) 100% angle=90deg)` — colors along a line. A word
    in `%` is the position of the color before it, and every other positional
    word is a stop, any ref that resolves to a color. Positions left out are
    spread evenly. Everything else is a named argument: `kind` (`linear` without
    it, or `radial`, `conic`), `angle` (a linear one's direction, 180deg without
    it as in CSS, or a conic one's start), `x` and `y` (the center of a radial
    or conic one, 50% each), `shape` and `size` (radial, in CSS's words),
    `repeat=true`, and `space`, the color space it is interpolated in. An
    argument its kind does not take is an error. A long one wraps over lines as
    plain YAML. No system can be named `gradient`
- **Positional and named arguments.** Settled 2026-11-20. Inside the parentheses
  a call has positional arguments, read in the order the callee declares, and
  named ones, written `name=value`. Whoever is called declares which of its
  arguments are which — an algorithm for its selector, a function for its inputs
  — and the resolver checks every call against that. An argument is one or the
  other, never both, so a call has one spelling. Only trailing positional
  arguments may be left out, and named arguments come after every positional
  one: a list is never split, and "before or after" would be two spellings.
  `sky(10 tint)` is two positional arguments, the second optional;
  `gradient(a b angle=90deg)` is a list and a named argument. `=` because `: `
  ends a YAML value. "Content is positional, settings are named" was the first
  wording and was turned down: it describes intent, which nothing can check, and
  it needed `sky(10 tint)` as an exception on its first day.
- **A step is identified by its selector's values, not its text.** `sky(3)`,
  `sky(3.0)` and `sky(03)` are one step and one variable, `--sky-3`; the
  same holds in `publish` and in `overrides` keys. Until 2026-11-20 the name was
  built from the text as written, so `sky(3.0)` emitted a second primitive,
  `sky-3_0`, with the same color.
- **A ref function is declared once.** `src/ref-functions.ts` lists
  `transparent` and `gradient` with what their ref arguments may resolve to and
  which arguments are named. The resolver checks a call against that line, the
  error names what the function takes, and TypeScript infers from the same line
  what the implementation is handed — so `transparent()` cannot treat its input
  as a color without handling a gradient. The declaration also reserves the name
  against systems.
- **One meaning each: `.` navigates, parentheses hand off.** Inside them, spaces
  separate, as in CSS's own color functions — a comma would end the item in a
  `[ ]` list and force quotes around every ref. A constant path and a role path
  are the same shape, so the two namespaces must not collide; the resolver
  errors if they do.
- **A literal is legal anywhere a color is.** A role may hold one, and it emits
  as its value, not a reference: nothing upstream moves it, and the editor can't
  reach it through the palette. Naming it in the palette makes it a constant.
  dtg warns when the same literal appears twice, or matches a constant, since
  repetition is a constant waiting to be named. Settled 2026-10-28, reversing
  the earlier rule that the semantic tier only points and derives: asking for a
  name before a color can be used was a detour.
- **`transparent()` produces a value.** It emits as the color it works out to
  and demands nothing: `transparent(sky(500) 70)` does not publish `sky(500)`,
  and a `publish: false` constant used only through it stays unpublished. Around
  a role, the value is written again in any mode where the role under it
  differs, since no `var()` is there to follow it. Settled 2026-11-20, reversing
  "constants only": the limit made a color need a palette name before it could
  be faded. CSS could keep the link with `color-mix()` instead; that is an
  emitter's choice, left for when something needs it.
- **A gradient is made of colors, and nothing but a gradient is made of a
  gradient.** Settled 2026-11-20. A role holds one or points at one, and is a
  gradient in every mode or in none; the palette can name one. A stop, a param
  and an editor background each take a color and say so when handed a gradient.
  `transparent()` takes either, and a gradient comes back a gradient with every
  stop at that opacity, written as values like any `transparent()`. So systems,
  steps and the algorithm contract never meet one: everything upstream of the
  roles is still only colors, and a gradient is an arrangement of colors that
  already resolved.
  - It is a function, not a system. A system was considered, for overrides at
    the ref (`brand(angle=15)`); nothing yet uses one gradient several ways, and
    repetition is the signal to promote it. A function also takes roles as
    stops, so one line follows every mode.
  - Stops are composed colors (`wash.red(6)`), not full colors faded afterwards.
    Fading inside the gradient would be `blend` again.
  - Stops keep their references: CSS writes each stop as that ref would be
    written alone, `var()` and all, so a step or constant stop is demanded like
    any other. DTCG writes `$type: gradient` with a position for every stop; its
    gradient is stops alone, so the kind, angle, center and the rest ride in
    `$extensions` as `gradients`, per mode. Sass writes every stop as its color.
  - **A palette gradient is the reusable one.** A string in `palette` that
    starts `gradient(` is a gradient with a name, pointed at by its path like a
    color. It holds only the palette's own: its colors and colors written out,
    plain or through `transparent()`. The palette is read before systems and
    roles, so there is nothing else for it to name, and nothing for one to loop
    back through. It emits as `--<path>`; in the `tailwind` output as
    `--gradient-<path>`, apart from `--color-`, which Tailwind reads as a color,
    outside `@theme`, with a `bg-<path>` class. Like a palette color it is always published,
    unless its group says `publish: false` and no role points at it. In the code
    the palette's gradients are a list of their own, so the plot, Randomize,
    Harmonize and the locks, which work on colors, never see them. The editor
    draws one where it is written, among the group's colors, marked as passed
    over by those tools. It opens the gradient's controls to edit, and it is
    renamed, moved and deleted like a color; its lock is shown and cannot be
    turned, since nothing would roll it. It is not a kind of thing the editor
    makes: there is no control to add one, and it is written in the file.
  - **`gradient()` restyles one gradient.** Where the colors would go it takes
    one gradient instead, alone — a palette gradient or a gradient role — and
    keeps its stops. What is named replaces what that gradient had; the rest
    carries over, as long as the kind is still the one it belonged to.
    `gradient(brand angle=135deg)` is brand turned;
    `gradient(brand kind=radial)` is brand's stops out from the center. This is
    what a gradient system with overrides at the ref would have been for. A
    gradient among colors is refused, since stops and positions have no one way
    to merge, and so are `extend=` and `inherit` placeholders. A restyle emits a
    whole gradient of its own: CSS cannot turn `var(--brand)`.
  - **The editor's gradient controls rewrite the text.** A gradient is its one
    string, in a role or in the palette. The controls take the string apart,
    change one piece and write it back whole, named arguments in the order the
    function declares them. The stops come first, since the colors are what a
    gradient is. A ruler lays them left to right by position, whatever the
    gradient's kind or angle, with a handle each: dragging a handle is how a
    stop moves, so its order and its position are one thing, and a click on the
    ruler adds one there. A stop with no written position sits where CSS would
    spread it, and is given a position only when it is dragged, or when another
    stop's move would shift it. Under the ruler is a row per stop, in the
    ruler's order, opening the same editor any color is chosen in, so a stop can
    be anything a stop can be. Where there is a gradient it could restyle, the
    rows share their place with a second tab, Use, which lists them: choosing
    one makes this gradient a restyle of it, and going back to Stops gives it
    that gradient's stops as its own, laid out as it was drawn. Under those are
    its kind, the arguments that kind takes, and repeat, beside a swatch of the
    gradient as it is really drawn. `space` has no control and is written in the
    file. A gradient is changed many times in one sitting, so while its panel is
    open undo and redo step through those changes one at a time, a whole drag or
    a whole pick being one step; closed, the sitting is one step of the page's.
    The text shows only when it does not read as a gradient, to be typed right.
  - A gradient with no `space` blends in the browser's default, which is sRGB
    when every stop is an old-style color and OKLab otherwise — so a stop
    outside sRGB, written twice for wide-gamut screens, blends differently
    there. That is CSS working as specified, and `space=` is there for whoever
    wants it pinned.
  - `background-size` is not part of a gradient and stays in the stylesheet.
    Left out until something needs them: a conic stop's position in degrees, and
    a hue direction such as `longer hue`.
  - The `tailwind` output gives a gradient role a class of its own,
    `@utility bg-<role> { background-image: var(--<role>) }`, where a color role
    is wired into `@theme inline` as `--color-<role>`. Tailwind documents no
    theme namespace for an image, and a gradient wired in as a color becomes
    `background-color`, which it is not valid in. Checked in Tailwind 4.3.3: the
    class takes variants like any other. A `--background-image-*` theme variable
    makes the same class there, but is not in Tailwind's documented namespaces,
    so it was not relied on.
  - A hex color after a space starts a YAML comment, so a ref holding one is
    quoted whole: `"gradient(paper #000000)"`.
- **A definition can resolve and still not be writable.** Settled 2026-11-20. A
  role that is a gradient in one mode and a color in another has a value in
  every mode, so it resolves and draws, and is reported in `problems` rather
  than thrown. The emitters refuse a definition with problems, so `dtg build`
  fails as it would on an error, and the editor refuses to save one. This is
  what lets the editor change a role one mode at a time: the state in between is
  kept, shown on the role's row, and blocks Save until it is put right. An error
  is still what has no value to draw: an unknown ref, a selector that does not
  read. A role that says the same ref in every mode only follows the role it
  points at, so the problem is reported where the mix is written. Writing a
  color mode as a flat gradient was considered, to make the mix legal, and
  turned down: the variable would change meaning by mode in ways the definition
  does not show.
- `none`, CSS's missing component, reads as `0` in any slot. It's a spelling:
  `oklch(70% 0 none)` and `oklch(70% 0 0)` are the same gray, and whether a
  color has a hue is decided by its chroma (see Color spaces). Writing back puts
  `0`.

Removed spellings are still detected and error with a pointer, rather than being
silently ignored: a top-level `emit:` block (replaced by inline `alias`),
`emits:` on a system (renamed to `alias`; the error also points at `publish`), a
color written in `systems` (moved to `palette`), scale's `stops` (replaced by
its 0–1000 selector, `midpoint` and `publish`), `blend` and `compose` (replaced
by a group of tints), the algorithm names `ink-ramp` and `oklch-scale` (now
`tint` and `scale`), and the slash spelling of a ref (`sky/3/ink`, now
`sky(3 tint)`), where the error spells out the replacement. Keep that pattern
for any future grammar change.

One renamed key is still read instead: `emit`, on a palette group or a system,
is the earlier spelling of `publish` (renamed 2026-11-21) and means the same. It
was too widely written to refuse. A block that writes both is an error, and the
editor edits whichever one the file has, writing `publish` when there is
neither. When the editor reads a file that still writes `emit`, it offers
rewriting each one as `publish` as one unsaved change, renaming only the keys;
Discard drops it, and it is offered again the next time the file is read. The
docs and examples use only `publish`.

## Algorithms

Five built-ins, each _total_, with no optional-parameter modes. Settled
2026-11-22: three are the core, and the README tells people to start with them;
the other two are demonstrations of what an algorithm can be, each following one
outside model of building a ramp.

The core:

- **`tint`** (`base`, `tint`, both required): a tint composited over base; the
  selector is the tint's alpha percent. The token name doubles as the recipe, so
  `light-15` is 15% ink. Steps are opaque surface colors, and the ramp also
  backs `transparent()`. Composited in encoded sRGB.
- **`curve`**: a ramp drawn through a picked color, shaped by editable curves.
  The anchor alone gives a usable ramp from the curves' defaults, which is why
  it, not `scale`, is the ramp to start with. See below.
- **`overlay`** (`color`): color at selector % opacity, never flattened. Shadows
  and scrims. This is why `shadow` is not a baseless tint: what kind of value a
  system produces is the **algorithm's nature**, declared once in the systems
  block, never a per-role flag.

The demonstrations:

- **`scale`** (`base`, `toward: [light, dark]`, `hueShift`, `midpoint`):
  Mosaic's model, a ramp between end colors you pick. A continuous curve through
  the base in OKLCH. The selector is any stop 0–1000: 0 is `toward[0]`, 500 the
  base, 1000 `toward[1]`. The share of base at a stop is its distance from the
  near end raised to a power; `midpoint` (default 0.5, a straight line) is the
  share at 250 for the light half and at 750 for the dark half, and sets the
  power. `hueShift` 0 locks every stop to the base hue, 100 follows the natural
  interpolated hue path. `midpoint` and `hueShift` are each one number for both
  halves or a `[light, dark]` pair (the number kind's `ends: 2`); the editor
  always shows both ends and writes the shortest form. Blended in OKLCH from
  OKLab. Scale was a lookup table of named stops; a single curve fit mosaic's
  hand-picked table to within ΔE 1.2 and made every stop between addressable.
- **`tone`**: Material 3's model, a palette whose selector is lightness itself.
  See below.

### `curve`

Settled 2026-10-19 while trying to replicate Tailwind's palette, which `scale`
could not: Tailwind's steps are hand-picked, with uneven lightness gaps, chroma
that peaks at 400 or 600 rather than at the base, and hue that turns as warm
colors darken. `curve` exists to explore that shape. It was experimental until
2026-11-22; its params, like every other algorithm's, now change only through a
removed or earlier spelling.

```yaml
blue:
  algorithm: curve
  params:
    anchor: hues.blue # the ramp passes through it exactly
    at: 500 # where the anchor sits
    gamut: display-p3 # what full chroma is measured against
    lightness: { from: 0.97, to: 0.25 } # OKLab lightness
    chroma: { from: 0.4, to: 0.7 } # share of the gamut's maximum
    hue: {
        from: 0,
        to: -32,
        easing: [[0.33, 0.33, 0.67, 0.67], [0.6, 0, 0.8, 1]],
      } # degrees from the anchor's
```

- **The selector is a position, 0–1000,** so `blue(500)` emits
  `--blue-500`. The number is relative to the pick, as in Tailwind and
  Material 2: `at` declares where the anchor sits, and `blue(at)` is the anchor
  exactly. A step number does not mean the same lightness across hues. An
  algorithm whose selector _is_ lightness is a separate one (`tone`, on the
  roadmap), because the selector's meaning is the algorithm's nature.
- **Three channels, each a curve:** lightness (OKLab L), chroma (a share of the
  most `gamut` holds at that lightness and hue), and hue (degrees from the
  anchor's). A curve runs `from` its value at 0, through the anchor's own value
  at `at`, `to` its value at 1000. `easing` is two CSS
  `cubic-bezier(x1, y1, x2, y2)` lists, before the anchor and after it: x in
  0–1, y free, so a curve can overshoot. The default,
  `[0.33, 0.33, 0.67, 0.67]`, is a straight line with its handles a third of the
  way along, where the editor can grab them. A field left out takes the
  default's, so `{ from: 0.4, to: 0.7 }` is a whole curve.
- **`curve` is a param kind,** not something only this algorithm knows. An
  algorithm declares `{ kind: "curve", along, min, max, default }`; dtg checks
  the fields, the bounds and the easing, and fills what is left out. `along`
  names the selector field the curve runs along, here `stop`, and the curve
  spans that field's range. Where it passes through what the algorithm holds
  fixed comes from the optional `curvePivots(params)` hook; the math that runs a
  curve through its pivot is one function, `curveAt`, shared by the algorithm
  and the page.
- **The page draws a curve from what the algorithm produces,** not from drawing
  instructions. Because the curve runs along a selector field, dtg resolves the
  system at evenly spaced points along it and sends those colors with the curve,
  and places each emitted step on it by reading the step's value for that field.
  The page shows the colors as a strip under the curve and the steps as dots in
  their own colors; both follow a drag, since previews are resolved like
  everything else.
- **One control per curve.** In `dtg edit` a curve param is a chip in the params
  row showing the curve in small, with the anchor marked. It opens like a number
  param does: the curve to drag (its ends up and down, its four easing handles
  anywhere) with `from`, `to` and the easing as numbers below, tried live on the
  page and kept on close. An edit writes the whole curve as one flow map.
- **Chroma as a share of the maximum** keeps every step inside `gamut` while the
  shares stay at or below 1, and lets chroma peak where the gamut is widest
  without a param for it. An anchor outside `gamut` has a share above 1 and
  pulls its neighbors out with it; the outputs map them.
- **`gamut` defaults to `display-p3`,** the most vivid rendition that stays
  compatible: P3 screens get the full color and the CSS carries the nearest sRGB
  color for the rest. On sRGB screens, neighboring steps past the sRGB edge land
  on it together, so a shaped chroma curve looks flatter there. `gamut: srgb`
  keeps the curve exact everywhere.
- The math is OKLCH from OKLab throughout, like `scale`.

**Why `scale` and `curve` both exist.** Settled 2026-10-19. They share a
selector meaning (a position relative to a pick) and an operation (interpolating
channels through it), and `scale` can nearly be written as a `curve`. They stay
separate anyway, because an algorithm is allowed to be specific: it serves the
way an app wants to make its colors, not every way.

- `scale` is for one ramp steered by two end colors and a `midpoint`: pick a
  base and where it should end up. That is how Mosaic makes its ramps, and the
  colors-as-ends input is the point of it, not a limitation.
- `curve` is for a family of ramps that should behave alike, or a shape that
  needs channel-by-channel control. Its curves can live in `defaults`, so every
  hue shares one shape and each system is just an anchor; tweaking the shared
  curve moves every ramp together. It is also the one for shapes two end colors
  cannot make (chroma peaking off the base, hue turning only in the darks) and
  for steps that must stay in gamut by construction.

What `curve` showed that does generalize is the `curve` param kind: shapes
inside an algorithm are curves, drawn and edited the same way wherever they
appear. `tone` will use them along lightness, which needs the pivot to be
optional.

### `tone`

Settled 2026-10-19. Where `curve` makes the pick a step, `tone` makes it a
source: the pick lends its hue (and, unless told otherwise, its chroma), and the
palette is generated by walking lightness from 0 to 100.

```yaml
primary: { algorithm: tone, params: { anchor: brand, chroma: 0.09 } }
tertiary: { algorithm: tone, params: { anchor: brand, chroma: 0.06, hue: 60 } }
```

- **The selector is tone, 0–100, and tone is CIELAB L\*.** `primary(40)` emits
  `--primary-40`, and every palette's 40 is equally light. Because L\* is
  a function of luminance alone, so is contrast: any tone 40 is about 6.5:1
  against white, any tone 50 about 4.5:1, whatever the hue. That is the reason
  to choose `tone`, and it holds exactly.
- **Params:** `anchor` (a color); `chroma`, OKLCH chroma, optional, the anchor's
  own when left out; `hue`, degrees from the anchor's OKLCH hue, default 0;
  `gamut`, default `srgb`. Where a tone cannot hold the chroma inside `gamut`,
  it gets the most it can, at the same tone and hue. With `chroma` left out and
  `hue` at 0, the palette passes through the anchor at the anchor's own tone.
- **Material 3-style, not Material-exact.** Material builds its palettes in HCT:
  tone is L\*, hue and chroma come from CAM16. Only the tone half carries the
  contrast guarantee, so `tone` keeps L\* exactly and holds hue and chroma in
  OKLCH like the rest of dtg, instead of porting CAM16 and its solver (Google's
  `@material/material-color-utilities` does not run in plain Node either).
  Measured against Material's own palettes for four source colors, the
  difference is 0.001–0.005 on average and at most 0.014 (OKLab ΔE; about 0.02
  is just noticeable), largest at tone 10. The numbers differ in meaning,
  though: Material's chroma 36 is CAM16 chroma, about 0.09 in OKLCH.
- **`gamut` defaults to `srgb`,** unlike `curve`: `chroma` here is absolute, and
  a palette that never leaves sRGB looks the same on every screen, as Material's
  does.
- The math: a tone fixes a luminance; `tone` finds the OKLab lightness at which
  the color, at that hue and (gamut-held) chroma, has it.

### The seam: color-math owns color, algorithms own vocabulary

`color-math.ts` holds every arithmetic operation and every color format. An
algorithm declares its params, declares what its selector is made of, turns a
selector into a color, and describes itself. Nothing else.

The algorithm chooses the vocabulary — which fields a selector has, what they
are called, which forms it offers. How a selector is _written_ is dtg's, in
`selector.ts`, and so are the public name, the ordering and the error messages
that follow from it. This was reopened on purpose on 2026-10-12: algorithms used
to parse their own selector text, which left dtg able to read a ref but not to
explain, draw or write one.

This is why the built-ins look redundant and are not. `tint` in its `tint` form
and `overlay` produce byte-identical values — `rgba(0, 26, 40, 0.03)` for the
same input, verified in the tests. They differ in what a _reader_ sees:

    tint      sky(3)          emits --light-3
    overlay   shadow(3)       never flattens, and says so declaratively

There was a third, `blend`: one base and several named colors, with the name
inside the selector (`warm(red 6)`). It was tint with several tints, and its
selector changed shape with its params. It was removed on 2026-10-16: several
tints over one ground are now a group of tints (`warm-wash.red(6)`), so the
color is found by walking the tree, every tint has the same selector, and the
picked colors live in the palette. Its `space` param went with it; nothing used
anything but srgb, which is what tint's compositing is.

`--light-15` only reads as "15% ink" because tint declares a selector of
one number. Folding these into one configurable algorithm would put the
selector's shape behind a param — configuration that changes syntax, which is
harder to read than four separately-named files of twenty to sixty lines.

The failure mode to watch is the opposite one: arithmetic drifting _up_ into the
algorithms. It has happened twice. `publicStep` was derived in three places and
one copy silently emitted a broken Figma alias. Formatting a translucent color
was implemented four times — three algorithms and the resolver — and they
disagreed about whether alpha arrived as a percent or a fraction. Both are now
single functions in `color-math.ts`. If you find yourself writing color
arithmetic or a color string inside `algorithms/`, it belongs one level down.

### Color spaces: how a color is written, what it is, and where the math runs

Settled 2026-10-19, after a Tailwind replication exposed that a color's written
form was changing results.

Three things that used to blur together are kept apart:

- **The written form** is how a definition spells a color: hex, `oklch()`,
  `oklab()`, `color(srgb …)`, `color(display-p3 …)`. It is kept only to write
  the file back and to emit the authored bytes exactly. It never reaches the
  math.
- **The value** is what the color is, held in OKLab. It's unbounded, so any
  color from any gamut fits, and the same color has the same value however it
  was written.
- **The math space** is the set of numbers an operation averages, and it is the
  algorithm's choice, part of what the algorithm means. The same two colors mix
  to different colors in each: 50% black over white is `#808080` in encoded
  sRGB, `#bcbcbc` in linear light, `#636363` in OKLab. `color-math.ts` offers
  `composite(layer, ground, alpha, space)` over `srgb`, `display-p3`, `linear`
  and `oklab`; the encoded spaces extend past 0–1, so a color outside them is
  carried rather than clipped. An algorithm may fix its space or expose it as a
  param.
  - `tint` composites in **encoded sRGB**, fixed. That is the long-standing
    meaning of opacity in CSS and Figma, and every existing tint keeps its value
    byte for byte.
  - `scale` blends in **OKLCH**, converted straight from OKLab, with no detour
    through RGB channels.

Browsers composite in the space of the surface they draw on, not one tied to the
color: Chrome flattens P3 red at 60% over white to `color(display-p3 1 0.4 0.4)`
on a P3 canvas and to the clipped sRGB result on an sRGB canvas. So a flattened
step matches its translucent twin (`sky(15)` and `sky(15 tint)`) exactly for
sRGB colors on an sRGB surface. For a color outside sRGB no flattened value
matches every surface; `tint`'s answer is about 0.03 (OKLab ΔE) from a P3
surface's for P3 red at 60%, and dtg's near-gray tints differ by under 0.001.

A gamut appears only at the edges: the project's `gamut` warns about authored
colors, and the outputs encode into sRGB and P3. No algorithm receives or infers
a gamut. `widestGamut`, which guessed one from how inputs were written, is gone.
It is why an `oklch()` base outside sRGB was clipped, and why the same blue
written as hex and as `color(display-p3 …)` produced different steps.

**Hue.** Whether a color has a hue is a property of its value, never of its
spelling. A color whose chroma is below ε (1e-5) has no hue. ε sits in a wide
gap: exact hex grays carry rounding noise up to about 4e-8, and the least
colorful non-gray hex color (`#feffff`) has chroma of about 1e-3. Where an
operation needs a hue that a color doesn't have (a blend, or `scale` holding its
base hue), it takes the other color's hue. If neither has one, the result is
gray. This replaces three thresholds that disagreed: 0.001 in blending, 5e-5
when writing back, and none at all for `scale`'s base hue, which made a gray
base lock to noise.

### The algorithm contract

`src/contract.ts` defines `Algorithm`:

- `name` is what a system's `algorithm:` names.
- `description` is one short paragraph, rendered in the browsing UI: what the
  algorithm makes and what its step means, with no examples.
- `params` declares each param's kind: a color, a number, a choice, or a list or
  map of those. dtg checks a system's params against it once — unknown, missing
  and malformed params all fail there — and hands every hook the parsed result:
  colors as colors, defaults filled in. It is also how dtg knows which params
  are colors, for the gamut warnings and for the browsing UI; the resolver adds
  whether each came from the system's own `params` or the shared `defaults`
  block. Every kind takes an optional `description`, one line on what the param
  does, which the editor shows as a tooltip on the param's name. A number with
  `ends` may be written as one value or one per end of the selector's range.
- `selector(params)` returns the selector's shape: its `fields` in written order
  (a number in a range, or a choice among options the params supply) and the
  `forms` it offers. Fields take an optional `description`, and forms one each
  through `formDescriptions`, shown as tooltips where a step is chosen.
- There is no emit hook. What can be _addressed_ is the selector's; what is
  written out is the definition's — a system's `publish` list plus demand.
- `resolve(selector, params)` returns a color. The selector arrives parsed, one
  value per field plus `form`. It throws with a human-readable message on a
  selector the system cannot produce.
- `curvePivots(params)` is optional: for each `curve` param, the position and
  value it passes through, so the page can draw the curve. Only an algorithm
  with curve params has it.
- `curveSwatch(params, name, value)` is optional: the color a value of a `curve`
  param stands for, painted behind the curve in the editor. It never reaches an
  output.
- `profile` is optional: the channels the editor plots the system's ramp in, one
  lane each — `oklab.l`, `cielab.l`, `oklch.c`, `oklch.h`, `alpha` — and OKLab
  lightness, OKLCH chroma and hue when unset. The profile is measured from what
  `resolve` returns, sampled densely along the selector, so this names a ruler,
  not drawing data: `tone` declares `cielab.l` so its lightness reads straight,
  and `overlay` declares `alpha` alone because opacity is all it varies.

There are no naming or ordering hooks. A step's public name is its fields joined
by `-`, then the form (`sky(3.5 tint)` emits as `3_5-tint`), and steps sort
field by field with the plain value before its forms. Add a hook when an
algorithm needs something else, not before.

An algorithm that composites publishes its layer as a further selector —
`sky(3 tint)`, `warm(red 6 top)`. That is not a core function, and was
deliberately not made one: `X(ref)` would promise it works on any color while
only working on algorithms that composite, with nothing at the call site to say
which. It cannot be a transformation of the output either, because flattening
destroys information: you cannot recover ink and alpha from a flattened hex. The
system re-runs the recipe and stops before compositing.

The registry is open. `resolveDefinition(yaml, extraAlgorithms)` merges project
algorithms over built-ins, so a project can bring its own generation methods, or
shadow a built-in by name. Nothing loads one yet; the design for doing so is in
`project-algorithms.md`.

## Rules the design settled (and why)

1. **Rigidity comes from closed sets, so every set is open.** Collections,
   groups, roles, systems, algorithm params, selectors. What is fixed is only
   the plumbing contract that lets tooling stay generic.
2. **Determinism is non-negotiable.** Same definition, same bytes. The
   definition is data (YAML, no computation); expressions are parsed, never
   evaluated as code.
3. **Explicit over inferred.** A role's emitted value must be readable from its
   own line plus the systems block, never inferred from what a system happens to
   support, so an edit on one side cannot silently reinterpret the other.
4. **No sugar in the role grammar.** `translucent: true` (auto-twin) was
   designed and then deliberately killed: uniform `name: [refs]` beats saving
   two lines. Twins are declared as sibling roles
   (`primary-translucent: [sky(15 tint), ...]`), so twinship stays recoverable
   by inspection.
5. **Overrides pin flattened steps only, with any opaque color.** An override
   takes any color the grammar accepts, so a wide-gamut step can be pinned
   exactly. It must be opaque, because it stands in for a flattened step. The
   uncomposited form always follows the recipe, and the resolver warns when the
   two overlap. Hand-tunes are explicit, visible, and survive regeneration.
   Exceptions either get promoted into the system later or stay flagged, never
   silent.
6. **Constants are published, systems publish what they list, roles reference.**
   A palette color is always published. A system step exists because a ref
   demands it or the system's `publish` lists it — never because of which
   algorithm it is. A role emits as a reference to what it points at, and a
   literal emits its value, and so does `transparent()`, which demands nothing.
7. **Repetition is a promotion signal.** A derivation appearing twice is a named
   system trying to be born. New functions and algorithms arrive when a caller
   exists, never for symmetry. No generic `alpha()` until something needs it.

## Code map

ESM TypeScript in `src/`, with explicit `.js` extensions on relative imports
(NodeNext). `pnpm build` compiles to `dist/`; the `dtg` bin is `dist/cli.js`.
Consumers run `dist/`, so rebuild after edits or they see stale code.

- `cli.ts` — command dispatch and flag parsing for `edit`, `build`, `docs`,
  `compare` and `skill`.
- `compare.ts` — `dtg compare`: an old stylesheet against the CSS the
  definition builds, every `var()` followed to its color, mode by mode, by
  OKLab ΔE. It reads just enough CSS for that (custom properties in plain
  blocks, `.mode` and `[data-*]` selectors) and passes over `@supports` and
  `@media`.
- `skill/` (outside `src/`) — the guide `dtg skill` prints for coding agents,
  and the Claude Code stub `dtg skill setup` writes. The guide covers what a
  power user knows beyond the README, not the grammar; it is shipped in the
  package, so an agent reads the version the project has installed.
- `outputs.ts` — writing the configured outputs for a resolved definition.
  `build` calls it once, or on every change with `--watch`; `edit --build` calls
  it whenever the definition file changes. Outputs follow the file on disk,
  never the working copy's unsaved edits. Writing outputs is always an explicit
  action — `dtg build`, or the `--build` flag on one `edit` run. No setting in
  `dtg.config.yaml` can turn it on: a config file must not be able to overwrite
  the files an app ships.
- `config.ts` — reading `dtg.config.yaml`, and `dtg init`'s placeholder for it.
  Where the definition is has no default; the config or a flag names it.
  Precedence is CLI flags, then `dtg.config.yaml`, then defaults.
- `resolve.ts` — the grammar lives here. YAML in, `ResolvedDefinition` out
  (systems with their steps, statics, collections, roles with a ref per mode,
  plus accumulated warnings). Public-name resolution is here too: `aliasedName`,
  `publicSystemName`.
- `contract.ts` — the `Algorithm` interface.
- `params.ts` — a system's params checked against what its algorithm declares,
  and parsed.
- `ref-functions.ts` — the functions a ref can call, each with what its
  arguments accept and which are named; and a gradient's text taken apart and
  written back, which is how the editor changes one piece of one.
- `selector.ts` — how a selector is written, and the public name and ordering
  that follow from it. The only file that knows the spelling.
- `algorithms/` — the three built-ins.
- `color-math.ts` — hex parsing, compositing, and the OKLCH and OKLAB math.
- `emit.ts` — the CSS and DTCG emitters.
- `dev-server.ts`, `dev-state.ts`, `watch.ts` — the HTTP and SSE server and
  definition file watching. The server holds no markup and draws nothing: it
  serves one HTML shell, the built editor bundle, and `/api/state`, the working
  copy with the settings around it. It resolves only to write outputs and to
  refuse a definition that is broken at startup.
- `app-shell.ts`, `site.ts` — the app's one HTML page, and `dtg docs`, which
  writes that page, the bundle and the definition as files. The page names its
  mode: `served` by edit, or `static`, where the app reads `state.json` beside
  it, addresses pages in the fragment so any host at any folder can serve it,
  and saves nothing. A static page built with `--editable` keeps its visitors'
  edits in the page alone (`ui/store.ts`).
- `edit.ts` — writing one value into the definition's text: an authored color,
  or the ref a role holds for a mode. An edit is a `set`, which needs a value to
  write over, or for a constant also an `add`, `rename` or `remove`. A rename
  carries the constant's pointers with it: each ref, `transparent()` and color
  param naming it is rewritten in the same splice, while an `alias` or changelog
  note that reads the same is not. Systems and roles are added, renamed and
  removed whole the same way, and a system's `publish` list is set whole. A
  constant or a role can be moved within its group, or placed at another dotted
  path, which writes the groups on the way that are not there. A group is not
  edited apart from what it holds: it is written with its first entry and goes
  with its last, and renaming one rewrites every ref into it. Keeping `add`
  apart from `set` is what lets an unsaved edit to a constant the file has since
  lost be dropped, rather than bring it back. The new value is spliced over the
  old one's exact span, so an edit is the one-line diff a person would have
  typed; re-serialising the YAML restyles the whole file. A ref edit can also
  carry `~`, putting a mode back to inheriting; a ref for a mode past the end of
  the role's list is added to it, with `~` holding any modes in between.
- `dev-settings.ts` — what a project keeps under `editor` in `dtg.config.yaml`
  for the editor's own use: today the background to view each mode on. The
  server reads it, watches it, and writes it straight to the file when the Modes
  page changes it. It is config, not the definition, so it stays out of the
  working copy and its undo, and `emit` never reads it.
- `working-copy.ts` — the file's text plus the edits not yet written to it. An
  edit names a color, not a line, so unsaved edits survive the file changing
  underneath them. The dev server holds one working copy, draws the app from it,
  and writes the file only when asked to save. Edits come in steps, which is
  what one undo takes back: randomizing a palette set is one step of many edits.
  What counts as a change follows an entry through renames, its own and those of
  the group, system or role that holds it, so renaming one back is no change at
  all.
- `snapshot.ts` — the resolved definition as plain data for the pages to draw,
  built in the page from the working copy.
- `ui/` (outside `src/`) — the browsing UI, a React app bundled by Vite into
  `dist/ui/`. It runs the resolver, the edits and the color math itself
  (`ui/engine.ts`), so the pages and the emitters run the same code.

Errors accumulate rather than throwing on the first problem, so one resolve
reports everything wrong with a definition. Keep that.

## Verification

There are no unit tests. Verification is the dev server plus, when adopting an
existing palette, **parity against the shipped stylesheet**: resolve the
definition, compare emitted primitives byte for byte, and chase every semantic
`var()` chain to its final value.

Parity is a strong acceptance test because a correct migration produces a
knowable diff, not zero diff. Expect three categories, and expect to justify
each one:

- unreferenced primitives disappearing under demand-driven emission
- hand-tunes that survive as declared `overrides`
- hand-drift the system deliberately absorbs, which is the class of bug the tool
  exists to prevent

Anything outside those three is a real defect. Promoting this check into a
`check` command is on the roadmap.

## Roadmap

- [x] Definition grammar, resolver, built-in algorithms
- [x] The editor (`dtg edit`): a page per system with demanded-by lineage,
      algorithm description and params, and adjacent-step OKLAB ΔE; a page per
      group of roles with side-by-side modes. A background per mode, white or
      black by its scheme, or a color or ref set in `editor.backgrounds`, so
      colors are judged on their ground, with chrome flipping to a dark scheme
      on dark backgrounds. Stdlib HTTP plus SSE live-reload on definition edits;
      a resolve error keeps serving the last good state behind an error banner.
      Restart to pick up changes to the tool's own code.
- [x] CSS emitter (`dtg build`, `dtg emit` until 0.3.0): `@theme` primitives
      block, `:root` and `.dark` semantic blocks, `@theme inline` wiring for
      every role. Public naming is inline via `alias`.
      `format: plain` (the default) emits primitives into `:root` instead, for
      any project not on Tailwind. Emit also writes DTCG when asked: the same
      collections, modes, values and aliases, plus a stable identity in
      `$extensions` as `id` — a role's internal path, a demand-driven step's
      lineage — so a courier can tell a rename from a create. `$description` is
      the author's `description`; until 0.3.0 it held the identity. An agent may
      ferry the payload; it never invents values.
- [x] Palette: a `palette:` block of the colors picked by hand, read before
      `systems`. Each group is a palette page in `dtg edit`, listed under
      Palette with an "all" table of every color. A page adds, renames, removes,
      locks and randomizes its colors (space rolls every unlocked one); a color
      the file does not have yet is renamed after its nearest color name on each
      roll, and once saved its name stays. Every palette color is published,
      since apps use them directly, unless its group says `publish: false`; an
      unsaved roll never reaches the outputs anyway.
- [x] Palette groups have a circular visualization prototype with two views: a
      2D HC disk and a fixed-camera 3D HCL volume. Hue runs clockwise from 0° at
      the top/back; chroma is radius in both views, and lightness is height in
      3D. Neutral colors sit at the center or on the center axis. Switching
      views animates the disk's tilt and the points' height over 650ms,
      preserving selection and authored colors. A second switch reverses from
      the current position; reduced-motion preferences skip the transition. Plot
      editing waits until the transition finishes. The colored disk is a fixed L
      0.72 reference mapped to sRGB, not a literal lightness-zero slice; points
      keep their actual colors. Stems connect each 3D point to its HC position
      on the base. A legend selects any color; count badges cycle overlapping
      points. Selection never changes the camera or reference background. In 2D,
      dragging edits H and C while preserving L. In 3D, vertical dragging edits
      only L; switching to 2D edits H/C. Clicking a swatch opens the original
      picker. Adding immediately enters an unlocked color in the working copy.
      Randomize and Space roll unlocked colors independently of selection. A
      plot drag is one undo step; Save writes the constants. The same locks
      prevent plot dragging, Randomize and Harmonize; locked points show a lock
      and can still be selected. The original picker remains available for
      editing an authored value directly. The visualization, its view controls,
      Randomize's style and Harmonize sit in a sidebar on the right with its own
      scrolling area. It opens with the settings button at the top right and
      closes with × or Escape; whether it is open is kept per browser, like the
      layout, and it starts closed the first time.
      Randomize sits beside the button, and Space still rolls colors while the
      sidebar is closed. Hovering between two swatches, or past the last, shows
      a + that adds an unlocked color at that place. A layout control shows the
      palette as a Strip, a Grid or a List, kept per browser. The List is the
      table the page of all colors draws, with the same row: reorder, rename by
      dotted path, duplicate, remove, lock. Randomize rolls any color, or with
      its style set, any hue at the base color's lightness and chroma. Harmonize
      moves the unlocked colors' hues onto a scheme around the base (analogous,
      complementary, triad, evenly spaced), keeping each color's lightness and
      chroma. The base is the color set as base, or the first locked one. Names,
      selection and opacity stay; one undo takes the whole action back.
      Double-clicking empty disk space adds an opaque color at that hue and
      chroma. In 3D, this targets the base disk. Lightness comes from the color
      selected before the first click, or the palette's median; with no colors,
      it is 0.65. Dots, axes and labels do not add.
- [x] `dtg docs`: the editor as static files, read-only, for a site's `public/`
      folder or GitHub Pages. `emit` became `build` alongside it, so each
      command names what it makes.
- [x] Params and `defaults` naming a palette color (`base: hues.sky`). Renaming
      a palette color rewrites every ref, `transparent()` and param that names
      it.
- [x] Picker: a bar with the mode and close. On a param or shared default the
      mode is Picker or Palette; palette mode lists the palette colors and
      choosing one writes a reference, and the editor opens in the mode the
      value is written in. The picker's "steps" toggle turns its field into a
      grid of lightness by share-of-maximum-chroma cells, with the sRGB edge
      drawn along the seams.
- [ ] Rolls that keep the locked colors' lightness and chroma and vary only hue.
- [x] `curve` editor: each curve param is one chip, a small drawing of the
      curve, that opens to drag the curve and type its numbers.
- [x] `tone`: an algorithm whose selector is lightness itself, as in Material
      3's tonal palettes. Tone is L\* exactly; hue and chroma are OKLCH, which
      lands within 0.014 of Material's HCT palettes.
- [ ] `tone` with curves: chroma and hue as `curve` params running along tone,
      which needs a curve's pivot to be optional.
- [ ] Multi-file definitions (`shadows.dtg.yaml`, `type.dtg.yaml` as siblings,
      one resolver over all). Discovery exists; merging does not.
- [x] Designer tweaking in the editor: every param, ref and palette color has a
      control. The page resolves edits itself; `dtg edit` keeps the working copy
      and writes the file on save, one-line splices that keep comments.
      `dtg docs --editable` keeps edits in the page alone.
- [x] Live CSS for a host page: embedded in an iframe, the editor posts the CSS
      for what it shows to the page around it, so real components render under a
      proposed palette as it is edited. The host can post back a
      `dtg:background` color so a docked panel is drawn on the page's own
      background.
- [ ] Specimens: auto-generated nested surfaces, labels at small sizes on every
      surface, 1px separators and states, for the portable case with no host
      page.
- [ ] Figma sync. `emit` already writes the payload as DTCG (collections via
      `$extensions`, modes, values, aliases by path, no file IDs). Delivery
      paths, ranked: (1) an agent courier replaying the payload through a plugin
      console, required for a first sync that must reconcile drifted names in an
      existing file, where renaming keeps variable IDs so mockups stay wired and
      anything ambiguous is skipped and reported; (2) the endgame, a thin plugin
      fetching `/figma.json` from the dev server, putting the reconcile loop
      behind a button inside Figma with no Enterprise plan and no agent; (3)
      Figma's _official_ DTCG import plugin is seed-only, since it only adds and
      never updates — emitting DTCG does not change that, it only makes the
      payload standard for our own courier. Every path is Plugin API underneath:
      the REST variables API is Enterprise-only in both directions.
- [ ] `check` command: definition versus emitted artifact drift, inert
      overrides, longhand-sugar detection.
- [ ] Custom algorithm loading from a project path. `resolveDefinition` already
      accepts a registry; the CLI does not load one yet.
- [ ] Playground (parked). The tool's edge over a picker is that play happens in
      parameter and ref space rather than color space. Candidates: a ΔE and
      contrast comparator that accepts refs rather than hexes (compare `sky(8)`
      against `night(8)`, asking whether the modes step at the same rate);
      generated candidate ramps from structured randomization of algorithm
      params, rendered beside the current system with delta rows aligned; more
      generally, ephemeral editor-only systems with full instrumentation,
      promotable into the definition when they win. This subsumes the tweak
      panel, since a tweak is a one-parameter candidate.

## Process

Decisions in this file were reached deliberately and should be treated as
settled unless reopened on purpose. Extend the system the same way: agree on the
shape first, build in small steps, verify after each. The definition file is the
unit of change. If a proposed feature cannot be expressed as "edit one line of
YAML, regenerate," question the feature.
