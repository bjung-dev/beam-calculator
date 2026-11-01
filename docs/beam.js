// Statically determinate beams: support reactions, shear, bending moment, stress and strain.
//
// Everything comes from the two equilibrium equations for a beam loaded in its plane:
//
//     ΣFy = 0        (forces balance vertically)
//     ΣM  = 0        (moments balance about any point)
//
// Coordinates: x runs along the beam from its left end (x = 0) to its right end (x = L).
//
// Sign conventions:
//   - Applied loads are entered as positive when they point DOWN (gravity loads).
//   - Reaction forces are positive when they point UP.
//   - Moments (applied couples and the fixed-support reaction) are positive COUNTERCLOCKWISE.
//   - Internal shear V(x) is the net upward force on everything to the left of the cut.
//   - Internal moment M(x) is positive when it bends the beam into a smile (sagging),
//     which puts the bottom of the beam in tension.
//
// The functions are unit-agnostic: use any consistent set (the site uses kN and m).

export const SIMPLY_SUPPORTED = "simply supported"; // pin + roller (anywhere, so overhangs are allowed)
export const CANTILEVER = "cantilever"; // one fixed end, the other end free

// --- Loads -------------------------------------------------------------------

// Linearly varying load from x = start to x = end, intensity wStart → wEnd (positive downward).
// Covers uniform (wStart = wEnd), triangular (one end zero) and trapezoidal loads.
export class DistributedLoad {
  constructor(start, end, wStart, wEnd) {
    Object.assign(this, { start, end, wStart, wEnd });
  }

  get length() {
    return this.end - this.start;
  }

  // Split into a rectangle and a triangle: [[resultant force, x of its centroid], ...].
  // Rectangle: height wStart, resultant wStart·L at the middle.
  // Triangle: height (wEnd − wStart), resultant ½(wEnd − wStart)·L at 2/3 of the way from the start.
  pieces() {
    const L = this.length;
    return [
      [this.wStart * L, this.start + L / 2],
      [0.5 * (this.wEnd - this.wStart) * L, this.start + (2 * L) / 3],
    ];
  }

  // Total force = area under the load diagram.
  get resultant() {
    return sum(this.pieces().map(([F]) => F));
  }

  // Where the resultant acts: x̄ = Σ(F·x) / ΣF. Null if the load sums to zero.
  get centroid() {
    const total = this.resultant;
    return total === 0 ? null : sum(this.pieces().map(([F, x]) => F * x)) / total;
  }

  intensity(x) {
    return this.wStart + ((this.wEnd - this.wStart) * (x - this.start)) / this.length;
  }

  // The part of this load between its start and x, as a new DistributedLoad (or null).
  portionLeftOf(x) {
    if (x <= this.start) return null;
    const u = Math.min(x, this.end);
    return new DistributedLoad(this.start, u, this.wStart, this.intensity(u));
  }
}

// --- Beam ----------------------------------------------------------------------

// pointLoads: [{x, P}] (P positive downward); moments: [{x, M}] (M positive counterclockwise)
export class Beam {
  constructor({
    length, support = SIMPLY_SUPPORTED, pinX = 0, rollerX = null, fixedEnd = "left",
    pointLoads = [], distributedLoads = [], moments = [],
  }) {
    if (!(length > 0)) throw new Error("beam length must be > 0");
    Object.assign(this, { length, support, pinX, fixedEnd, pointLoads, distributedLoads, moments });
    this.rollerX = rollerX ?? length;
    if (support === SIMPLY_SUPPORTED) {
      this.checkOnBeam(this.pinX, "pin");
      this.checkOnBeam(this.rollerX, "roller");
      if (this.pinX === this.rollerX) throw new Error("the pin and roller must be at different positions");
    } else if (support === CANTILEVER) {
      if (!["left", "right"].includes(fixedEnd)) throw new Error("fixedEnd must be 'left' or 'right'");
    } else {
      throw new Error(`unknown support type: ${support}`);
    }
    for (const load of [...pointLoads, ...moments]) this.checkOnBeam(load.x, "load");
    for (const d of distributedLoads) {
      this.checkOnBeam(d.start, "distributed load start");
      this.checkOnBeam(d.end, "distributed load end");
      if (d.end <= d.start) throw new Error("a distributed load must end after it starts");
    }
  }

