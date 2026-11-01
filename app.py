"""Streamlit web app for the beam calculator.

Run with:  streamlit run app.py

Units in the app: forces in kN, lengths in m (section dimensions in mm), moments in kN·m,
stress in MPa, and strain in microstrain (με = 10⁻⁶).
"""

import numpy as np
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from beam import (
    CANTILEVER, SIMPLY_SUPPORTED, Beam, DistributedLoad, PointLoad, PointMoment, bending_stress,
    circle, diagrams, extremes, hollow_circle, i_beam, internal_forces, rectangle,
    solve_reactions, strain,
)

st.set_page_config(page_title="Beam Calculator", page_icon="🏗️", layout="wide")

SHEAR_COLOR = "#2a78d6"
MOMENT_COLOR = "#eb6834"
TOP_COLOR = "#2a78d6"
BOTTOM_COLOR = "#e34948"
LOAD_COLOR = "#e34948"
REACTION_COLOR = "#1baf7a"
BEAM_COLOR = "#898781"
STRESS_SCALE = [[0, "#1c5cab"], [0.5, "#f0efec"], [1, "#c23a39"]]  # compression, zero, tension

MATERIALS = {  # Young's modulus E, GPa
    "Structural steel": 200.0,
    "Aluminum (6061)": 69.0,
    "Wood (Douglas fir)": 13.0,
    "Concrete": 30.0,
}

EXAMPLES = {
    "Simply supported: center point load": dict(
        L=6.0, support=SIMPLY_SUPPORTED, pin=0.0, roller=6.0,
        points=[dict(x=3.0, P=10.0)], dists=[], moments=[]),
    "Simply supported: uniform load": dict(
        L=6.0, support=SIMPLY_SUPPORTED, pin=0.0, roller=6.0,
        points=[], dists=[dict(start=0.0, end=6.0, w_start=5.0, w_end=5.0)], moments=[]),
    "Simply supported: triangular load": dict(
        L=6.0, support=SIMPLY_SUPPORTED, pin=0.0, roller=6.0,
        points=[], dists=[dict(start=0.0, end=6.0, w_start=0.0, w_end=9.0)], moments=[]),
    "Cantilever: end load + uniform load": dict(
        L=4.0, support=CANTILEVER, fixed="left",
        points=[dict(x=4.0, P=8.0)], dists=[dict(start=0.0, end=4.0, w_start=2.0, w_end=2.0)], moments=[]),
    "Overhanging beam: mixed loads": dict(
        L=10.0, support=SIMPLY_SUPPORTED, pin=0.0, roller=7.0,
        points=[dict(x=5.0, P=10.0), dict(x=10.0, P=6.0)],
        dists=[dict(start=0.0, end=4.0, w_start=4.0, w_end=4.0)],
        moments=[dict(x=2.5, M=-8.0)]),
    "Blank beam": dict(L=5.0, support=SIMPLY_SUPPORTED, pin=0.0, roller=5.0, points=[], dists=[], moments=[]),
}

# --- Inputs -----------------------------------------------------------------
with st.sidebar:
    example_name = st.selectbox("Start from an example", list(EXAMPLES))
    ex = EXAMPLES[example_name]
    k = example_name  # widget keys include the example, so picking one resets the inputs

    st.header("Beam and supports")
    L = st.number_input("Length, L (m)", 0.1, 100.0, ex["L"], 0.5, key=f"L_{k}")
    support_label = st.radio("Support type", ["Simply supported (pin + roller)", "Cantilever (fixed end)"],
                             index=0 if ex["support"] == SIMPLY_SUPPORTED else 1, key=f"sup_{k}")
    support = SIMPLY_SUPPORTED if support_label.startswith("Simply") else CANTILEVER
    pin_x, roller_x, fixed_end = 0.0, L, "left"
    if support == SIMPLY_SUPPORTED:
        st.caption("Move a support in from the end to make an overhang.")
        pin_x = st.number_input("Pin position (m)", 0.0, L, min(ex.get("pin", 0.0), L), 0.25, key=f"pin_{k}")
        roller_x = st.number_input("Roller position (m)", 0.0, L, min(ex.get("roller", L), L), 0.25,
                                   key=f"rol_{k}")
    else:
        fixed_end = st.radio("Fixed end", ["left", "right"], horizontal=True,
                             index=0 if ex.get("fixed", "left") == "left" else 1, key=f"fix_{k}")

    st.header("Cross section")
    shape = st.selectbox("Shape", ["Rectangle", "I-beam", "Circle", "Round tube"])
    if shape == "Rectangle":
        b = st.number_input("Width, b (mm)", 1.0, 2000.0, 100.0, 5.0)
        h = st.number_input("Height, h (mm)", 1.0, 2000.0, 250.0, 5.0)
        make_section = lambda: rectangle(b / 1000, h / 1000)
    elif shape == "I-beam":
        bf = st.number_input("Flange width, b (mm)", 1.0, 2000.0, 150.0, 5.0)
        tf = st.number_input("Flange thickness, t_f (mm)", 0.5, 500.0, 12.0, 1.0)
        h = st.number_input("Total height, h (mm)", 1.0, 2000.0, 300.0, 5.0)
        tw = st.number_input("Web thickness, t_w (mm)", 0.5, 500.0, 8.0, 1.0)
        make_section = lambda: i_beam(bf / 1000, tf / 1000, h / 1000, tw / 1000)
    elif shape == "Circle":
        d = st.number_input("Diameter, d (mm)", 1.0, 2000.0, 150.0, 5.0)
        make_section = lambda: circle(d / 1000)
    else:
        D = st.number_input("Outer diameter, D (mm)", 1.0, 2000.0, 150.0, 5.0)
        d_in = st.number_input("Inner diameter, d (mm)", 0.0, 2000.0, 130.0, 5.0)
        make_section = lambda: hollow_circle(D / 1000, d_in / 1000)

    st.header("Material")
    material = st.selectbox("Material", [*MATERIALS, "Custom"])
    if material == "Custom":
        E_gpa = st.number_input("Young's modulus, E (GPa)", 0.1, 1000.0, 100.0, 1.0)
    else:
        E_gpa = MATERIALS[material]
        st.caption(f"E = {E_gpa:g} GPa")

