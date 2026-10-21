import type { EditTarget } from "../../src/edit.js";
import { useMemo } from "react";
import type { Color } from "../../src/color-math.js";
import { formatRef } from "../../src/selector.js";
import type { Snapshot, SnapshotStep, SnapshotSystem } from "../../src/snapshot.js";
import { ColorChip } from "../ColorChip.js";
import { ChoiceParam } from "../ChoiceParam.js";
import { CurveParam } from "../CurveParam.js";
import { NumberParam } from "../NumberParam.js";
import { Probe } from "../Probe.js";
import { useScrollToHash } from "../router.js";
import { stepAnchor, stepDeltaE, Strip } from "../Strip.js";
import { UsedBy } from "../UsedBy.js";

export function SystemPage({ system, snapshot }: { system: SnapshotSystem; snapshot: Snapshot }) {
  const hash = useScrollToHash(system.system);
  const constants = useMemo(
    () => new Map(snapshot.constants.map((constant) => [constant.path, constant.color])),
    [snapshot.constants],
  );

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
      <Params system={system} constants={constants} />
      <Probe key={system.system} system={system} definition={snapshot.definition.text} gamut={snapshot.gamut} />
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

function Params({ system, constants }: { system: SnapshotSystem; constants: ReadonlyMap<string, Color> }) {
  const entries = Object.entries(system.params);
  if (entries.length === 0) return null;
  return (
    <div className="params">
      {entries.map(([key, value]) => (
        <div className="param" key={key}>
          {key}
          <div className="param-value">
            <ParamValue value={value} path={key} system={system} constants={constants} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ParamValue({
  value,
  path,
  system,
  constants,
}: {
  value: unknown;
  path: string;
  system: SnapshotSystem;
  constants: ReadonlyMap<string, Color>;
}) {
  const { colorParams } = system;
  // Where the value comes from decides where an edit goes: a param the
  // system writes, or the algorithm's default, is written into the system; one
  // from the `defaults` block is shared, and editing it moves every system.
  // A YAML anchor is shared with every alias of it, so editing it is a shared
  // edit; an alias's value is written elsewhere and cannot be edited here.
  const top = path.split(".")[0];
  const defaulted = system.defaultedParams.includes(top);
  const shared = !defaulted && !system.ownParams.includes(top);
  const anchor = system.anchors[top];
  const note = anchor
    ? anchor.role === "anchor"
      ? `shared as &${anchor.name}`
      : `same as &${anchor.name}`
    : defaulted
      ? "default"
      : shared
        ? "shared"
        : null;
  const readOnly = anchor?.role === "alias";
  const target: EditTarget = shared
    ? { kind: "default", algorithm: system.algorithm, path }
    : { kind: "param", system: system.system, path };
  const curve = system.curves[path];
  if (curve) {
    return (
      <CurveParam
        name={path}
        curve={curve}
        system={system}
        constants={constants}
        target={target}
        note={note}
        dim={defaulted}
        readOnly={readOnly}
      />
    );
  }
  const colorParam = colorParams.find((param) => param.path === path);
  if (colorParam) {
    return (
      <ColorChip color={colorParam.color} label={String(value)} edit={readOnly ? undefined : target} named={colorParam.constant}>
        {note && <span className="muted">{note}</span>}
      </ColorChip>
    );
  }
  const options = system.choices[path];
  if (options && typeof value === "string") {
    return <ChoiceParam name={path} value={value} options={options} target={target} note={note} dim={defaulted} readOnly={readOnly} />;
  }
  if (typeof value === "number") {
    return (
      <NumberParam
        name={path}
        value={value}
        target={target}
        range={system.numberRanges[path] ?? null}
        note={note}
        dim={defaulted}
        readOnly={readOnly}
      />
    );
  }
  if (defaulted) return <code className="muted">{JSON.stringify(value)}</code>;
  if (Array.isArray(value)) {
    return (
      <span className="cell">
        {value.map((item, index) => (
          <ParamValue key={index} value={item} path={`${path}.${index}`} system={system} constants={constants} />
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
            <ParamValue value={item} path={`${path}.${key}`} system={system} constants={constants} />
          </span>
        ))}
      </span>
    );
  }
  return <code>{String(value)}</code>;
}
