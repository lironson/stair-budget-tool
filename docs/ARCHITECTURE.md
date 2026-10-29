# Architecture & editing guide

The Steel Stair Estimator is a static page: one HTML file, one stylesheet and three
plain JavaScript files. There is no build step, no framework and no dependency. All
scripts are **classic scripts** (not ES modules) so the page also works when
`index.html` is opened straight from disk (`file://`).

```
index.html          markup: input panel, plan view <svg id="plan">, estimate table
css/styles.css      colour/type tokens (light + dark), layout, print styles
assets/             Grizzly logo (used as a CSS mask so it follows the ink colour)
js/calc.js          section table, defaults, unit formatting, computeEstimate()
js/plan.js          renderPlan(): draws the live plan view into the <svg>
js/app.js           reads inputs -> state, calls calc + plan, fills table, localStorage
tests/calc.test.js  npm test
```

Load order in `index.html` (end of body): `js/calc.js`, `js/plan.js`, `js/app.js`.
Top-level `const`/`function` declarations in classic scripts are shared between
the three files, so `app.js` can call `computeEstimate()` and `renderPlan()` directly.

Data flow (one direction, recomputed in full on every `input`/`change` event):

```
inputs --(app.js readState)--> state --+--> computeEstimate(state) --> result --> table
                                       +--> renderPlan(svg, state)  --> SVG
```

All lengths inside `state` and inside the calculations are **inches**. Weights are
**lb**. Money is plain numbers (the page shows `$`).

---

## 1. `state` object (the shared contract)

`app.js` builds this from the form; `calc.js` and `plan.js` only read it.

| key | type | default | meaning |
|---|---|---|---|
| `orientation` | string | `'U-right'` | one of `'straight'`, `'inline'`, `'L-left'`, `'L-right'`, `'U-left'`, `'U-right'` (see §4) |
| `treads1` | int | `10` | treads in flight 1 (the bottom flight) |
| `treads2` | int | `10` | treads in flight 2. Ignored when `orientation === 'straight'` |
| `treadDepth` | number (in) | `11` | going / run per tread |
| `riserHeight` | number (in) | `7` | rise per riser |
| `stairWidth` | number (in) | `44` | flight width, out-to-out of the outer stringers |
| `landingDepth` | number (in) | `48` | landing size measured in flight 1's direction of travel |
| `wellGap` | number (in) | `4` | gap between the two flights. Used by U-stairs only |
| `stringerSection` | string | `'C12x20.7'` | a `SECTIONS` name, or `'Custom'` |
| `stringerCustomLbFt` | number | `20` | lb/ft used when `stringerSection === 'Custom'` |
| `stringersPerFlight` | int | `2` | `2` = two outer cranked stringers; `4` = 2 cranked outer + 2 inner (PDF examples 1 & 4) |
| `crankAllowance` | number (in) | `12` | extra length added to **each** stringer for cranked ends / bearing |
| `landingSection` | string | `'C8x11.2'` | a `SECTIONS` name, or `'Custom'` |
| `landingCustomLbFt` | number | `11` | lb/ft used when `landingSection === 'Custom'` |
| `landingCount` | int | `1` | number of landings to price (all the same size) |
| `channelsPerLanding` | int | `2` | landing channels per landing |
| `channelLengthAuto` | bool | `true` | `true` → channel length = landing width (see §3) |
| `channelLengthOverride` | number (in) | `44` | channel length used when `channelLengthAuto` is `false` |
| `pricePerTread` | number $ | `85` | supply cost per tread (pan, grating, etc.) |
| `pricePerLb` | number $ | `1.6` | channel steel cost per lb |
| `connectionAllowancePct` | number % | `15` | extra steel weight for clips, plates, angles, bolts, welds |
| `labourHours` | number | `40` | total shop hours |
| `shopRate` | number $/hr | `110` | labour rate |
| `markupPct` | number % | `10` | applied to the subtotal |

