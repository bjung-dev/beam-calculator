// User interface for the beam calculator.
//
// Units on the page: forces in kN, lengths in m (section dimensions in mm), moments in kN·m,
// stress in MPa, and strain in microstrain (με = 10⁻⁶).

import {
  CANTILEVER, SIMPLY_SUPPORTED, Beam, DistributedLoad, bendingStress, circle, diagrams, extremes,
  hollowCircle, iBeam, internalForces, linspace, rectangle, solveReactions, strain, sum,
} from "./beam.js";

const MATERIALS = { // Young's modulus E, GPa
  "Structural steel": 200,
  "Aluminum (6061)": 69,
  "Wood (Douglas fir)": 13,
  "Concrete": 30,
  "Custom": null,
};

const SHAPES = { // dimension inputs in mm: [key, label, default]
  "Rectangle": [["b", "Width, b", 100], ["h", "Height, h", 250]],
  "I-beam": [["bf", "Flange width, b", 150], ["tf", "Flange thick., t_f", 12], ["h", "Total height, h", 300], ["tw", "Web thick., t_w", 8]],
  "Circle": [["d", "Diameter, d", 150]],
  "Round tube": [["D", "Outer diam., D", 150], ["d", "Inner diam., d", 130]],
};

const EXAMPLES = {
  "Simply supported: center point load": {
    L: 6, support: SIMPLY_SUPPORTED, pinX: 0, rollerX: 6, points: [{ x: 3, P: 10 }], dists: [], moments: [],
  },
  "Simply supported: uniform load": {
    L: 6, support: SIMPLY_SUPPORTED, pinX: 0, rollerX: 6, points: [],
    dists: [{ start: 0, end: 6, wStart: 5, wEnd: 5 }], moments: [],
  },
  "Simply supported: triangular load": {
    L: 6, support: SIMPLY_SUPPORTED, pinX: 0, rollerX: 6, points: [],
    dists: [{ start: 0, end: 6, wStart: 0, wEnd: 9 }], moments: [],
  },
  "Cantilever: end load + uniform load": {
    L: 4, support: CANTILEVER, fixedEnd: "left", points: [{ x: 4, P: 8 }],
    dists: [{ start: 0, end: 4, wStart: 2, wEnd: 2 }], moments: [],
  },
  "Overhanging beam: mixed loads": {
    L: 10, support: SIMPLY_SUPPORTED, pinX: 0, rollerX: 7, points: [{ x: 5, P: 10 }, { x: 10, P: 6 }],
    dists: [{ start: 0, end: 4, wStart: 4, wEnd: 4 }], moments: [{ x: 2.5, M: -8 }],
  },
  "Blank beam": { L: 5, support: SIMPLY_SUPPORTED, pinX: 0, rollerX: 5, points: [], dists: [], moments: [] },
};

const LOAD_COLUMNS = {
  points: [["x", 0.25], ["P", 1]],
  dists: [["start", 0.25], ["end", 0.25], ["wStart", 0.5], ["wEnd", 0.5]],
  moments: [["x", 0.25], ["M", 1]],
};
const NEW_ROW = {
  points: (L) => ({ x: L / 2, P: 10 }),
  dists: (L) => ({ start: 0, end: L, wStart: 5, wEnd: 5 }),
  moments: (L) => ({ x: L / 2, M: 10 }),
};

const TO_MPA = 1e-3; // kN/m² → MPa

const state = {
  L: 6, support: SIMPLY_SUPPORTED, pinX: 0, rollerX: 6, fixedEnd: "left",
  points: [], dists: [], moments: [],
  shape: "Rectangle", dims: {}, material: "Structural steel", E: 200, xCut: null,
};

const $ = (id) => document.getElementById(id);

// --- Formatting ------------------------------------------------------------------

function fmt(v, digits = 2) {
  const s = v.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s; // no "-0.00"
}
const num = (x) => String(+x.toFixed(4)); // compact positions, e.g. 2.5 not 2.50

// --- Theme-aware chart colors ------------------------------------------------------

function colors() {
  const css = getComputedStyle(document.documentElement);
  const get = (name) => css.getPropertyValue(`--${name}`).trim();
  return Object.fromEntries(
    ["ink", "ink-2", "muted", "grid", "axis", "surface", "shear", "moment", "load", "reaction", "top", "bottom",
      "compression", "neutral", "tension", "beam"].map((n) => [n, get(n)]),
  );
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function baseLayout(c, extra = {}) {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", color: c["ink-2"], size: 12 },
    hoverlabel: { bgcolor: c.surface, bordercolor: c.axis, font: { color: c.ink } },
    showlegend: false,
    ...extra,
  };
}

function axis(c, extra = {}) {
  return { gridcolor: c.grid, zeroline: false, linecolor: c.axis, tickcolor: c.axis, ...extra };
}

const PLOT_CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["select2d", "lasso2d"] };

// --- Building the model from the inputs ---------------------------------------------

