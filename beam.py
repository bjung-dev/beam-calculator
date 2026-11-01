"""Statically determinate beams: support reactions, shear, bending moment, stress and strain.

Everything comes from the two equilibrium equations for a beam loaded in its plane:

    ΣFy = 0        (forces balance vertically)
    ΣM  = 0        (moments balance about any point)

Coordinates: x runs along the beam from its left end (x = 0) to its right end (x = L).

Sign conventions:
    - Applied loads are entered as positive when they point DOWN (gravity loads).
    - Reaction forces are positive when they point UP.
    - Moments (applied couples and the fixed-support reaction) are positive COUNTERCLOCKWISE.
    - Internal shear V(x) is the net upward force on everything to the left of the cut.
    - Internal moment M(x) is positive when it bends the beam into a smile (sagging),
      which puts the bottom of the beam in tension.

The functions are unit-agnostic: use any consistent set (the app uses kN and m).
"""

from dataclasses import dataclass, field
import math

import numpy as np


# --- Loads -------------------------------------------------------------------

@dataclass
class PointLoad:
    x: float  # position along the beam
    P: float  # magnitude, positive downward


@dataclass
class DistributedLoad:
    """Linearly varying load from x = start to x = end.

    Intensity goes from w_start to w_end (force per length, positive downward), so this
    covers uniform (w_start = w_end), triangular (one end zero) and trapezoidal loads.
    """
    start: float
    end: float
    w_start: float
    w_end: float

    @property
    def length(self):
        return self.end - self.start

    def pieces(self):
        """Split into a rectangle and a triangle: [(resultant force, x of its centroid), ...].

        Rectangle: height w_start, resultant w_start·L at the middle.
        Triangle: height (w_end − w_start), resultant ½(w_end − w_start)·L at 2/3 of the way
        from the start (the centroid of a triangle is 1/3 of the way from its tall side).
        """
        L = self.length
        return [
            (self.w_start * L, self.start + L / 2),
            (0.5 * (self.w_end - self.w_start) * L, self.start + 2 * L / 3),
        ]

    @property
    def resultant(self):
        """Total force = area under the load diagram."""
        return sum(F for F, _ in self.pieces())

    @property
    def centroid(self):
        """Where the resultant acts: x̄ = Σ(F·x) / ΣF. None if the load sums to zero."""
        total = self.resultant
        if total == 0:
            return None
        return sum(F * x for F, x in self.pieces()) / total

    def intensity(self, x):
        """w(x) inside the load, linear interpolation."""
        return self.w_start + (self.w_end - self.w_start) * (x - self.start) / self.length

    def portion_left_of(self, x):
        """The part of this load between its start and x, as a new DistributedLoad (or None)."""
        if x <= self.start:
            return None
        u = min(x, self.end)
        return DistributedLoad(self.start, u, self.w_start, self.intensity(u))


@dataclass
class PointMoment:
    x: float  # position along the beam
    M: float  # magnitude, positive counterclockwise


# --- Supports ----------------------------------------------------------------

SIMPLY_SUPPORTED = "simply supported"  # pin + roller (anywhere, so overhangs are allowed)
CANTILEVER = "cantilever"  # one fixed end, the other end free