  checkOnBeam(x, name) {
    if (!(x >= 0 && x <= this.length)) {
      throw new Error(`${name} position ${fmtNum(x)} is off the beam (0 to ${fmtNum(this.length)})`);
    }
  }

  // Every applied force as [downward force, x]: point loads plus distributed-load pieces.
  loadResultants() {
    return [...this.pointLoads.map((p) => [p.P, p.x]), ...this.distributedLoads.flatMap((d) => d.pieces())];
  }
}

// Support reactions from ΣFy = 0 and ΣM = 0.
// Returns {forces: [{R, x, label}] (upward +), moments: [{M, x, label}] (counterclockwise +)}.
export function solveReactions(beam) {
  const loads = beam.loadResultants();
  const totalLoad = sum(loads.map(([F]) => F));
  const appliedCouples = sum(beam.moments.map((m) => m.M));

  if (beam.support === SIMPLY_SUPPORTED) {
    const a = beam.pinX;
    const b = beam.rollerX;
    // ΣM about the pin = 0 (counterclockwise +):  R_b (b − a) − Σ F (x − a) + Σ C = 0
    const Rb = (sum(loads.map(([F, x]) => F * (x - a))) - appliedCouples) / (b - a);
    // ΣFy = 0:  R_a + R_b − Σ F = 0
    const Ra = totalLoad - Rb;
    return { forces: [{ R: Ra, x: a, label: "Pin" }, { R: Rb, x: b, label: "Roller" }], moments: [] };
  }

  // Cantilever: the fixed support supplies a vertical force and a moment.
  const a = beam.fixedEnd === "left" ? 0 : beam.length;
  // ΣM about the wall = 0:  M_wall − Σ F (x − a) + Σ C = 0
  const Mwall = sum(loads.map(([F, x]) => F * (x - a))) - appliedCouples;
  return { forces: [{ R: totalLoad, x: a, label: "Wall" }], moments: [{ M: Mwall, x: a, label: "Wall" }] };
}

// --- Internal forces (method of sections) -------------------------------------

// Shear V and bending moment M at x, from a free body of everything left of x:
//     V(x) = Σ (upward forces left of x)
//     M(x) = Σ F·(x − x_F) − Σ C   (couples C left of x, counterclockwise +)
// A point load or couple exactly at x is counted when rightSide is true, so you get the value
// just to the right of it; false gives the value just to the left.
export function internalForces(beam, x, reactions = solveReactions(beam), rightSide = true) {
  const counts = (xi) => xi < x || (rightSide && xi === x);

  const forces = [
    ...reactions.forces.map((r) => [r.R, r.x]),
    ...beam.pointLoads.map((p) => [-p.P, p.x]),
  ];
  for (const d of beam.distributedLoads) {
    const part = d.portionLeftOf(x);
    if (part) forces.push(...part.pieces().map(([F, xc]) => [-F, xc]));
  }
  const couples = [...beam.moments.map((m) => [m.M, m.x]), ...reactions.moments.map((m) => [m.M, m.x])];

  const left = forces.filter(([, xi]) => counts(xi));
  const V = sum(left.map(([F]) => F));
  const M = sum(left.map(([F, xi]) => F * (x - xi))) - sum(couples.filter(([, xi]) => counts(xi)).map(([C]) => C));
  return { V, M };
}

// Positions where V or M can jump or change shape: ends, supports, and load edges.
export function keyPoints(beam, reactions = solveReactions(beam)) {
  const pts = new Set([0, beam.length]);
  reactions.forces.forEach((r) => pts.add(r.x));
  beam.pointLoads.forEach((p) => pts.add(p.x));
  beam.moments.forEach((m) => pts.add(m.x));
  beam.distributedLoads.forEach((d) => { pts.add(d.start); pts.add(d.end); });
  return [...pts].sort((a, b) => a - b);
}