function buildSection() {
  const d = Object.fromEntries(Object.entries(state.dims).map(([k, v]) => [k, v / 1000])); // mm → m
  switch (state.shape) {
    case "Rectangle": return rectangle(d.b, d.h);
    case "I-beam": return iBeam(d.bf, d.tf, d.h, d.tw);
    case "Circle": return circle(d.d);
    default: return hollowCircle(d.D, d.d);
  }
}

function buildModel() {
  const complete = (row, keys) => keys.every(([k]) => Number.isFinite(row[k]));
  const beam = new Beam({
    length: state.L,
    support: state.support,
    pinX: state.pinX,
    rollerX: state.rollerX,
    fixedEnd: state.fixedEnd,
    pointLoads: state.points.filter((r) => complete(r, LOAD_COLUMNS.points)),
    distributedLoads: state.dists.filter((r) => complete(r, LOAD_COLUMNS.dists))
      .map((r) => new DistributedLoad(r.start, r.end, r.wStart, r.wEnd)),
    moments: state.moments.filter((r) => complete(r, LOAD_COLUMNS.moments)),
  });
  const section = buildSection();
  if (!(section.I > 0)) throw new Error("the cross-section dimensions must be positive");
  if (!(state.E > 0)) throw new Error("Young's modulus must be positive");
  return { beam, section };
}

// --- Free-body diagram -------------------------------------------------------------

function renderFreeBody(beam, reactions, c) {
  const L = beam.length;
  const traces = [];
  const annotations = [];
  const shapes = [{ type: "rect", x0: 0, x1: L, y0: -0.06, y1: 0.06, fillcolor: c.beam, line: { width: 0 } }];

  const arrow = (x, yHead, yTail, color) => annotations.push({
    x, y: yHead, ax: x, ay: yTail, xref: "x", yref: "y", axref: "x", ayref: "y", text: "",
    showarrow: true, arrowhead: 2, arrowsize: 1.1, arrowwidth: 2.5, arrowcolor: color,
  });
  const label = (x, y, text, color, yanchor = "middle", size = 12) => annotations.push({
    x, y, text, showarrow: false, yanchor, font: { color, size },
  });

  // Distributed loads: a shaded profile with small arrows, height scaled to the largest w
  const wPeak = Math.max(1e-12, ...beam.distributedLoads.flatMap((d) => [Math.abs(d.wStart), Math.abs(d.wEnd)]));
  const height = (w) => 0.15 + (0.75 * Math.abs(w)) / wPeak;
  for (const d of beam.distributedLoads) {
    const xs = linspace(d.start, d.end, 60);
    traces.push({
      x: [...xs, ...[...xs].reverse()],
      y: [...xs.map((x) => height(d.intensity(x))), ...xs.map(() => 0.15)],
      fill: "toself", fillcolor: withAlpha(c.load, 0.15), line: { color: c.load, width: 1.5 }, mode: "lines",
      hoverinfo: "text", text: `${fmt(d.wStart)} → ${fmt(d.wEnd)} kN/m, resultant ${fmt(d.resultant)} kN`,
    });
    const nArrows = Math.max(3, Math.floor((8 * d.length) / L) + 1);
    for (const x of linspace(d.start, d.end, nArrows)) {
      const w = d.intensity(x);
      if (Math.abs(w) > 1e-9) arrow(x, w > 0 ? 0.08 : height(w), w > 0 ? height(w) : 0.08, c.load);
    }
    const text = d.wStart === d.wEnd ? `${fmt(d.wStart)} kN/m` : `${fmt(d.wStart)} → ${fmt(d.wEnd)} kN/m`;
    label((d.start + d.end) / 2, 0.92, text, c.load, "bottom");
  }

  for (const p of beam.pointLoads) {
    if (p.P >= 0) arrow(p.x, 0.08, 1.25, c.load);
    else arrow(p.x, 1.25, 0.08, c.load);
    label(p.x, 1.27, `${fmt(Math.abs(p.P))} kN${p.P < 0 ? " ↑" : ""}`, c.load, "bottom");
  }

  for (const m of beam.moments) {
    label(m.x, 0, m.M >= 0 ? "↺" : "↻", c.load, "middle", 34);
    label(m.x, -0.3, `${fmt(Math.abs(m.M))} kN·m`, c.load, "top");
  }

  // Supports
  if (beam.support === SIMPLY_SUPPORTED) {
    const tri = 0.035 * L;
    const { pinX, rollerX } = beam;
    traces.push({
      x: [pinX - tri, pinX, pinX + tri, pinX - tri], y: [-0.45, -0.06, -0.45, -0.45], fill: "toself",
      fillcolor: withAlpha(c.beam, 0.45), mode: "lines", line: { color: c.beam }, hoverinfo: "skip",
    });
    traces.push({
      x: [rollerX], y: [-0.22], mode: "markers", hoverinfo: "skip",
      marker: { size: 18, color: "rgba(0,0,0,0)", line: { color: c.beam, width: 2.5 } },
    });
    for (const x0 of [pinX, rollerX]) {
      shapes.push({ type: "line", x0: x0 - 1.4 * tri, x1: x0 + 1.4 * tri, y0: -0.47, y1: -0.47, line: { color: c.beam, width: 2 } });
    }
  } else {
    const xw = beam.fixedEnd === "left" ? 0 : L;
    const side = beam.fixedEnd === "left" ? -1 : 1;
    shapes.push({ type: "rect", x0: xw, x1: xw + side * 0.025 * L, y0: -0.7, y1: 0.7, fillcolor: c.beam, opacity: 0.6, line: { width: 0 } });
  }

  // Reactions, drawn below the supports
  for (const r of reactions.forces) {
    if (r.R >= 0) arrow(r.x, -0.5, -1.35, c.reaction);
    else arrow(r.x, -1.35, -0.5, c.reaction);
    // Anchor labels at the beam ends inward so they aren't clipped on narrow screens
    const xanchor = r.x <= 0.15 * L ? "left" : r.x >= 0.85 * L ? "right" : "center";
    annotations.push({
      x: r.x, y: -1.4, text: `<b>${r.label}: ${fmt(Math.abs(r.R))} kN ${r.R >= 0 ? "↑" : "↓"}</b>`, showarrow: false,
      xanchor, xshift: { left: -8, right: 8, center: 0 }[xanchor], yanchor: "top", font: { color: c.reaction, size: 12 },
    });
  }
  for (const m of reactions.moments) {
    const offset = (beam.fixedEnd === "left" ? 0.08 : -0.08) * L;
    label(m.x + offset, 0.45, m.M >= 0 ? "↺" : "↻", c.reaction, "middle", 34);
    label(m.x + offset, 0.95, `<b>${fmt(Math.abs(m.M))} kN·m</b>`, c.reaction, "bottom");
  }

  const pad = 0.06 * L;
  Plotly.react($("fbd"), traces, baseLayout(c, {
    height: 300, margin: { l: 20, r: 20, t: 10, b: 40 }, annotations, shapes,
    xaxis: axis(c, { range: [-pad, L + pad], title: { text: "x (m)" }, showgrid: false, fixedrange: true }),
    yaxis: { range: [-1.9, 1.6], visible: false, fixedrange: true },
  }), { ...PLOT_CONFIG, displayModeBar: false });
}

