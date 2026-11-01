# Beam Calculator

An interactive website that finds the support reactions of a statically determinate beam, then draws its shear, bending-moment, stress and strain diagrams. It also explains the mechanics behind each step.

**Live site: https://bjung-dev.github.io/beam-calculator/**

The website is plain HTML, CSS and JavaScript (with [Plotly.js](https://plotly.com/javascript/) for charts and [KaTeX](https://katex.org) for equations). Everything runs in the visitor's browser, with no server. The original Python version, built with [Streamlit](https://streamlit.io), is still included and gives identical results.

## Features

- **Supports:** simply supported (a pin and a roller at any positions, so overhangs work) or a cantilever fixed at either end
- **Loads:** any number of point loads, distributed loads (uniform, triangular or trapezoidal) and applied couples
- **Free-body diagram:** the applied loads, plus the solved reactions drawn as arrows
- **Diagrams:** shear force V(x), bending moment M(x), and bending stress and strain at the top and bottom fibers, with the maximum values labeled
- **Inside the beam:** a stress map over the beam's side view, plus the stress and strain through the depth at any cut you choose
- **Cross sections:** rectangle, I-beam, solid circle or round tube, in steel, aluminum, wood, concrete or a custom material
- **The math tab:** the derivations, plus a worked example that uses your current beam
- **Works on phones** and follows your system's light or dark mode

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

The same textbook checks run against both versions: [`tests/beam.test.js`](tests/beam.test.js) for the website and [`tests/test_beam.py`](tests/test_beam.py) for the Python version.

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

**Website.** The page loads its code as JavaScript modules, which browsers won't open straight from a file, so serve the folder:

```bash
python -m http.server 8000
```

Then open http://localhost:8000/docs/ for the site and http://localhost:8000/tests/ to run the JavaScript tests.

**Python version.**

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
streamlit run app.py          # opens http://localhost:8501
pytest                        # run the Python tests
```

## Publishing

The site is served by GitHub Pages from the `docs/` folder of the `main` branch (Settings → Pages → Deploy from a branch → `main` / `/docs`). Every push to `main` updates the live site within a minute or two.

## Project structure

```
docs/                The website
  index.html         Page layout and the math tab's text
  style.css          Styles, including light and dark themes
  beam.js            Mechanics: reactions, shear/moment diagrams, sections, stress and strain
  app.js             Inputs, charts and the worked example
tests/
  beam.test.js       Website tests (open tests/index.html through a local server)
  test_beam.py       Python tests (pytest)
beam.py              Python version of the mechanics
app.py               Python version of the interface (Streamlit)
```