// Shear and moment along the beam, ready to plot: {x, V, M} arrays.
// Each key point is sampled twice, just left and just right of it, so jumps from point loads and
// couples show up as vertical lines, and the diagrams start and end at zero.
export function diagrams(beam, nPoints = 400) {
  const reactions = solveReactions(beam);
  const keys = keyPoints(beam, reactions);
  const keySet = new Set(keys);
  const grid = linspace(0, beam.length, nPoints).filter((x) => !keySet.has(x));
  const out = { x: [], V: [], M: [] };
  for (const x of [...grid, ...keys].sort((a, b) => a - b)) {
    for (const side of keySet.has(x) ? [false, true] : [true]) {
      const { V, M } = internalForces(beam, x, reactions, side);
      out.x.push(x);
      out.V.push(V);
      out.M.push(M);
    }
  }
  return out;
}

// {max, xMax, min, xMin}
export function extremes(values, xs) {
  let iMax = 0;
  let iMin = 0;
  values.forEach((v, i) => {
    if (v > values[iMax]) iMax = i;
    if (v < values[iMin]) iMin = i;
  });
  return { max: values[iMax], xMax: xs[iMax], min: values[iMin], xMin: xs[iMin] };
}

// --- Cross sections, stress and strain -------------------------------------------

// Each section: {name, area, I, c, depth} — I about the horizontal centroidal axis,
// c the distance from the centroid to the top and bottom fibers.

// Solid rectangle, width b and height h:  I = b h³ / 12,  c = h / 2.
export function rectangle(b, h) {
  return { name: "Rectangle", area: b * h, I: (b * h ** 3) / 12, c: h / 2, depth: h };
}

// Solid circle of diameter d:  I = π d⁴ / 64,  c = d / 2.
export function circle(d) {
  return { name: "Circle", area: (Math.PI * d ** 2) / 4, I: (Math.PI * d ** 4) / 64, c: d / 2, depth: d };
}

// Round tube:  I = π (D⁴ − d⁴) / 64,  c = D / 2.
export function hollowCircle(dOuter, dInner) {
  if (!(dInner >= 0 && dInner < dOuter)) throw new Error("inner diameter must be smaller than outer diameter");
  return {
    name: "Tube",
    area: (Math.PI * (dOuter ** 2 - dInner ** 2)) / 4,
    I: (Math.PI * (dOuter ** 4 - dInner ** 4)) / 64,
    c: dOuter / 2,
    depth: dOuter,
  };
}

// Symmetric I-beam: two flanges (b × t_f) and a web (t_w × (h − 2t_f)).
// I = [b h³ − (b − t_w)(h − 2 t_f)³] / 12  (the full rectangle minus the two empty sides).
export function iBeam(bFlange, tFlange, h, tWeb) {
  if (!(2 * tFlange > 0 && 2 * tFlange < h && tWeb > 0 && tWeb <= bFlange)) {
    throw new Error("I-beam dimensions are inconsistent");
  }
  const webH = h - 2 * tFlange;
  return {
    name: "I-beam",
    area: 2 * bFlange * tFlange + tWeb * webH,
    I: (bFlange * h ** 3 - (bFlange - tWeb) * webH ** 3) / 12,
    c: h / 2,
    depth: h,
  };
}

// Flexure formula: σ = −M y / I  (y measured up from the centroid; tension is +).
export function bendingStress(M, y, I) {
  return (-M * y) / I;
}

// Hooke's law: ε = σ / E.
export function strain(stress, E) {
  return stress / E;
}

// --- Helpers ---------------------------------------------------------------------

export function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

export function linspace(a, b, n) {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

function fmtNum(x) {
  return Number.isFinite(x) ? String(+x.toFixed(6)) : String(x);
}
