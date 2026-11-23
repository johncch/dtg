import { useLayoutEffect, useRef } from "react";
import type { Snapshot } from "../src/engine/snapshot.js";
import { groupOf, openNameOf } from "./EntryRow.js";
import { navigate, type Route } from "./router.js";

type Address = Exclude<Route, { page: "unknown" }>;

/** The page an edit opens once the working copy has what the page shows, and the entry on it whose name opens for typing. */
export type Opening = { page: Address; naming?: string };

let opening: Opening | null = null;

/** Set by a commit that was kept; null takes it back. */
export function openOnceThere(next: Opening | null): void {
  opening = next;
}

/** The page above the one `route` names, while the working copy has what that page shows; null when it does not, or the page shows nothing an edit can take. */
function pageAbove(route: Route, working: Snapshot): Address | null {
  if (route.page === "palette") return working.constants.some((constant) => groupOf(constant.path) === route.name) ? { page: "constants" } : null;
  if (route.page === "system") return working.systems.some((system) => system.system === route.name) ? { page: "definition" } : null;
  if (route.page === "roles" && route.section != null) return working.sections.includes(route.section) ? { page: "definition" } : null;
  if (route.page !== "group") return null;
  const held = working.roles.find((role) => role.group === route.name);
  return held ? { page: "roles", section: held.section } : null;
}

/**
 * Keeps the address with the working copy. The page an edit asked for opens
 * once what it shows has arrived. A group, a palette or a system goes with
 * its last entry, or with an undo, as a collection goes when removed, and the page that showed it then goes to
 * the one above; an address that never named anything stays, to say so.
 *
 * Before paint, so an address just renamed away from never shows as missing.
 * It must be drawn after the page: the rows there take a name to open as they
 * are drawn, and the page being left would take the one meant for the next.
 */
export function FollowWorkingCopy({ route, working }: { route: Route; working: Snapshot }) {
  const address = JSON.stringify(route);
  const above = pageAbove(route, working);
  const shown = useRef<{ address: string; above: Address } | null>(null);
  useLayoutEffect(() => {
    if (opening && pageAbove(opening.page, working)) {
      const { page, naming } = opening;
      opening = null;
      if (naming) openNameOf(naming);
      navigate(page, { replace: true });
      return;
    }
    if (above) {
      shown.current = { address, above };
      return;
    }
    if (shown.current?.address !== address) return;
    const to = shown.current.above;
    shown.current = null;
    navigate(to, { replace: true });
  }, [address, working]);
  return null;
}
