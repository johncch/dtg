import type { Snapshot } from "../../src/snapshot.js";
import { ColorTip } from "../ColorTip.js";
import { paintCss } from "../paint.js";
import { Link } from "../router.js";
import { labelColorOn, Strip } from "../Strip.js";
import { constantAnchor } from "./ConstantsPage.js";

export function OverviewPage({ snapshot }: { snapshot: Snapshot }) {
  const domains = [...new Set(snapshot.roles.map((role) => role.domain))];
  return (
    <>
      <h1>Colors</h1>
      <p className="sub">Modes: {snapshot.modes.join(", ")}</p>
      {snapshot.warnings.length > 0 && (
        <div className="warn">
          <strong>Warnings</strong>
          <ul className="plain">
            {snapshot.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {snapshot.systems.map((system) => (
        <section key={system.system}>
          <h2>
            <Link to={{ page: "system", name: system.system }}>{system.system}</Link>{" "}
            <span className="muted">
              → {system.cssName} · {system.algorithm}
            </span>
          </h2>
          <Strip system={system} />
        </section>
      ))}
      {snapshot.constants.length > 0 && (
        <>
          <h2>
            <Link to={{ page: "constants" }}>Constants</Link>{" "}
            <span className="muted">{snapshot.constants.length}</span>
          </h2>
          <div className="strip-wrap">
            <div className="strip">
              {snapshot.constants.map((constant) => (
                <ColorTip key={constant.path} color={constant.color}>
                  <Link to={{ page: "constants" }} hash={constantAnchor(constant.path)}>
                    <span className="strip-fill" style={{ background: paintCss(constant.color) }} />
                    <span className="step-label" style={{ color: labelColorOn(constant.color) }}>
                      {constant.path}
                    </span>
                  </Link>
                </ColorTip>
              ))}
            </div>
          </div>
        </>
      )}
      <h2>Role domains</h2>
      <ul className="plain">
        {domains.map((domain) => (
          <li key={domain}>
            <Link to={{ page: "domain", name: domain }}>
              <code>{domain}</code>
            </Link>{" "}
            <span className="muted">
              {snapshot.roles.filter((role) => role.domain === domain).length} roles
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
