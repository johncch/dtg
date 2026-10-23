import type { Gamut } from "./color-math.js";
import type { BackgroundOverrides } from "./dev-settings.js";
import type { ModeRendering } from "./emit.js";
import type { WorkingCopy } from "./working-copy.js";

/**
 * What `dtg edit` hands the page at `/api/state`: the working copy and the
 * settings around it. The page resolves the copy itself; the server only
 * keeps it, applies edits to it, and reads and writes the files.
 */
export type DevState = {
  copy: WorkingCopy;
  /** Unsaved changes that could not be carried over when the file changed. */
  notices: string[];
  /** dtg itself was rebuilt since the server started. */
  stale: boolean;
  gamut: Gamut;
  /** The definition file's full path. */
  definitionPath: string;
  /** The full path of the `dtg.config.yaml` the settings are kept in, whether or not it exists yet. */
  configPath: string;
  /** Editor backgrounds set by hand in `dtg.config.yaml`, by mode. */
  backgroundOverrides: BackgroundOverrides;
  /** How the project's CSS renders modes, so CSS the page emits for a host matches the site's own selectors. */
  cssModes: ModeRendering;
};
