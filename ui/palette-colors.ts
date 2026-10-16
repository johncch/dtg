import { createContext, useContext } from "react";
import type { SnapshotConstant } from "../src/snapshot.js";

const PaletteColors = createContext<SnapshotConstant[]>([]);

export const PaletteColorsProvider = PaletteColors.Provider;

/** Every palette color, for the picker's palette mode to offer. */
export function usePaletteColors(): SnapshotConstant[] {
  return useContext(PaletteColors);
}