// --- Shear / moment / stress / strain diagrams -------------------------------------------

function renderDiagrams(beam, diag, fibers, c) {
  const L = beam.length;
  const titles = ["Shear force, V (kN)", "Bending moment, M (kN·m)",
    "Bending stress at the extreme fibers, σ (MPa)", "Bending strain at the extreme fibers, ε (με)"];
  const domains = [[0.79, 0.97], [0.53, 0.71], [0.27, 0.45], [0.01, 0.19]];
  const traces = [];
  const annotations = [];
  const layout = baseLayout(c, {
    height: 960, margin: { l: 60, r: 20, t: 10, b: 50 }, hovermode: "x unified",
    showlegend: true, legend: { orientation: "h", x: 0, y: -0.06, font: { color: c["ink-2"] } },
    xaxis: axis(c, { anchor: "y4", range: [-0.04 * L, 1.04 * L], title: { text: "x (m)" } }),
  });

  const area = (y, name, color, axisId, unit, digits = 2) => ({
    x: diag.x, y, name, xaxis: "x", yaxis: axisId, mode: "lines", fill: "tozeroy",
    line: { color, width: 2 }, fillcolor: withAlpha(color, 0.15), showlegend: false,
    hovertemplate: `${name} = %{y:.${digits}f} ${unit}<extra></extra>`,
  });
  const line = (y, name, color, axisId, unit, showlegend, digits = 2) => ({
    x: diag.x, y, name, xaxis: "x", yaxis: axisId, mode: "lines", line: { color, width: 2 },
    legendgroup: name, showlegend, hovertemplate: `${name} = %{y:.${digits}f} ${unit}<extra></extra>`,
  });
  traces.push(area(diag.V, "V", c.shear, "y", "kN"));
  traces.push(area(diag.M, "M", c.moment, "y2", "kN·m"));
  traces.push(line(fibers.sigmaTop, "Top fiber", c.top, "y3", "MPa", true));
  traces.push(line(fibers.sigmaBot, "Bottom fiber", c.bottom, "y3", "MPa", true));
  traces.push(line(fibers.epsTop, "Top fiber", c.top, "y4", "με", false, 1));
  traces.push(line(fibers.epsBot, "Bottom fiber", c.bottom, "y4", "με", false, 1));

  // Label the peaks of V and M
  const peaks = (values, axisId, color, withX) => {
    const e = extremes(values, diag.x);
    for (const [v, x] of [[e.max, e.xMax], [e.min, e.xMin]]) {
      if (Math.abs(v) < 1e-9) continue;
      traces.push({
        x: [x], y: [v], xaxis: "x", yaxis: axisId, mode: "markers", marker: { size: 8, color },
        hoverinfo: "skip", showlegend: false,
      });
      annotations.push({
        x, y: v, xref: "x", yref: axisId, showarrow: false, yshift: v > 0 ? 12 : -12,
        text: withX ? `${fmt(v)} at x = ${num(x)}` : fmt(v), font: { color: c.ink, size: 12 },
      });
    }
  };
  peaks(diag.V, "y", c.shear, false);
  peaks(diag.M, "y2", c.moment, true);

  const series = [diag.V, diag.M, fibers.sigmaBot, fibers.epsBot];
  ["yaxis", "yaxis2", "yaxis3", "yaxis4"].forEach((key, i) => {
    let lo;
    let hi;
    if (i < 2) {
      lo = Math.min(0, ...series[i]);
      hi = Math.max(0, ...series[i]);
    } else { // stress and strain are symmetric about zero
      hi = Math.max(...series[i].map(Math.abs));
      lo = -hi;
    }
    const pad = 0.25 * (hi - lo) || 1;
    layout[key] = axis(c, { domain: domains[i], anchor: "x", range: [lo - pad, hi + pad], zeroline: true, zerolinecolor: c.axis });
    annotations.push({
      text: `<b>${titles[i]}</b>`, xref: "paper", yref: "paper", x: 0, y: domains[i][1] + 0.005,
      xanchor: "left", yanchor: "bottom", showarrow: false, font: { color: c.ink, size: 13 },
    });
  });
  layout.annotations = annotations;
  Plotly.react($("diagrams"), traces, layout, PLOT_CONFIG);
}

