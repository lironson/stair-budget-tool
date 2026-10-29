# Architecture & editing guide

The Stair Budget Tool is a static page: one HTML file, one stylesheet and three
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
| `orientation` | string | `'U'` | one of `'straight'`, `'inline'`, `'L'`, `'U'` (see §3). Turn direction doesn't matter: L always turns right, U always returns on the right. Old saved values `'L-left'`/`'L-right'`/`'U-left'`/`'U-right'` are mapped by `normalizeOrientation()` |
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
| `landingCount` | int | `1` | number of landings: **1 or 2 only** (a `<select>`). `straight` is always 1. `calc.js` clamps any other value: < 1 → 1, > 2 → 2, straight → 1 |
| `deckRatePerSqFt` | number $/sq.ft | `0` | landing deck, priced on landingWidth × landingDepth × landingCount; taxed with materials (PST) |
| `beamXSection` | string | `'C8x11.2'` | **X landing beams** (run *across* the stair, i.e. across flight 1's travel): a `SECTIONS` name, or `'Custom'` |
| `beamXCustomLbFt` | number | `11` | lb/ft used when `beamXSection === 'Custom'` |
| `beamXCount` | int | `2` | X beams per landing |
| `beamXLengthAuto` | bool | `true` | `true` → each X beam = landing width, `landingWidth(state)` (see §3) |
| `beamXLengthOverride` | number (in) | `44` | X beam length used when `beamXLengthAuto` is `false` |
| `beamYSection` | string | `'C8x11.2'` | **Y landing beams** (run *along* the stair, i.e. in flight 1's direction of travel): a `SECTIONS` name, or `'Custom'` |
| `beamYCustomLbFt` | number | `11` | lb/ft used when `beamYSection === 'Custom'` |
| `beamYCount` | int | `2` | Y beams per landing |
| `beamYLengthAuto` | bool | `true` | `true` → each Y beam = landing depth (`landingDepth`) |
| `beamYLengthOverride` | number (in) | `48` | Y beam length used when `beamYLengthAuto` is `false` |
| `pricePerTread` | number $ | `0` | supply cost per tread (pan, grating, etc.) |
| `pricePerLb` | number $ | `0` | channel steel cost per lb |
| `connectionAllowancePct` | number % | `15` | extra steel weight for clips, plates, angles, bolts, welds |
| `finishType` | string | `'SP3/Standard Primer'` | a `FINISHES` name (finish dropdown) |
| `finishRatePerFt` | number $/ft | `0` | finish price per ft of stringers + landing beams. Treads are excluded: the tread finish is in `pricePerTread` |
| `labourHours` | number | `0` | total shop hours, typed by the user |
| `shopRate` | number $/hr | `0` | labour rate |
| `detailingCost` | number $ | `0` | detailing (shop drawings), one lump sum |
| `installationCost` | number $ | `0` | installation (erection crew, equipment, travel), one lump sum |
| `freightCost` | number $ | `0` | freight / delivery, one lump sum; not taxed |
| `markupPct` | number % | `0` | applied to the subtotal |
| `pstPct` | number % | `7` | PST (BC rate), charged on **materials only** (steel + treads), added after markup. GST is excluded |

`DEFAULTS` (in `calc.js`) holds exactly these keys and values. On a first visit every $
rate and the shop hours are **0**; the user enters their own and the page remembers them.

*Removed keys (v1 → v2)*: `landingSection`, `landingCustomLbFt`, `channelsPerLanding`,
`channelLengthAuto`, `channelLengthOverride`. They were the old single set of landing
"channels" and map 1-for-1 onto `beamXSection`, `beamXCustomLbFt`, `beamXCount`,
`beamXLengthAuto`, `beamXLengthOverride`. `app.js` migrates values saved under the old
names in localStorage.

## 2. `calc.js` exports

```js
const SECTIONS = [ { name: 'C12x20.7', lbft: 20.7, depth: 12 }, ... ];  // depth in inches
const DEFAULTS = { ...the table above... };
function sectionWeight(name, customLbFt)   // -> lb/ft number ('Custom' returns customLbFt)
function normalizeOrientation(o)          // -> 'straight' | 'inline' | 'L' | 'U'. 'L-left'/'L-right' -> 'L',
                                           //   'U-left'/'U-right' -> 'U', anything unknown -> 'U'.
                                           //   calc.js, plan.js and app.js always normalise before use.
function landingWidth(state)               // -> inches, landing size across the stair = auto X beam length (§3)
function landingBeamLength(state, axis)    // axis 'x' | 'y' -> inches, length of ONE beam on that axis,
                                           //   honouring beamXLengthAuto/Override or beamYLengthAuto/Override
function computeEstimate(state)            // -> result (below)
function fmtFtIn(inches)                   // 42 -> 3'-6"   263.56 -> 21'-11 1/2"  (nearest 1/8")
function fmtMoney(n)                       // 1234.5 -> "$1,234.50"
function fmtNum(n, decimals = 0)           // 1234.5 -> "1,235"
```

The file ends with
`if (typeof module !== 'undefined') module.exports = { SECTIONS, FINISHES, DEFAULTS, normalizeOrientation, sectionWeight, landingWidth, landingBeamLength, computeEstimate, fmtFtIn, fmtMoney, fmtNum };`
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
  beamsX: { section, lbft, count, eachLengthIn, lengthFt, weightLb },  // count = landingCount x beamXCount
  beamsY: { section, lbft, count, eachLengthIn, lengthFt, weightLb },  // count = landingCount x beamYCount
  baseSteelLb,                     // stringers.weightLb + beamsX.weightLb + beamsY.weightLb
  allowanceLb,                     // baseSteelLb x connectionAllowancePct / 100
  totalSteelLb,                    // baseSteelLb + allowanceLb
  costs: { steel, treads, labour, detailing, installation, subtotal, markup, pst, total },   // + costs.deck, costs.finish, costs.freight
  deck: { sqFt },  finish: { type, lengthFt },
  warnings: [ 'string', ... ]      // gentle checks, e.g. riser > 7 7/8", tread < 10", treads < 1
}
```

Formulas:

* `run = treads × treadDepth`, `rise = (treads + 1) × riserHeight`
* `stringerLength = √(run² + rise²) + crankAllowance`
* `costs.steel = totalSteelLb × pricePerLb`, `costs.treads = totalTreads × pricePerTread`,
  `costs.labour = labourHours × shopRate`, `costs.detailing = detailingCost`,
  `costs.installation = installationCost`,
  `costs.deck = deckRatePerSqFt × deck.sqFt` (deck.sqFt = landingCount × landingWidth × landingDepth / 144),
  `costs.finish = finishRatePerFt × finish.lengthFt` where `finish.lengthFt` = all stringers + all landing beams,
  `costs.freight = freightCost`,
  `subtotal = steel + treads + deck + finish + labour + detailing + installation + freight`,
  `markup = subtotal × markupPct / 100`, `pst = (steel + treads + deck) × pstPct / 100`,
  `total = subtotal + markup + pst` (GST excluded)

Hand check: 19 treads @ 11", 7" risers, 2 × C12x20.7, 12" allowance →
√(209² + 140²) = 251.56" + 12" = 263.56" = 21.96 ft; × 2 × 20.7 = **909.3 lb**.

## 3. Plan geometry (used by `plan.js`; `landingWidth` in `calc.js`)

Plan coordinates are inches. Flight 1 starts at the bottom and goes **up** the screen
("UP" arrow). x is to the right, y is down in SVG space.

* **straight**: flight 1, then a top landing (`landingDepth` deep, `stairWidth` wide).
* **inline**: flight 1, then the landing, then flight 2 carrying on in the same direction.
* **L**: flight 1, then the landing (`landingDepth` × `stairWidth`). Flight 2 leaves the
  landing's **right** side, turned 90°, flush with the far edge of the landing.
* **U**: flight 1, then the landing across the full width (`2 × stairWidth + wellGap`), then
  flight 2 coming back down parallel to flight 1 on its **right**, with the `wellGap` between.

(The direction is fixed; there are no left/right variants any more.)

`landingWidth(state)` = `2 × stairWidth + wellGap` for U-stairs, otherwise `stairWidth`.
**X beams** run **across** flight 1's direction of travel (horizontal in the plan), each
spanning the landing width, spread evenly over the landing depth (as in PDF examples 1 and 4).
1 beam sits at mid-depth; with 2+ the first and last sit a small inset from the near/far edges.

**Y beams** run **along** flight 1's direction of travel (vertical in the plan), each
spanning the landing depth, spread evenly across the landing width with the same rule:
1 at the centre; 2 at the two side edges; 3 = both edges + centre (over the U-stair well),
as in PDF example 5. X beams are drawn first, Y beams on top.

A small axis key ("X →", "Y ↑") on the drawing ties the beams to the input names.

### Upper landing (landingCount ≥ 2)

A second drawing in its own svg shows the **upper landing**: the landing at the top of the
last flight (flight 1 for `straight`, flight 2 otherwise). It is the same size as landing 1
(`landingWidth` × `landingDepth`) with the same X / Y beams, deck symbol, labels
(`{SECTION} @ LANDING LEVEL`) and width/depth dimensions. The arriving flight is shown only
as its **last 3 treads** (fewer if the flight is shorter) with its stringers and an UP
arrow, cut off with a zig-zag **break line** on the free end, as on the PDF's upper-landing
sheets. Placement:

* **straight / inline**: the landing sits above the top end of the arriving flight.
* **L**: the arriving flight 2 runs to the right; the landing is beyond its right end,
  flight 2 meeting the landing's left edge, flush with the landing's far (top) edge.
* **U**: the arriving flight 2 runs down the screen on the right; the landing is below its
  end and spans the full landing width, flight 2 meeting the right half of its top edge.

Title: `2 | UPPER LANDING FRAMING PLAN` (the main drawing is `1 | STAIR FRAMING PLAN`).

## 4. `plan.js`

```js
function renderPlan(svgEl, state)          // clears svgEl, sets its viewBox, draws everything
function renderUpperLanding(svgEl, state)  // second view (§3 "Upper landing"); clears svgEl and
                                           //   draws nothing when landingCount < 2. Never throws.
```

* Draws in inch units and sets `viewBox` to the drawing's bounding box plus margin for
  labels and dimensions. Text size scales with the drawing.
* Injects its own `<style>` into the SVG using CSS variables with fallbacks, so it also
  works standalone:
  `--plan-paper` (sheet background), `--plan-ink` (treads, outlines, text),
  `--plan-muted` (hatch, secondary lines), `--plan-steel` (stringers & landing beams),
  `--plan-dim` (dimension lines/ticks/text), `--plan-landing` (landing fill).
* Draws: thin tread nosing lines; stringers as thick `--plan-steel` lines (the outer two
  are "CRANKED", inner ones are not); landing outline and fill with a small hatched
  deck symbol; X and Y landing beams as thick `--plan-steel` lines (one label per axis,
  each `{SECTION} @ LANDING LEVEL` with its own leader); an "UP" arrow on each
  flight; labels like `C12x20.7 CRANKED STRINGER`, `C12x20.7 STRINGER`,
  `C8x11.2 @ LANDING LEVEL`; dimension strings `9 TR @ 11"` (with `fmtFtIn` total) along
  each flight, the stair width, and the landing depth.
* `renderPlan` must never throw for odd input (0 treads, huge widths): clamp and draw
  what makes sense.

## 5. DOM ids (`index.html` ↔ `app.js`)

Every `state` key has an input with **the same id** (`<select id="orientation">`,
`<input id="treads1">`, `<input type="checkbox" id="beamXLengthAuto">`, …).

Other ids:

| id | element | used for |
|---|---|---|
| `plan` | `<svg>` | `renderPlan` target |
| `viewTabs` | element | `role="tablist"` above the plan sheet; `hidden` when `landingCount < 2`. Print-hidden |
| `tabMain` | `<button role="tab">` | "1 · Stair framing plan"; `aria-controls="plan"` |
| `tabUpper` | `<button role="tab">` | "2 · Upper landing framing plan"; `aria-controls="planUpperWrap"` |
| `planUpperWrap` | element | holds the upper-landing view; `hidden` when `landingCount < 2`. On screen only the tab-selected view shows (`.show-main` / `.show-upper` on `.sheet-frame`); in print both sit side by side at the same scale (see "Drawing scale") |
| `planUpper` | `<svg>` | `renderUpperLanding` target |
| `.logo-print` | `<img>` | print-only logo, `assets/grizzly-logo-print.png` (black on transparent). Shown in print instead of the CSS-mask `.logo`, which iPhone Safari prints as a black block |
| `toggleAllBtn` | `<button>` | above the first input section: "Collapse all" while any section is open, otherwise "Expand all"; sets every `details.section` `open` (their `toggle` handlers save the state) |
| `results` | `<tbody>` | estimate breakdown rows, filled by `app.js` |
| `grandTotal` | element | big total figure |
| `summary` | element | one line: flights, total treads/risers, total rise |
| `warnings` | `<ul>` | `result.warnings`, hidden when empty |
| `printBtn` | `<button>` | `window.print()`. Hidden when the page is framed (`window.self !== window.top`) |
| `resetBtn` | `<button>` | restore `DEFAULTS` |
| `beamXLengthAutoValue`, `beamYLengthAutoValue` | `<output>` | the auto length next to each "match" switch, e.g. `(7'-8")` |
| wrapper elements `field-treads2`, `field-wellGap`, `field-stringerCustomLbFt`, `field-beamXCustomLbFt`, `field-beamXLengthOverride`, `field-beamYCustomLbFt`, `field-beamYLengthOverride` | | shown or hidden (`el.hidden`) depending on state |

### Collapsible input sections

Each input group is a `<details class="section" open>` whose `<summary>` is the group
heading. Order and ids:

| id | heading | collapsed summary (`<span class="section-sum" id="sum-…">`, filled by `app.js`) |
|---|---|---|
| `sec-layout` | Layout | orientation · treads, e.g. `U-stair · 10 + 10 TR` |
| `sec-stringers` | Stringers | e.g. `C12x20.7 × 2 / flight` |
| `sec-landings` | Landings | e.g. `1 landing · X 2 × C8x11.2 · Y 2 × C8x11.2` |
| `sec-material` | Material pricing | e.g. `$85.00 / tread · $1.60 / lb` |
| `sec-finish` | Finishes | e.g. `SP3/Standard Primer · $2.50 / ft` |
| `sec-labour` | Labour | e.g. `52 hrs @ $100.00 / hr` |
| `sec-detailing` | Detailing | e.g. `$1,200.00` |
| `sec-installation` | Installation | e.g. `$3,500.00` |
| `sec-freight` | Freight | e.g. `$500.00` |
| `sec-markup` | Markup | e.g. `0%` |
| `sec-pst` | PST | e.g. `7% on materials` |

Summary span ids are `sum-layout`, `sum-stringers`, … (same suffix as the section id).
All sections start open; each viewer's open/closed state is remembered in
`localStorage['stairBudgetTool.sections']` (an object `{ sectionId: bool }`).

### Saved state, schema 2

`app.js` saves `{ ...state, schema: 2 }`. When it loads a save without `schema: 2`, any of
`labourHours`, `shopRate`, `markupPct` still equal to the **old** example defaults
(`40`, `110`, `10`) is dropped so the new defaults apply; values the user changed are kept.

### Print

`window.print()` must produce **exactly one Letter page**: compact header, plan sheet,
estimate (total, summary, warnings, table) and the disclaimer. Inputs, buttons and the
theme switch are hidden. All print rules live in the `@media print` block of `styles.css`.

Estimate table rows for the landing: **"Landing beams — X (across)"** and
**"Landing beams — Y (along)"**, each with a detail line like `C8x11.2 · 11.2 lb/ft · 2 × 4'-0"`.
After the Labour row come **"Detailing"** (detail line "Shop drawings — lump sum") and
**"Installation"** (detail line "Erection — lump sum"), each with only a Cost value.

`app.js` saves `state` to `localStorage['stairBudgetTool.v1']` (wrapped in try/catch; falls back to the
pre-rename key `stairEstimator.v1` when nothing is saved yet) and
merges the saved values over `DEFAULTS` on load.

---

## How to…

* **Add a channel size**: add `{ name, lbft, depth }` to `SECTIONS` in `js/calc.js`. All three
  dropdowns pick it up automatically.
* **Change the starting values**: edit `DEFAULTS` in `js/calc.js`.
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


## Drawing scale (screen and print)

Both drawings are in inches, so the same scale means the same CSS px per viewBox unit.
After each redraw `app.js` reads each svg's `viewBox` and sets custom properties on
`.sheet-frame`: `--vb-w-main`, `--vb-h-main`, `--vb-w-upper`, `--vb-h-upper`,
`--vb-maxw` (largest width), `--vb-maxh` (largest height) and `--vb-sumw` (sum of widths;
just the main width when the upper view is hidden). The CSS turns those into sizes:

* **Screen:** one view at a time. With 2+ landings the tabs (`#tabMain`, `#tabUpper`) pick the
  view (`planView`, saved in localStorage `stairBudgetTool.planView`); `app.js` sets
  `.show-main` / `.show-upper` on `.sheet-frame` and the other view is `display: none` on
  screen only. The shown view fills the sheet like the plan did with 1 landing (full width,
  capped at `--plan-max-h`, `aspect-ratio: w / h`). Both drawings are still redrawn on every
  update.
* **Print:** the views sit **side by side** in a flex row. Each child's flex-grow is its
  viewBox width, and the row's width is `min(100%, --print-plan-h × sumw / maxh)`, so both
  share one scale and fit the plan height. This is pure CSS; no `beforeprint` script.

Print must not depend on the screen width (iPhone Safari): `@media print` undoes every
phone-width screen rule, uses inch sizes, and keeps the printed content within an
**8.6in** height budget (Safari adds its own margins, header and footer).

## Releasing (cache busting)

GitHub Pages lets browsers cache `css/styles.css`, the scripts and images for a while.
iPhone Safari once combined a new `index.html` with an old cached `styles.css`, which broke
the printout. So `index.html` loads every asset with a version query (`styles.css?v=…`,
`calc.js?v=…`, …). **On every release, change all the `?v=` values in `index.html`** (any
new value, e.g. the date plus a counter). The logo's screen/print rules are also repeated
in a small `<style>` block in `index.html`, so the logo prints correctly even with a stale
stylesheet.
