# Plan: fifthrevision.com

Migrating fifthrevision.com's color system onto dtg, and using it as dtg's
first non-Tailwind consumer. Sunnyday validates the Tailwind path; this site
validates everything else, and its gaps are the point rather than an
obstacle.

Repo: `~/Projects/fifthrevision`. Jekyll, Dart Sass (`sass: style:
compressed`), npm with `package-lock.json`. dtg is on npm at 0.1.0.

## What is there today

All color lives in `_sass/themes/_theme.scss`, in three groups.

**Five background gradients** — `lightWarm`, `lightCoolDawn`,
`lightCoolDusk`, `lightWarmDawn`, `darkPalette`. Each a 178deg
`linear-gradient` of five near-white (or near-black) stops, each with a
hand-maintained `display-p3` twin. `_main.scss:17` sets `background-size:
100% 1200px`, so the gradient is a repeating band and stop positions are tied
to a length.

**Semantic colors** — `$primaryFontColor`, `$secondaryFontColor` (alpha
0.7), `$tertiaryFontColor`, dark-mode counterparts, `$hoverBackground` /
`$darkModeHoverBackground`, `$codeBackground` /
`$darkModeCodeBackground`, `$selectionColor`, `$figureBorderColor`,
per-theme `$*Highlighter`.

**Two full-spectrum gradients** used in borders.

**Themes are selected per page, not by class.** `_data/themes.yml` maps a
theme name to a stylesheet; `_layouts/base.html:56` links
`warmdawnmode.css` / `darkmode.css` on top of `style.css`. Consumption is
compile-time Sass (`theme.$x`), including inside `linear-gradient()` and
inside `@if $mode == dark` branches in `mixins/_typography.scss`.

## What the audit found

Evidence that the system is more coherent than the file admits.

**One ink, three alphas, written out three times:**

```scss
$selectionColor:         rgba(253, 107, 98, 1);
$codeBackground:         rgba(253, 107, 98, 0.15);
$darkModeCodeBackground: rgba(253, 107, 98, 0.2);
```

That is `overlay: { color: "#fd6b62" }` at selectors 100, 15, 20 — expressible
today. Same for `$hoverBackground` / `$darkModeHoverBackground` (white at 70%
and 8%) and `$figureBorderColor` (`rgba(67,94,118,0.07)`).

**The background and border gradients share a palette.** Solving each warm
stop back to an ink over white at the minimum valid alpha — the point where
the first channel hits zero, giving maximum chroma:

| stop | min α | ink | border gradient |
|---|---|---|---|
| `rgb(250,240,240)` | 5.9% | `#aa0000` | `#b30a0a` |
| `rgb(250,244,240)` | 5.9% | `#aa4400` | `#af4f0b` |
| `rgb(246,248,251)` | 3.5% | blue | `#6192bb` |
| `rgb(252,246,253)` | 3.5% | magenta | `#c86dd7` |

Four hue families, used at ~5% for surfaces and at 100% for borders. The
relationship is currently invisible in both directions.

**Dark mode is a bottom swap.** Dark stops measured against
`$darkPalette-c1` = `rgb(28,24,24)`:

| dark stop | delta from ground | matching light stop |
|---|---|---|
| `rgb(25,24,35)` | `(−3, 0, +11)` blue | `rgb(246,248,251)` |
| `rgb(27,24,27)` | `(−1, 0, +3)` magenta | `rgb(252,246,253)` |
| `rgb(28,24,24)` | warm | `rgb(250,240,240)` |

Same hue families recomposed over a dark ground. Stop order and alphas
differ, so this is a family match, not an identity.

**The p3 twins have already drifted.** Four themes follow a straight `/255`
component copy exactly. `lightWarmDawn` does not:

| Sass | straight /255 | shipped p3 |
|---|---|---|
| `rgba(255,245,254)` | `1 0.961 0.996` | `0.99 0.96 0.99` |
| `rgba(252,252,255)` | `0.988 0.988 1` | `0.99 0.99 1` |
| `rgba(245,251,255)` | `0.961 0.984 1` | `0.97 0.98 1` |