@dataclass
class Beam:
    length: float
    support: str = SIMPLY_SUPPORTED
    pin_x: float = 0.0  # simply supported: pin position
    roller_x: float = None  # simply supported: roller position (default: right end)
    fixed_end: str = "left"  # cantilever: "left" or "right"
    point_loads: list = field(default_factory=list)
    distributed_loads: list = field(default_factory=list)
    moments: list = field(default_factory=list)

    def __post_init__(self):
        if self.length <= 0:
            raise ValueError("beam length must be > 0")
        if self.roller_x is None:
            self.roller_x = self.length
        if self.support == SIMPLY_SUPPORTED:
            for name, x in (("pin", self.pin_x), ("roller", self.roller_x)):
                self._check_on_beam(x, name)
            if self.pin_x == self.roller_x:
                raise ValueError("the pin and roller must be at different positions")
        elif self.support == CANTILEVER:
            if self.fixed_end not in ("left", "right"):
                raise ValueError("fixed_end must be 'left' or 'right'")
        else:
            raise ValueError(f"unknown support type: {self.support!r}")
        for load in self.point_loads + self.moments:
            self._check_on_beam(load.x, "load")
        for load in self.distributed_loads:
            self._check_on_beam(load.start, "distributed load start")
            self._check_on_beam(load.end, "distributed load end")
            if load.end <= load.start:
                raise ValueError("a distributed load must end after it starts")

    def _check_on_beam(self, x, name):
        if not 0 <= x <= self.length:
            raise ValueError(f"{name} position {x:g} is off the beam (0 to {self.length:g})")

    def load_resultants(self):
        """Every applied force as (downward force, x): point loads plus distributed-load pieces."""
        forces = [(p.P, p.x) for p in self.point_loads]
        for d in self.distributed_loads:
            forces += d.pieces()
        return forces


@dataclass
class Reactions:
    forces: list  # [(upward force, x, label), ...]
    moments: list  # [(counterclockwise moment, x, label), ...]


def solve_reactions(beam):
    """Support reactions from ΣFy = 0 and ΣM = 0."""
    loads = beam.load_resultants()
    total_load = sum(F for F, _ in loads)
    applied_couples = sum(m.M for m in beam.moments)

    if beam.support == SIMPLY_SUPPORTED:
        a, b = beam.pin_x, beam.roller_x
        # ΣM about the pin = 0 (counterclockwise +). The roller force R_b acts at arm (b − a),
        # each downward load F acts at arm (x − a), and couples add directly:
        #   R_b (b − a) − Σ F (x − a) + Σ C = 0
        R_b = (sum(F * (x - a) for F, x in loads) - applied_couples) / (b - a)
        # ΣFy = 0:  R_a + R_b − Σ F = 0
        R_a = total_load - R_b
        return Reactions(forces=[(R_a, a, "Pin"), (R_b, b, "Roller")], moments=[])

    # Cantilever: the fixed support supplies a vertical force and a moment.
    a = 0.0 if beam.fixed_end == "left" else beam.length
    # ΣFy = 0:  R − Σ F = 0
    R = total_load
    # ΣM about the wall = 0:  M_wall − Σ F (x − a) + Σ C = 0
    M_wall = sum(F * (x - a) for F, x in loads) - applied_couples
    return Reactions(forces=[(R, a, "Wall")], moments=[(M_wall, a, "Wall")])


# --- Internal forces (method of sections) -------------------------------------

def internal_forces(beam, x, reactions=None, right_side=True):
    """Shear V and bending moment M at position x, from a free body of everything left of x.

    Cut the beam at x and keep the left piece. For it to be in equilibrium:
        V(x) = Σ (upward forces left of x)
        M(x) = Σ F·(x − x_F)  for every upward force F left of x
               − Σ C          for every counterclockwise couple left of x
    A point load or couple exactly at x is counted when right_side is True, so at a point
    load you get the value just to the right of it, and False gives the value just to the left.
    """
    reactions = reactions or solve_reactions(beam)

    def counts(xi):
        return xi < x or (right_side and xi == x)

    # Upward forces: reactions (+) and point loads (−)
    forces = [(R, xr) for R, xr, _ in reactions.forces]
    forces += [(-p.P, p.x) for p in beam.point_loads]
    # Only the part of each distributed load that lies left of the cut
    for d in beam.distributed_loads:
        part = d.portion_left_of(x)
        if part is not None:
            forces += [(-F, xc) for F, xc in part.pieces()]
    couples = [(m.M, m.x) for m in beam.moments] + [(M, xm) for M, xm, _ in reactions.moments]

    V = sum(F for F, xi in forces if counts(xi))
    M = sum(F * (x - xi) for F, xi in forces if counts(xi)) - sum(C for C, xi in couples if counts(xi))
    return V, M


