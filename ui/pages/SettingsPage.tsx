import { useEffect, useState } from "react";
import { parseColor, type Color } from "../../src/color-math.js";
import type { BackgroundOverrides } from "../../src/dev-settings.js";
import { rolePath } from "../../src/selector.js";
import type { Snapshot, SnapshotMode } from "../../src/snapshot.js";
import { ColorTip } from "../ColorTip.js";
import { probeOf } from "../engine.js";
import { useProjectGamut } from "../gamut.js";
import { paintCss } from "../paint.js";
import { ValueEditor, type Drawn } from "../picker/ValueEditor.js";
import { Popup } from "../Popup.js";
import { useStore } from "../store.js";

/**
 * The definition's modes and how this app shows each: its scheme, and the
 * background its colors are seen on. A background changed here is written to
 * `editor.backgrounds` in `dtg.config.yaml` at once. It is config, not the
 * definition, so it is never one of the unsaved changes and undo does not
 * reach it.
 */
export function SettingsPage({
  configPath,
  snapshot,
}: {
  configPath: string;
  snapshot: Snapshot;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const store = useStore();
  const modes = snapshot.modeDetails;
  const overrides: BackgroundOverrides = Object.fromEntries(
    modes
      .filter((mode) => mode.backgroundOverridden)
      .map((mode) => [mode.name, mode.backgroundWritten]),
  );

  const write = (next: BackgroundOverrides) => {
    setFailure(null);
    store
      .setBackgroundOverrides?.(next)
      .catch((error: Error) => setFailure(error.message));
  };

  return (
    <>
      <h1>Settings</h1>
      <p className="sub">
        <code>{configPath}</code>
      </p>
      <h2>Modes</h2>
      <p className="sub">
        The definition's modes. Each one's colors are seen on its background:
        white for a light scheme, black for a dark one, or any color or ref set
        here, which is kept under <code>editor.backgrounds</code> in the config. A
        ref resolves in that mode.
      </p>
      <table className="modes">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Scheme</th>
            <th>Editor background</th>
          </tr>
        </thead>
        <tbody>
          {modes.map((mode, index) => (
            <ModeRow
              key={mode.name}
              mode={mode}
              modeIndex={index}
              snapshot={snapshot}
              onPick={(value) => write({ ...overrides, [mode.name]: value })}
              onDefault={() => {
                const { [mode.name]: _, ...rest } = overrides;
                write(rest);
              }}
            />
          ))}
        </tbody>
      </table>
      {modes.some((mode) => mode.schemeInferred) && (
        <p className="sub">
          A scheme marked inferred was read from the mode's colors.{" "}
          <code>scheme: light</code> or <code>scheme: dark</code> on the mode in
          the definition settles it, and lands in the CSS as{" "}
          <code>color-scheme</code>.
        </p>
      )}
      {failure && (
        <p className="changes-error">
          Could not write dtg.config.yaml: {failure}
        </p>
      )}
    </>
  );
}

/**
 * One mode. While its background is being picked the chip follows the pick,
 * the way a role's cell follows its ref; nothing else in the app redraws for
 * a background being tried, so what it comes to is worked out here. The
 * value is written when the panel closes.
 */
function ModeRow({
  mode,
  modeIndex,
  snapshot,
  onPick,
  onDefault,
}: {
  mode: SnapshotMode;
  modeIndex: number;
  snapshot: Snapshot;
  /** Called with the value as `dtg.config.yaml` would write it. */
  onPick: (value: string) => void;
  onDefault: () => void;
}) {
  const gamut = useProjectGamut();
  const [tried, setTried] = useState<string | null>(null);
  // A commit arrives as a new written value; the tried one stays on the chip until then, so it never flashes back.
  useEffect(() => setTried(null), [mode.backgroundWritten]);
  const drawn: Drawn =
    tried == null
      ? { kind: "color", color: mode.background }
      : comesTo(tried, snapshot, modeIndex, gamut);
  const shown = drawn.kind === "color" ? drawn.color : mode.background;
  return (
    <tr>
      <td>
        <code>{mode.name}</code>
      </td>
      <td>
        {mode.scheme}
        {mode.schemeInferred && <span className="de"> inferred</span>}
      </td>
      <td>
        <Popup
          title="Edit background"
          className="chip chip-editable"
          label={
            <>
              <span className="swatch">
                <span
                  className="swatch-color"
                  style={{ background: paintCss(shown) }}
                />
              </span>
              <code>{tried ?? mode.backgroundWritten}</code>
            </>
          }
          focus="panel"
          wrap={(button, open) => (
            <ColorTip color={shown} suppressed={open}>
              {button}
            </ColorTip>
          )}
        >
          {(panel) => (
            <ValueEditor
              value={mode.backgroundWritten}
              drawn={drawn}
              sources={["picker", "palette", "systems", "roles"]}
              constants={snapshot.constants}
              systems={snapshot.systems}
              roles={snapshot.roles.map((role) => ({
                path: rolePath(role),
                color: role.perMode[modeIndex].color,
              }))}
              panel={panel}
              onPreview={setTried}
              onCommit={onPick}
            />
          )}
        </Popup>
        {mode.backgroundOverridden && (
          <button type="button" className="btn btn-small mode-reset" onClick={onDefault}>
            reset
          </button>
        )}
        {mode.backgroundProblem && (
          <p className="ref-error">{mode.backgroundProblem}</p>
        )}
      </td>
    </tr>
  );
}

function colorOrNull(written: string): Color | null {
  try {
    return parseColor(written, "background");
  } catch {
    return null;
  }
}

/** What `written` comes to in the mode, resolved in the page against the definition as drawn. */
function comesTo(
  written: string,
  snapshot: Snapshot,
  modeIndex: number,
  gamut: ReturnType<typeof useProjectGamut>,
): { kind: "color"; color: Color } | { kind: "refused"; error: string } {
  const literal = colorOrNull(written);
  if (literal) return { kind: "color", color: literal };
  const constant = snapshot.constants.find(
    (candidate) => candidate.path === written,
  );
  if (constant) return { kind: "color", color: constant.color };
  const role = snapshot.roles.find(
    (candidate) => rolePath(candidate) === written,
  );
  if (role) return { kind: "color", color: role.perMode[modeIndex].color };
  const probe = probeOf(snapshot.definition.text, gamut, written);
  return "error" in probe
    ? { kind: "refused", error: probe.error }
    : { kind: "color", color: probe.color };
}
