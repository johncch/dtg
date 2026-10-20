import { Fragment } from "react";
import type { SnapshotUse } from "../src/snapshot.js";
import { rolePath } from "../src/selector.js";
import { Link } from "./router.js";

export function UsedBy({ uses }: { uses: SnapshotUse[] }) {
  return uses.map((use, index) => (
    <Fragment key={`${rolePath(use)}.${use.mode}`}>
      {index > 0 && ", "}
      <Link to={use.group ? { page: "group", name: use.group } : { page: "roles", section: use.section }} hash={use.role}>
        <code>
          {rolePath(use)}
        </code>
      </Link>
      <span className="muted">
        {" "}
        {use.mode}
        {use.translucent ? " (translucent)" : ""}
      </span>
    </Fragment>
  ));
}
