"""Check the calculator against known textbook results."""

import math

import numpy as np
import pytest

from beam import (
    CANTILEVER, Beam, DistributedLoad, PointLoad, PointMoment, bending_stress, circle, diagrams,
    extremes, hollow_circle, i_beam, internal_forces, rectangle, solve_reactions, strain,
)


def reaction_values(beam):
    r = solve_reactions(beam)
    return [F for F, _, _ in r.forces], [M for M, _, _ in r.moments]


def max_abs_moment(beam):
    d = diagrams(beam, n_points=2001)
    return np.abs(d.M).max()


def test_simply_supported_center_point_load():
    # R = P/2 at each end, M_max = PL/4 under the load
    beam = Beam(8, point_loads=[PointLoad(4, 10)])
    (Ra, Rb), _ = reaction_values(beam)
    assert Ra == pytest.approx(5) and Rb == pytest.approx(5)
    assert internal_forces(beam, 4)[1] == pytest.approx(10 * 8 / 4)


def test_simply_supported_off_center_point_load():
    # R_a = P b / L, R_b = P a / L, M_max = P a b / L
    beam = Beam(10, point_loads=[PointLoad(3, 12)])
    (Ra, Rb), _ = reaction_values(beam)
    assert Ra == pytest.approx(12 * 7 / 10)
    assert Rb == pytest.approx(12 * 3 / 10)
    assert internal_forces(beam, 3)[1] == pytest.approx(12 * 3 * 7 / 10)


def test_simply_supported_uniform_load():
    # R = wL/2, M_max = wL²/8 at midspan, V varies linearly from +wL/2 to −wL/2
    w, L = 4, 6
    beam = Beam(L, distributed_loads=[DistributedLoad(0, L, w, w)])
    (Ra, Rb), _ = reaction_values(beam)
    assert Ra == pytest.approx(w * L / 2) and Rb == pytest.approx(w * L / 2)
    assert internal_forces(beam, L / 2)[1] == pytest.approx(w * L**2 / 8)
    assert max_abs_moment(beam) == pytest.approx(w * L**2 / 8)
    assert internal_forces(beam, L / 4)[0] == pytest.approx(w * L / 4)


def test_simply_supported_triangular_load():
    # Load rising from 0 to w0: R_a = w0 L/6, R_b = w0 L/3, M_max = w0 L² / (9√3) at x = L/√3
    w0, L = 9, 6
    beam = Beam(L, distributed_loads=[DistributedLoad(0, L, 0, w0)])
    (Ra, Rb), _ = reaction_values(beam)
    assert Ra == pytest.approx(w0 * L / 6)
    assert Rb == pytest.approx(w0 * L / 3)
    V, M = internal_forces(beam, L / math.sqrt(3))
    assert V == pytest.approx(0, abs=1e-9)
    assert M == pytest.approx(w0 * L**2 / (9 * math.sqrt(3)))


def test_distributed_load_resultant_and_centroid():
    # Trapezoid 2 → 8 over 3 m: area (2+8)/2·3 = 15, centroid L(w1 + 2w2)/(3(w1 + w2)) from start
    d = DistributedLoad(1, 4, 2, 8)
    assert d.resultant == pytest.approx(15)
    assert d.centroid == pytest.approx(1 + 3 * (2 + 16) / (3 * 10))


def test_applied_couple_on_simply_supported_beam():
    # A couple C at midspan: reactions ±C/L, and the moment diagram jumps by C
    C, L = 20, 10
    beam = Beam(L, moments=[PointMoment(5, C)])
    (Ra, Rb), _ = reaction_values(beam)
    assert Ra == pytest.approx(C / L) and Rb == pytest.approx(-C / L)
    _, M_left = internal_forces(beam, 5, right_side=False)
    _, M_right = internal_forces(beam, 5, right_side=True)
    assert M_left - M_right == pytest.approx(C)  # counterclockwise couple drops the diagram


def test_cantilever_end_load():
    # Fixed at the left, P at the free end: R = P, M_wall = PL, M(0) = −PL (hogging)
    P, L = 5, 3
    beam = Beam(L, support=CANTILEVER, point_loads=[PointLoad(L, P)])
    (R,), (M_wall,) = reaction_values(beam)
    assert R == pytest.approx(P)
    assert M_wall == pytest.approx(P * L)
    assert internal_forces(beam, 0)[1] == pytest.approx(-P * L)
    assert internal_forces(beam, L / 2)[0] == pytest.approx(P)


def test_cantilever_uniform_load_fixed_on_the_right():
    # Mirror image of the classic case: M at the wall = −wL²/2
    w, L = 2, 4
    beam = Beam(L, support=CANTILEVER, fixed_end="right", distributed_loads=[DistributedLoad(0, L, w, w)])
    (R,), (M_wall,) = reaction_values(beam)
    assert R == pytest.approx(w * L)
    assert M_wall == pytest.approx(-w * L**2 / 2)  # clockwise, since the load is to the left
    assert internal_forces(beam, L, right_side=False)[1] == pytest.approx(-w * L**2 / 2)


