import type { AppMode } from "../src/app-shell.js";

/**
 * Served by `dtg edit`, with the API behind it, or a static copy written by
 * `dtg docs`, which reads its state from a file and saves nothing. The page
 * says which; it cannot change while the page is open.
 */
const mode = document.querySelector('meta[name="dtg-mode"]')?.getAttribute("content") as AppMode | null;

export const STATIC = mode === "static";

/** Whether colors can be edited: always when served, and in a static copy built with `--editable`, where edits live in the page alone. */
export const EDITABLE = !STATIC || document.querySelector('meta[name="dtg-editable"]')?.getAttribute("content") === "true";

/** Whether there are files to write: the definition on save, and the settings. */
export const SAVABLE = !STATIC;
