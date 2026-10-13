import { useSyncExternalStore } from "react";
import { hexToOklab, toOklab, type Color, type Oklab } from "../src/color-math.js";

type Named = { name: string; lab: Oklab };

/**
 * The name list is a few thousand entries nobody needs to read the page, so
 * it is its own chunk, fetched the first time something asks for a name.
 */
type Names = { status: "unasked" } | { status: "loading" } | { status: "ready"; named: Named[] } | { status: "failed" };

let names: Names = { status: "unasked" };
const listeners = new Set<() => void>();

function set(next: Names) {
  names = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (names.status === "unasked") {
    set({ status: "loading" });
    import("color-name-list/bestof").then(
      ({ colornames }) =>
        set({ status: "ready", named: colornames.map(({ name, hex }) => ({ name, lab: hexToOklab(hex) })) }),
      () => set({ status: "failed" }),
    );
  }
  return () => listeners.delete(listener);
}

/**
 * The nearest named color, as a handle to remember a color by — "the base is
 * Dusk" — not a statement of what it is. Nearest by distance in OKLab, which
 * tracks how different two colors look. Null until the list has arrived.
 */
export function useColorName(color: Color): string | null {
  const current = useSyncExternalStore(subscribe, () => names);
  if (current.status !== "ready") return null;
  const [L, a, b] = toOklab(color);
  let nearest = current.named[0];
  let least = Infinity;
  for (const candidate of current.named) {
    const distance = (candidate.lab[0] - L) ** 2 + (candidate.lab[1] - a) ** 2 + (candidate.lab[2] - b) ** 2;
    if (distance < least) {
      least = distance;
      nearest = candidate;
    }
  }
  return nearest.name;
}