// --- Stress inside the beam ----------------------------------------------------------

function renderHeat(beam, reactions, section, c) {
  const L = beam.length;
  const xs = linspace(0, L, 301);
  const Ms = xs.map((x) => internalForces(beam, x, reactions).M);
  const ys = linspace(-section.c, section.c, 61);
  const z = ys.map((y) => Ms.map((M) => bendingStress(M, y, section.I) * TO_MPA));
  const zlim = Math.max(1e-9, ...z.flat().map(Math.abs));
  Plotly.react($("heat"), [{
    type: "heatmap", x: xs, y: ys.map((y) => y * 1000), z, zmin: -zlim, zmax: zlim,
    colorscale: [[0, c.compression], [0.5, c.neutral], [1, c.tension]],
    colorbar: { title: { text: "σ (MPa)" }, outlinewidth: 0, thickness: 14 },
    hovertemplate: "x = %{x:.2f} m<br>y = %{y:.1f} mm<br>σ = %{z:.2f} MPa<extra></extra>",
  }], baseLayout(c, {
    height: 260, margin: { l: 60, r: 20, t: 10, b: 45 },
    xaxis: axis(c, { title: { text: "x (m)" }, range: [-0.04 * L, 1.04 * L] }),
    yaxis: axis(c, { title: { text: "y from neutral axis (mm)" } }),
  }), PLOT_CONFIG);
}

function sectionOutline(c) {
  // Outline of the cross section in mm, centred on its centroid: {traces, shapes, halfWidth, halfDepth}
  const d = state.dims;
  const fill = withAlpha(c.beam, 0.3);
  const outline = (x, y) => ({ x, y, fill: "toself", fillcolor: fill, mode: "lines", line: { color: c.beam, width: 2 }, hoverinfo: "skip", xaxis: "x", yaxis: "y" });
  if (state.shape === "Rectangle") {
    const [w, h] = [d.b / 2, d.h / 2];
    return { traces: [outline([-w, w, w, -w, -w], [h, h, -h, -h, h])], halfWidth: w, halfDepth: h };
  }
  if (state.shape === "I-beam") {
    const [b, t, h, w] = [d.bf / 2, d.tf, d.h / 2, d.tw / 2];
    return {
      traces: [outline(
        [-b, b, b, w, w, b, b, -b, -b, -w, -w, -b, -b],
        [h, h, h - t, h - t, -h + t, -h + t, -h, -h, -h + t, -h + t, h - t, h - t, h],
      )],
      halfWidth: b, halfDepth: h,
    };
  }
  // Circle or tube: outer circle one way, inner circle back the other way, leaving a hole
  const R = (state.shape === "Circle" ? d.d : d.D) / 2;
  const r = state.shape === "Circle" ? 0 : d.d / 2;
  const t = linspace(0, 2 * Math.PI, 120);
  const tr = [...t].reverse();
  return {
    traces: [outline([...t.map((a) => R * Math.cos(a)), ...tr.map((a) => r * Math.cos(a))],
      [...t.map((a) => R * Math.sin(a)), ...tr.map((a) => r * Math.sin(a))])],
    halfWidth: R, halfDepth: R,
  };
}