def key_points(beam):
    """Positions where V or M can jump or change shape: ends, supports, and load edges."""
    reactions = solve_reactions(beam)
    pts = {0.0, beam.length}
    pts.update(xr for _, xr, _ in reactions.forces)
    pts.update(p.x for p in beam.point_loads)
    pts.update(m.x for m in beam.moments)
    for d in beam.distributed_loads:
        pts.update((d.start, d.end))
    return sorted(pts)


@dataclass
class Diagram:
    x: np.ndarray
    V: np.ndarray  # shear force
    M: np.ndarray  # bending moment


def diagrams(beam, n_points=400):
    """Shear and moment along the beam, ready to plot.

    Each key point is sampled twice, just left and just right of it, so jumps from point
    loads and couples show up as vertical lines. The diagrams start and end at zero, which
    closes them off at the beam ends (and checks that the beam is in equilibrium).
    """
    reactions = solve_reactions(beam)
    keys = key_points(beam)
    grid = sorted(set(np.linspace(0, beam.length, n_points)) - set(keys))
    xs, Vs, Ms = [], [], []
    for x in sorted(grid + keys):
        sides = (False, True) if x in keys else (True,)
        for side in sides:
            V, M = internal_forces(beam, x, reactions, right_side=side)
            xs.append(x)
            Vs.append(V)
            Ms.append(M)
    return Diagram(np.array(xs), np.array(Vs), np.array(Ms))


def extremes(values, xs):
    """(max value, x at max, min value, x at min)."""
    i_max, i_min = int(np.argmax(values)), int(np.argmin(values))
    return values[i_max], xs[i_max], values[i_min], xs[i_min]


# --- Cross sections, stress and strain -------------------------------------------

@dataclass
class Section:
    name: str
    area: float  # A
    I: float  # second moment of area about the horizontal centroidal axis
    c: float  # distance from the centroid to the top and bottom fibers
    depth: float  # total height (2c for these symmetric shapes)


def rectangle(b, h):
    """Solid rectangle, width b and height h:  I = b h³ / 12,  c = h / 2."""
    return Section("Rectangle", b * h, b * h**3 / 12, h / 2, h)


def circle(d):
    """Solid circle of diameter d:  I = π d⁴ / 64,  c = d / 2."""
    return Section("Circle", math.pi * d**2 / 4, math.pi * d**4 / 64, d / 2, d)


def hollow_circle(d_outer, d_inner):
    """Round tube:  I = π (D⁴ − d⁴) / 64,  c = D / 2."""
    if not 0 <= d_inner < d_outer:
        raise ValueError("inner diameter must be smaller than outer diameter")
    return Section("Tube", math.pi * (d_outer**2 - d_inner**2) / 4,
                   math.pi * (d_outer**4 - d_inner**4) / 64, d_outer / 2, d_outer)


def i_beam(b_flange, t_flange, h, t_web):
    """Symmetric I-beam: two flanges (b × t_f) and a web (t_w × (h − 2t_f)).

    I = [b h³ − (b − t_w)(h − 2 t_f)³] / 12  (the full rectangle minus the two empty sides).
    """
    if not (0 < 2 * t_flange < h and 0 < t_web <= b_flange):
        raise ValueError("I-beam dimensions are inconsistent")
    web_h = h - 2 * t_flange
    area = 2 * b_flange * t_flange + t_web * web_h
    I = (b_flange * h**3 - (b_flange - t_web) * web_h**3) / 12
    return Section("I-beam", area, I, h / 2, h)


def bending_stress(M, y, I):
    """Flexure formula: σ = −M y / I  (y measured up from the centroid; tension is +).

    A sagging moment (M > 0) squeezes the top (y > 0, σ < 0) and stretches the bottom.
    """
    return -M * y / I


def strain(stress, E):
    """Hooke's law: ε = σ / E."""
    return stress / E
