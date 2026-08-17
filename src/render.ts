import { oklabDeltaE } from "./color-math.js";
import {
  publicSystemName,
  type ResolvedDefinition,
  type ResolvedRole,
  type ResolvedStep,
  type ResolvedSystem,
} from "./resolve.js";

export type Lineage = Map<
  string,
  { domain: string; role: string; mode: string; viaTransparent: boolean }[]
>;

export function buildLineage(resolved: ResolvedDefinition): Lineage {
  const lineage: Lineage = new Map();
  for (const role of resolved.roles) {
    role.perMode.forEach((entry, i) => {
      if (entry.target.kind === "role") return;
      const key = `${entry.target.system}/${entry.target.selector}`;
      const uses = lineage.get(key) ?? [];
      uses.push({
        domain: role.domain,
        role: role.role,
        mode: resolved.modes[i] ?? String(i),
        viaTransparent: entry.target.kind === "transparent",
      });
      lineage.set(key, uses);
    });
  }
  return lineage;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function swatch(css: string, opaque: boolean, size = 28): string {
  const inner = `<span class="swatch-color" style="background:${esc(css)}"></span>`;
  return `<span class="swatch ${opaque ? "" : "swatch-alpha"}" style="width:${size}px;height:${size}px">${inner}</span>`;
}

function stepAnchor(step: ResolvedStep): string {
  return `s-${step.publicStep}`;
}

function refLink(
  ref: string,
  target: {
    kind: string;
    system?: string;
    selector?: string;
    domain?: string;
    role?: string;
  },
): string {
  if (target.kind === "role") {
    return `<a href="/domain/${target.domain}#${target.role}"><code>${esc(ref)}</code></a>`;
  }
  return `<a href="/system/${target.system}#s-${(target.selector ?? "").replace(".", "_")}"><code>${esc(ref)}</code></a>`;
}

function layout(
  title: string,
  nav: string,
  body: string,
  banner: string | null,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --fg: #1d2427; --muted: #6c777e; --faint: #8a959c;
    --border: #e3e7ea; --border-soft: #eef1f3;
    --panel: #ffffff; --panel-head: #f6f8f9; --hover: #eef1f3;
    --link: #036ca3; --target: #fdf6df; --swatch-border: rgba(0,0,0,0.12);
  }
  body.on-dark {
    --fg: #e6eaec; --muted: #a5aeb3; --faint: #8a959c;
    --border: rgba(255,255,255,0.16); --border-soft: rgba(255,255,255,0.08);
    --panel: rgba(255,255,255,0.045); --panel-head: rgba(255,255,255,0.07);
    --hover: rgba(255,255,255,0.09);
    --link: #6db3d8; --target: rgba(253,246,223,0.14); --swatch-border: rgba(255,255,255,0.25);
  }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--fg); background: #ffffff; display: flex; min-height: 100vh; }
  aside { width: 220px; flex-shrink: 0; border-right: 1px solid var(--border); padding: 20px 16px; display: flex; flex-direction: column; }
  aside h1 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--faint); margin-bottom: 14px; }
  aside h1 a { color: var(--faint); text-decoration: none; }
  aside h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--faint); margin: 16px 0 6px; }
  aside nav a { display: block; padding: 3px 8px; border-radius: 6px; color: var(--fg); text-decoration: none; font-size: 14px; }
  aside nav a:hover { background: var(--hover); }
  main { flex: 1; padding: 28px 36px; max-width: 1100px; }
  main h1 { font-size: 22px; margin-bottom: 4px; }
  main h2 { font-size: 15px; margin: 26px 0 10px; }
  main h2 a { color: var(--fg); }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 18px; }
  .desc { color: var(--muted); font-size: 13px; max-width: 620px; line-height: 1.5; margin: 8px 0 14px; }
  code { font-family: "SF Mono", ui-monospace, monospace; font-size: 12px; }
  a code { color: var(--link); }
  table { border-collapse: collapse; width: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--panel-head); }
  td { padding: 7px 12px; border-bottom: 1px solid var(--border-soft); font-size: 13px; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:target { background: var(--target); }
  .params { display: flex; flex-wrap: wrap; gap: 18px; margin: 0 0 16px; }
  .params .param { font-size: 12px; color: var(--muted); }
  .params .param .param-value { margin-top: 3px; color: var(--fg); }
  .strip-wrap { margin: 10px 0 18px; }
  .strip { display: flex; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
  .strip a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; min-height: 72px; padding: 4px 2px; text-decoration: none; position: relative; overflow: hidden; }
  .strip a .step-label { font-size: 10px; font-weight: 600; position: relative; }
  .strip a .step-hex { font-size: 9px; font-family: "SF Mono", ui-monospace, monospace; opacity: 0.75; position: relative; white-space: nowrap; }
  .strip-fill { position: absolute; inset: 0; }
  .strip-gaps { display: flex; margin-top: 3px; }
  .strip-gaps .gap { flex: 1; position: relative; height: 14px; }
  .strip-gaps .gap span { position: absolute; right: 0; transform: translateX(50%); font-size: 10px; font-family: "SF Mono", ui-monospace, monospace; color: var(--faint); }
  .swatch { display: inline-block; vertical-align: middle; border-radius: 6px; border: 1px solid var(--swatch-border); overflow: hidden; position: relative; flex-shrink: 0; }
  .swatch-alpha { background: conic-gradient(#e6e6e6 0 25%, #fff 0 50%, #e6e6e6 0 75%, #fff 0) 0 0 / 12px 12px; }
  .swatch-color { position: absolute; inset: 0; display: block; }
  .cell { display: flex; align-items: center; gap: 8px; }
  .muted { color: var(--faint); }
  .pill { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 99px; background: #fdeaea; color: #a33; margin-left: 6px; vertical-align: 1px; }
  .banner { background: #fdecec; border: 1px solid #f2c4c4; color: #8c2f2f; border-radius: 8px; padding: 10px 14px; margin-bottom: 18px; font-size: 13px; white-space: pre-wrap; font-family: "SF Mono", ui-monospace, monospace; }
  .warn { background: #fdf6df; border: 1px solid #ecdca8; color: #7a6620; border-radius: 8px; padding: 10px 14px; margin-bottom: 18px; font-size: 13px; }
  ul.plain { list-style: none; }
  ul.plain li { padding: 2px 0; }
  .de { font-size: 11px; color: var(--faint); font-family: "SF Mono", ui-monospace, monospace; }
  #bg-section { margin-top: auto; padding-top: 18px; }
  #bg-chips { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
  .bg-chip { display: flex; align-items: center; gap: 7px; padding: 3px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--fg); border: none; background: none; text-align: left; width: 100%; }
  .bg-chip:hover { background: var(--hover); }
  .bg-chip.active { background: var(--hover); font-weight: 600; }
  .bg-chip .dot { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--swatch-border); flex-shrink: 0; }
  .bg-chip .x { margin-left: auto; color: var(--faint); font-size: 12px; padding: 0 3px; visibility: hidden; }
  .bg-chip:hover .x { visibility: visible; }
  #bg-form { display: flex; gap: 5px; align-items: center; }
  #bg-form input[type="text"] { width: 76px; font-size: 12px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 5px; background: transparent; color: var(--fg); }
  #bg-form input[type="color"] { width: 26px; height: 24px; padding: 0; border: 1px solid var(--border); border-radius: 5px; background: transparent; }
  #bg-form button { font-size: 12px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 5px; background: transparent; color: var(--fg); cursor: pointer; }
  #bg-form button:hover { background: var(--hover); }
</style>
</head>
<body>
<aside>${nav}
<div id="bg-section">
  <h2>Background</h2>
  <div id="bg-chips"></div>
  <div id="bg-form">
    <input type="text" id="bg-name" placeholder="name">
    <input type="color" id="bg-color" value="#000000">
    <button id="bg-add">add</button>
  </div>
</div>
</aside>
<main>${banner ?? ""}${body}</main>
<script>
new EventSource("/events").onmessage = () => location.reload();

(function () {
  var KEY = "colors.backgrounds", ACT = "colors.activeBackground";
  var bgs, active;
  try { bgs = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { bgs = null; }
  if (!Array.isArray(bgs) || bgs.length === 0) bgs = [{ name: "light", hex: "#ffffff" }];
  active = localStorage.getItem(ACT) || bgs[0].name;

  function save() {
    localStorage.setItem(KEY, JSON.stringify(bgs));
    localStorage.setItem(ACT, active);
  }
  function luma(hex) {
    return 0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16);
  }
  function apply() {
    var bg = bgs.find(function (b) { return b.name === active; }) || bgs[0];
    active = bg.name;
    document.body.style.background = bg.hex;
    document.body.classList.toggle("on-dark", luma(bg.hex) < 140);
    renderChips();
  }
  function renderChips() {
    var box = document.getElementById("bg-chips");
    box.textContent = "";
    bgs.forEach(function (bg) {
      var chip = document.createElement("button");
      chip.className = "bg-chip" + (bg.name === active ? " active" : "");
      var dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = bg.hex;
      var label = document.createElement("span");
      label.textContent = bg.name;
      chip.appendChild(dot);
      chip.appendChild(label);
      if (bgs.length > 1) {
        var x = document.createElement("span");
        x.className = "x";
        x.textContent = "\\u00d7";
        x.addEventListener("click", function (e) {
          e.stopPropagation();
          bgs = bgs.filter(function (b) { return b.name !== bg.name; });
          if (active === bg.name) active = bgs[0].name;
          save();
          apply();
        });
        chip.appendChild(x);
      }
      chip.addEventListener("click", function () {
        active = bg.name;
        save();
        apply();
      });
      box.appendChild(chip);
    });
  }
  document.getElementById("bg-add").addEventListener("click", function () {
    var name = document.getElementById("bg-name").value.trim();
    var hex = document.getElementById("bg-color").value;
    if (!name) return;
    var existing = bgs.find(function (b) { return b.name === name; });
    if (existing) existing.hex = hex;
    else bgs.push({ name: name, hex: hex });
    active = name;
    document.getElementById("bg-name").value = "";
    save();
    apply();
  });
  apply();
})();
</script>
</body>
</html>`;
}

function navFor(resolved: ResolvedDefinition): string {
  const systems = resolved.systems
    .map((s) => `<a href="/system/${s.system}">${esc(s.system)}</a>`)
    .join("");
  const domains = [...new Set(resolved.roles.map((r) => r.domain))]
    .map((d) => `<a href="/domain/${d}">${esc(d)}</a>`)
    .join("");
  return `<h1><a href="/">colors</a></h1><nav><h2>Systems</h2>${systems}<h2>Roles</h2>${domains}</nav>`;
}

function luma(hex: string): number {
  return (
    0.299 * parseInt(hex.slice(1, 3), 16) +
    0.587 * parseInt(hex.slice(3, 5), 16) +
    0.114 * parseInt(hex.slice(5, 7), 16)
  );
}

function stripFor(system: ResolvedSystem, withDeltas = false): string {
  if (system.steps.length === 0)
    return `<p class="sub">No steps demanded yet.</p>`;
  const cells = system.steps
    .map((step) => {
      const textColor =
        step.opaque && luma(step.css) < 150 ? "#fff" : "#1d2427";
      const cellClass = step.opaque ? "" : ' class="swatch-alpha"';
      return `<a href="/system/${system.system}#${stepAnchor(step)}"${cellClass}><span class="strip-fill" style="background:${esc(step.css)}"></span><span class="step-label" style="color:${textColor}">${esc(step.publicStep)}</span><span class="step-hex" style="color:${textColor}">${esc(step.css)}</span></a>`;
    })
    .join("");
  const strip = `<div class="strip">${cells}</div>`;
  if (!withDeltas) return `<div class="strip-wrap">${strip}</div>`;
  const gaps = system.steps
    .map((step, i) => {
      const next = system.steps[i + 1];
      const label =
        next && step.opaque && next.opaque
          ? `<span>${oklabDeltaE(step.css, next.css).toFixed(3)}</span>`
          : "";
      return `<div class="gap">${label}</div>`;
    })
    .join("");
  return `<div class="strip-wrap">${strip}<div class="strip-gaps">${gaps}</div></div>`;
}

function paramValue(value: unknown): string {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return `<span class="cell">${swatch(value, true, 18)}<code>${esc(value)}</code></span>`;
  }
  if (Array.isArray(value)) {
    return `<span class="cell">${value.map((v) => paramValue(v)).join(" ")}</span>`;
  }
  if (value != null && typeof value === "object") {
    return `<code class="muted">${Object.keys(value).length} entries</code>`;
  }
  return `<code>${esc(String(value))}</code>`;
}

function paramsFor(system: ResolvedSystem): string {
  const entries = Object.entries(system.params);
  if (entries.length === 0) return "";
  const items = entries
    .map(
      ([key, value]) =>
        `<div class="param">${esc(key)}<div class="param-value">${paramValue(value)}</div></div>`,
    )
    .join("");
  return `<div class="params">${items}</div>`;
}

export function renderOverview(
  resolved: ResolvedDefinition,
  banner: string | null,
): string {
  const warnings =
    resolved.warnings.length > 0
      ? `<div class="warn"><strong>Warnings</strong><ul class="plain">${resolved.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`
      : "";
  const systems = resolved.systems
    .map(
      (s) =>
        `<h2><a href="/system/${s.system}">${esc(s.system)}</a> <span class="muted">→ ${esc(publicSystemName(s, "css"))} · ${esc(s.algorithm)}</span></h2>${stripFor(s)}`,
    )
    .join("");
  const statics =
    resolved.statics.length > 0
      ? `<h2>Statics</h2><table><tbody>${resolved.statics
          .map(
            (s) =>
              `<tr><td><code>${esc(s.name)}</code></td><td><span class="cell">${swatch(s.hex, true, 22)}<code>${esc(s.hex)}</code></span></td></tr>`,
          )
          .join("")}</tbody></table>`
      : "";
  const domains = [...new Set(resolved.roles.map((r) => r.domain))]
    .map((d) => {
      const count = resolved.roles.filter((r) => r.domain === d).length;
      return `<li><a href="/domain/${d}"><code>${esc(d)}</code></a> <span class="muted">${count} roles</span></li>`;
    })
    .join("");
  return layout(
    "Colors",
    navFor(resolved),
    `<h1>Colors</h1><p class="sub">Modes: ${resolved.modes.join(", ")}</p>${warnings}${systems}${statics}<h2>Role domains</h2><ul class="plain">${domains}</ul>`,
    banner,
  );
}

export function renderSystem(
  resolved: ResolvedDefinition,
  name: string,
  lineage: Lineage,
  banner: string | null,
): string | null {
  const system = resolved.systems.find((s) => s.system === name);
  if (!system) return null;
  const rows = system.steps
    .map((step, i) => {
      const uses = lineage.get(`${name}/${step.selector}`) ?? [];
      const usedBy = uses
        .map(
          (u) =>
            `<a href="/domain/${u.domain}#${u.role}"><code>${esc(`${u.domain}.${u.role}`)}</code></a><span class="muted"> ${esc(u.mode)}${u.viaTransparent ? " (transparent)" : ""}</span>`,
        )
        .join(", ");
      const previous = i > 0 ? system.steps[i - 1] : null;
      const deltaE =
        previous && step.opaque && previous.opaque
          ? `<span class="de">${oklabDeltaE(previous.css, step.css).toFixed(3)}</span>`
          : `<span class="muted">—</span>`;
      const value = step.overridden
        ? `<span class="cell">${swatch(step.css, step.opaque, 22)}<code>${esc(step.css)}</code><span class="pill">override</span></span>
           <div class="muted" style="margin-top:3px">generated <span class="cell" style="display:inline-flex">${swatch(step.generatedCss ?? "", step.opaque, 14)}<code>${esc(step.generatedCss ?? "")}</code></span></div>`
        : `<span class="cell">${swatch(step.css, step.opaque, 22)}<code>${esc(step.css)}</code></span>`;
      return `<tr id="${stepAnchor(step)}"><td><code>${esc(publicSystemName(system, "css"))}-${esc(step.publicStep)}</code></td><td><code>${esc(name)}/${esc(step.selector)}</code></td><td>${value}</td><td>${deltaE}</td><td>${usedBy || '<span class="muted">—</span>'}</td></tr>`;
    })
    .join("");
  return layout(
    `${name} · Colors`,
    navFor(resolved),
    `<h1>${esc(name)} <span class="muted" style="font-size:14px">emits <code>${esc(publicSystemName(system, "css"))}</code> · ${esc(system.algorithm)}</span></h1>
     <p class="desc">${esc(system.algorithmDescription)}</p>
     ${paramsFor(system)}
     ${stripFor(system, true)}
     <table><thead><tr><th>Token</th><th>Ref</th><th>Value</th><th>ΔE prev</th><th>Demanded by</th></tr></thead><tbody>${rows}</tbody></table>`,
    banner,
  );
}

export function renderDomain(
  resolved: ResolvedDefinition,
  name: string,
  banner: string | null,
): string | null {
  const roles = resolved.roles.filter((r) => r.domain === name);
  if (roles.length === 0) return null;
  const modeHeaders = resolved.modes.map((m) => `<th>${esc(m)}</th>`).join("");
  const rows = roles
    .map((role: ResolvedRole) => {
      const cells = role.perMode
        .map(
          (entry) =>
            `<td><span class="cell">${swatch(entry.css, entry.opaque)}<span><code>${esc(entry.css)}</code><br>${refLink(entry.ref, entry.target)}</span></span></td>`,
        )
        .join("");
      return `<tr id="${esc(role.role)}"><td><code>${esc(role.role)}</code></td>${cells}</tr>`;
    })
    .join("");
  return layout(
    `${name} · Colors`,
    navFor(resolved),
    `<h1>${esc(name)}</h1><p class="sub">${roles.length} roles</p>
     <table><thead><tr><th>Role</th>${modeHeaders}</tr></thead><tbody>${rows}</tbody></table>`,
    banner,
  );
}