`DEFAULTS` (in `calc.js`) holds exactly these keys and values. The prices are
**example rates**, not real quotes, and the page labels them that way.

## 2. `calc.js` exports

```js
const SECTIONS = [ { name: 'C12x20.7', lbft: 20.7, depth: 12 }, ... ];  // depth in inches
const DEFAULTS = { ...the table above... };
function sectionWeight(name, customLbFt)   // -> lb/ft number ('Custom' returns customLbFt)
function landingWidth(state)               // -> inches, the auto channel length (§3)
function computeEstimate(state)            // -> result (below)
function fmtFtIn(inches)                   // 42 -> 3'-6"   263.56 -> 21'-11 1/2"  (nearest 1/8")
function fmtMoney(n)                       // 1234.5 -> "$1,234.50"
function fmtNum(n, decimals = 0)           // 1234.5 -> "1,235"
```

The file ends with
`if (typeof module !== 'undefined') module.exports = { SECTIONS, DEFAULTS, sectionWeight, landingWidth, computeEstimate, fmtFtIn, fmtMoney, fmtNum };`
so Node tests can `require` it.

`SECTIONS` (AISC lb/ft): C6x8.2, C6x10.5, C7x9.8, C7x12.25, C8x11.2, C8x11.5,
C8x13.75, C9x13.4, C10x15.3, C10x20, C12x20.7, C12x25, C15x33.9, MC8x8.5,
MC10x8.4, MC12x10.6. `'Custom'` is not in the array; the UI adds it as the last
dropdown option.

### `result` shape

```js
{
  flights: [                       // 1 entry for 'straight', otherwise 2
    { treads, risers, run, rise, stringerLength }   // inches. risers = treads + 1
  ],                               // stringerLength = one stringer, incl. crankAllowance
  totalTreads, totalRisers, totalRise,             // totalRise in inches
  stringers: { section, lbft, count, lengthFt, weightLb },        // count = flights x stringersPerFlight; lengthFt = total of all
  channels:  { section, lbft, count, eachLengthIn, lengthFt, weightLb }, // count = landingCount x channelsPerLanding
  baseSteelLb,                     // stringers.weightLb + channels.weightLb
  allowanceLb,                     // baseSteelLb x connectionAllowancePct / 100
  totalSteelLb,                    // baseSteelLb + allowanceLb
  costs: { steel, treads, labour, subtotal, markup, total },
  warnings: [ 'string', ... ]      // gentle checks, e.g. riser > 7 7/8", tread < 10", treads < 1
}
```

Formulas:

* `run = treads × treadDepth`, `rise = (treads + 1) × riserHeight`
* `stringerLength = √(run² + rise²) + crankAllowance`
* `costs.steel = totalSteelLb × pricePerLb`, `costs.treads = totalTreads × pricePerTread`,
  `costs.labour = labourHours × shopRate`, `subtotal = steel + treads + labour`,
  `markup = subtotal × markupPct / 100`, `total = subtotal + markup`

Hand check: 19 treads @ 11", 7" risers, 2 × C12x20.7, 12" allowance →
√(209² + 140²) = 251.56" + 12" = 263.56" = 21.96 ft; × 2 × 20.7 = **909.3 lb**.

## 3. Plan geometry (used by `plan.js`; `landingWidth` in `calc.js`)

Plan coordinates are inches. Flight 1 starts at the bottom and goes **up** the screen
("UP" arrow). x is to the right, y is down in SVG space.

* **straight**: flight 1, then a top landing (`landingDepth` deep, `stairWidth` wide).
* **inline**: flight 1, then the landing, then flight 2 carrying on in the same direction.
* **L-left / L-right**: flight 1, then the landing (`landingDepth` × `stairWidth`). Flight 2
  leaves the landing's left/right side, turned 90°, flush with the far edge of the landing.
* **U-left / U-right**: flight 1, then the landing across the full width
  (`2 × stairWidth + wellGap`), then flight 2 coming back down parallel to flight 1 on the
  left/right side of it, with the `wellGap` between them.

