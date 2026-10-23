# dtg

**A design token should be an address in a parameter space, not an entry in
a list.**

`@fifthrevision/dtg` turns color rules into design tokens. You write a YAML
definition of how your colors are _made_, and it compiles into CSS
variables, a DTCG token file, and an editor to tune them in.

Most palettes start as a system, a few picks and a rule for the steps
between them, and end as a list of hexes that drifts as people edit it. dtg
keeps the rule in the file. A _system_ is an algorithm plus a few anchors: a
gray ramp is "this ink over this base," and asking for `gray(3)` gives the
step at 3% ink. _Roles_ such as `surface.canvas` or `label.secondary` point
at steps, never at hexes, so every color traces back to an anchor and
changing one parameter moves everything derived from it. The argument is in
[Store colors as algorithms, not hexes](https://fifthrevision.com/writing/2026/Introducing-Design-Tokens-Generator.html).

## First run

```
pnpm add -D @fifthrevision/dtg
npx dtg init
npx dtg edit
```

`init` asks where the definition should live and writes a starter there,
with a `dtg.config.yaml` pointing at it. `edit` opens the editor; edits
are written back to the file. `npx dtg build` writes the CSS beside the
definition.

## Starting from the colors you have

Put your hexes in `palette`, name roles, and point them at those colors. A
definition with no systems is valid.

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

Where a group of picks is really a ramp, replace it with a system and
compare the two in `dtg edit`. Pin a step that must stay exact with
`overrides`. The role names do not change, so neither does anything that
uses them.

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

Three tiers: `palette` holds the colors you picked, `systems` holds the
recipes, and every other top-level key is a collection of roles, in groups.

```yaml
dtg: 1

modes: [light, dark]

palette:
  white: "#ffffff"
  hues:
    emit: false # inputs for systems, not published on their own
    brand: "#03a2e8"

systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
  night:
    algorithm: tint
    params: { base: "#151c1f", tint: "#fafdff" }
  theme:
    algorithm: scale
    params: { base: hues.brand, toward: ["#fafdff", "#001a28"] }
    emit: [50, 500, 950] # published whether or not a role asks
  shadow:
    algorithm: overlay
    params: { color: "#000000" }

core:
  surface:
    canvas: [sky(3), night(0)] # one ref per mode, in `modes` order
    floating: [surface.card, night(6)] # roles can point at roles
    card: [sky(0), night(4)]
  state:
    hover: [sky(3 tint), night(3.5 tint)] # the ink alone, uncomposited
    scrim: [shadow(40), shadow(60)]
    veil: [transparent(white 70), transparent(white 40)]
  label:
    primary: { omit: true, refs: [night(0), sky(0)] } # emits --label
    secondary: [night(30), sky(40)]
```

A ref is a constant by path, a step, another role, or `transparent(name
pct)`. A role is one ref per mode, and nothing else. `emit` publishes steps
no role asks for, `defaults` shares params across systems of one algorithm,
`alias` and `omit` shape public names. The full grammar and the reasoning
behind it are in [`docs/how-this-works.md`](docs/how-this-works.md).

## Choosing an algorithm

| Algorithm | The selector is                                                | Reach for it when                                              |
| --------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `tint`    | percent of ink over a base: `sky(15)`                          | neutrals: surfaces, separators, text on a known ground          |
| `scale`   | a stop 0 to 1000 through your color at 500: `theme(600)`       | a brand or accent ramp around one pick                          |
| `overlay` | percent opacity of a color, never flattened: `shadow(40)`      | shadows and scrims                                              |
| `curve`   | a position on a ramp whose lightness, chroma and hue you shape | reproducing a hand-picked palette with uneven steps. Experimental |
| `tone`    | lightness itself, 0 to 100: `primary(40)`                      | contrast you can promise per tone, as Material 3 does. Experimental |

The algorithm decides what a step is, once, in the systems block. Each
one's params are documented in the editor, on the system's page.

## Examples

`init` asks what the definition starts as: the starter, a blank with only
the modes, or a complete example. `--from` answers for it:

```
npx dtg init --from tailwind
```

- `tailwind`: Tailwind v4's palette as `curve` systems sharing one lightness
  curve. [Source.](https://github.com/johncch/dtg/blob/main/examples/tailwind.dtg.yaml)
- `material`: Material 3's scheme as `tone` systems, contrast held per tone.
  [Source.](https://github.com/johncch/dtg/blob/main/examples/material.dtg.yaml)

## Publish and embed

`dtg docs --out <dir>` writes the editor as static files for any host.
With `--editable`, visitors can try edits in their own page; nothing is
saved.

In an iframe, the editor posts the CSS for whatever it shows, edits
included, so a page built on the variables re-skins live:

```js
const frame = document.querySelector("iframe#dtg");
const style = document.head.appendChild(document.createElement("style"));
addEventListener("message", (event) => {
  if (event.source === frame.contentWindow && event.data?.type === "dtg:css") {
    style.textContent = event.data.css;
  }
});
frame.contentWindow.postMessage({ type: "dtg:css?" }, "*");
```

## Config

`dtg.config.yaml` at the project root names the definition and the outputs.
Nothing is written unless asked.

```yaml
definitions: src/colors.dtg.yaml # or a folder of *.dtg.yaml
outputs:
  css:
    path: src/colors.generated.css
    format: tailwind # default plain
  dtcg: src/colors.json # omit and no DTCG is written
gamut: srgb # the widest colors you mean to author; default display-p3
```

Name no outputs and you get CSS beside the definition, named after it:
`colors.dtg.yaml` gives `colors.generated.css`. Flags override the config.
`dtg --help` lists every flag and output.

The editor shows each mode on white or black, by its scheme. To view a mode
on another background, set it on the Settings page, which keeps it in the
config:

```yaml
editor:
  backgrounds:
    dark: surface.canvas # a color or a ref, per mode
```

## Commands

```
dtg init [--definition <file>] [--from <name>]   # a definition and config; asks what it is not told
dtg edit [--port <n>] [--build]      # open the editor; --build also writes outputs on change
dtg build [--watch]                  # write the configured outputs
dtg docs --out <dir> [--editable]    # the editor as static files
```

## Status

0.4. In production use on one design system and the products built on it.
Ahead: project-defined algorithms, multi-file definitions, design-tool sync
through the DTCG file, and a `check` command for drift.
