import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type Ref } from "react";

export type Route =
  | { page: "overview" }
  | { page: "definition" }
  | { page: "settings" }
  | { page: "system"; name: string }
  | { page: "domain"; name: string }
  | { page: "roles" }
  | { page: "constants" }
  | { page: "palette"; name: string }
  | { page: "unknown"; path: string };

function parse(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "");
  const [, kind, ...rest] = path.split("/");
  const name = decodeURIComponent(rest.join("/"));
  if (kind == null) return { page: "overview" };
  if (kind === "system" && name) return { page: "system", name };
  if (kind === "domain" && name) return { page: "domain", name };
  if (kind === "roles" && !name) return { page: "roles" };
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
    case "domain":
    case "palette":
      return `/${route.page}/${encodeURIComponent(route.name)}`;
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

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  return parse(pathname);
}

/** The fragment without its "#", or "" when there is none. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, () => decodeURIComponent(location.hash.slice(1)));
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
  const href = hash ? `${hrefFor(to)}#${encodeURIComponent(hash)}` : hrefFor(to);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState(null, "", href);
    dispatchEvent(new Event(NAVIGATED));
    if (!hash) scrollTo(0, 0);
  };
  return <a {...anchor} ref={ref} href={href} onClick={follow} />;
}
