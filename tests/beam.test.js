// Check the website's mechanics (docs/beam.js) against known textbook results.
// Open tests/index.html through a local web server to run these (see the README).

import {
  CANTILEVER, Beam, DistributedLoad, bendingStress, circle, diagrams, extremes, hollowCircle, iBeam,
  internalForces, rectangle, solveReactions, strain, sum,
} from "../docs/beam.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function approx(actual, expected, { rel = 1e-6, abs = 1e-12 } = {}) {
  if (!(Math.abs(actual - expected) <= Math.max(abs, rel * Math.abs(expected)))) {
    throw new Error(`expected ${expected}, got ${actual}`);
  }
}

function throws(fn) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error("expected an error");
}

const reactionValues = (beam) => {
  const r = solveReactions(beam);
  return [r.forces.map((f) => f.R), r.moments.map((m) => m.M)];
};
const P = (x, P) => ({ x, P });
const C = (x, M) => ({ x, M });

test("simply supported, center point load: R = P/2, M_max = PL/4", () => {
  const beam = new Beam({ length: 8, pointLoads: [P(4, 10)] });
  const [[Ra, Rb]] = reactionValues(beam);
  approx(Ra, 5);
  approx(Rb, 5);
  approx(internalForces(beam, 4).M, (10 * 8) / 4);
});

test("simply supported, off-center load: R_a = Pb/L, M_max = Pab/L", () => {
  const beam = new Beam({ length: 10, pointLoads: [P(3, 12)] });
  const [[Ra, Rb]] = reactionValues(beam);
  approx(Ra, (12 * 7) / 10);
  approx(Rb, (12 * 3) / 10);
  approx(internalForces(beam, 3).M, (12 * 3 * 7) / 10);
});

test("simply supported, uniform load: R = wL/2, M_max = wL²/8", () => {
  const [w, L] = [4, 6];
  const beam = new Beam({ length: L, distributedLoads: [new DistributedLoad(0, L, w, w)] });
  const [[Ra, Rb]] = reactionValues(beam);
  approx(Ra, (w * L) / 2);
  approx(Rb, (w * L) / 2);
  approx(internalForces(beam, L / 2).M, (w * L ** 2) / 8);
  approx(Math.max(...diagrams(beam, 2001).M.map(Math.abs)), (w * L ** 2) / 8);
  approx(internalForces(beam, L / 4).V, (w * L) / 4);
});

test("simply supported, triangular load: M_max = w₀L²/(9√3) at L/√3", () => {
  const [w0, L] = [9, 6];
  const beam = new Beam({ length: L, distributedLoads: [new DistributedLoad(0, L, 0, w0)] });
  const [[Ra, Rb]] = reactionValues(beam);
  approx(Ra, (w0 * L) / 6);
  approx(Rb, (w0 * L) / 3);
  const { V, M } = internalForces(beam, L / Math.sqrt(3));
  approx(V, 0, { abs: 1e-9 });
  approx(M, (w0 * L ** 2) / (9 * Math.sqrt(3)));
});

test("distributed load resultant and centroid", () => {
  const d = new DistributedLoad(1, 4, 2, 8);
  approx(d.resultant, 15);
  approx(d.centroid, 1 + (3 * (2 + 16)) / (3 * 10));
});

test("applied couple: reactions ±C/L, moment jumps by C", () => {
  const beam = new Beam({ length: 10, moments: [C(5, 20)] });
  const [[Ra, Rb]] = reactionValues(beam);
  approx(Ra, 2);
  approx(Rb, -2);
  const left = internalForces(beam, 5, undefined, false).M;
  const right = internalForces(beam, 5, undefined, true).M;
  approx(left - right, 20);
});

test("cantilever, end load: R = P, M_wall = PL", () => {
  const beam = new Beam({ length: 3, support: CANTILEVER, pointLoads: [P(3, 5)] });
  const [[R], [Mw]] = reactionValues(beam);
  approx(R, 5);
  approx(Mw, 15);
  approx(internalForces(beam, 0).M, -15);
  approx(internalForces(beam, 1.5).V, 5);
});

test("cantilever fixed on the right, uniform load: M_wall = −wL²/2", () => {
  const [w, L] = [2, 4];
  const beam = new Beam({
    length: L, support: CANTILEVER, fixedEnd: "right", distributedLoads: [new DistributedLoad(0, L, w, w)],
  });
  const [[R], [Mw]] = reactionValues(beam);
  approx(R, w * L);
  approx(Mw, (-w * L ** 2) / 2);
  approx(internalForces(beam, L, undefined, false).M, (-w * L ** 2) / 2);
});

