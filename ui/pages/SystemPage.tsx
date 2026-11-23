import type { EditTarget } from "../../src/edit.js";
import { useMemo } from "react";
import type { Color } from "../../src/color-math.js";
import { formatRef } from "../../src/selector.js";
import type { Snapshot, SnapshotStep, SnapshotSystem } from "../../src/snapshot.js";
import { ColorChip } from "../ColorChip.js";
import { ChoiceParam } from "../ChoiceParam.js";
import { CurveParam } from "../CurveParam.js";
import { EmitParam } from "../EmitParam.js";
import { EDITABLE } from "../mode.js";
import { Hint } from "../Hint.js";
import { NumberParam } from "../NumberParam.js";
import type { ParamScope } from "../ParamScope.js";
import { algorithmFor } from "../../src/resolve.js";
import { Probe } from "../Probe.js";
import { Profile } from "../Profile.js";
import { useScrollToHash } from "../router.js";
import { SystemSettings } from "../SystemEditor.js";
import { stepAnchor, stepDeltaE, Strip } from "../Strip.js";
import { UsedBy } from "../UsedBy.js";

/** `snapshot` is what to draw; `working` is the working copy, which an edit to the system itself is made on. */
export function SystemPage({ system, snapshot, working }: { system: SnapshotSystem; snapshot: Snapshot; working: Snapshot }) {
  const hash = useScrollToHash(system.system);
  const constants = useMemo(
    () => new Map(snapshot.constants.map((constant) => [constant.path, constant.color])),
    [snapshot.constants],
  );

  return (
    <>
      <div className="system-head">
        <h1>
          {system.system}{" "}
          <span className="title-kind">
            {system.algorithm}
          </span>
        </h1>
        {EDITABLE && <SystemSettings key={system.system} system={working.systems.find((candidate) => candidate.system === system.system) ?? system} working={working} />}
      </div>
      {system.note && <p className="note">{system.note}</p>}
      <p className="desc">{system.description}</p>
      <div className="system-overview">
        <Params system={system} constants={constants} />
        <Profile system={system} constants={constants} gamut={snapshot.gamut} />
      </div>
      <div className="system-overview">
        <Probe key={system.system} system={system} definition={snapshot.definition.text} gamut={snapshot.gamut} />
        <section className="box">
          <h2 className="box-title">Published steps</h2>
          <div className="steps-body">
            <Strip system={system} withDeltas />
          </div>
        </section>
      </div>
      <table className="steps-table">
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
                <td>
                  <UsedBy uses={step.usedBy} />
                  {system.emit.includes(step.selector) && (
                    <span className="muted">
                      {step.usedBy.length > 0 && ", "}
                      publish
                    </span>
                  )}
                </td>
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
  return (
    <section className="box">
      <h2 className="box-title">Params</h2>
      <div className="params">
        {entries.map(([key, value]) => (
          <div className="param" key={key}>
            <ParamName name={key} description={algorithmFor(system.algorithm)?.params[key]?.description ?? null} />
            <div className="param-value">
              <ParamValue value={value} path={key} system={system} constants={constants} />
            </div>
          </div>
        ))}
        <div className="param">
          <ParamName name="publish" description="Steps published even when no role uses them." />
          <div className="param-value">
            <EmitParam key={system.system} system={system} />
          </div>
        </div>
      </div>
    </section>
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
    : shared
      ? "defaults"
      : null;
  const readOnly = anchor?.role === "alias";
  const kind = algorithmFor(system.algorithm)?.params[top];
  // A number with one value per end is shown as all of them, however it is
  // written; an edit to one writes the whole param, in its shortest form.
  const ends = kind?.kind === "number" ? kind.ends : undefined;
  const perEnd = (written: unknown): number[] => (Array.isArray(written) ? written : Array<number>(ends ?? 0).fill(written as number));
  const whole = ends != null && path !== top;
  const target: EditTarget = shared
    ? { kind: "default", algorithm: system.algorithm, path: whole ? top : path }
    : { kind: "param", system: system.system, path: whole ? top : path };
  const builtIn = kind != null && (("default" in kind && kind.default !== undefined) || (kind.kind === "number" && kind.optional === true));
  // An item of a list param is unlinked and reset with its whole list, so its scope is the list's.
  const [, index, ...deeper] = path.split(".");
  const list = ends != null ? perEnd(system.params[top]) : system.params[top];
  const item = index != null && deeper.length === 0 && Array.isArray(list) ? { index: Number(index), list, shorthand: ends != null } : null;
  const scope: ParamScope | null =
    anchor || (path.includes(".") && !item)
      ? null
      : {
          system: system.system,
          algorithm: system.algorithm,
          path: top,
          from: defaulted ? "built-in" : shared ? "defaults" : "system",
          fallback: system.paramsInDefaults.includes(top) ? "defaults" : builtIn ? "built-in" : null,
          item,
        };
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
        scope={scope}
      />
    );
  }
  const colorParam = colorParams.find((param) => param.path === path);
  if (colorParam) {
    return (
      <ColorChip color={colorParam.color} label={String(value)} edit={readOnly ? undefined : target} editor={{ scope }}>
        {note && <span className="muted param-note">{note}</span>}
      </ColorChip>
    );
  }
  const options = system.choices[path];
  if (options && typeof value === "string") {
    return <ChoiceParam name={path} value={value} options={options} target={target} note={note} dim={defaulted} readOnly={readOnly} scope={scope} />;
  }
  if (ends != null && path === top) {
    return (
      <span className="cell">
        {perEnd(value).map((end, index) => (
          <ParamValue key={index} value={end} path={`${path}.${index}`} system={system} constants={constants} />
        ))}
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <NumberParam
        name={whole && ends === 2 ? `${top}, ${index === "0" ? "light" : "dark"} end` : path}
        value={value}
        target={target}
        compose={item?.shorthand ? (n) => shortestOf(item.list.map((other, at) => (at === item.index ? n : other))) : undefined}
        range={system.numberRanges[path] ?? null}
        note={note}
        dim={defaulted}
        readOnly={readOnly}
        scope={scope}
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

/** A value per end as the file would be written by hand: one number when every end has the same. */
export function shortestOf(values: unknown[]): string {
  return values.every((value) => value === values[0]) ? String(values[0]) : JSON.stringify(values);
}

/** A param's name, with the algorithm's line on what it does on hover. */
function ParamName({ name, description }: { name: string; description: string | null }) {
  if (!description) return <span>{name}</span>;
  return (
    <Hint text={description}>
      <span className="param-name" tabIndex={0}>
        {name}
      </span>
    </Hint>
  );
}
