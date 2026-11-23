import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { emitCss, emitDtcg, emitScss, emitTailwind } from "../src/engine/emit.js";
import type { ResolvedDefinition } from "../src/engine/resolve.js";
import type { Snapshot } from "../src/engine/snapshot.js";
import { Popup } from "./Popup.js";

type Format = "css" | "tailwind" | "scss" | "dtcg";

const FORMATS: { format: Format; label: string; suffix: string }[] = [
  { format: "css", label: "CSS", suffix: ".css" },
  { format: "tailwind", label: "Tailwind", suffix: ".tailwind.css" },
  { format: "scss", label: "SCSS", suffix: ".scss" },
  { format: "dtcg", label: "DTCG", suffix: ".tokens.json" },
];

function emit(resolved: ResolvedDefinition, format: Format): string {
  if (format === "scss") return emitScss(resolved);
  if (format === "dtcg") return JSON.stringify(emitDtcg(resolved, "srgb"), null, 2) + "\n";
  return format === "tailwind" ? emitTailwind(resolved) : emitCss(resolved);
}

function definitionStem(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? "";
  return name.replace(/(\.dtg)?\.ya?ml$/, "") || "colors";
}

/**
 * The working copy written out in any format, unsaved edits included. A copy
 * that did not resolve draws the last one that did, so it is not exported.
 */
export function Export({ resolved, working }: { resolved: ResolvedDefinition; working: Snapshot }) {
  const [format, setFormat] = useState<Format>("css");
  const blocked = working.error != null || working.problems.length > 0;
  const text = useMemo(() => (blocked ? null : emit(resolved, format)), [blocked, resolved, format]);
  const fileName = definitionStem(working.definition.path) + FORMATS.find((entry) => entry.format === format)!.suffix;
  const unsaved = working.changes.length;

  const download = () => {
    if (text == null) return;
    const url = URL.createObjectURL(new Blob([text], { type: format === "dtcg" ? "application/json" : "text/css" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Popup
      title="Export"
      className="nav-add"
      label={
        <>
          <Download size={16} aria-hidden />
          <span className="sr-only">Export</span>
        </>
      }
      focus="panel"
    >
      {(panel) => (
        <div className="ref-editor export">
          <div className="editor-head" {...panel.handle}>
            <span className="ref-editor-heading">Export</span>
            {panel.close}
          </div>
          <div className="export-options">
            <select aria-label="Format" value={format} onChange={(event) => setFormat(event.target.value as Format)}>
              {FORMATS.map((entry) => (
                <option key={entry.format} value={entry.format}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          {unsaved > 0 && (
            <p className="muted export-note">
              Includes {unsaved} unsaved {unsaved === 1 ? "change" : "changes"}
            </p>
          )}
          {text == null ? (
            <p className="muted export-note">Fix the errors to export</p>
          ) : (
            <pre className="export-preview">
              <code>{text}</code>
            </pre>
          )}
          <div className="export-actions">
            <button type="button" className="btn btn-small" disabled={text == null} onClick={() => void navigator.clipboard.writeText(text!)}>
              Copy
            </button>
            <button type="button" className="btn btn-small" disabled={text == null} onClick={download} title={fileName}>
              Download
            </button>
          </div>
        </div>
      )}
    </Popup>
  );
}
