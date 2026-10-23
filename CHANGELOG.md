# Changelog

## [0.4.0] - 2026-10-22

### Start here

- `dtg init` writes a working definition, not just a config. It asks where
  the definition should live and what it starts as: a starter, a blank, or
  the Tailwind or Material example. `--definition` and `--from` answer for
  it.
- An unnamed CSS output is named after its definition: `colors.dtg.yaml`
  gives `colors.generated.css`. It was `tokens.generated.css` for everything.
- The README is a quick start. The argument for the model moved to
  [Store colors as algorithms, not hexes](https://fifthrevision.com/writing/2026/Introducing-Design-Tokens-Generator.html).

### Algorithms

- `curve` (experimental): a ramp through a picked color, shaped by
  lightness, chroma and hue curves you edit in the browser.
- `tone` (experimental): the selector is lightness itself, CIELAB L\*, so
  contrast per tone holds across hues, as in Material 3.
- Color math runs in OKLab and in the widest space its inputs use, so a
  wide-gamut anchor is no longer clipped to sRGB on the way in. Some
  chromatic stops shift by one in a channel; plain CSS gains a
  `@supports (display-p3)` block for colors sRGB cannot show.

### Grammar

- `domain` is now `group`, in the definition and in the browser's URLs.
- Edits through a YAML alias are refused, and the browser shows what an
  anchor is shared with.

### Browser

- Resolution runs in the page. The dev server serves the working copy at
  `/api/state`; `state.json` replaces `snapshot.json` in `dtg docs`.
- `dtg docs --editable` lets visitors try edits in their own page.
- Embedded in an iframe, the browser posts its CSS as `dtg:css` on every
  change, and takes `dtg:background` from the host.
- The chrome is built on Mosaic's base stylesheet, with a narrow layout
  under 640px. No bundled fonts; the system stack.
- The overview page is gone. `/` is the definition, which now carries the
  warnings; the sidebar's top links are Definition and Settings.

### Package

- `exports` declares the API: `resolveDefinition`, `emitCss`, `emitScss`,
  `emitDtcg` and their types at the root, the CLI at `./cli`. Deep imports
  of `dist/` no longer resolve.
- The examples ship in the package, for `init --from`.
