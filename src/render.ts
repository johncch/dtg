import { formatColor, isOpaque, oklabDeltaE } from "./color-math.js";
import type { AlgorithmPreview } from "./contract.js";
import {
  algorithmFor,
  publicPath,
  publicSystemName,
  type Lineage,
  type RefTarget,
  type ResolvedDefinition,
  type ResolvedRole,
  type ResolvedStep,
  type ResolvedSystem,
} from "./resolve.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function swatch(css: string, opaque: boolean, size = 28): string {
  const inner = `<span class="swatch-color" style="background:${esc(css)}"></span>`;
  return `<span class="swatch ${opaque ? "" : "swatch-alpha"}" style="width:${size}px;height:${size}px">${inner}</span>`;
}

function constantAnchor(path: string): string {
  return `c-${path.replace(/\./g, "_")}`;
}

function stepAnchor(step: ResolvedStep): string {
  return `s-${step.publicStep}`;
}

function refLink(
  resolved: ResolvedDefinition,
  ref: string,
  target: RefTarget,
): string {
  if (target.kind === "role") {
    return `<a href="/domain/${target.domain}#${target.role}"><code>${esc(ref)}</code></a>`;
  }
  if (target.kind === "constant") {
    return `<a href="/constants#${constantAnchor(target.name)}"><code>${esc(ref)}</code></a>`;
  }
  const step = resolved.systems
    .find((s) => s.system === target.system)
    ?.steps.find((s) => s.selector === target.selector);
  return `<a href="/system/${target.system}#s-${step?.publicStep ?? target.selector}"><code>${esc(ref)}</code></a>`;
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
  .picker { display: flex; flex-direction: column; gap: 14px; max-width: 640px; }
  .spaces { display: flex; gap: 10px; align-items: center; }
  .spaces select { font-size: 13px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--fg); }
  .field-wrap { position: relative; width: 100%; aspect-ratio: 3 / 2; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; cursor: crosshair; }
  .field-wrap canvas { width: 100%; height: 100%; display: block; }
  .dot { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.35); pointer-events: none; }
  .axes { display: flex; justify-content: space-between; font-size: 11px; color: var(--faint); font-family: "SF Mono", ui-monospace, monospace; }
  .zgrad { grid-column: 1 / -1; height: 10px; border-radius: 3px; border: 1px solid var(--border); margin-top: 6px; }
  .zmark { position: relative; height: 0; }
  .zmark i { position: absolute; top: -14px; width: 2px; height: 14px; background: var(--fg); }
  .check { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 10px 0 4px; }
  .check figure { margin: 0; }
  .check .pairbox { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--border); }
  .check .pairbox span { height: 52px; display: block; }
  .check figcaption { font-size: 11px; color: var(--faint); font-family: "SF Mono", ui-monospace, monospace; display: flex; justify-content: space-between; margin-top: 4px; }
  .readout { display: flex; flex-wrap: wrap; gap: 14px; font-family: "SF Mono", ui-monospace, monospace; font-size: 12px; }
  .readout span b { color: var(--faint); font-weight: 600; margin-right: 4px; }
  .tool { display: grid; grid-template-columns: minmax(240px, 300px) 1fr; gap: 20px; align-items: start; }
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .track { grid-column: 1 / -1; position: relative; height: 6px; border-radius: 3px; background: var(--border-soft); margin: 6px 0 2px; }
  .track i { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--fg); opacity: 0.55; }
  .track i.p3 { background: var(--link); }
  .track-key { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: 12px; font-size: 11px; color: var(--faint); font-family: "SF Mono", ui-monospace, monospace; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .big { min-height: 150px; border-radius: 8px; border: 1px solid var(--border); }
  .cap { font-size: 12px; color: var(--muted); margin-top: 6px; }
  .cap b { color: var(--fg); font-weight: 600; }
  .val { font-family: "SF Mono", ui-monospace, monospace; font-size: 12px; color: var(--fg); word-break: break-all; }
  .tag { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 99px; vertical-align: 1px; }
  .tag.in { background: #e6f4ec; color: #2f7d5c; }
  .tag.out { background: #fdeaea; color: #a33; }
  body.on-dark .tag.in { background: rgba(47,125,92,0.25); color: #8fd9b6; }
  body.on-dark .tag.out { background: rgba(163,51,51,0.25); color: #f0a0a0; }
  .quad { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .quad .big { min-height: 120px; }
  .tuner { display: grid; grid-template-columns: minmax(260px, 320px) 1fr; gap: 20px; align-items: start; margin: 0 0 20px; }
  .tuner-controls { display: flex; flex-direction: column; gap: 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  .ctl { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  .ctl label { color: var(--fg); }
  .ctl select { font-size: 12px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 5px; background: transparent; color: var(--fg); }
  .ctl input[type="color"] { width: 30px; height: 24px; padding: 0; border: 1px solid var(--border); border-radius: 5px; background: transparent; cursor: pointer; }
  .ctl-range { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 62px; gap: 8px; align-items: center; }
  .ctl-range input[type="range"] { width: 100%; accent-color: var(--link); }
  .ctl-range input[type="number"] { width: 100%; font-family: \"SF Mono\", ui-monospace, monospace; font-size: 12px; padding: 3px 5px; border: 1px solid var(--border); border-radius: 5px; background: transparent; color: var(--fg); }
  .ctl-sep { border-top: 1px solid var(--border-soft); margin: 4px 0 0; padding-top: 8px; }
  .composite { min-height: 300px; border: 1px solid var(--border); border-radius: 8px; }
  .tuner-out { display: flex; flex-direction: column; gap: 10px; }
  .tuner-steps { display: flex; flex-wrap: wrap; gap: 6px; }
  .tuner-steps .chip { display: flex; align-items: center; gap: 6px; font-size: 11px; font-family: \"SF Mono\", ui-monospace, monospace; border: 1px solid var(--border); border-radius: 6px; padding: 3px 7px; color: var(--muted); }
  .tuner-steps .chip b { font-weight: 600; color: var(--fg); }
  pre.snippet { background: var(--panel-head); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-family: \"SF Mono\", ui-monospace, monospace; font-size: 11.5px; line-height: 1.5; overflow-x: auto; color: var(--fg); }
  .tuner-err { color: #a33; font-size: 12px; font-family: \"SF Mono\", ui-monospace, monospace; }
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
var live = new EventSource("/events");
live.onmessage = function () { location.reload(); };
// Closed explicitly on navigation: a page frozen into the back/forward
// cache keeps its stream open, and six open streams exhaust the browser's
// per-origin connection limit, so the next page load blocks forever.
addEventListener("pagehide", function () { live.close(); });

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
  const constants =
    resolved.statics.length > 0
      ? `<h2>Constants</h2><a href="/constants">all ${resolved.statics.length}</a>`
      : "";
  return `<h1><a href="/">colors</a></h1><nav>
    <h2>Tools</h2><a href="/colors">picker &amp; gamut</a><a href="/blend">blending</a>
    <h2>Systems</h2>${systems}${constants}<h2>Roles</h2>${domains}</nav>`;
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
        isOpaque(step.color) && luma(formatColor(step.color, "srgb")) < 150 ? "#fff" : "#1d2427";
      const cellClass = isOpaque(step.color) ? "" : ' class="swatch-alpha"';
      return `<a href="/system/${system.system}#${stepAnchor(step)}"${cellClass}><span class="strip-fill" style="background:${esc(formatColor(step.color, "srgb"))}"></span><span class="step-label" style="color:${textColor}">${esc(step.publicStep)}</span><span class="step-hex" style="color:${textColor}">${esc(formatColor(step.color, "srgb"))}</span></a>`;
    })
    .join("");
  const strip = `<div class="strip">${cells}</div>`;
  if (!withDeltas) return `<div class="strip-wrap">${strip}</div>`;
  const gaps = system.steps
    .map((step, i) => {
      const next = system.steps[i + 1];
      const label =
        next && isOpaque(step.color) && isOpaque(next.color)
          ? `<span>${oklabDeltaE(formatColor(step.color, "srgb"), formatColor(next.color, "srgb")).toFixed(3)}</span>`
          : "";
      return `<div class="gap">${label}</div>`;
    })
    .join("");
  return `<div class="strip-wrap">${strip}<div class="strip-gaps">${gaps}</div></div>`;
}

function tunerFor(system: ResolvedSystem, pv: AlgorithmPreview): string {
  const control = (c: (typeof pv.controls)[number]) => {
    if (c.kind === "color") {
      return `<div class="ctl"><label for="c-${esc(c.path)}">${esc(c.label)}</label>
         <input type="color" id="c-${esc(c.path)}" data-path="${esc(c.path)}" value="${esc(c.value)}"></div>`;
    }
    if (c.kind === "select") {
      const options = c.options
        .map(
          (o) =>
            `<option value="${esc(o.value)}"${o.value === c.value ? " selected" : ""}>${esc(o.label)}</option>`,
        )
        .join("");
      return `<div class="ctl"><label for="c-${esc(c.path)}">${esc(c.label)}</label>
         <select id="c-${esc(c.path)}" data-path="${esc(c.path)}" data-kind="select">${options}</select></div>`;
    }
    return `<div class="ctl ctl-sep"><label for="c-${esc(c.path)}">${esc(c.label)}</label><span>${esc(c.unit ?? "")}</span>
         <div class="ctl-range">
           <input type="range" data-path="${esc(c.path)}" value="${c.value}" min="${c.min}" max="${c.max}" step="${c.step}">
           <input type="number" id="c-${esc(c.path)}" data-path="${esc(c.path)}" value="${c.value}" min="${c.min}" max="${c.max}" step="${c.step}">
         </div></div>`;
  };

  const vars = (pv.composite?.vars ?? [])
    .map(
      (v) => `<div class="ctl ctl-sep"><label for="v-${esc(v.name)}">${esc(v.label)}</label><span>${esc(v.unit ?? "")}</span>
        <div class="ctl-range">
          <input type="range" data-var="${esc(v.name)}" value="${v.value}" min="${v.min}" max="${v.max}" step="${v.step}">
          <input type="number" id="v-${esc(v.name)}" data-var="${esc(v.name)}" value="${v.value}" min="${v.min}" max="${v.max}" step="${v.step}">
        </div></div>`,
    )
    .join("");

  return `<div class="tuner">
    <div class="tuner-controls">${vars}${pv.controls.map(control).join("")}</div>
    <div class="tuner-out">
      ${pv.composite ? `<div class="composite" id="composite"></div>` : ""}
      <div class="tuner-steps" id="tuner-steps"></div>
      <div class="tuner-err" id="tuner-err"></div>
      <pre class="snippet" id="tuner-yaml"></pre>
    </div>
  </div>
  <script>
  (function () {
    var system = ${JSON.stringify(system.system)};
    var templates = ${JSON.stringify(pv.composite?.selectors ?? [])};
    var params = document.querySelectorAll("[data-path]");
    var vars = document.querySelectorAll("[data-var]");

    function varValues() {
      var out = {};
      vars.forEach(function (el) { out[el.dataset.var] = el.value; });
      return out;
    }
    function wanted() {
      var v = varValues();
      return templates.map(function (t) {
        Object.keys(v).forEach(function (name) {
          t = t.split("{" + name + "}").join(v[name]);
        });
        return t;
      });
    }
    function overrides() {
      var out = {};
      params.forEach(function (el) {
        out[el.dataset.path] = (el.type === "color" || el.dataset.kind === "select")
          ? el.value : Number(el.value);
      });
      return out;
    }
    function mirror(source) {
      var key = source.dataset.var ? "data-var" : "data-path";
      var val = source.dataset.var || source.dataset.path;
      document.querySelectorAll("[" + key + "=\'" + val + "\']").forEach(function (el) {
        if (el !== source) el.value = source.value;
      });
    }
    function paint(data, ring) {
      var err = document.getElementById("tuner-err");
      err.textContent = data.error || "";
      if (data.error) return;
      var by = {};
      data.steps.forEach(function (s) { by[s.selector] = s.css; });
      var box = document.getElementById("composite");
      if (box && ring.length) {
        var seq = ring.map(function (s) { return by[s]; }).filter(Boolean);
        if (seq.length) {
          var all = seq.concat([seq[0]]);
          box.style.background = "linear-gradient(178deg, " + all.map(function (c, i) {
            return c + " " + ((i / (all.length - 1)) * 100).toFixed(1) + "%";
          }).join(", ") + ")";
        }
      }
      document.getElementById("tuner-steps").innerHTML = data.steps.map(function (s) {
        return \'<span class="chip"><span class="swatch\' + (s.opaque ? "" : " swatch-alpha") +
          \'" style="width:14px;height:14px"><span class="swatch-color" style="background:\' + s.css +
          \'"></span></span><b>\' + s.selector + "</b>" + s.css + "</span>";
      }).join("");
      document.getElementById("tuner-yaml").textContent = data.yaml || "";
    }
    function update() {
      var ring = wanted();
      fetch("/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system: system, overrides: overrides(), selectors: ring }),
      }).then(function (r) { return r.json(); }).then(function (d) { paint(d, ring); });
    }
    [].forEach.call(params, function (el) {
      el.addEventListener("input", function () { mirror(el); update(); });
    });
    [].forEach.call(vars, function (el) {
      el.addEventListener("input", function () { mirror(el); update(); });
    });
    update();
  })();
  </script>`;
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
      ? `<h2><a href="/constants">Constants</a> <span class="muted">${resolved.statics.length}</span></h2>
         <div class="strip-wrap"><div class="strip">${resolved.statics
           .map(
             (s) =>
               `<a href="/constants#${constantAnchor(s.path)}"><span class="strip-fill" style="background:${esc(formatColor(s.color, "srgb"))}"></span><span class="step-label" style="color:${luma(formatColor(s.color, "srgb")) < 150 ? "#fff" : "#1d2427"}">${esc(s.path)}</span></a>`,
           )
           .join("")}</div></div>`
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

export function renderConstants(
  resolved: ResolvedDefinition,
  lineage: Lineage,
  banner: string | null,
): string | null {
  if (resolved.statics.length === 0) return null;
  const rows = resolved.statics
    .map((c) => {
      const uses = lineage.get(c.path) ?? [];
      const usedBy = uses
        .map(
          (u) =>
            `<a href="/domain/${u.domain}#${u.role}"><code>${esc(`${u.domain}.${u.role}`)}</code></a><span class="muted"> ${esc(u.mode)}${u.translucent ? " (translucent)" : ""}</span>`,
        )
        .join(", ");
      return `<tr id="${constantAnchor(c.path)}">
        <td><code>${esc(c.path)}</code></td>
        <td><code>--color-${esc(publicPath(c.segments, "css", "-"))}</code></td>
        <td><span class="cell">${swatch(formatColor(c.color, "srgb"), true, 22)}<code>${esc(formatColor(c.color, "srgb"))}</code></span></td>
        <td>${usedBy || '<span class="muted">nothing — it emits, but no role points at it</span>'}</td>
      </tr>`;
    })
    .join("");
  return layout(
    "Constants · Colors",
    navFor(resolved),
    `<h1>Constants</h1>
     <p class="desc">Flat colors with no recipe behind them. A role points at one by path; <code>transparent(name 70)</code> takes one at an alpha. Unlike a system step, a constant emits whether or not anything demands it.</p>
     <table><thead><tr><th>Path</th><th>Emits</th><th>Value</th><th>Used by</th></tr></thead><tbody>${rows}</tbody></table>`,
    banner,
  );
}


export function renderPicker(
  resolved: ResolvedDefinition,
  banner: string | null,
): string {
  return layout(
    "Picker · Colors",
    navFor(resolved),
    `<h1>Picker &amp; gamut</h1>
     <p class="desc">Pick in any space. The field draws a contour where sRGB runs out, so you can see which colours your definition could ask for that sRGB cannot express — and the two swatches below show the difference on a display that can.</p>
     <div class="picker">
       <div class="spaces">
         <label for="space">space</label>
         <select id="space">
           <option value="oklch">OKLCH — lightness, chroma, hue</option>
           <option value="oklab">OKLab — lightness, a, b</option>
           <option value="srgb">sRGB — red, green, blue</option>
           <option value="display-p3">Display P3 — red, green, blue</option>
         </select>
         <span class="muted" id="hint"></span>
       </div>
       <div class="field-wrap" id="wrap"><canvas id="field" width="360" height="240"></canvas><span class="dot" id="dot"></span></div>
       <div class="axes"><span id="axX"></span><span id="axY"></span></div>
       <p class="cap" id="cover"></p>
       <div class="ctl ctl-sep"><label for="s">third axis</label><span id="sName"></span>
         <div class="ctl-range"><input type="range" id="sr" min="0" max="1" step="0.002" value="0.5">
         <input type="number" id="s" step="0.002" value="0.5"></div>
         <div class="zgrad" id="zgrad"></div>
         <div class="zmark"><i id="zmark"></i></div></div>
       <div class="readout" id="readout"></div>
     </div>

     <div class="pair" style="margin-top:20px">
       <div><div class="big" id="swSrgb"></div>
         <div class="cap"><b>sRGB</b> <span id="tagSrgb"></span><div class="val" id="vSrgb"></div></div></div>
       <div><div class="big" id="swP3"></div>
         <div class="cap"><b>Display P3</b> <span id="tagP3"></span><div class="val" id="vP3"></div></div></div>
     </div>
     <p class="cap" id="note"></p>
     <p class="cap"><b>Display check.</b> These are the sRGB and P3 primaries side by side — the widest gap there is. If each pair looks identical, this display or browser is not rendering P3 and no comparison above will show anything.</p>
     <div class="check">
       <figure><div class="pairbox"><span style="background:#ff0000"></span><span style="background:color(display-p3 1 0 0)"></span></div>
         <figcaption><span>sRGB red</span><span>P3 red</span></figcaption></figure>
       <figure><div class="pairbox"><span style="background:#00ff00"></span><span style="background:color(display-p3 0 1 0)"></span></div>
         <figcaption><span>sRGB green</span><span>P3 green</span></figcaption></figure>
       <figure><div class="pairbox"><span style="background:#0000ff"></span><span style="background:color(display-p3 0 0 1)"></span></div>
         <figcaption><span>sRGB blue</span><span>P3 blue</span></figcaption></figure>
     </div>
     <p class="cap" id="wideNote"></p>
     <pre class="snippet" id="out"></pre>

     <script type="module">
     import { oklchToOklab, oklabToOklch, encodedToOklab, encodeIn,
              inGamut, formatIn, oklabToLinear, gamutMap } from "/color-math.js";
     const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
     const $ = (id) => document.getElementById(id);
     const NL = String.fromCharCode(10);

     const SPACES = {
       oklch: { x: ["C", 0, 0.4], y: ["L", 0, 1], z: ["H", 0, 360],
                hint: "unbounded — chroma can exceed any display",
                toLab: (v) => oklchToOklab([v.L, v.C, v.H]),
                fromLab: (lab) => { const o = oklabToOklch(lab); return { L: o[0], C: o[1], H: o[2] }; } },
       oklab: { x: ["a", -0.4, 0.4], y: ["b", -0.4, 0.4], z: ["L", 0, 1],
                hint: "unbounded — a and b are the opponent axes",
                toLab: (v) => [v.L, v.a, v.b],
                fromLab: (lab) => ({ L: lab[0], a: lab[1], b: lab[2] }) },
       srgb: { x: ["g", 0, 1], y: ["b", 0, 1], z: ["r", 0, 1],
               hint: "a cross-section of the sRGB cube — everything here is in gamut",
               toLab: (v) => encodedToOklab([v.r, v.g, v.b], "srgb"),
               fromLab: (lab) => { const c = encodeIn(lab, "srgb")[0]; return { r: c[0], g: c[1], b: c[2] }; } },
       "display-p3": { x: ["g", 0, 1], y: ["b", 0, 1], z: ["r", 0, 1],
               hint: "a cross-section of the P3 cube — the contour is where sRGB ends",
               toLab: (v) => encodedToOklab([v.r, v.g, v.b], "display-p3"),
               fromLab: (lab) => { const c = encodeIn(lab, "display-p3")[0]; return { r: c[0], g: c[1], b: c[2] }; } },
     };

     let spaceId = "oklch";
     let v = { L: 0.6, C: 0.1, H: 29 };
     const canvas = $("field");
     let ctx;
     try { ctx = canvas.getContext("2d", { colorSpace: "display-p3" }); } catch (e) { ctx = null; }
     if (!ctx) ctx = canvas.getContext("2d");
     const wide = (ctx.getContextAttributes && ctx.getContextAttributes().colorSpace) === "display-p3";
     const paintGamut = wide ? "display-p3" : "srgb";

     function sp() { return SPACES[spaceId]; }
     function axisVal(axis, t) { return axis[1] + t * (axis[2] - axis[1]); }
     function axisPos(axis, val) { return (val - axis[1]) / (axis[2] - axis[1]); }

     function drawField() {
       const s = sp(), W = canvas.width, H = canvas.height;
       const img = ctx.createImageData(W, H);
       const mask = new Uint8Array(W * H);
       for (let py = 0; py < H; py++) {
         for (let px = 0; px < W; px++) {
           const probe = Object.assign({}, v);
           probe[s.x[0]] = axisVal(s.x, px / (W - 1));
           probe[s.y[0]] = axisVal(s.y, 1 - py / (H - 1));
           const lab = s.toLab(probe);
           const i = py * W + px;
           mask[i] = inGamut(lab, "srgb") ? 1 : 0;
           const lin = oklabToLinear(lab, paintGamut);
           const o = i * 4;
           for (let k = 0; k < 3; k++) {
             const c = Math.min(1, Math.max(0, lin[k]));
             img.data[o + k] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
           }
           img.data[o + 3] = 255;
         }
       }
       // contour: a pixel in sRGB with a neighbour outside it
       for (let py = 0; py < H; py++) {
         for (let px = 0; px < W; px++) {
           const i = py * W + px;
           if (!mask[i]) continue;
           const edge = (px > 0 && !mask[i - 1]) || (px < W - 1 && !mask[i + 1]) ||
                        (py > 0 && !mask[i - W]) || (py < H - 1 && !mask[i + W]);
           if (edge) { const o = i * 4; img.data[o] = 255; img.data[o+1] = 255; img.data[o+2] = 255; }
         }
       }
       ctx.putImageData(img, 0, 0);
       let inside = 0;
       for (let i = 0; i < mask.length; i++) inside += mask[i];
       const pct = Math.round((inside / mask.length) * 100);
       $("cover").textContent = pct === 100
         ? "every colour in this slice is within sRGB"
         : (pct === 0
             ? "none of this slice is within sRGB — no contour to draw"
             : pct + "% of this slice is within sRGB; the contour is the boundary");
     }

     function paint() {
       const s = sp();
       $("hint").textContent = s.hint;
       $("wideNote").textContent = wide
         ? "This browser gave us a Display P3 canvas, so the field above is drawn in P3. If the pairs above still look identical, the display itself is clamping — check the monitor's colour preset."
         : "This browser did NOT give us a Display P3 canvas, so everything here is sRGB and no pair will differ.";
       $("axX").textContent = s.x[0] + ": " + s.x[1] + " to " + s.x[2] + "  (horizontal)";
       $("axY").textContent = s.y[0] + ": " + s.y[1] + " to " + s.y[2] + "  (vertical)";
       $("sName").textContent = s.z[0];
       for (const id of ["s", "sr"]) {
         const el = $(id);
         el.min = s.z[1]; el.max = s.z[2];
         el.step = (s.z[2] - s.z[1]) / 500;
         el.value = v[s.z[0]];
       }
       const stops = [];
       for (let i = 0; i <= 24; i++) {
         const probe = Object.assign({}, v);
         probe[s.z[0]] = axisVal(s.z, i / 24);
         stops.push(formatIn(s.toLab(probe), wide ? "display-p3" : "srgb") + " " + ((i / 24) * 100) + "%");
       }
       $("zgrad").style.background = "linear-gradient(to right, " + stops.join(", ") + ")";
       $("zmark").style.left = (axisPos(s.z, v[s.z[0]]) * 100) + "%";
       $("dot").style.left = (axisPos(s.x, v[s.x[0]]) * 100) + "%";
       $("dot").style.top = ((1 - axisPos(s.y, v[s.y[0]])) * 100) + "%";
       $("readout").innerHTML = Object.keys(v).map((k) =>
         "<span><b>" + k + "</b>" + (Math.round(v[k] * 1000) / 1000) + "</span>").join("");

       const lab = s.toLab(v);
       const okS = inGamut(lab, "srgb"), okP = inGamut(lab, "display-p3");
       const srgb = formatIn(lab, "srgb"), p3 = formatIn(lab, "display-p3");
       $("swSrgb").style.background = srgb;
       $("swP3").style.background = p3;
       $("vSrgb").textContent = srgb;
       $("vP3").textContent = p3;
       $("tagSrgb").className = "tag " + (okS ? "in" : "out");
       $("tagSrgb").textContent = okS ? "in gamut" : "gamut mapped";
       $("tagP3").className = "tag " + (okP ? "in" : "out");
       $("tagP3").textContent = okP ? "in gamut" : "gamut mapped";
       if (okS) {
         $("note").textContent = "Both displays can show this exactly, so the swatches match.";
       } else {
         const gap = dE(lab, gamutMap(lab, "srgb"));
         const verdict = gap > 0.05 ? "clearly visible" : (gap > 0.02 ? "subtle but above the ~0.02 threshold" : "below the ~0.02 threshold — you should NOT expect to see a difference");
         $("note").textContent = "Outside sRGB, chroma reduced by " +
           Math.round((1 - oklabToOklch(gamutMap(lab, "srgb"))[1] / oklabToOklch(lab)[1]) * 100) +
           "%. Expected difference dE " + gap.toFixed(3) + " — " + verdict + ".";
       }
       const o = oklabToOklch(lab);
       $("out").textContent = ["oklch(" + (Math.round(o[0]*1000)/1000) + " " +
         (Math.round(o[1]*1000)/1000) + " " + Math.round(o[2]) + ")", srgb, p3].join(NL);
     }

     function repaint() { drawField(); paint(); }

     function pick(ev) {
       const r = $("wrap").getBoundingClientRect();
       const s = sp();
       const tx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
       const ty = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
       v[s.x[0]] = axisVal(s.x, tx);
       v[s.y[0]] = axisVal(s.y, 1 - ty);
       paint();
     }
     let dragging = false;
     $("wrap").addEventListener("pointerdown", (e) => { dragging = true; $("wrap").setPointerCapture(e.pointerId); pick(e); });
     $("wrap").addEventListener("pointermove", (e) => { if (dragging) pick(e); });
     $("wrap").addEventListener("pointerup", () => { dragging = false; });

     for (const [a, b] of [["s","sr"],["sr","s"]]) {
       $(a).addEventListener("input", () => { $(b).value = $(a).value; v[sp().z[0]] = Number($(a).value); repaint(); });
     }
     $("space").addEventListener("change", () => {
       const lab = sp().toLab(v);
       spaceId = $("space").value;
       v = sp().fromLab(lab);
       repaint();
     });
     repaint();
     </script>`,
    banner,
  );
}

export function renderBlend(
  resolved: ResolvedDefinition,
  banner: string | null,
): string {
  return layout(
    "Blending · Colors",
    navFor(resolved),
    `<h1>Blending</h1>
     <p class="desc">The same operation — <code>t</code> of A over B — carried out in four spaces. Endpoints always agree; everything between them is where the spaces disagree, because a straight line between two colours takes a different path in each.</p>
     <div class="tool">
       <div class="pane">
         <div class="ctl"><label for="a">colour A</label><input type="color" id="a" value="#b30a0a"></div>
         <div class="ctl"><label for="b">colour B</label><input type="color" id="b" value="#ffffff"></div>
         <div class="ctl ctl-sep"><label for="t">amount of A</label><span>%</span>
           <div class="ctl-range"><input type="range" id="tr" min="0" max="100" step="1" value="6">
           <input type="number" id="t" min="0" max="100" step="1" value="6"></div></div>
         <p class="cap" id="drift"></p>
       </div>
       <div class="quad" id="quad"></div>
     </div>
     <script type="module">
     import { mixIn, BLEND_SPACES, hexToOklab, oklabToOklch } from "/color-math.js";
     const $ = (id) => document.getElementById(id);
     const quad = $("quad");
     for (const s of BLEND_SPACES) {
       const box = document.createElement("div");
       box.innerHTML = '<div class="big" id="sw-' + s.id + '"></div>' +
         '<div class="cap"><b>' + s.label + '</b><div class="val" id="v-' + s.id + '"></div>' + s.note + '</div>';
       quad.appendChild(box);
     }
     function paint() {
       const A = $("a").value, B = $("b").value, t = Number($("t").value) / 100;
       for (const s of BLEND_SPACES) {
         const r = mixIn(A, B, t, s.id);
         document.getElementById("sw-" + s.id).style.background = r.css;
         document.getElementById("v-" + s.id).textContent = r.css === r.hex ? r.css : r.css + "  ~ " + r.hex;
       }
       const h = (hex) => oklabToOklch(hexToOklab(hex))[2];
       const base = h(A);
       const parts = BLEND_SPACES.map((s) => {
         const got = h(mixIn(A, B, t, s.id).hex);
         let d = ((got - base + 540) % 360) - 180;
         return s.label + " " + (d >= 0 ? "+" : "") + d.toFixed(1) + "deg";
       });
       $("drift").textContent = "Hue drift from A (" + base.toFixed(0) + "deg): " + parts.join(", ");
     }
     for (const [x, y] of [["t","tr"],["tr","t"]]) $(x).addEventListener("input", () => { $(y).value = $(x).value; paint(); });
     for (const id of ["a","b"]) $(id).addEventListener("input", paint);
     paint();
     </script>`,
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
            `<a href="/domain/${u.domain}#${u.role}"><code>${esc(`${u.domain}.${u.role}`)}</code></a><span class="muted"> ${esc(u.mode)}${u.translucent ? " (translucent)" : ""}</span>`,
        )
        .join(", ");
      const previous = i > 0 ? system.steps[i - 1] : null;
      const deltaE =
        previous && isOpaque(step.color) && isOpaque(previous.color)
          ? `<span class="de">${oklabDeltaE(formatColor(previous.color, "srgb"), formatColor(step.color, "srgb")).toFixed(3)}</span>`
          : `<span class="muted">—</span>`;
      const value = step.overridden
        ? `<span class="cell">${swatch(formatColor(step.color, "srgb"), isOpaque(step.color), 22)}<code>${esc(formatColor(step.color, "srgb"))}</code><span class="pill">override</span></span>
           <div class="muted" style="margin-top:3px">generated <span class="cell" style="display:inline-flex">${swatch(formatColor(step.generated!, "srgb"), isOpaque(step.color), 14)}<code>${esc(formatColor(step.generated!, "srgb"))}</code></span></div>`
        : `<span class="cell">${swatch(formatColor(step.color, "srgb"), isOpaque(step.color), 22)}<code>${esc(formatColor(step.color, "srgb"))}</code></span>`;
      return `<tr id="${stepAnchor(step)}"><td><code>${esc(publicSystemName(system, "css"))}-${esc(step.publicStep)}</code></td><td><code>${esc(name)}/${esc(step.selector)}</code></td><td>${value}</td><td>${deltaE}</td><td>${usedBy || '<span class="muted">—</span>'}</td></tr>`;
    })
    .join("");
  const pv = algorithmFor(system.algorithm)?.preview?.(
    system.params,
    system.steps.map((s) => s.selector),
  );
  return layout(
    `${name} · Colors`,
    navFor(resolved),
    `<h1>${esc(name)} <span class="muted" style="font-size:14px">emits <code>${esc(publicSystemName(system, "css"))}</code> · ${esc(system.algorithm)}</span></h1>
     <p class="desc">${esc(system.algorithmDescription)}</p>
     ${pv ? tunerFor(system, pv) : paramsFor(system)}
     ${stripFor(system, pv?.shape !== "palette")}
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
            `<td><span class="cell">${swatch(formatColor(entry.color, "srgb"), isOpaque(entry.color))}<span><code>${esc(formatColor(entry.color, "srgb"))}</code><br>${refLink(resolved, entry.ref, entry.target)}</span></span></td>`,
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
