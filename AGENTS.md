# dtg — agent notes

**Read `docs/how-this-works.md` before changing anything.** It is the design
doc: the grammar, the algorithms, and — most importantly — the decisions
that were settled in long-form conversation with John and should not be
re-litigated (no middle scale tier, no role flags, no literals in the
semantic tier, demand-driven primitives, deterministic generation, explicit
over inferred). `README.md` is the user-facing summary of the same system.

Working notes:

- Source is ESM TypeScript in `src/` with explicit `.js` extensions on
  relative imports (NodeNext). `pnpm build` → `dist/`; the `dtg` bin is
  `dist/cli.js`.
- Sunnyday (`~/Projects/sunnyday/sunnyday-app`) consumes this package as
  `link:../../dtg` until it's published — **consumers run `dist/`, so
  rebuild after edits or they see stale code**.
- Conventions the tool promises (see README): definitions in
  `design-tokens/*.dtg.yaml`, optional `dtg.yaml` project config at root,
  outputs default beside the definitions. Flags > `dtg.yaml` > defaults.
- No test files; verification is the dev server, and (for Sunnyday) parity
  of emitted CSS against what the app shipped.
- Extend by conversation with John first, in small steps. If a feature
  can't be expressed as "edit one line of definition, regenerate," question
  the feature.
