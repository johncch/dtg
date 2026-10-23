import type { ReactNode } from "react";
import { parseColor } from "../../src/color-math.js";
import type { SnapshotDefinition } from "../../src/snapshot.js";
import { paintCss } from "../paint.js";

export function DefinitionPage({ definition, warnings }: { definition: SnapshotDefinition; warnings: string[] }) {
  return (
    <>
      <h1>Definition</h1>
      <p className="sub">
        <code>{definition.path}</code>
      </p>
      {warnings.length > 0 && (
        <div className="warn">
          <strong>Warnings</strong>
          <ul className="plain">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <pre className="source">
        {definition.text.split("\n").map((line, index) => (
          <span key={index}>
            {highlighted(line)}
            {"\n"}
          </span>
        ))}
      </pre>
    </>
  );
}

// A string, a key (a name followed by a colon), a number, a ref call, or flow punctuation.
const TOKEN = /("(?:[^"\\]|\\.)*"|'[^']*')|([A-Za-z_][\w.-]*)(?=:(?:\s|$))|(-?\d+(?:\.\d+)?)(?![\w.(])|([\w.-]+\([^()]*\))|([{}[\],~])/g;

/**
 * One line of the definition, colored by a tokenizer that knows only the YAML
 * a definition is written in: block and flow maps, lists, scalars and
 * comments. A color literal gets its swatch.
 */
function highlighted(line: string): ReactNode[] {
  const commentAt = commentStart(line);
  const code = commentAt === -1 ? line : line.slice(0, commentAt);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of code.matchAll(TOKEN)) {
    if (match.index > at) parts.push(code.slice(at, match.index));
    const [text, quoted, key, number, call, punct] = match;
    const id = match.index;
    if (quoted) parts.push(<Swatched key={id} text={quoted} value={quoted.slice(1, -1)} />);
    else if (key) parts.push(<span key={id} className="tok-key">{key}</span>);
    else if (number) parts.push(<span key={id} className="tok-number">{number}</span>);
    else if (call) parts.push(<Swatched key={id} text={call} value={call} />);
    else if (punct) parts.push(<span key={id} className="tok-punct">{punct}</span>);
    at = match.index + text.length;
  }
  if (at < code.length) parts.push(code.slice(at));
  if (commentAt !== -1) parts.push(<span key="comment" className="tok-comment">{line.slice(commentAt)}</span>);
  return parts;
}

/** Where a `#` starts a comment: at the line's start or after a space, and outside quotes. */
function commentStart(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return i;
    }
  }
  return -1;
}

/** A value, with a swatch when it reads as a color — a hex or `oklch(…)`, not a ref like `sky(3)`. */
function Swatched({ text, value }: { text: string; value: string }) {
  let color;
  try {
    color = parseColor(value, "");
  } catch {
    return text;
  }
  return (
    <>
      <span className="tok-swatch" style={{ background: paintCss(color) }} />
      {text}
    </>
  );
}
