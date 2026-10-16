import type { AppMode } from "../src/app-shell.js";

/**
 * Served by `dtg dev`, with the API behind it, or a static copy written by
 * `dtg docs`, which reads its snapshot from a file and edits nothing. The page
 * says which; it cannot change while the page is open.
 */
const mode = document.querySelector('meta[name="dtg-mode"]')?.getAttribute("content") as AppMode | null;

export const STATIC = mode === "static";