st.title("🏗️ Beam Calculator")
calc_tab, math_tab = st.tabs(["📐 Calculator", "📘 Mathematical models"])


def clean_rows(rows, columns):
    """Drop rows from a data editor that are missing any value."""
    return [r for r in rows if all(r.get(c) is not None and not np.isnan(r[c]) for c in columns)]


# --- Loads (entered in the calculator tab, used by both tabs) ----------------
with calc_tab:
    st.subheader("Loads")
    st.caption("Forces and distributed loads are **positive downward**. Moments are **positive "
               "counterclockwise** (↺). Positions are measured from the left end of the beam.")
    c1, c2, c3 = st.columns([2, 3, 2])
    with c1:
        st.markdown("**Point loads**")
        point_rows = st.data_editor(
            ex["points"] or {"x": [], "P": []}, key=f"pts_{k}", num_rows="dynamic", width="stretch",
            column_config={"x": st.column_config.NumberColumn("x (m)", format="%.2f"),
                           "P": st.column_config.NumberColumn("P (kN) ↓", format="%.2f")},
            column_order=["x", "P"],
        )
    with c2:
        st.markdown("**Distributed loads** (uniform, triangular or trapezoidal)")
        dist_rows = st.data_editor(
            ex["dists"] or {"start": [], "end": [], "w_start": [], "w_end": []},
            key=f"dist_{k}", num_rows="dynamic", width="stretch",
            column_config={"start": st.column_config.NumberColumn("from (m)", format="%.2f"),
                           "end": st.column_config.NumberColumn("to (m)", format="%.2f"),
                           "w_start": st.column_config.NumberColumn("w start (kN/m) ↓", format="%.2f"),
                           "w_end": st.column_config.NumberColumn("w end (kN/m) ↓", format="%.2f")},
            column_order=["start", "end", "w_start", "w_end"],
        )
    with c3:
        st.markdown("**Applied moments** (couples)")
        moment_rows = st.data_editor(
            ex["moments"] or {"x": [], "M": []}, key=f"mom_{k}", num_rows="dynamic", width="stretch",
            column_config={"x": st.column_config.NumberColumn("x (m)", format="%.2f"),
                           "M": st.column_config.NumberColumn("M (kN·m) ↺", format="%.2f")},
            column_order=["x", "M"],
        )


def as_records(data):
    """data_editor returns what it was given: a list of dicts or a dict of columns."""
    if isinstance(data, dict):
        keys = list(data)
        return [dict(zip(keys, vals)) for vals in zip(*data.values())]
    return list(data)


points = [PointLoad(r["x"], r["P"]) for r in clean_rows(as_records(point_rows), ["x", "P"])]
dists = [DistributedLoad(r["start"], r["end"], r["w_start"], r["w_end"])
         for r in clean_rows(as_records(dist_rows), ["start", "end", "w_start", "w_end"])]
couples = [PointMoment(r["x"], r["M"]) for r in clean_rows(as_records(moment_rows), ["x", "M"])]

try:
    beam = Beam(L, support, pin_x=pin_x, roller_x=roller_x, fixed_end=fixed_end,
                point_loads=points, distributed_loads=dists, moments=couples)
    section = make_section()
