import { parseColor, spacedSpelling, toOklab, type Color } from "./color-math.js";

type Block = { selectors: string[]; declarations: [string, string][] };

/**
 * Every block of custom properties in a stylesheet, in order. Blocks inside
 * `@supports` and `@media` are passed over: what is compared is the value
 * every browser gets. `@theme` counts as `:root`, which is where Tailwind
 * puts it.
 */
function readBlocks(css: string): Block[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Block[] = [];
  const preludes: string[] = [];
  let buffer = "";
  for (const char of text) {
    if (char === "{") {
      preludes.push(buffer.trim());
      buffer = "";
    } else if (char === "}") {
      const prelude = preludes.pop() ?? "";
      const conditional = [...preludes, prelude].some((p) => p.startsWith("@supports") || p.startsWith("@media"));
      if (!conditional) {
        const declarations = buffer
          .split(";")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("--") && line.includes(":"))
          .map((line): [string, string] => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]);
        const selectors = prelude.startsWith("@theme") ? [":root"] : prelude.split(",").map((s) => s.trim());
        if (declarations.length > 0) blocks.push({ selectors, declarations });
      }
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return blocks;
}

/** The mode a selector applies, `""` for the root, or null for a selector this cannot place. */
function modeOf(selector: string): string | null {
  if (selector === ":root" || selector === "html") return "";
  const match =
    /^(?::root|html)?\.([\w-]+)$/.exec(selector) ??
    /^(?::root|html)?\[data-[\w-]+=["']?([\w-]+)["']?\]$/.exec(selector);
  return match ? match[1] : null;
}

/** Each variable's value in one mode, as the cascade leaves it: the root, then that mode's blocks, later winning. */
function valuesIn(blocks: Block[], mode: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const block of blocks) {
    const modes = block.selectors.map(modeOf);
    if (modes.includes("") || modes.includes(mode)) {
      for (const [name, value] of block.declarations) values.set(name, value);
    }
  }
  return values;
}

function follow(values: Map<string, string>, name: string): string | undefined {
  const seen = new Set<string>();
  let value = values.get(name);
  while (value != null) {
    const pointer = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/.exec(value);
    if (!pointer || seen.has(pointer[1])) return value;
    seen.add(pointer[1]);
    value = values.get(pointer[1]) ?? pointer[2];
  }
  return value;
}

/** A value as a color, reading `rgba(1, 2, 3, 0.5)` as CSS does; undefined for anything else. */
function colorOf(value: string): Color | undefined {
  const legacy = /^([a-z]+)\(([^()]*,[^()]*)\)$/i.exec(value);
  try {
    return parseColor(legacy ? spacedSpelling(legacy[1].toLowerCase(), legacy[2]) : value, "compare");
  } catch {
    return undefined;
  }
}

export type Moved = { name: string; mode: string; before: string; after: string; deltaE: number; alpha: [number, number] };

export type Comparison = {
  modes: string[];
  /** Variables both stylesheets declare, in some mode. */
  shared: number;
  moved: Moved[];
  /** Values that are not colors, gradients among them, that differ as written. */
  differing: { name: string; mode: string; before: string; after: string }[];
  /** Colors only the old stylesheet declares. */
  onlyBefore: string[];
  onlyAfter: string[];
  /** Selectors in the old stylesheet that name no mode of the definition. */
  unplaced: string[];
};

const SAME_BELOW = 5e-5;

/**
 * An old stylesheet against the one dtg builds, variable by variable and
 * mode by mode, with every `var()` chain followed to the value it ends at.
 * Colors are compared in OKLab, where about 0.02 is the least difference
 * people notice.
 */
export function compareStylesheets(before: string, after: string, modes: string[]): Comparison {
  const beforeBlocks = readBlocks(before);
  const afterBlocks = readBlocks(after);
  const unplaced = [
    ...new Set(beforeBlocks.flatMap((block) => block.selectors).filter((s) => modeOf(s) === null || (modeOf(s) !== "" && !modes.includes(modeOf(s)!)))),
  ];
  const declared = (blocks: Block[]) => new Set(blocks.flatMap((block) => block.declarations.map(([name]) => name)));
  const beforeNames = declared(beforeBlocks);
  const afterNames = declared(afterBlocks);

  const moved: Moved[] = [];
  const differing: Comparison["differing"] = [];
  const isColorBefore = new Set<string>();
  modes.forEach((mode) => {
    const old = valuesIn(beforeBlocks, mode);
    const built = valuesIn(afterBlocks, mode);
    for (const name of beforeNames) {
      const oldValue = follow(old, name);
      if (oldValue != null && colorOf(oldValue)) isColorBefore.add(name);
      const newValue = follow(built, name);
      if (oldValue == null || newValue == null) continue;
      const a = colorOf(oldValue);
      const b = colorOf(newValue);
      if (a && b) {
        const [la, lb] = [toOklab(a), toOklab(b)];
        const deltaE = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
        if (deltaE >= SAME_BELOW || Math.abs(a.alpha - b.alpha) > 0.001) {
          moved.push({ name, mode, before: oldValue, after: newValue, deltaE, alpha: [a.alpha, b.alpha] });
        }
      } else if (oldValue.replace(/\s+/g, " ") !== newValue.replace(/\s+/g, " ")) {
        differing.push({ name, mode, before: oldValue, after: newValue });
      }
    }
  });
  moved.sort((x, y) => y.deltaE - x.deltaE || x.name.localeCompare(y.name));
  return {
    modes,
    shared: [...beforeNames].filter((name) => afterNames.has(name)).length,
    moved,
    differing,
    onlyBefore: [...beforeNames].filter((name) => isColorBefore.has(name) && !afterNames.has(name)),
    onlyAfter: [...afterNames].filter((name) => !beforeNames.has(name)),
    unplaced,
  };
}

/** The comparison as `dtg compare` prints it. */
export function formatComparison(comparison: Comparison, beforeName: string): string {
  const { moved, differing, onlyBefore, onlyAfter, unplaced } = comparison;
  const largest = moved.length > 0 ? `, largest ΔE ${moved[0].deltaE.toFixed(4)}` : "";
  const lines = [
    `${beforeName} against what dtg builds, in ${comparison.modes.join(", ")}`,
    `  ${comparison.shared} variables in both; ${moved.length} colors moved${largest}`,
  ];
  if (differing.length > 0) lines.push(`  ${differing.length} other values differ as written`);
  const list = (names: string[]) => names.slice(0, 12).join(" ") + (names.length > 12 ? ` (+${names.length - 12} more)` : "");
  if (onlyBefore.length > 0) lines.push(`  ${onlyBefore.length} colors only in ${beforeName}: ${list(onlyBefore)}`);
  if (onlyAfter.length > 0) lines.push(`  ${onlyAfter.length} only in dtg's: ${list(onlyAfter)}`);
  if (unplaced.length > 0) lines.push(`  not compared, naming no mode: ${unplaced.join(", ")}`);
  if (moved.length > 0) {
    lines.push("", "moved (OKLab ΔE; about 0.02 is just noticeable)");
    const width = Math.max(...moved.map((m) => m.name.length));
    for (const m of moved) {
      const alpha = Math.abs(m.alpha[0] - m.alpha[1]) > 0.001 ? `  alpha ${m.alpha[0]} → ${m.alpha[1]}` : "";
      lines.push(`  ${m.deltaE.toFixed(4)}  ${m.name.padEnd(width)}  ${m.mode}  ${m.before} → ${m.after}${alpha}`);
    }
  }
  if (differing.length > 0) {
    lines.push("", "differ as written");
    for (const d of differing) lines.push(`  ${d.name}  ${d.mode}  ${d.before} → ${d.after}`);
  }
  return lines.join("\n");
}