Eyeballed to two decimals while every other theme is precise. Exactly the
drift the README opens with.

**A fifth copy of the palette lives in YAML.** `_data/themes.yml` carries
`themeColor: "#faf0f0"` per theme for the `<meta name="theme-color">` tag.

## Blockers in dtg

See `docs/roadmap.md` for the design of each.

| Need | Status | Blocks |
|---|---|---|
| Plain-CSS emit target | Settled, unbuilt | Everything. Current output is Tailwind-only and silently inert elsewhere. |
| `compose` algorithm | Settled, unbuilt | Phase 2 onward |
| Selector ownership hooks | Settled, unbuilt | `compose` (determinism) |
| Gradients tier | Designed, not settled | Phase 3 |
| Themes with inheritance | Designed, not settled | Phase 4 |
| p3 emit + gamut in color-math | Open question | Phase 5 |
| JSON / `_data` emit | Later | Phase 6 |

## Phases

Each phase leaves the site shippable.

**0 — Plain-CSS emit.** In dtg, not the site. Nothing below is verifiable
until a browser accepts the output.

**1 — Semantic slice.** `modes: [light, dark]`. Migrate `label.*`,
`state.hover`, `state.code`, `state.selection`, the mat-item shadow
(`rgba(0,0,0,0.4)`), and `figureBorderColor`. Roughly a dozen roles, all
expressible with today's `ink-ramp` and `overlay`. Gradients stay in Sass,
untouched.

This exercises `ink-ramp`, `overlay`, `transparent()`, role-to-role refs,
`alias`, and `omit` against a real non-Tailwind consumer without needing a
single new feature. `font-color($level, $mode)` in
`mixins/_typography.scss` loses its `$mode` parameter and becomes a
`var()` lookup.

**2 — Declare the inks.** Build `compose`. Pick the alpha convention per
gradient (see open decisions) and declare the four hue families as tops.
Gradient stops become generated; the border gradient points at the same tops
at 100%. Values will shift slightly — this is a re-derivation, not a
transcription.

**3 — Gradients tier.** Page backgrounds become generated compositions.
Angle and stop positions move into the definition. Carry or document the
`background-size: 100% 1200px` coupling.

**4 — Themes.** Collapse the five stylesheets into one plus a class on
`<html>` from `base.html` (the theme name is already computed there).
Delete `_cooldawnmode.scss`, `_coolduskmode.scss`, `_warmdawnmode.scss`.
`_darkmode.scss` shrinks to whatever is genuinely not a token.

**5 — p3.** Emit the `@supports` block; retire the hand-maintained twins and
the double-declaration pattern in every theme file. Resolve the
source-of-truth gamut question first.

**6 — `_data` emit.** `themeColor` comes from the definition.

## Verification

No test suite in dtg; verification is the dev server plus output parity.

- Phases 0–1 **must** be byte-stable on the colors they touch. Those values
  are transcribed, not re-derived. Diff the compiled `_site` CSS.
- Phases 2–3 **will** shift values. Record the alpha choice and the resulting
  inks in the definition, and review visually against the current site rather
  than diffing bytes.
- Phase 5 should be a no-op on sRGB output.

## Delivery mechanics

- The site is npm; dtg is pnpm. Install from the registry, not a link.
- Generated CSS is committed, so CircleCI and Vercel never run the Node step.
  Keep it that way.
- dtg requires Node >= 22.

## Open decisions

1. **The alpha convention per gradient.** It sets the inks, decides whether
   the background and border gradients can genuinely share a palette, and is
   the number that would be most painful to change once roles point at it.
   Minimum alpha gives maximum chroma and the most tuning headroom.
   Recommendation: one alpha per gradient, so the definition reads as "these
   four hues at 4%."
2. **May re-derived colors shift?** Phase 2 cannot reproduce the current
   hexes exactly unless the alphas are chosen to force it. Assume yes, small,
   and reviewed by eye.
3. **Do all five themes survive?** Four of them differ only in the background
   gradient and the highlighter. Worth asking whether that is still the
   intent before encoding it.