except ValueError as err:
    with calc_tab:
        st.error(f"Check the inputs: {err}")
    st.stop()

reactions = solve_reactions(beam)
diag = diagrams(beam)
E = E_gpa * 1e6  # kPa, to match kN/m² stresses
to_mpa = 1e-3  # kN/m² → MPa
sigma_top = bending_stress(diag.M, section.c, section.I) * to_mpa
sigma_bot = bending_stress(diag.M, -section.c, section.I) * to_mpa
eps_top = strain(sigma_top / to_mpa, E) * 1e6  # microstrain
eps_bot = strain(sigma_bot / to_mpa, E) * 1e6
V_max, xV_max, V_min, xV_min = extremes(diag.V, diag.x)
M_max, xM_max, M_min, xM_min = extremes(diag.M, diag.x)
M_crit, xM_crit = (M_max, xM_max) if abs(M_max) >= abs(M_min) else (M_min, xM_min)
sigma_max = abs(M_crit) * section.c / section.I * to_mpa


def fmt(v, digits=2):
    return f"{v:.{digits}f}" if abs(v) >= 10 ** -digits / 2 else f"{0:.{digits}f}"


# --- Free-body diagram --------------------------------------------------------

def free_body_figure():
    fig = go.Figure()
    pad = 0.06 * L
    # Beam
    fig.add_shape(type="rect", x0=0, x1=L, y0=-0.06, y1=0.06, fillcolor=BEAM_COLOR, line_width=0)

    def arrow(x, y_head, y_tail, color, text, text_at_tail=True):
        fig.add_annotation(x=x, y=y_head, ax=x, ay=y_tail, xref="x", yref="y", axref="x", ayref="y",
                           showarrow=True, arrowhead=2, arrowsize=1.2, arrowwidth=2.5, arrowcolor=color,
                           text=text if text_at_tail else "", font=dict(size=12),
                           yanchor="bottom" if y_tail > y_head else "top")

    # Distributed loads: a shaded profile with small arrows, height scaled to the largest w
    w_peak = max([abs(w) for d in dists for w in (d.w_start, d.w_end)] + [1e-12])
    for d in dists:
        xs = np.linspace(d.start, d.end, 60)
        top = 0.15 + 0.75 * np.abs(d.intensity(xs)) / w_peak
        fig.add_trace(go.Scatter(x=np.r_[xs, xs[::-1]], y=np.r_[top, np.full_like(xs, 0.15)], fill="toself",
                                 fillcolor="rgba(227,73,72,0.15)", line=dict(color=LOAD_COLOR, width=1.5),
                                 hoverinfo="text", showlegend=False,
                                 text=f"{fmt(d.w_start)} → {fmt(d.w_end)} kN/m, resultant {fmt(d.resultant)} kN"))
        n_arrows = max(3, int(8 * d.length / L) + 1)
        for x in np.linspace(d.start, d.end, n_arrows):
            w = d.intensity(x)
            if abs(w) > 1e-9:
                t = 0.15 + 0.75 * abs(w) / w_peak
                arrow(x, 0.08 if w > 0 else t, t if w > 0 else 0.08, LOAD_COLOR, "")
        label = (f"{fmt(d.w_start)} kN/m" if d.w_start == d.w_end
                 else f"{fmt(d.w_start)} → {fmt(d.w_end)} kN/m")
        fig.add_annotation(x=(d.start + d.end) / 2, y=0.92, text=label, showarrow=False, yanchor="bottom",
                           font=dict(color=LOAD_COLOR, size=12))

    # Point loads
    for p in points:
        if p.P >= 0:
            arrow(p.x, 0.08, 1.25, LOAD_COLOR, f"{fmt(p.P)} kN")
        else:
            arrow(p.x, 1.25, 0.08, LOAD_COLOR, "")
            fig.add_annotation(x=p.x, y=1.25, text=f"{fmt(-p.P)} kN ↑", showarrow=False, yanchor="bottom")

    # Applied couples
    for m in couples:
        symbol = "↺" if m.M >= 0 else "↻"
        fig.add_annotation(x=m.x, y=0, text=symbol, showarrow=False, font=dict(size=34, color=LOAD_COLOR))
        fig.add_annotation(x=m.x, y=-0.3, text=f"{fmt(abs(m.M))} kN·m", showarrow=False, yanchor="top",
                           font=dict(color=LOAD_COLOR, size=12))

    # Supports
    if support == SIMPLY_SUPPORTED:
        tri = 0.035 * L
        fig.add_trace(go.Scatter(x=[pin_x - tri, pin_x, pin_x + tri, pin_x - tri], y=[-0.45, -0.06, -0.45, -0.45],
                                 fill="toself", mode="lines", line=dict(color=BEAM_COLOR), hoverinfo="skip",
                                 showlegend=False))
        fig.add_trace(go.Scatter(x=[roller_x], y=[-0.22], mode="markers", hoverinfo="skip", showlegend=False,
                                 marker=dict(size=18, color="rgba(0,0,0,0)", line=dict(color=BEAM_COLOR, width=2.5))))
        for x0 in (pin_x, roller_x):
            fig.add_shape(type="line", x0=x0 - 1.4 * tri, x1=x0 + 1.4 * tri, y0=-0.47, y1=-0.47,
                          line=dict(color=BEAM_COLOR, width=2))
    else:
        xw = 0.0 if fixed_end == "left" else L
        side = -1 if fixed_end == "left" else 1
        fig.add_shape(type="rect", x0=xw, x1=xw + side * 0.025 * L, y0=-0.7, y1=0.7,
                      fillcolor=BEAM_COLOR, line_width=0, opacity=0.6)

    # Reactions (below the supports)
    for R, x, label in reactions.forces:
        if R >= 0:
            arrow(x, -0.5, -1.35, REACTION_COLOR, "")
        else:
            arrow(x, -1.35, -0.5, REACTION_COLOR, "")
        fig.add_annotation(x=x, y=-1.4, text=f"<b>{label}: {fmt(abs(R))} kN {'↑' if R >= 0 else '↓'}</b>",
                           showarrow=False, yanchor="top", font=dict(color=REACTION_COLOR, size=12))
    for Mr, x, label in reactions.moments:
        offset = 0.08 * L if fixed_end == "left" else -0.08 * L
        fig.add_annotation(x=x + offset, y=0.45, text="↺" if Mr >= 0 else "↻", showarrow=False,
                           font=dict(size=34, color=REACTION_COLOR))
        fig.add_annotation(x=x + offset, y=0.95, text=f"<b>{fmt(abs(Mr))} kN·m</b>", showarrow=False,
                           font=dict(color=REACTION_COLOR, size=12))

    fig.update_layout(
        height=300, margin=dict(l=70, r=20, t=10, b=30), showlegend=False,
        xaxis=dict(range=[-pad, L + pad], title="x (m)", zeroline=False, showgrid=False),
        yaxis=dict(range=[-1.9, 1.6], visible=False, fixedrange=True),
    )
    return fig