function renderCut(beam, reactions, section, c) {
  const x = state.xCut;
  $("xCut-out").textContent = x.toFixed(2);
  const { V, M } = internalForces(beam, x, reactions);
  const E = state.E * 1e6; // GPa → kPa, to match kN/m² stresses
  const ys = linspace(-section.c, section.c, 61);
  const sig = ys.map((y) => bendingStress(M, y, section.I) * TO_MPA);
  const eps = sig.map((s) => strain(s / TO_MPA, E) * 1e6);

  $("cut-stats").innerHTML = [
    stat("Shear, V", `${fmt(V)} kN`),
    stat("Moment, M", `${fmt(M)} kN·m`),
    stat("σ top / bottom", `${fmt(sig.at(-1))} / ${fmt(sig[0])} MPa`),
    stat("ε top / bottom", `${fmt(eps.at(-1), 1)} / ${fmt(eps[0], 1)} με`),
    stat("Average shear stress, V/A", `${fmt((V / section.area) * TO_MPA, 3)} MPa`),
  ].join("");

  const out = sectionOutline(c);
  const hd = out.halfDepth;
  const yMm = ys.map((y) => y * 1000);
  const traces = [...out.traces, {
    x: [-out.halfWidth * 1.3, out.halfWidth * 1.3], y: [0, 0], mode: "lines", xaxis: "x", yaxis: "y",
    line: { color: c.muted, dash: "dash", width: 1.5 }, hoverinfo: "skip",
  }];
  const annotations = [{ x: out.halfWidth * 1.3, y: 0, xref: "x", yref: "y", text: "N.A.", showarrow: false, xanchor: "right", yanchor: "bottom", font: { color: c.muted } }];
  for (const [values, xa, unit, digits] of [[sig, "x2", "MPa", 2], [eps, "x3", "με", 1]]) {
    traces.push({
      x: values, y: yMm, xaxis: xa, yaxis: "y", mode: "lines", fill: "tozerox",
      line: { color: c.moment, width: 2 }, fillcolor: withAlpha(c.moment, 0.15),
      hovertemplate: `%{x:.${digits}f} ${unit} at y = %{y:.1f} mm<extra></extra>`,
    });
    annotations.push(
      { x: values.at(-1), y: hd, xref: xa, yref: "y", text: fmt(values.at(-1), digits), showarrow: false, yanchor: "bottom", font: { color: c.ink } },
      { x: values[0], y: -hd, xref: xa, yref: "y", text: fmt(values[0], digits), showarrow: false, yanchor: "top", font: { color: c.ink } },
    );
  }
  const titles = [[`${section.name} section`, 0], ["Stress, σ (MPa)", 0.36], ["Strain, ε (με)", 0.7]];
  for (const [text, x0] of titles) {
    annotations.push({ text: `<b>${text}</b>`, xref: "paper", yref: "paper", x: x0, y: 1.02, xanchor: "left", yanchor: "bottom", showarrow: false, font: { color: c.ink, size: 13 } });
  }
  const lim = Math.max(out.halfWidth * 1.4, hd * 1.2);
  const vlim = (values) => 1.25 * Math.max(1e-9, ...values.map(Math.abs));
  Plotly.react($("cut"), traces, baseLayout(c, {
    height: 360, margin: { l: 60, r: 20, t: 30, b: 45 }, annotations,
    xaxis: axis(c, { domain: [0, 0.26], range: [-lim, lim], scaleanchor: "y", title: { text: "mm" } }),
    xaxis2: axis(c, { domain: [0.36, 0.64], anchor: "y", range: [-vlim(sig), vlim(sig)], title: { text: "σ (MPa)" }, zeroline: true, zerolinecolor: c.axis }),
    xaxis3: axis(c, { domain: [0.7, 1], anchor: "y", range: [-vlim(eps), vlim(eps)], title: { text: "ε (με)" }, zeroline: true, zerolinecolor: c.axis }),
    yaxis: axis(c, { range: [-hd * 1.35, hd * 1.35], title: { text: "y (mm)" } }),
  }), PLOT_CONFIG);
}

// --- Stat tiles and tables --------------------------------------------------------------

function stat(label, value, sub = "") {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}

function renderStats(reactions, diag, crit, section) {
  const V = extremes(diag.V, diag.x);
  $("reaction-stats").innerHTML = [
    ...reactions.forces.map((r) => stat(`${r.label} force`, `${fmt(r.R)} kN`, `at x = ${num(r.x)} m · positive = upward`)),
    ...reactions.moments.map((m) => stat(`${m.label} moment`, `${fmt(m.M)} kN·m`, `at x = ${num(m.x)} m · positive = counterclockwise`)),
    stat("Max |shear|", `${fmt(Math.max(Math.abs(V.max), Math.abs(V.min)))} kN`),
    stat("Max |moment|", `${fmt(Math.abs(crit.M))} kN·m`, `at x = ${num(crit.x)} m`),
  ].join("");

  const sigmaMax = ((Math.abs(crit.M) * section.c) / section.I) * TO_MPA;
  $("section-stats").innerHTML = [
    stat("Area, A", `${(section.area * 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} mm²`),
    stat("Second moment of area, I", `${(section.I * 1e12).toExponential(3)} mm⁴`),
    stat("Max bending stress", `${fmt(sigmaMax)} MPa`, `|M| c / I at x = ${num(crit.x)} m`),
    stat("Max bending strain", `${fmt((sigmaMax / (state.E * 1e3)) * 1e6, 1)} με`, `σ / E with E = ${num(state.E)} GPa`),
  ].join("");
}

