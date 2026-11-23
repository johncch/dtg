import { createContext, useContext } from "react";
import type { CssFormat } from "../src/engine/emit.js";

const CssNames = createContext<CssFormat>("css");

export const CssNamesProvider = CssNames.Provider;

/** How the project's CSS output names a palette color: as written, or in Tailwind's namespaces. */
export function useCssNames(): CssFormat {
  return useContext(CssNames);
}
