import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { colorFromOklab, formatAuthored, oklchToOklab, type Color } from "../../src/color-math.js";
import type { Background } from "../../src/dev-settings.js";
import type { SnapshotBackground } from "../../src/snapshot.js";
import { ColorTip } from "../ColorTip.js";
import { useProjectGamut } from "../gamut.js";
import { paintCss } from "../paint.js";
import { lchOf } from "../picker/ColorEditor.js";
import { Picker } from "../picker/Picker.js";
import { Popup } from "../Popup.js";

const NEW_BACKGROUND_COLOR = "#ffffff";

/**
 * How this app shows the definition: settings the project keeps under `dev`
 * in `dtg.yaml`. A change here is written to that file at once. It is config,
 * not the definition, so it is never one of the unsaved changes and undo does
 * not reach it.
 */
export function SettingsPage({
  configPath,
  backgrounds,
}: {
  configPath: string;
  backgrounds: SnapshotBackground[];
}) {
  const [draftName, setDraftName] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const written: Background[] = backgrounds.map(({ name, written }) => ({ name, color: written }));

  const write = (next: Background[]) => {
    setFailure(null);
    fetch("/api/backgrounds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backgrounds: next }),
    })
      .then(async (response) => {
        if (response.ok) return;
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setFailure(body.error ?? `the server answered ${response.status}`);
      })
      .catch((error: Error) => setFailure(error.message));
  };

  const add = () => {
    const name = draftName.trim();
    if (!name) return;
    write([...written, { name, color: NEW_BACKGROUND_COLOR }]);
    setDraftName("");
  };

  return (
    <>
      <h1>Settings</h1>
      <p className="sub">
        <code>{configPath}</code>
      </p>
      <h2>Backgrounds</h2>
      <p className="sub">
        <code>dev.backgrounds</code>
      </p>
      <table className="backgrounds">
        <thead>
          <tr>
            <th>Name</th>
            <th>Color</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {backgrounds.map((background) => (
            <tr key={background.name}>
              <td>
                <code>{background.name}</code>
              </td>
              <td>
                <Popup
                  title="Edit background"
                  className="chip chip-editable"
                  label={
                    <>
                      <span className="swatch">
                        <span className="swatch-color" style={{ background: paintCss(background.color) }} />
                      </span>
                      <code>{background.written}</code>
                    </>
                  }
                  focus="panel"
                  wrap={(button, open) => (
                    <ColorTip color={background.color} suppressed={open}>
                      {button}
                    </ColorTip>
                  )}
                >
                  {({ handle, close }) => (
                    <BackgroundPicker
                      original={background.color}
                      handle={handle}
                      close={close}
                      onPick={(color) =>
                        write(written.map((other) => (other.name === background.name ? { ...other, color } : other)))
                      }
                    />
                  )}
                </Popup>
              </td>
              <td>
                {backgrounds.length > 1 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => write(written.filter((other) => other.name !== background.name))}
                  >
                    remove
                  </button>
                )}
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={3}>
              <form
                className="background-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  add();
                }}
              >
                <input
                  type="text"
                  placeholder="name"
                  aria-label="New background's name"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                />
                <button type="submit" className="btn">
                  add
                </button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
      {failure && <p className="changes-error">Could not write dtg.yaml: {failure}</p>}
    </>
  );
}

/** The picker on a background. The pick is written when the popup is dismissed, not on every drag. */
function BackgroundPicker({
  original,
  handle,
  close,
  onPick,
}: {
  original: Color;
  handle: HTMLAttributes<HTMLDivElement>;
  close: ReactNode;
  /** Called with the color as `dtg.yaml` would write it. */
  onPick: (color: string) => void;
}) {
  const gamut = useProjectGamut();
  const [start] = useState(() => lchOf(original));
  const [lch, setLch] = useState(start);
  const latest = useRef({ lch, onPick });
  latest.current = { lch, onPick };
  useEffect(
    () => () => {
      if (latest.current.lch !== start) latest.current.onPick(formatAuthored(oklchToOklab(latest.current.lch)));
    },
    [],
  );
  const picked = lch === start ? original : colorFromOklab(oklchToOklab(lch));
  return (
    <>
      <div className="editor-head" {...handle}>
        <ColorTip color={picked}>
          <span className="swatch editor-current" aria-label="Selection">
            <span className="swatch-color" style={{ background: paintCss(picked) }} />
          </span>
        </ColorTip>
        {close}
      </div>
      <Picker value={lch} gamut={gamut} onChange={setLch} />
    </>
  );
}