function renderDataTable(beam, reactions, section) {
  const E = state.E * 1e6;
  const rows = linspace(0, beam.length, 21).map((x) => {
    const { V, M } = internalForces(beam, x, reactions);
    const sig = ((M * section.c) / section.I) * TO_MPA;
    return [x.toFixed(3), V.toFixed(3), M.toFixed(3), sig.toFixed(3), ((sig / TO_MPA / E) * 1e6).toFixed(2)];
  });
  $("data-table").innerHTML = "<thead><tr><th>x (m)</th><th>V (kN)</th><th>M (kN·m)</th><th>σ bottom (MPa)</th><th>ε bottom (με)</th></tr></thead>"
    + `<tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

// --- Math tab: reactions and worked example ---------------------------------------------

function renderMath(beam, reactions, section, crit) {
  const tex = (s) => `$$${s}$$`;
  let html;
  if (beam.support === SIMPLY_SUPPORTED) {
    html = "<p>Sum moments about the <b>pin</b> at \\(x = a\\) so its unknown force drops out. The roller at \\(x = b\\) is then the only unknown:</p>"
      + tex(String.raw`R_{\text{roller}}\,(b - a) - \sum F_i\,(x_i - a) + \sum C_j = 0 \;\;\Longrightarrow\;\; R_{\text{roller}} = \frac{\sum F_i (x_i - a) - \sum C_j}{b - a}`)
      + "<p>Then vertical force balance gives the pin:</p>"
      + tex(String.raw`R_{\text{pin}} = \sum F_i - R_{\text{roller}}`);
  } else {
    html = "<p>At the wall (\\(x = a\\)), force balance gives the vertical reaction and moment balance about the wall gives the reaction moment:</p>"
      + tex(String.raw`R_{\text{wall}} = \sum F_i \qquad M_{\text{wall}} = \sum F_i\,(x_i - a) - \sum C_j`);
  }
  $("math-reactions").innerHTML = html;

  // Worked example with the current numbers
  const loads = beam.loadResultants();
  const items = [
    ...beam.pointLoads.map((p) => `<li>Point load: <b>${fmt(p.P)} kN</b> at x = ${num(p.x)} m</li>`),
    ...beam.distributedLoads.map((d) => {
      const where = d.centroid === null ? "(net zero)" : `at x = ${d.centroid.toFixed(3)} m`;
      return `<li>Distributed load ${fmt(d.wStart)} → ${fmt(d.wEnd)} kN/m from ${num(d.start)} to ${num(d.end)} m: resultant <b>${fmt(d.resultant, 3)} kN</b> ${where}</li>`;
    }),
    ...beam.moments.map((m) => `<li>Couple: <b>${fmt(m.M)} kN·m</b> at x = ${num(m.x)} m</li>`),
  ];
  let ex = `<p><b>Loads</b> (distributed loads replaced by their resultants):</p><ul>${items.join("") || "<li>none</li>"}</ul>`;
  const total = sum(loads.map(([F]) => F));
  const sumC = sum(beam.moments.map((m) => m.M));
  if (beam.support === SIMPLY_SUPPORTED) {
    const a = beam.pinX;
    const b = beam.rollerX;
    const momentSum = sum(loads.map(([F, x]) => F * (x - a)));
    const [Rpin, Rroller] = reactions.forces.map((r) => r.R);
    ex += tex(String.raw`\sum F_i (x_i - a) = ${momentSum.toFixed(3)}\ \text{kN}\cdot\text{m} \qquad \sum C_j = ${sumC.toFixed(3)}\ \text{kN}\cdot\text{m}`)
      + tex(String.raw`R_{\text{roller}} = \frac{${momentSum.toFixed(3)} - (${sumC.toFixed(3)})}{${num(b)} - ${num(a)}} = ${Rroller.toFixed(3)}\ \text{kN}`)
      + tex(String.raw`R_{\text{pin}} = ${total.toFixed(3)} - ${Rroller.toFixed(3)} = ${Rpin.toFixed(3)}\ \text{kN}`);
  } else {
    const a = beam.fixedEnd === "left" ? 0 : beam.length;
    const momentSum = sum(loads.map(([F, x]) => F * (x - a)));
    ex += tex(String.raw`R_{\text{wall}} = ${reactions.forces[0].R.toFixed(3)}\ \text{kN} \qquad M_{\text{wall}} = ${momentSum.toFixed(3)} - (${sumC.toFixed(3)}) = ${reactions.moments[0].M.toFixed(3)}\ \text{kN}\cdot\text{m}`);
  }
  const cMm = section.c * 1000;
  const IMm4 = section.I * 1e12;
  const sigmaMax = ((Math.abs(crit.M) * section.c) / section.I) * TO_MPA;
  const [mant, exp] = IMm4.toExponential(4).split("e");
  const Itex = `${mant}\\times 10^{${Number(exp)}}`;
  ex += `<p>The largest moment is <b>${fmt(crit.M)} kN·m</b> at x = ${num(crit.x)} m. For the ${section.name.toLowerCase()} section, \\(I = ${Itex}\\) mm⁴ and \\(c = ${cMm.toFixed(1)}\\) mm, so:</p>`
    + tex(String.raw`\sigma_{\max} = \frac{|M|\,c}{I} = \frac{(${Math.abs(crit.M).toFixed(3)}\times 10^6\ \text{N}\cdot\text{mm})(${cMm.toFixed(1)}\ \text{mm})}{${Itex}\ \text{mm}^4} = ${sigmaMax.toFixed(2)}\ \text{MPa}`)
    + tex(String.raw`\varepsilon_{\max} = \frac{\sigma_{\max}}{E} = \frac{${sigmaMax.toFixed(2)}\ \text{MPa}}{${num(state.E)}\times 10^3\ \text{MPa}} = ${((sigmaMax / (state.E * 1e3)) * 1e6).toFixed(1)}\times 10^{-6}`);
  $("math-example").innerHTML = ex;
  typeset($("tab-math"));
}

function typeset(el) {
  if (window.renderMathInElement) {
    renderMathInElement(el, {
      delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\(", right: "\\)", display: false }],
      throwOnError: false,
    });
  }
}

// --- Main update -------------------------------------------------------------------------

function update() {
  let model;
  try {
    model = buildModel();
  } catch (err) {
    $("error").textContent = `Check the inputs: ${err.message}.`;
    $("error").hidden = false;
    $("results").classList.add("stale");
    return;
  }
  $("error").hidden = true;
  $("results").classList.remove("stale");

  const { beam, section } = model;
  const c = colors();
  const reactions = solveReactions(beam);
  const diag = diagrams(beam);
  const E = state.E * 1e6;
  const sigmaTop = diag.M.map((M) => bendingStress(M, section.c, section.I) * TO_MPA);
  const sigmaBot = diag.M.map((M) => bendingStress(M, -section.c, section.I) * TO_MPA);
  const fibers = {
    sigmaTop, sigmaBot,
    epsTop: sigmaTop.map((s) => strain(s / TO_MPA, E) * 1e6),
    epsBot: sigmaBot.map((s) => strain(s / TO_MPA, E) * 1e6),
  };
  const e = extremes(diag.M, diag.x);
  const crit = Math.abs(e.max) >= Math.abs(e.min) ? { M: e.max, x: e.xMax } : { M: e.min, x: e.xMin };

  const slider = $("xCut");
  slider.max = beam.length;
  if (state.xCut === null) state.xCut = Math.round(crit.x * 100) / 100;
  state.xCut = Math.min(state.xCut, beam.length);
  slider.value = state.xCut;

  renderFreeBody(beam, reactions, c);
  renderStats(reactions, diag, crit, section);
  renderDiagrams(beam, diag, fibers, c);
  renderHeat(beam, reactions, section, c);
  renderCut(beam, reactions, section, c);
  renderDataTable(beam, reactions, section);
  renderMath(beam, reactions, section, crit);
  lastModel = { beam, reactions, section };
}

let lastModel = null;
let lastValidL = state.L; // the length the supports were last placed against

// --- Inputs -------------------------------------------------------------------------------

const readNumber = (input) => (input.value.trim() === "" ? NaN : Number(input.value));

function renderLoadTable(kind) {
  const tbody = $(`${kind}-table`).querySelector("tbody");
  const cols = LOAD_COLUMNS[kind];
  if (state[kind].length === 0) {
    tbody.innerHTML = `<tr class="empty"><td colspan="${cols.length + 1}">None yet</td></tr>`;
    return;
  }
  tbody.innerHTML = state[kind].map((row, i) => `<tr>${cols.map(([key, step]) => (
    `<td><input type="number" step="${step}" data-kind="${kind}" data-i="${i}" data-key="${key}" value="${row[key] ?? ""}" aria-label="${key}"></td>`
  )).join("")}<td><button type="button" class="remove" data-kind="${kind}" data-i="${i}" aria-label="Remove">×</button></td></tr>`).join("");
}

function renderDims() {
  $("dims").innerHTML = SHAPES[state.shape].map(([key, label]) => (
    `<label class="field"><span>${label} (mm)</span><input type="number" min="0" step="1" data-dim="${key}" value="${state.dims[key]}"></label>`
  )).join("");
}

function setPressed(groupId, value) {
  for (const b of $(groupId).querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.value === value));
}

function syncSupportFields() {
  setPressed("support", state.support);
  setPressed("fixedEnd", state.fixedEnd);
  $("ss-fields").hidden = state.support !== SIMPLY_SUPPORTED;
  $("cant-fields").hidden = state.support !== CANTILEVER;
}

function loadExample(name) {
  const ex = structuredClone(EXAMPLES[name]);
  Object.assign(state, {
    L: ex.L, support: ex.support, pinX: ex.pinX ?? 0, rollerX: ex.rollerX ?? ex.L, fixedEnd: ex.fixedEnd ?? "left",
    points: ex.points, dists: ex.dists, moments: ex.moments, xCut: null,
  });
  $("L").value = lastValidL = state.L;
  $("pinX").value = state.pinX;
  $("rollerX").value = state.rollerX;
  syncSupportFields();
  Object.keys(LOAD_COLUMNS).forEach(renderLoadTable);
  update();
}

function setShape(shape) {
  state.shape = shape;
  state.dims = Object.fromEntries(SHAPES[shape].map(([key, , value]) => [key, value]));
  renderDims();
}

function init() {
  $("example").innerHTML = Object.keys(EXAMPLES).map((n) => `<option>${n}</option>`).join("");
  $("material").innerHTML = Object.keys(MATERIALS).map((n) => `<option>${n}</option>`).join("");
  $("E").value = state.E;
  $("E-field").hidden = true;
  setShape(state.shape);

  $("example").addEventListener("change", (e) => loadExample(e.target.value));

  for (const id of ["L", "pinX", "rollerX"]) {
    $(id).addEventListener("input", (e) => {
      state[id] = readNumber(e.target);
      if (id === "L" && Number.isFinite(state.L)) {
        // A support sitting at the right end stays at the right end
        for (const key of ["pinX", "rollerX"]) {
          if (state[key] === lastValidL) $(key).value = state[key] = state.L;
        }
        $("rollerX").max = $("pinX").max = lastValidL = state.L;
      }
      update();
    });
  }

  $("support").addEventListener("click", (e) => {
    const value = e.target.closest("button")?.dataset.value;
    if (!value) return;
    state.support = value;
    syncSupportFields();
    update();
  });
  $("fixedEnd").addEventListener("click", (e) => {
    const value = e.target.closest("button")?.dataset.value;
    if (!value) return;
    state.fixedEnd = value;
    syncSupportFields();
    update();
  });

  $("shape").addEventListener("change", (e) => {
    setShape(e.target.value);
    update();
  });
  $("dims").addEventListener("input", (e) => {
    state.dims[e.target.dataset.dim] = readNumber(e.target);
    update();
  });

  $("material").addEventListener("change", (e) => {
    const E = MATERIALS[e.target.value];
    $("E-field").hidden = E !== null;
    if (E !== null) state.E = E;
    $("E").value = state.E;
    update();
  });
  $("E").addEventListener("input", (e) => {
    state.E = readNumber(e.target);
    update();
  });

  // Load tables: edit in place (no re-render, so focus stays put); add/remove re-render
  document.querySelector(".loads").addEventListener("input", (e) => {
    const { kind, i, key } = e.target.dataset;
    if (!kind) return;
    state[kind][Number(i)][key] = readNumber(e.target);
    update();
  });
  document.querySelector(".loads").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.add) {
      const kind = btn.dataset.add;
      state[kind].push(NEW_ROW[kind](Number.isFinite(state.L) ? state.L : 1));
      renderLoadTable(kind);
      update();
    } else if (btn.classList.contains("remove")) {
      state[btn.dataset.kind].splice(Number(btn.dataset.i), 1);
      renderLoadTable(btn.dataset.kind);
      update();
    }
  });

  $("xCut").addEventListener("input", (e) => {
    state.xCut = Number(e.target.value);
    if (lastModel) renderCut(lastModel.beam, lastModel.reactions, lastModel.section, colors());
  });

  // Tabs (the math tab can be linked to directly as #math)
  const showTab = (name) => {
    for (const t of document.querySelectorAll(".tabs button")) t.setAttribute("aria-selected", String(t.dataset.tab === name));
    $("tab-calc").hidden = name !== "calc";
    $("tab-math").hidden = name !== "math";
    if (name === "calc") window.dispatchEvent(new Event("resize")); // let Plotly re-measure
  };
  for (const tab of document.querySelectorAll(".tabs button")) {
    tab.addEventListener("click", () => {
      showTab(tab.dataset.tab);
      history.replaceState(null, "", tab.dataset.tab === "math" ? "#math" : location.pathname);
    });
  }
  if (location.hash === "#math") showTab("math");

  // Redraw the charts in the new colors when the system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", update);

  loadExample(Object.keys(EXAMPLES)[0]);
}

init();
