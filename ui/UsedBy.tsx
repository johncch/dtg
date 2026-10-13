import { Fragment } from "react";
import type { SnapshotUse } from "../src/snapshot.js";
import { Link } from "./router.js";

export function UsedBy({ uses }: { uses: SnapshotUse[] }) {
  return uses.map((use, index) => (
    <Fragment key={`${use.domain}.${use.role}.${use.mode}`}>
      {index > 0 && ", "}
      <Link to={{ page: "domain", name: use.domain }} hash={use.role}>
        <code>
          {use.domain}.{use.role}
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
