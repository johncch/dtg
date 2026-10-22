import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type Ref } from "react";
import { STATIC } from "./mode.js";

export type Route =
  | { page: "overview" }
  | { page: "definition" }
  | { page: "settings" }
  | { page: "system"; name: string }
  | { page: "group"; name: string }
  /** Every role, or a section's. */
  | { page: "roles"; section?: string }
  | { page: "constants" }
  | { page: "palette"; name: string }
  | { page: "unknown"; path: string };

function parse(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "");
  const [, kind, ...rest] = path.split("/");
  const name = decodeURIComponent(rest.join("/"));
  if (kind == null) return { page: "overview" };
  if (kind === "system" && name) return { page: "system", name };
  if (kind === "group" && name) return { page: "group", name };
  if (kind === "roles") return name ? { page: "roles", section: name } : { page: "roles" };
  if (kind === "settings" && !name) return { page: "settings" };
  if (kind === "definition" && !name) return { page: "definition" };
  if (kind === "constants" && !name) return { page: "constants" };
  if (kind === "palette" && name) return { page: "palette", name };
  return { page: "unknown", path };
}

export function hrefFor(route: Exclude<Route, { page: "unknown" }>): string {
  switch (route.page) {
    case "overview":
      return "/";
    case "system":
    case "group":
    case "palette":
      return `/${route.page}/${encodeURIComponent(route.name)}`;
    case "roles":
      return route.section ? `/roles/${encodeURIComponent(route.section)}` : "/roles";
    default:
      return `/${route.page}`;
  }
}

const NAVIGATED = "dtg:navigated";

function subscribe(onChange: () => void): () => void {
  addEventListener("popstate", onChange);
  addEventListener("hashchange", onChange);
  addEventListener(NAVIGATED, onChange);
  return () => {
    removeEventListener("popstate", onChange);
    removeEventListener("hashchange", onChange);
    removeEventListener(NAVIGATED, onChange);
  };
}

/**
 * The page's path and the anchor within it. A static copy can be served from
 * any folder by a host that knows nothing of the app's pages, so both live in
 * the fragment there: `#/system/theme#s-500`.
 */
function pagePath(): string {
  return STATIC ? location.hash.slice(1).split("#")[0] || "/" : location.pathname;
}

function anchor(): string {
  const fragment = location.hash.slice(1);
  return decodeURIComponent(STATIC ? fragment.split("#").slice(1).join("#") : fragment);
}

/** The address of a page and an anchor in it, written the way this copy of the app is reached. */
function addressOf(route: Exclude<Route, { page: "unknown" }>, hash?: string): string {
  const page = hrefFor(route);
  const fragment = hash ? `#${encodeURIComponent(hash)}` : "";
  return STATIC ? `#${page}${fragment}` : `${page}${fragment}`;
}

export function useRoute(): Route {
  return parse(useSyncExternalStore(subscribe, pagePath));
}

/** The fragment without its "#", or "" when there is none. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, anchor);
}

/**
 * The current fragment, scrolled to once the row it names exists. `pageKey`
 * re-runs the scroll when the same component shows a different page.
 */
export function useScrollToHash(pageKey?: string): string {
  const hash = useHash();
  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "center" });
  }, [hash, pageKey]);
  return hash;
}

/**
 * An in-app link. Extra anchor props and the ref pass through to the `<a>`, so
 * it can be the trigger of a tooltip or popover.
 */
export function Link({
  to,
  hash,
  onClick,
  ref,
  ...anchor
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: Exclude<Route, { page: "unknown" }>;
  hash?: string;
  ref?: Ref<HTMLAnchorElement>;
}) {
  const href = addressOf(to, hash);
  const current = useRoute();
  const active = current.page !== "unknown" && hrefFor(current) === hrefFor(to);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState(null, "", href);
    dispatchEvent(new Event(NAVIGATED));
    if (!hash) scrollTo(0, 0);
  };
  return <a {...anchor} ref={ref} href={href} aria-current={active ? "page" : undefined} onClick={follow} />;
}