function mixedBeams() {
  const loads = () => ({
    pointLoads: [P(1.5, 7), P(9, 3)],
    distributedLoads: [new DistributedLoad(2, 6, 1, 5), new DistributedLoad(7, 9, 2, 2)],
    moments: [C(4.5, -6)],
  });
  return [
    ["overhangs on both sides", new Beam({ length: 9, pinX: 1, rollerX: 7, ...loads() })],
    ["pin right of roller", new Beam({ length: 9, rollerX: 4, pinX: 8, ...loads() })],
    ["cantilever, left", new Beam({ length: 9, support: CANTILEVER, ...loads() })],
    ["cantilever, right", new Beam({ length: 9, support: CANTILEVER, fixedEnd: "right", ...loads() })],
  ];
}

for (const [name, beam] of mixedBeams()) {
  test(`mixed loads (${name}): ΣF = 0 and ΣM = 0`, () => {
    const r = solveReactions(beam);
    const loads = beam.loadResultants();
    approx(sum(r.forces.map((f) => f.R)), sum(loads.map(([F]) => F)));
    const p = 3.7;
    const total = sum(r.forces.map((f) => f.R * (f.x - p))) - sum(loads.map(([F, x]) => F * (x - p)))
      + sum(beam.moments.map((m) => m.M)) + sum(r.moments.map((m) => m.M));
    approx(total, 0, { abs: 1e-9 });
  });

  test(`mixed loads (${name}): diagrams close at both ends`, () => {
    const d = diagrams(beam);
    approx(d.V[0], 0);
    approx(d.M[0], 0);
    approx(d.V.at(-1), 0, { abs: 1e-9 });
    approx(d.M.at(-1), 0, { abs: 1e-9 });
  });

  test(`mixed loads (${name}): dM/dx = V`, () => {
    const h = 1e-5;
    for (const x of [0.7, 2.6, 5.3, 6.6, 8.2]) {
      const slope = (internalForces(beam, x + h).M - internalForces(beam, x - h).M) / (2 * h);
      approx(slope, internalForces(beam, x).V, { rel: 1e-5, abs: 1e-6 });
    }
  });
}

test("dV/dx = −w inside a distributed load", () => {
  const beam = new Beam({ length: 9, distributedLoads: [new DistributedLoad(2, 6, 1, 5)] });
  const h = 1e-5;
  approx((internalForces(beam, 4 + h).V - internalForces(beam, 4 - h).V) / (2 * h), -3, { rel: 1e-5 });
});

test("a point load makes the shear jump by its magnitude", () => {
  const beam = new Beam({ length: 10, pointLoads: [P(6, 8)] });
  approx(internalForces(beam, 6, undefined, false).V - internalForces(beam, 6, undefined, true).V, 8);
});

test("extremes", () => {
  const d = diagrams(new Beam({ length: 8, pointLoads: [P(4, 10)] }));
  const e = extremes(d.M, d.x);
  approx(e.max, 20);
  approx(e.xMax, 4);
  approx(e.min, 0);
});

test("section properties", () => {
  const r = rectangle(0.1, 0.3);
  approx(r.I, (0.1 * 0.3 ** 3) / 12);
  approx(r.c, 0.15);
  approx(circle(0.2).I, (Math.PI * 0.2 ** 4) / 64);
  approx(hollowCircle(0.2, 0).I, circle(0.2).I);
  approx(iBeam(0.1, 0.02, 0.3, 0.1).I, r.I); // full-width web = rectangle
});

test("bending stress and strain", () => {
  const s = rectangle(0.1, 0.2);
  const bottom = bendingStress(10, -s.c, s.I);
  approx(bottom, (10 * s.c) / s.I);
  approx(bendingStress(10, s.c, s.I), -bottom);
  approx(bendingStress(10, 0, s.I), 0);
  approx(strain(bottom, 200e6), bottom / 200e6);
});

test("invalid inputs throw", () => {
  throws(() => new Beam({ length: 0 }));
  throws(() => new Beam({ length: 5, pinX: 2, rollerX: 2 }));
  throws(() => new Beam({ length: 5, pointLoads: [P(6, 1)] }));
  throws(() => new Beam({ length: 5, distributedLoads: [new DistributedLoad(3, 2, 1, 1)] }));
});

// --- Runner ----------------------------------------------------------------------
let failed = 0;
const lines = tests.map(([name, fn]) => {
  try {
    fn();
    return `PASS  ${name}`;
  } catch (err) {
    failed += 1;
    return `FAIL  ${name}: ${err.message}`;
  }
});
const summary = `${tests.length - failed} passed, ${failed} failed`;
document.getElementById("results").textContent = [...lines, "", summary].join("\n");
document.title = summary;
