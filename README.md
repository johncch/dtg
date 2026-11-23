# dtg

**The definitive color tool to create, iterate and maintain color tokens in
design systems for the long haul.**

This tool was created to scratch my own itch: a long, long time ago, I used to
build color systems by picking colors in a design tool or generating them with
an online tool. This worked well for a while, but eventually when I needed to
change something about the colors, the updates would become increasingly
time-consuming and painful because I would've forgotten how they came about in
the first place. A system that was supposed to be clean and regimented would
then descend into chaos.
[I make the full argument here](https://fifthrevision.com/writing/2026/Introducing-Design-Tokens-Generator.html).

dtg (`@fifthrevision/dtg`) keeps color tokens alongside the methods used to
generate them. We start with the **palette**, add the **systems**, and then the
**roles** that use them. This is all written down in a definition file. That
way, you come back later, make one small tweak to any part of the definition,
and you will get back a coherent whole.

Here's an example of dtg in production:
[the Mosaic Design System](https://fifthrevision.github.io/mosaic/#/colors).

## Quick start

If you have `npm`, it's as easy as:

```sh
npx @fifthrevision/dtg edit --build
```

After a few quick questions, you will get a fully working color system. Adjust
as you deem fit, and save to write the definition file. `--build` will write the
CSS that is ready to be used in code. Use **Export** to preview or download the
result as CSS, Tailwind, SCSS or DTCG.

For longer term usage, I suggest adding it to your `package.json`:

```sh
pnpm add -D @fifthrevision/dtg
# or
npm install --save-dev @fifthrevision/dtg
# then
npx dtg edit --build
```

`npx dtg build` writes the CSS once, for a build script or CI. `dtg init` sets
up a project without opening the editor.

## Commands

```sh
dtg init  [--definition <file>] [--from <name>]   # set up a project; asks what it isn't told
dtg edit  [--port <n>] [--build]                  # open the editor; offers setup if there's no project
dtg build [--watch]                               # write the configured outputs
dtg docs  --out <dir> [--editable]                # the editor as static files
dtg compare <stylesheet>                          # what moved against what build writes
dtg skill [setup]                                 # the guide for coding agents
```

`dtg compare` is for moving an existing stylesheet onto dtg. It reads both,
follows every `var()` to the color it ends at, and lists, mode by mode, what
moved and by how much (OKLab ΔE, where about 0.02 is just noticeable), and the
colors only one side has.

## Concepts

A definition has three kinds of things: palette colors, systems, and roles.

**Palette.** A collection of colors, typically taken from your brand guide.
Colors defined here are published as variables by default so they can be used in
your applications. Set `publish: false` on a group to keep it internal.

**Systems.** Systems are the heart of dtg. A system defines the method by which
new colors are generated. It is a combination of an algorithm, its parameters,
and a few anchor colors. Typical uses include color scale generation or
compositing.

As an example, `tint` is a built-in algorithm that composites a tint color over
a base color. If you define a system called `sky` which uses `tint`, it can now
be used with any value, such as `sky(15)`. In this case, it applies a 15% tint
over the base.

**Roles, modes, and collections.** Roles are the workhorses of dtg. A role can
point at a hex color, a gradient, a palette color, a system value like
`sky(15)`, or another role. Name them for how the color is used, such as
`surface.canvas` or `label.secondary`. A role can point somewhere different in
each mode, such as light and dark, or one theme and another. Collections group
related roles.

Remember, collections and roles are free! Use them liberally to keep related
concepts together and unrelated ones apart.

These layers keep each decision in one place. Change a palette color and every
system anchored to it moves; change a system's params and every role on it
moves; repoint a role and only that role changes.

## Start from the colors you have

This might sound like a lot, but it can be really easy to start. From your
existing colors, put them in `palette`, then point to them using roles:

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

When a group of colors is really a ramp, replace it with a system (you can
compare them visually in the editor). Use `overrides` to adjust for specific
values if you have to. Now you can address any step in the ramp.

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

## The definition

A fuller definition, with two modes and all three layers:

```yaml
dtg: 1

modes: [light, dark]

palette:
  white: "#ffffff"
  hues:
    publish: false # inputs for systems, not published on their own
    brand: "#03a2e8"
  dawn: gradient(hues.brand 0% white 100% angle=180deg) # a named gradient

systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
  night:
    algorithm: tint
    params: { base: "#151c1f", tint: "#fafdff" }
  theme:
    algorithm: curve
    params: { anchor: hues.brand }
    publish: [50, 500, 950] # published whether or not a role uses them
  shadow:
    algorithm: overlay
    params: { color: "#000000" }

core:
  surface:
    canvas: [sky(3), night(0)] # one color per mode, in `modes` order
    floating: [surface.card, night(6)] # roles can point at roles
    card: [sky(0), night(4)]
    hero: [dawn, gradient(dawn angle=135deg)] # restyled where it's used
  link: ["#0066cc", "#66b3ff"] # literal colors
  state:
    hover: [sky(3 tint), night(3.5 tint)] # the ink alone, uncomposited
    scrim: [shadow(40), shadow(60)]
    veil: [transparent(white 70), transparent(white 40)] # transparent is a built-in function
  label:
    primary: { omit: true, refs: [night(0), sky(0)] } # published as --label
    secondary: [night(30), sky(40)]
```

A few notes on the snippet above:

- A role takes a list of colors, one per mode, in the order defined by `modes`.
  See [Modes](#modes) for more.
- Each color can be a palette color, a system value, another role, a literal, or
  one of the [built-in functions](#built-in-functions).
- `publish` adds steps that no role uses.
- `defaults` shares params across systems with the same algorithm.
- `alias` and `omit` change public names.

The full grammar, and the reasoning behind it, is in
[`docs/how-this-works.md`](docs/how-this-works.md).

## Algorithms

Algorithms are at the heart of what makes dtg special. An algorithm describes
how a color is generated; by setting the parameters, you get an addressable
system like `sky(15)` that materializes into colors at build time.

dtg ships five algorithms out of the box. Support for custom per-project
algorithms is on the roadmap. You probably want to start with these three:

| Algorithm | A step is                                                   | Use it for                                                 |
| --------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `tint`    | a percent of tint over a base: `sky(15)`                    | neutrals: surfaces, separators, text on a known background |
| `curve`   | a stop from 0 to 1000 on a ramp through your color          | brand and accent ramps                                     |
| `overlay` | a percent opacity of a color, never flattened: `shadow(40)` | shadows and scrims                                         |

### tint

`tint` lays one color over another and flattens the result into a solid color.
`sky(15)` is 15% of the tint over the base:

```yaml
sky:
  algorithm: tint
  params: { base: "#fafdff", tint: "#001a28" }
```

Since every step is solid, `tint` is great for things that sit on a background
you know, like surfaces and separators. When a color has to sit on top of other
things, like a hover state, write `sky(15 tint)` to get just the tint at 15%
opacity.

### curve

`curve` gives you a light-to-dark ramp through an anchor color. This is similar
to how most color scales in design systems are constructed today.

```yaml
blue:
  algorithm: curve
  params: { anchor: hues.blue }
```

That's it. From this definition, you can get all the way from `blue(50)` to
`blue(950)`. When you want a different shape, give lightness, chroma and hue a
curve each.

```yaml
blue:
  algorithm: curve
  params:
    anchor: hues.blue
    lightness: { from: 0.97, to: 0.25 } # at stop 0 and stop 1000, through the anchor's
    chroma: { from: 0.4, to: 0.7 } # a share of the most the screen can show
    hue: { from: 0, to: -12 } # degrees from the anchor's hue
```

The easiest way to shape the curves is to drag them in the editor. Put them in
`defaults` and every hue shares the same shape; that's how the
[Tailwind example](examples/tailwind.dtg.yaml) is built.

### overlay

`overlay` is one color at different opacities, and it's never flattened.
`shadow(40)` is the color at 40%:

```yaml
shadow:
  algorithm: overlay
  params: { color: "#000000" }
```

You could write `transparent(black 40)` instead, and get the same color. The
difference is that `overlay` makes it a family you can name and publish
together. Reach for it for shadows and scrims, where you don't know what's
underneath.

## More algorithms

`scale` and `tone` are here to show what else an algorithm can do. Each one is
much more opinionated than `curve`.

### scale

`scale` takes three colors: a base at 500, and the two colors at either end, 0
and 1000. It blends between them, so a typical use would be a saturated color
that blends more towards the surface color as it approaches the ends of the
scale:

```yaml
theme:
  algorithm: scale
  params:
    base: hues.brand
    toward: ["#fafdff", "#001a28"] # the colors at 0 and 1000
    midpoint: [0.5, 0.5] # how much of the base 250 and 750 carry
    hueShift: [0, 0] # how far hue drifts toward the ends, 0 to 100
```

`midpoint` bends the ramp, and `hueShift` lets the hue drift toward the end
colors. Both can be set separately for the light and dark halves.

### tone

`tone` is how Material 3 builds its colors. Given a color, it keeps the hue and
builds a ramp by lightness, so the same step is equally light whatever the
color. Swap purple for orange and every pairing stays just as readable:

```yaml
primary:
  algorithm: tone
  params: { anchor: hues.brand, chroma: 0.09 }
```

The anchor lends its hue and, unless you set `chroma`, its chroma. The
[Material example](examples/material.dtg.yaml) uses it.

## Modes

Modes are the sets of colors your roles switch between, such as light and dark.
The simplest way to write them is a list:

```yaml
modes: [light, dark]
```

Every role then lists one color per mode, in that order. If you don't write
`modes` at all, you get a single mode called `default`.

When you need more, write modes as a map instead:

```yaml
modes:
  light: { scheme: light }
  dark: { scheme: dark }
  dark-hc: { extends: dark }
  monochrome: { extends: light }
```

`scheme` says whether a mode is light or dark. dtg writes it into the CSS as
`color-scheme`, so form controls and scrollbars match, and the editor uses it to
pick a white or black background.

`extends` is where modes get useful. A mode that extends another starts as a
copy of it and only says what's different. Here, `dark-hc` is a high-contrast
version of dark and `monochrome` is light without the color, and most roles
don't need to mention them at all:

```yaml
roles:
  surface: [white, gray] # dark-hc uses dark's gray; monochrome uses white
  border: [gray, gray, white] # stronger borders in dark-hc; monochrome uses light's gray
  accent: [theme(500), white, ~, black] # ~ gives dark-hc dark's white
```

To skip a mode and still set one after it, use `~`. And since `dark-hc` copies
what a role points at rather than the color it ends up as, changing one role in
`dark-hc` moves every role that points at it there too.

In the CSS, the first mode goes on `:root` and every other mode is a class. Put
`.dark` or `.dark-hc` on `<html>`, or on any element, to switch what's inside
it. `.dark-hc` picks up everything from `.dark` and overrides only what it
declares.

## Built-in functions

dtg comes with two functions for the colors that don't fit neatly into a system.
You can use them anywhere a role's color goes.

### `transparent()`

Sometimes you just need a color at a lower opacity, like a veil over an image.
That's what `transparent()` is for:

```yaml
veil: [transparent(white 70), transparent(white 40)]
```

Give it any color (a palette color, a literal, a system value or another role)
and an opacity. If the color already has some transparency, the two multiply.
You can hand it a gradient too, and every stop gets that opacity.

One thing to know: `transparent()` works out a new color rather than pointing at
the old one. So `transparent(theme(500) 70)` won't publish `theme(500)` by
itself.

### `gradient()`

Gradients work the way you'd expect from CSS. List the colors, each with an
optional position, then add any settings by name:

```
gradient(hues.brand 0% sky(10) 60% white 100% angle=135deg)
```

Leave the positions out and dtg spreads the colors evenly. The settings are:

- `kind`: `linear` (the default), `radial` or `conic`
- `angle`: which way a linear gradient runs (180deg by default), or where a
  conic one starts
- `x` and `y`: the center of a radial or conic gradient, 50% by default
- `shape` and `size`: for radial gradients, as in CSS
- `repeat=true`: repeats the gradient
- `space`: the color space it blends in, such as `space=oklch`

If you use a gradient in more than one place, give it a name in the palette and
point at it like any other color. You can still tweak it where you use it:
`gradient(dawn angle=135deg)` is `dawn` turned to 135°, and
`gradient(dawn kind=radial)` spreads it out from the center.

Two gotchas. A role that's a gradient has to be a gradient in every mode. And
YAML treats a space followed by `#` as the start of a comment, so wrap anything
with a hex color inside it in quotes: `"gradient(white #000000)"`.

## Examples

dtg ships three examples. `dtg init --from <name>` starts a project from one;
use them as they are, or modify them to your needs:

- `starter`: five hues as `curve` scales, neutrals for light and dark, and two
  collections of roles, gradients and `transparent()` included. It's what
  `dtg init` starts from unless you pick another.
  [Source.](https://github.com/johncch/dtg/blob/main/examples/showcase.dtg.yaml)
- `tailwind`: Tailwind v4's palette as `curve` systems that share one lightness
  curve.
  [Source.](https://github.com/johncch/dtg/blob/main/examples/tailwind.dtg.yaml)
- `material`: Material 3's color scheme as `tone` systems, with contrast held
  per tone.
  [Source.](https://github.com/johncch/dtg/blob/main/examples/material.dtg.yaml)

## Coding agents

dtg ships a guide for coding agents: how to convert an existing color system,
what the names will be, and when to hand a decision back to you. Install it
as a Claude Code skill in your project:

```sh
npx dtg skill setup
```

That writes `.claude/skills/dtg/SKILL.md`, a few lines that tell the agent to
run `npx @fifthrevision/dtg skill` and follow what it prints, so the guide
always matches the dtg your project has installed. `npx dtg skill` prints it
for any other agent.

## Share the editor

Want to show your color system to someone who doesn't have dtg? Run:

```sh
dtg docs --out <dir>
```

That writes the editor as static files you can host anywhere. Visitors can
browse every color, system and role. Add `--editable` and they can try changes
too, right in their browser. Nothing is ever saved.

## Config

Every project has a `dtg.config.yaml` at its root. `dtg init` and `dtg edit`
write one for you, and most projects only need `definitions` and one output.
Here's one with everything in it:

```yaml
definitions: src/colors.dtg.yaml # or a folder of *.dtg.yaml
outputs:
  css: src/colors.generated.css # or tailwind:, for a Tailwind v4 build
  scss: src/_colors.scss
  dtcg: src/colors.json
gamut: srgb
editor:
  backgrounds:
    dark: surface.canvas
```

Command-line flags override anything here, and `dtg --help` lists them all.

### Outputs

Outputs are written only when you run `dtg build` or `dtg edit --build`.

If you don't name any, you get CSS next to the definition, named after it:
`colors.dtg.yaml` produces `colors.generated.css`. Once you name one, you get
exactly the ones you named.

- `css` is a path, or `{ path, modes }`. Every color is named as it is in the
  definition: `palette.white` is `--white`, and `sky(10)` is `--sky-10`.
  `modes` is `nested` (the default), where each mode is a class, or `flat`,
  where the mode is part of every variable's name.
- `tailwind` is the same, for a Tailwind v4 build. Palette colors and system
  steps go in `@theme` as `--color-white` and `--color-sky-10`, so they get
  utilities like `bg-sky-10`, and every role is wired in too. Use it instead of
  `css`, not beside it.
- `scss` is a path. Sass variables are always flat.
- `dtcg` is a path, or `{ path, colorSpace }`. `colorSpace` is `srgb` (the
  default) or `display-p3`. Figma holds one color space per file, so match the
  file you're bringing the tokens into.

### Gamut

`gamut` is the widest colors you mean to use, `srgb` or `display-p3` (the
default). The color picker stops there, and a color past it gets a warning.
Nothing is changed for you.

### Editor backgrounds

The editor shows each mode on white or black, depending on its scheme. To
preview a mode on a different background, set one on the Modes page, and it's
saved here. Any color a role can point at works.

### Tailwind and gradients

With the `tailwind` output, each color role gets the usual utilities
(`bg-surface-card`, `text-surface-card`). A gradient role gets a single class,
`bg-surface-hero`, which sets `background-image`. Two things to watch for:

- Don't use `bg-linear-(--surface-hero)`. It expects a list of color stops and
  wraps them in another `linear-gradient()`.
- `tailwind-merge` treats unknown `bg-` classes as background colors. It drops a
  color class written next to the gradient, and won't let `bg-none` remove it.
  Add the gradient classes to its `bg-image` group, or write
  `bg-(image:--surface-hero)`, which it handles correctly.

## Sync to Figma

If you want your colors in Figma, write a DTCG file and ask your AI agent to
update Figma from it. Add the output to your config and build:

```yaml
outputs:
  css: src/colors.generated.css
  dtcg: src/colors.json
```

Then point your agent at `colors.json` and a Figma file it can edit, and ask it
to bring the variables up to date.

DTCG on its own only says what each color is. dtg writes extra metadata into the
file, under `$extensions`, so an agent can keep Figma consistent from one sync
to the next:

- **Collections and modes.** Each collection of roles, and the systems, say
  which Figma collection they belong in, and every role has a value for every
  mode.
- **Aliases stay aliases.** A role that points at a system value or another role
  is written as a reference, so it becomes a Figma alias, not a copy of the
  color.
- **Stable identities.** Every color carries an id that survives a rename, so
  the agent can tell a renamed color from a new one. It renames the variable
  instead of creating another, and your designs stay connected.
- **Instructions for the agent.** The file says how its values should be written
  into Figma, so you don't have to explain it.
- **Your notes.** Anything in the definition's `changelog` travels with the
  file, so you can tell the agent what changed and why:

  ```yaml
  changelog:
    - 2026-11-20: renamed surface.base to surface.canvas
  ```

One thing you have to do by hand: Figma reads every color in the file's color
profile, and a plugin can't change it. Set the document's profile to match the
DTCG's `colorSpace` (`srgb` by default) before the first sync.

Why not Figma's own DTCG import? It only adds variables and never updates them,
so it's fine for a first import but can't keep a file in sync.