def mixed_beams():
    loads = dict(
        point_loads=[PointLoad(1.5, 7), PointLoad(9, 3)],
        distributed_loads=[DistributedLoad(2, 6, 1, 5), DistributedLoad(7, 9, 2, 2)],
        moments=[PointMoment(4.5, -6)],
    )
    return [
        Beam(9, pin_x=1, roller_x=7, **loads),  # overhangs on both sides
        Beam(9, roller_x=4, pin_x=8, **loads),  # pin to the right of the roller
        Beam(9, support=CANTILEVER, **loads),
        Beam(9, support=CANTILEVER, fixed_end="right", **loads),
    ]


@pytest.mark.parametrize("beam", mixed_beams())
def test_equilibrium_holds_for_mixed_loads(beam):
    r = solve_reactions(beam)
    loads = beam.load_resultants()
    # ΣFy = 0
    assert sum(F for F, _, _ in r.forces) == pytest.approx(sum(F for F, _ in loads))
    # ΣM = 0 about an arbitrary point (counterclockwise +)
    p = 3.7
    total = (sum(F * (x - p) for F, x, _ in r.forces) - sum(F * (x - p) for F, x in loads)
             + sum(m.M for m in beam.moments) + sum(M for M, _, _ in r.moments))
    assert total == pytest.approx(0, abs=1e-9)


@pytest.mark.parametrize("beam", mixed_beams())
def test_diagrams_close_at_both_ends(beam):
    d = diagrams(beam)
    assert d.V[0] == pytest.approx(0) and d.M[0] == pytest.approx(0)
    assert d.V[-1] == pytest.approx(0, abs=1e-9) and d.M[-1] == pytest.approx(0, abs=1e-9)


@pytest.mark.parametrize("beam", mixed_beams())
def test_slope_of_moment_diagram_equals_shear(beam):
    # dM/dx = V, checked with a central difference away from the jumps
    h = 1e-5
    for x in (0.7, 2.6, 5.3, 6.6, 8.2):
        _, M_minus = internal_forces(beam, x - h)
        _, M_plus = internal_forces(beam, x + h)
        V, _ = internal_forces(beam, x)
        assert (M_plus - M_minus) / (2 * h) == pytest.approx(V, rel=1e-5)


def test_slope_of_shear_diagram_equals_minus_load():
    # dV/dx = −w inside a distributed load
    beam = Beam(9, distributed_loads=[DistributedLoad(2, 6, 1, 5)])
    h = 1e-5
    V_minus, _ = internal_forces(beam, 4 - h)
    V_plus, _ = internal_forces(beam, 4 + h)
    assert (V_plus - V_minus) / (2 * h) == pytest.approx(-3, rel=1e-5)


def test_point_load_makes_shear_jump_by_its_magnitude():
    beam = Beam(10, point_loads=[PointLoad(6, 8)])
    V_left, _ = internal_forces(beam, 6, right_side=False)
    V_right, _ = internal_forces(beam, 6, right_side=True)
    assert V_left - V_right == pytest.approx(8)


def test_extremes():
    beam = Beam(8, point_loads=[PointLoad(4, 10)])
    d = diagrams(beam)
    M_max, x_max, M_min, _ = extremes(d.M, d.x)
    assert M_max == pytest.approx(20) and x_max == pytest.approx(4)
    assert M_min == pytest.approx(0)


def test_section_properties():
    r = rectangle(0.1, 0.3)
    assert r.I == pytest.approx(0.1 * 0.3**3 / 12) and r.c == pytest.approx(0.15)
    c = circle(0.2)
    assert c.I == pytest.approx(math.pi * 0.2**4 / 64)
    t = hollow_circle(0.2, 0.0)
    assert t.I == pytest.approx(c.I)
    # An I-beam with a full-width web is just a rectangle
    assert i_beam(0.1, 0.02, 0.3, 0.1).I == pytest.approx(r.I)


def test_bending_stress_and_strain():
    # σ = M c / I at the extreme fibers: compression on top, tension on the bottom for sagging M
    s = rectangle(0.1, 0.2)
    M = 10.0
    top = bending_stress(M, s.c, s.I)
    bottom = bending_stress(M, -s.c, s.I)
    assert bottom == pytest.approx(M * s.c / s.I) and top == pytest.approx(-bottom)
    assert bending_stress(M, 0, s.I) == 0  # neutral axis
    assert strain(bottom, 200e6) == pytest.approx(bottom / 200e6)


def test_invalid_inputs_raise():
    with pytest.raises(ValueError):
        Beam(0)
    with pytest.raises(ValueError):
        Beam(5, pin_x=2, roller_x=2)
    with pytest.raises(ValueError):
        Beam(5, point_loads=[PointLoad(6, 1)])
    with pytest.raises(ValueError):
        Beam(5, distributed_loads=[DistributedLoad(3, 2, 1, 1)])