# --- Calculator tab -------------------------------------------------------------
with calc_tab:
    st.subheader("Free-body diagram")
    st.caption("Applied loads in red, support reactions in green.")
    st.plotly_chart(free_body_figure(), width="stretch")

    st.subheader("Support reactions")
    cols = st.columns(len(reactions.forces) + len(reactions.moments) + 2)
    i = 0
    for R, x, label in reactions.forces:
        cols[i].metric(f"{label} force at x = {x:g} m", f"{fmt(R)} kN", help="Positive = upward")
        i += 1
    for Mr, x, label in reactions.moments:
        cols[i].metric(f"{label} moment at x = {x:g} m", f"{fmt(Mr)} kN·m", help="Positive = counterclockwise")
        i += 1
    cols[i].metric("Max |shear|", f"{fmt(max(abs(V_max), abs(V_min)))} kN")
    cols[i + 1].metric("Max |moment|", f"{fmt(abs(M_crit))} kN·m", help=f"at x = {xM_crit:.2f} m")

    st.subheader("Shear, moment, stress and strain diagrams")
    fig = make_subplots(rows=4, cols=1, shared_xaxes=True, vertical_spacing=0.06,
                        subplot_titles=["Shear force, V (kN)", "Bending moment, M (kN·m)",
                                        "Bending stress at the extreme fibers, σ (MPa)",
                                        "Bending strain at the extreme fibers, ε (με)"])
    fig.add_trace(go.Scatter(x=diag.x, y=diag.V, name="Shear V", fill="tozeroy", line=dict(color=SHEAR_COLOR, width=2),
                             fillcolor="rgba(42,120,214,0.15)", hovertemplate="V = %{y:.2f} kN"), 1, 1)
    fig.add_trace(go.Scatter(x=diag.x, y=diag.M, name="Moment M", fill="tozeroy",
                             line=dict(color=MOMENT_COLOR, width=2), fillcolor="rgba(235,104,52,0.15)",
                             hovertemplate="M = %{y:.2f} kN·m"), 2, 1)
    fig.add_trace(go.Scatter(x=diag.x, y=sigma_top, name="Top fiber", line=dict(color=TOP_COLOR, width=2),
                             legendgroup="top", hovertemplate="σ top = %{y:.2f} MPa"), 3, 1)
    fig.add_trace(go.Scatter(x=diag.x, y=sigma_bot, name="Bottom fiber", line=dict(color=BOTTOM_COLOR, width=2),
                             legendgroup="bot", hovertemplate="σ bottom = %{y:.2f} MPa"), 3, 1)
    fig.add_trace(go.Scatter(x=diag.x, y=eps_top, name="Top fiber", line=dict(color=TOP_COLOR, width=2),
                             legendgroup="top", showlegend=False, hovertemplate="ε top = %{y:.1f} με"), 4, 1)
    fig.add_trace(go.Scatter(x=diag.x, y=eps_bot, name="Bottom fiber", line=dict(color=BOTTOM_COLOR, width=2),
                             legendgroup="bot", showlegend=False, hovertemplate="ε bottom = %{y:.1f} με"), 4, 1)

    def mark(row, x, y, text, color):
        if abs(y) > 1e-9:
            fig.add_trace(go.Scatter(x=[x], y=[y], mode="markers+text", text=[text], showlegend=False,
                                     textposition="top center" if y > 0 else "bottom center",
                                     marker=dict(size=8, color=color), hoverinfo="skip"), row, 1)

    mark(1, xV_max, V_max, f"{fmt(V_max)}", SHEAR_COLOR)
    mark(1, xV_min, V_min, f"{fmt(V_min)}", SHEAR_COLOR)
    mark(2, xM_max, M_max, f"{fmt(M_max)} at x={xM_max:.2f}", MOMENT_COLOR)
    mark(2, xM_min, M_min, f"{fmt(M_min)} at x={xM_min:.2f}", MOMENT_COLOR)
    for row, values in ((1, diag.V), (2, diag.M), (3, sigma_bot), (4, eps_bot)):
        fig.add_hline(y=0, line=dict(color=BEAM_COLOR, width=1), row=row, col=1)
        # Headroom so the peak labels aren't clipped (stress and strain are symmetric about zero)
        if row <= 2:
            lo, hi = min(values.min(), 0), max(values.max(), 0)
        else:
            hi = np.abs(values).max()
            lo = -hi
        pad = 0.25 * (hi - lo) or 1
        fig.update_yaxes(range=[lo - pad, hi + pad], row=row, col=1)
    fig.update_xaxes(title_text="x (m)", row=4, col=1, range=[-0.06 * L, 1.06 * L])
    fig.update_layout(height=950, margin=dict(l=70, r=20, t=40, b=40), hovermode="x unified",
                      legend=dict(orientation="h", y=-0.06))
    st.plotly_chart(fig, width="stretch")
    st.caption("Point loads make the shear diagram jump; couples make the moment diagram jump. "
               "Positive moment (sagging) compresses the top fiber and stretches the bottom fiber.")

    # Stress over the whole beam, and the distribution through one section
    st.subheader("Stress inside the beam")
    xs = np.linspace(0, L, 301)
    M_xs = np.array([internal_forces(beam, x, reactions)[1] for x in xs])
    ys = np.linspace(-section.c, section.c, 61)
    sigma_grid = bending_stress(M_xs[None, :], ys[:, None], section.I) * to_mpa
    zlim = max(np.abs(sigma_grid).max(), 1e-9)
    heat = go.Figure(go.Heatmap(
        x=xs, y=ys * 1000, z=sigma_grid, colorscale=STRESS_SCALE, zmin=-zlim, zmax=zlim,
        colorbar=dict(title="σ (MPa)"),
        hovertemplate="x = %{x:.2f} m<br>y = %{y:.1f} mm<br>σ = %{z:.2f} MPa<extra></extra>",
    ))
    heat.update_layout(height=280, margin=dict(l=70, r=20, t=10, b=40),
                       xaxis=dict(title="x (m)", range=[-0.06 * L, 1.06 * L]),
                       yaxis=dict(title="y from neutral axis (mm)"))
    st.plotly_chart(heat, width="stretch")
    st.caption("Side view of the beam (depth exaggerated). Red is tension, blue is compression, and the "
               "neutral axis (y = 0) carries no bending stress.")

    x_cut = st.slider("Cut the beam at x (m)", 0.0, float(L), float(round(xM_crit, 2)), 0.01)
    V_cut, M_cut = internal_forces(beam, x_cut, reactions)
    sig_y = bending_stress(M_cut, ys, section.I) * to_mpa
    eps_y = strain(sig_y / to_mpa, E) * 1e6

    m = st.columns(5)
    m[0].metric("Shear, V", f"{fmt(V_cut)} kN")
    m[1].metric("Moment, M", f"{fmt(M_cut)} kN·m")
    m[2].metric("σ top / bottom", f"{fmt(sig_y[-1])} / {fmt(sig_y[0])} MPa")
    m[3].metric("ε top / bottom", f"{fmt(eps_y[-1], 1)} / {fmt(eps_y[0], 1)} με")
    m[4].metric("Average shear stress, V/A", f"{fmt(V_cut / section.area * to_mpa, 3)} MPa")

    cut = make_subplots(rows=1, cols=3, shared_yaxes=True, horizontal_spacing=0.06, column_widths=[0.25, 0.375, 0.375],
                        subplot_titles=[f"{section.name} section", "Stress, σ (MPa)", "Strain, ε (με)"])
    # Section outline (mm), drawn about its centroid
    yy = section.depth * 1000 / 2
    if shape == "Rectangle":
        cut.add_shape(type="rect", x0=-b / 2, x1=b / 2, y0=-yy, y1=yy, line=dict(color=BEAM_COLOR, width=2),
                      fillcolor="rgba(137,135,129,0.25)", row=1, col=1)
        half_w = b / 2
    elif shape == "I-beam":
        outline_x = [-bf / 2, bf / 2, bf / 2, tw / 2, tw / 2, bf / 2, bf / 2, -bf / 2, -bf / 2, -tw / 2, -tw / 2, -bf / 2, -bf / 2]
        outline_y = [yy, yy, yy - tf, yy - tf, -yy + tf, -yy + tf, -yy, -yy, -yy + tf, -yy + tf, yy - tf, yy - tf, yy]
        cut.add_trace(go.Scatter(x=outline_x, y=outline_y, fill="toself", mode="lines", hoverinfo="skip",
                                 line=dict(color=BEAM_COLOR, width=2), fillcolor="rgba(137,135,129,0.25)",
                                 showlegend=False), 1, 1)
        half_w = bf / 2
    else:
        # Outer circle one way, inner circle back the other way, so the fill leaves a hole
        t = np.linspace(0, 2 * np.pi, 120)
        r_in = d_in / 2 if shape == "Round tube" else 0.0
        cut.add_trace(go.Scatter(x=np.r_[yy * np.cos(t), r_in * np.cos(t[::-1])],
                                 y=np.r_[yy * np.sin(t), r_in * np.sin(t[::-1])], fill="toself", mode="lines",
                                 line=dict(color=BEAM_COLOR, width=2), fillcolor="rgba(137,135,129,0.25)",
                                 hoverinfo="skip", showlegend=False), 1, 1)
        half_w = yy
    cut.add_trace(go.Scatter(x=[-half_w * 1.3, half_w * 1.3], y=[0, 0], mode="lines+text", showlegend=False,
                             line=dict(color=BEAM_COLOR, dash="dash"), text=["", "N.A."],
                             textposition="top left", hoverinfo="skip"), 1, 1)
    for col, values, unit, digits in ((2, sig_y, "MPa", 2), (3, eps_y, "με", 1)):
        cut.add_trace(go.Scatter(x=values, y=ys * 1000, fill="tozerox", mode="lines", showlegend=False,
                                 line=dict(color=MOMENT_COLOR, width=2), fillcolor="rgba(235,104,52,0.15)",
                                 hovertemplate=f"%{{x:.{digits}f}} {unit} at y = %{{y:.1f}} mm<extra></extra>"),
                      1, col)
        for v, y, pos in ((values[-1], yy, "top center"), (values[0], -yy, "bottom center")):
            cut.add_annotation(x=v, y=y, text=f"{fmt(v, digits)}", showarrow=False,
                               yanchor="bottom" if y > 0 else "top", row=1, col=col)
        cut.add_vline(x=0, line=dict(color=BEAM_COLOR, width=1), row=1, col=col)
    lim = max(half_w * 1.4, yy * 1.2)
    cut.update_xaxes(range=[-lim, lim], scaleanchor="y", scaleratio=1, title_text="mm", row=1, col=1)
    cut.update_xaxes(title_text="σ (MPa)", row=1, col=2)
    cut.update_xaxes(title_text="ε (με)", row=1, col=3)
    cut.update_yaxes(title_text="y (mm)", range=[-yy * 1.35, yy * 1.35], row=1, col=1)
    cut.update_layout(height=380, margin=dict(l=70, r=20, t=40, b=40))
    st.plotly_chart(cut, width="stretch")
    st.caption("Stress and strain vary linearly through the depth: zero at the neutral axis (N.A.) and "
               "largest at the top and bottom fibers.")

    st.subheader("Section and material")
    s = st.columns(4)
    s[0].metric("Area, A", f"{section.area * 1e6:,.0f} mm²")
    s[1].metric("Second moment of area, I", f"{section.I * 1e12:,.4g} mm⁴")
    s[2].metric("Max bending stress", f"{sigma_max:.2f} MPa", help=f"|M| c / I at x = {xM_crit:.2f} m")
    s[3].metric("Max bending strain", f"{sigma_max / to_mpa / E * 1e6:.1f} με")

    with st.expander("Diagram data"):
        x_tab = np.linspace(0, L, 21)
        rows = []
        for x in x_tab:
            V, M = internal_forces(beam, x, reactions)
            sig = M * section.c / section.I * to_mpa
            rows.append({"x (m)": round(x, 3), "V (kN)": round(V, 3), "M (kN·m)": round(M, 3),
                         "σ bottom (MPa)": round(sig, 3), "ε bottom (με)": round(sig / to_mpa / E * 1e6, 2)})
        st.dataframe(rows, hide_index=True, width="stretch")

