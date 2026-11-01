# Beam Calculator

An interactive web app that finds the support reactions of a statically determinate beam, then draws its shear, bending-moment, stress and strain diagrams. It also explains the mechanics behind each step. Built in Python with [Streamlit](https://streamlit.io) and [Plotly](https://plotly.com/python/).

## Features

- **Supports:** simply supported (a pin and a roller at any positions, so overhangs work) or a cantilever fixed at either end
- **Loads:** any number of point loads, distributed loads (uniform, triangular or trapezoidal) and applied couples
- **Free-body diagram:** the applied loads, plus the solved reactions drawn as arrows
- **Diagrams:** shear force V(x), bending moment M(x), and bending stress and strain at the top and bottom fibers, with the maximum values labeled
- **Inside the beam:** a stress map over the beam's side view, plus the stress and strain through the depth at any cut you choose
- **Cross sections:** rectangle, I-beam, solid circle or round tube, in steel, aluminum, wood, concrete or a custom material
- **Mathematical models tab:** the derivations, plus a worked example that uses your current beam

## The mechanics

| Step | Principle | Equation |
|---|---|---|
| Reactions | Static equilibrium | ΣF_y = 0, ΣM = 0 |
| Distributed loads | Resultant = area, acting at the centroid | rectangle w·L at L/2, triangle ½w·L at 2L/3 |
| Shear and moment | Method of sections (free body left of the cut) | V = Σ forces, M = Σ F·(x − x_F) − Σ C |
| Checks | Load–shear–moment relations | dV/dx = −w, dM/dx = V |
| Bending stress | Flexure formula | σ = −M y / I, σ_max = \|M\| c / I |
| Strain | Hooke's law | ε = σ / E |

**Sign conventions:** loads are positive downward, reactions positive upward, moments positive counterclockwise, and a positive bending moment means sagging (compression on top).

The stress and strain steps go slightly past a statics course, into the first topic of mechanics of materials. **Assumptions:** the beam is statically determinate, straight and slender, deflections are small, the material is linear elastic, and the cross section is symmetric about its horizontal axis.

## Validation

The tests in [`tests/test_beam.py`](tests/test_beam.py) check the calculator against textbook results:

| Check | Expected result |
|---|---|
| Simply supported, center load P | R = P/2, M_max = PL/4 |
| Simply supported, off-center load | R_a = Pb/L, M_max = Pab/L |
| Simply supported, uniform load w | R = wL/2, M_max = wL²/8 |
| Simply supported, triangular load | R = w₀L/6 and w₀L/3, M_max = w₀L²/(9√3) at L/√3 |
| Cantilever, end load | R = P, M_wall = PL |
| Cantilever, uniform load | M_wall = wL²/2 |
| Applied couple | Moment diagram jumps by C |
| Mixed loads, overhangs, either support type | ΣF = 0 and ΣM = 0; V and M return to zero at both ends; dM/dx = V |
| Section properties | I = bh³/12, πd⁴/64, and so on |

## Running locally

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
streamlit run app.py          # opens http://localhost:8501
pytest                        # run the tests
```

## Project structure

```
beam.py              Loads, supports, reactions, shear/moment diagrams, sections, stress and strain
app.py               Streamlit user interface (calculator + mathematical models tabs)
tests/               Validation tests (pytest)
```