`landingWidth(state)` = `2 × stairWidth + wellGap` for U-stairs, otherwise `stairWidth`.
Landing channels run **across** flight 1's direction of travel (horizontal in the plan)
and are spread evenly over the landing depth, as in PDF examples 1 and 4.

## 4. `plan.js`

```js
function renderPlan(svgEl, state)   // clears svgEl, sets its viewBox, draws everything
```

* Draws in inch units and sets `viewBox` to the drawing's bounding box plus margin for
  labels and dimensions. Text size scales with the drawing.
* Injects its own `<style>` into the SVG using CSS variables with fallbacks, so it also
  works standalone:
  `--plan-paper` (sheet background), `--plan-ink` (treads, outlines, text),
  `--plan-muted` (hatch, secondary lines), `--plan-steel` (stringers & channels),
  `--plan-dim` (dimension lines/ticks/text), `--plan-landing` (landing fill).
* Draws: thin tread nosing lines; stringers as thick `--plan-steel` lines (the outer two
  are "CRANKED", inner ones are not); landing outline and fill with a small hatched
  deck symbol; landing channels as thick `--plan-steel` lines; an "UP" arrow on each
  flight; labels like `C12x20.7 CRANKED STRINGER`, `C12x20.7 STRINGER`,
  `C8x11.2 @ LANDING LEVEL`; dimension strings `9 TR @ 11"` (with `fmtFtIn` total) along
  each flight, the stair width, and the landing depth.
* `renderPlan` must never throw for odd input (0 treads, huge widths): clamp and draw
  what makes sense.

## 5. DOM ids (`index.html` ↔ `app.js`)

Every `state` key has an input with **the same id** (`<select id="orientation">`,
`<input id="treads1">`, `<input type="checkbox" id="channelLengthAuto">`, …).

Other ids:

| id | element | used for |
|---|---|---|
| `plan` | `<svg>` | `renderPlan` target |
| `results` | `<tbody>` | estimate breakdown rows, filled by `app.js` |
| `grandTotal` | element | big total figure |
| `summary` | element | one line: flights, total treads/risers, total rise |
| `warnings` | `<ul>` | `result.warnings`, hidden when empty |
| `printBtn` | `<button>` | `window.print()`. Hidden when the page is framed (`window.self !== window.top`) |
| `resetBtn` | `<button>` | restore `DEFAULTS` |
| wrapper elements `field-treads2`, `field-wellGap`, `field-stringerCustomLbFt`, `field-landingCustomLbFt`, `field-channelLengthOverride` | | shown or hidden (`el.hidden`) depending on state |

`app.js` saves `state` to `localStorage['stairEstimator.v1']` (wrapped in try/catch) and
merges the saved values over `DEFAULTS` on load.

---

## How to…

* **Add a channel size**: add `{ name, lbft, depth }` to `SECTIONS` in `js/calc.js`. Both
  dropdowns pick it up automatically.
* **Change the default values or example rates**: edit `DEFAULTS` in `js/calc.js`.
* **Change the look**: the colour/type tokens at the top of `css/styles.css` mirror the
  *Steel Size Rolodex* app (white/black, ink, `#ff4f00` accent, Barlow Condensed + IBM Plex
  Mono). Keep the two in sync. Plan colours are the `--plan-*` tokens in the same file.
* **Theme**: the "Dark mode" switch stores `localStorage['theme']` (same key as the
  Rolodex, so the preference is shared on the same site).
* **Add a cost line** (e.g. galvanizing): add a state key + input with the same id, add
  it to `DEFAULTS`, compute it in `computeEstimate` and add it to `costs`, then add a row
  in `renderResults()` in `js/app.js`.
* **Add an orientation**: add an `<option>` in `index.html`, handle it in `landingWidth`
  and the flight count in `calc.js`, and add a layout branch in `plan.js`.
