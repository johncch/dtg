import { useEffect, useMemo, useRef } from "react";
import { emitHostCss, type HostCss } from "../src/emit.js";
import type { ResolvedDefinition } from "../src/resolve.js";

const EMBEDDED = window.parent !== window;

/**
 * When the app is inside another page's iframe, that page gets the CSS for
 * whatever the app shows, edits being tried included, each time it changes:
 * a `{ type: "dtg:css", css }` message. A host whose listener starts late
 * sends `{ type: "dtg:css?" }` and gets the current CSS back.
 *
 * Named as the project's CSS output names its variables, but always written
 * into `:root`: Tailwind's `@theme` blocks mean nothing to a browser, while
 * `:root` overrides what the host's own stylesheet set.
 */
export function LiveCss({ resolved, host }: { resolved: ResolvedDefinition; host: HostCss }) {
  // A definition with problems draws but is not written out, so the host keeps the CSS it last got.
  const css = useMemo(() => (EMBEDDED && resolved.problems.length === 0 ? emitHostCss(resolved, host.names, host.modes) : null), [resolved, host]);
  const latest = useRef(css);

  useEffect(() => {
    latest.current = css;
    // Any origin: the host's is not known here, and generated CSS is public anyway.
    if (css != null) parent.postMessage({ type: "dtg:css", css }, "*");
  }, [css]);

  useEffect(() => {
    if (!EMBEDDED) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== parent || (event.data as { type?: unknown } | null)?.type !== "dtg:css?") return;
      if (latest.current != null) parent.postMessage({ type: "dtg:css", css: latest.current }, "*");
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  return null;
}
