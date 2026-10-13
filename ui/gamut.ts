import { createContext, useContext } from "react";
import type { Gamut } from "../src/color-math.js";

const ProjectGamut = createContext<Gamut>("display-p3");

export const ProjectGamutProvider = ProjectGamut.Provider;

/** The project's gamut: the widest colors the definition means to use, and so the widest a picker offers. */
export function useProjectGamut(): Gamut {
  return useContext(ProjectGamut);
}
