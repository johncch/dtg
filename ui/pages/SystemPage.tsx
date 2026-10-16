import type { EditTarget } from "../../src/edit.js";
import { formatRef } from "../../src/selector.js";
import type { SnapshotStep, SnapshotSystem } from "../../src/snapshot.js";
import { ColorChip } from "../ColorChip.js";
import { NumberParam } from "../NumberParam.js";
import { STATIC } from "../mode.js";
import { Probe } from "../Probe.js";
import { useScrollToHash } from "../router.js";
import { stepAnchor, stepDeltaE, Strip } from "../Strip.js";
import { UsedBy } from "../UsedBy.js";

export function SystemPage({ system }: { system: SnapshotSystem }) {
  const hash = useScrollToHash(system.system);

  return (
    <>
      <h1>
        {system.system}{" "}
        <span className="muted" style={{ fontSize: "var(--text-body)" }}>
          emits <code>{system.cssName}</code> · {system.algorithm}
        </span>
      </h1>
      {system.note && <p className="note">{system.note}</p>}
      <p className="desc">{system.description}</p>
      <Params system={system} />
      {/* The preview asks the server to resolve a step; a static copy has none. */}
      {!STATIC && <Probe key={system.system} system={system} />}
      <section className="box">
        <h2 className="box-title">Steps</h2>
        <div className="steps-body">
          <Strip system={system} withDeltas />
        </div>
      </section>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Ref</th>
            <th>Value</th>
            <th>ΔE prev</th>
            <th>Used by</th>
          </tr>
        </thead>
        <tbody>
          {system.steps.map((step, index) => {
            const anchor = stepAnchor(step.publicStep);
            const previous = index > 0 ? system.steps[index - 1] : null;
            const delta = previous ? stepDeltaE(previous.color, step.color) : null;
            return (
              <tr key={step.selector} id={anchor} className={anchor === hash ? "target" : undefined}>
                <td>
                  <code>
                    {system.cssName}-{step.publicStep}
                  </code>
                </td>
                <td>
                  <code>{formatRef(system.system, step.selector)}</code>
                </td>
                <td>
                  <StepValue step={step} />
                </td>
                <td>{delta ? <span className="de">{delta}</span> : <span className="muted">—</span>}</td>
                <td>{step.usedBy.length > 0 ? <UsedBy uses={step.usedBy} /> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function StepValue({ step }: { step: SnapshotStep }) {
  if (!step.generated) return <ColorChip color={step.color} />;
  return (
    <>
      <span className="cell">
        <ColorChip color={step.color} />
        <span className="pill">override</span>
      </span>
      <div className="muted" style={{ marginTop: 3 }}>
        generated{" "}
        <ColorChip color={step.generated} size="small" />
      </div>
    </>
  );
}

function Params({ system }: { system: SnapshotSystem }) {
  const entries = Object.entries(system.params);
  if (entries.length === 0) return null;
  return (
    <div className="params">
      {entries.map(([key, value]) => (
        <div className="param" key={key}>
          {key}
          <div className="param-value">
            <ParamValue value={value} path={key} system={system} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ParamValue({ value, path, system }: { value: unknown; path: string; system: SnapshotSystem }) {
  const { colorParams } = system;
  const colorParam = colorParams.find((param) => param.path === path);
  if (colorParam) {
    const target: EditTarget =
      colorParam.from === "defaults"
        ? { kind: "default", algorithm: system.algorithm, path }
        : { kind: "param", system: system.system, path };
    return (
      <ColorChip color={colorParam.color} label={String(value)} edit={target} named={colorParam.constant}>
        {colorParam.from === "defaults" && <span className="muted">shared</span>}
      </ColorChip>
    );
  }
  if (typeof value === "number") {
    const target: EditTarget = system.ownParams.includes(path.split(".")[0])
      ? { kind: "param", system: system.system, path }
      : { kind: "default", algorithm: system.algorithm, path };
    return (
      <NumberParam name={path} value={value} target={target} range={system.numberRanges[path] ?? null} shared={target.kind === "default"} />
    );
  }
  if (Array.isArray(value)) {
    return (
      <span className="cell">
        {value.map((item, index) => (
          <ParamValue key={index} value={item} path={`${path}.${index}`} system={system} />
        ))}
      </span>
    );
  }
  if (value != null && typeof value === "object") {
    const entries = Object.entries(value);
    if (!colorParams.some((param) => param.path.startsWith(`${path}.`))) {
      return <code className="muted">{entries.length} entries</code>;
    }
    return (
      <span className="cell">
        {entries.map(([key, item]) => (
          <span key={key}>
            <span className="muted">{key}</span>{" "}
            <ParamValue value={item} path={`${path}.${key}`} system={system} />
          </span>
        ))}
      </span>
    );
  }
  return <code>{String(value)}</code>;
}