# --- Mathematical models tab ------------------------------------------------
with math_tab:
    st.header("1. Equilibrium")
    st.markdown("A beam that is not moving is in **static equilibrium**. For loads in the plane of the "
                "beam, two equations must hold:")
    st.latex(r"\sum F_y = 0 \qquad\qquad \sum M_{\text{any point}} = 0")
    st.markdown(
        "A pin gives one vertical reaction and a roller gives one, so a simply supported beam has two "
        "unknowns. A fixed support gives a vertical force *and* a moment, which is again two unknowns. "
        "Two equations and two unknowns means these beams are **statically determinate**: the reactions "
        "come from statics alone. (Horizontal reactions are zero here because every load is vertical.)\n\n"
        "**Sign conventions:** loads are positive downward, reactions positive upward, and moments "
        "positive counterclockwise."
    )

    st.header("2. Distributed loads → equivalent point loads")
    st.markdown(
        "For the equilibrium equations, a distributed load $w(x)$ can be replaced by a single **resultant** "
        "force equal to the *area* under the load diagram, acting at the area's *centroid*. A linearly "
        "varying (trapezoidal) load splits into a rectangle and a triangle:"
    )
    st.latex(r"F_{\text{rect}} = w_1 L_w \;\;\text{at}\;\; \tfrac{1}{2}L_w"
             r"\qquad F_{\text{tri}} = \tfrac{1}{2}(w_2 - w_1) L_w \;\;\text{at}\;\; \tfrac{2}{3}L_w")
    st.markdown("Here $L_w$ is the loaded length and the distances are measured from the start of the load.")

    st.header("3. Solving for the reactions")
    if support == SIMPLY_SUPPORTED:
        st.markdown("Sum moments about the **pin** at $x = a$ so its unknown force drops out. The roller "
                    "at $x = b$ is then the only unknown:")
        st.latex(r"R_{\text{roller}}\,(b - a) - \sum F_i\,(x_i - a) + \sum C_j = 0"
                 r"\;\;\Longrightarrow\;\; R_{\text{roller}} = \frac{\sum F_i (x_i - a) - \sum C_j}{b - a}")
        st.markdown("Then vertical force balance gives the pin:")
        st.latex(r"R_{\text{pin}} = \sum F_i - R_{\text{roller}}")
    else:
        st.markdown("At the wall ($x = a$), force balance gives the vertical reaction and moment balance "
                    "about the wall gives the reaction moment:")
        st.latex(r"R_{\text{wall}} = \sum F_i \qquad M_{\text{wall}} = \sum F_i\,(x_i - a) - \sum C_j")

    st.header("4. Shear and bending moment (method of sections)")
    st.markdown(
        "Cut the beam at any position $x$ and draw a free-body diagram of the piece on the left. The cut "
        "face carries an internal **shear force** $V$ and **bending moment** $M$, which keep that piece in "
        "equilibrium:"
    )
    st.latex(r"V(x) = \sum_{\text{left of } x} (\text{upward forces})"
             r"\qquad M(x) = \sum_{\text{left of } x} F\,(x - x_F) \;-\; \sum_{\text{left of } x} C")
    st.markdown(
        "Positive $M$ means **sagging** (the beam bends into a smile). Repeating the cut at every $x$ gives "
        "the diagrams. Three shortcuts help you check them by hand:\n"
        "- $\\dfrac{dV}{dx} = -w(x)$: the slope of the shear diagram is the load intensity, so shear is "
        "flat with no load, linear under a uniform load, and a parabola under a triangular load.\n"
        "- $\\dfrac{dM}{dx} = V(x)$: the slope of the moment diagram is the shear, so **M is largest where "
        "V crosses zero**.\n"
        "- A point load makes $V$ jump by the load. A couple makes $M$ jump by the couple (clockwise "
        "jumps up, counterclockwise jumps down)."
    )

    st.header("5. Stress and strain from bending")
    st.markdown(
        "This step goes slightly past statics, into the opening topic of *mechanics of materials*. Once "
        "$M$ is known, the **flexure formula** gives the normal stress at height $y$ above the neutral axis "
        "(the centroid of the cross section):"
    )
    st.latex(r"\sigma = -\frac{M\,y}{I} \qquad\Longrightarrow\qquad \sigma_{\max} = \frac{|M|\,c}{I}")
    st.markdown(
        "$I$ is the cross section's **second moment of area** (a geometric property, computed like a "
        "centroid) and $c$ is the distance to the farthest fiber. **Hooke's law** turns stress into strain, "
        "the fractional stretch of the material:"
    )
    st.latex(r"\varepsilon = \frac{\sigma}{E}")
    st.markdown(
        "| Shape | $I$ | $c$ |\n|---|---|---|\n"
        "| Rectangle $b \\times h$ | $bh^3/12$ | $h/2$ |\n"
        "| Circle, diameter $d$ | $\\pi d^4/64$ | $d/2$ |\n"
        "| Tube, $D$ outside, $d$ inside | $\\pi (D^4 - d^4)/64$ | $D/2$ |\n"
        "| I-beam | $[b h^3 - (b - t_w)(h - 2t_f)^3]/12$ | $h/2$ |\n\n"
        "The **average shear stress** $\\tau_{avg} = V/A$ is the statics-level estimate of the shear stress. "
        "The true distribution through the depth is a mechanics-of-materials topic.\n\n"
        "**Assumptions:** the beam is straight and slender, deflections are small, the material is linear "
        "elastic, and the cross section is symmetric about its horizontal axis."
    )

    st.header("Worked example: your current beam")
    loads = beam.load_resultants()
    lines = [f"- Point load: **{fmt(p.P)} kN** at x = {p.x:g} m" for p in points]
    for dl in dists:
        cx = dl.centroid
        where = f"at x = {cx:.3f} m" if cx is not None else "(net zero)"
        lines.append(f"- Distributed load {fmt(dl.w_start)} → {fmt(dl.w_end)} kN/m from {dl.start:g} to {dl.end:g} m: "
                     f"resultant **{fmt(dl.resultant, 3)} kN** {where}")
    lines += [f"- Couple: **{fmt(m.M)} kN·m** at x = {m.x:g} m" for m in couples]
    st.markdown("**Loads** (distributed loads replaced by their resultants):\n" + ("\n".join(lines) or "- none"))
    total = sum(F for F, _ in loads)
    sum_C = sum(m.M for m in couples)
    if support == SIMPLY_SUPPORTED:
        a, bb = pin_x, roller_x
        moment_sum = sum(F * (x - a) for F, x in loads)
        R_pin, R_rol = reactions.forces[0][0], reactions.forces[1][0]
        st.latex(rf"\sum F_i (x_i - a) = {moment_sum:.3f}\ \text{{kN·m}} \qquad \sum C_j = {sum_C:.3f}\ \text{{kN·m}}")
        st.latex(rf"R_{{\text{{roller}}}} = \frac{{{moment_sum:.3f} - ({sum_C:.3f})}}{{{bb:g} - {a:g}}} = {R_rol:.3f}\ \text{{kN}}")
        st.latex(rf"R_{{\text{{pin}}}} = {total:.3f} - {R_rol:.3f} = {R_pin:.3f}\ \text{{kN}}")
    else:
        a = 0.0 if fixed_end == "left" else L
        R_w, M_w = reactions.forces[0][0], reactions.moments[0][0]
        moment_sum = sum(F * (x - a) for F, x in loads)
        st.latex(rf"R_{{\text{{wall}}}} = {R_w:.3f}\ \text{{kN}} \qquad "
                 rf"M_{{\text{{wall}}}} = {moment_sum:.3f} - ({sum_C:.3f}) = {M_w:.3f}\ \text{{kN·m}}")
    c_mm, I_mm4 = section.c * 1000, section.I * 1e12
    st.markdown(f"The largest moment is **{fmt(M_crit)} kN·m** at x = {xM_crit:.2f} m. For the "
                f"{section.name.lower()} section, $I = {I_mm4:,.4g}$ mm⁴ and $c = {c_mm:.1f}$ mm, so:")
    st.latex(rf"\sigma_{{\max}} = \frac{{|M| c}}{{I}} = \frac{{({abs(M_crit):.3f}\times 10^6\ \text{{N·mm}})"
             rf"({c_mm:.1f}\ \text{{mm}})}}{{{I_mm4:.4g}\ \text{{mm}}^4}} = {sigma_max:.2f}\ \text{{MPa}}")
    st.latex(rf"\varepsilon_{{\max}} = \frac{{\sigma_{{\max}}}}{{E}} = \frac{{{sigma_max:.2f}\ \text{{MPa}}}}"
             rf"{{{E_gpa:g}\times 10^3\ \text{{MPa}}}} = {sigma_max / (E_gpa * 1e3) * 1e6:.1f}\times 10^{{-6}}")
