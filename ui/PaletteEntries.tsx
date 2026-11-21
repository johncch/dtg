import { CircleOff } from "lucide-react";
import type { SnapshotConstant, SnapshotGradient } from "../src/snapshot.js";
import { Hint } from "./Hint.js";
import { isGradient, type Paint } from "./paint.js";

/** A palette entry as its row and its tile show it: a color, or a gradient written among the colors. */
export type PaletteRow = {
  path: string;
  cssName: string;
  emitted: boolean;
  written: string;
  paint: Paint;
  usedBy: SnapshotConstant["usedBy"];
  paramOf: SnapshotConstant["paramOf"];
};

/** The palette entries written straight in `group` (`""` for the palette itself), colors and gradients together, in the order written. */
export function paletteRows(group: string, constants: SnapshotConstant[], gradients: SnapshotGradient[], order: string[]): PaletteRow[] {
  const rows: PaletteRow[] = [
    ...constants.map((constant) => ({ ...constant, paint: constant.color })),
    ...gradients.map((named) => ({ ...named, paint: named.gradient, paramOf: [] })),
  ];
  return rows.filter((row) => groupOf(row.path) === group).sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
}

function groupOf(path: string): string {
  const cut = path.lastIndexOf(".");
  return cut === -1 ? "" : path.slice(0, cut);
}

/** The variable a palette entry emits as. */
export function paletteVariable(row: PaletteRow): string {
  return `--${isGradient(row.paint) ? "gradient" : "color"}-${row.cssName}`;
}

export const NO_LOCK = "A gradient is never rolled, so it stays locked";

/** Marks a gradient among a palette's colors: it is drawn where it is written, and the tools that make colors pass over it. */
export function NotAColor({ className = "palette-not-a-color" }: { className?: string }) {
  return (
    <Hint text="Gradients cannot be used in color tools">
      <span className={className} aria-label="Gradients cannot be used in color tools">
        <CircleOff size={12} aria-hidden />
      </span>
    </Hint>
  );
}
