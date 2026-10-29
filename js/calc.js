/*
 * calc.js — the numbers behind the Steel Stair Estimator
 * =======================================================
 *
 * WHAT THIS FILE DOES
 *   Holds the channel section table (SECTIONS), the starting form values (DEFAULTS),
 *   and all the arithmetic: stair geometry, stringer and landing-beam weights (X beams
 *   across the stair, Y beams along it), the cost roll-up, and the warnings. It also
 *   has the small formatters the page uses to show feet-inches, dollars and plain
 *   numbers.
 *
 *   There is NO page / DOM code in here. It only takes numbers in and gives numbers
 *   back, so it can be tested on its own with `node --test tests/`.
 *
 * HOW IT FITS WITH THE OTHER FILES
 *   index.html loads three classic scripts, in this order:
 *     1. js/calc.js  (this file)  — SECTIONS, DEFAULTS, computeEstimate(), fmtFtIn() ...
 *     2. js/plan.js              — renderPlan(svg, state) draws the plan view; it uses
 *                                  landingWidth(), landingBeamLength() and fmtFtIn()
 *                                  from this file.
 *     3. js/app.js               — reads the form into a `state` object, calls
 *                                  computeEstimate(state) and renderPlan(svg, state),
 *                                  and fills the estimate table.
 *   Top-level `const` / `function` names in classic scripts are shared by all three
 *   files, so do not reuse a name from this file in app.js or plan.js.
 *
 *   Units everywhere in here: lengths in INCHES, weights in LB, money as plain numbers.
 *   The full contract (state keys, result shape) is in docs/ARCHITECTURE.md.
 *
 * HOW TO EDIT
 *   - Add a channel size: add a row { name, lbft, depth } to SECTIONS below. All three
 *     dropdowns on the page (stringers, X landing beams, Y landing beams) pick it up
 *     automatically.
 *   - Landing beams come in two directions, each with its own section, custom lb/ft,
 *     count per landing, auto-length switch and length override:
 *       X beams (beamX... keys) run ACROSS the stair; auto length = landingWidth().
 *       Y beams (beamY... keys) run ALONG the stair (flight 1's direction of travel);
 *       auto length = landingDepth.
 *     landingBeamLength(state, 'x' | 'y') gives the length of one beam on either axis.
 *   - Change the default values or example rates: edit DEFAULTS below. These are the
 *     values the page starts with and the "Reset" button goes back to.
 *   - Add a cost line (e.g. galvanizing):
 *       1. add a key to DEFAULTS (and an <input> with the same id in index.html),
 *       2. compute it in computeEstimate() in the "Costs" step and add it to `costs`
 *          and to `subtotal`,
 *       3. add a row for it in renderResults() in js/app.js.
 */

/*
 * SECTIONS — channel sizes offered for stringers and the X and Y landing beams.
 *   name:  the designation shown in the dropdown and on the plan
 *   lbft:  nominal weight, lb per foot (AISC)
 *   depth: nominal depth, inches
 * 'Custom' is NOT in this list; the page adds it as the last dropdown option and then
 * uses the custom lb/ft typed into the form.
 */
const SECTIONS = [
  // --- C channels (American Standard channels, sloped inner flange faces) ---
  { name: 'C6x8.2', lbft: 8.2, depth: 6 },
  { name: 'C6x10.5', lbft: 10.5, depth: 6 },
  { name: 'C7x9.8', lbft: 9.8, depth: 7 },
  { name: 'C7x12.25', lbft: 12.25, depth: 7 },
  { name: 'C8x11.2', lbft: 11.2, depth: 8 },
  { name: 'C8x11.5', lbft: 11.5, depth: 8 },
  { name: 'C8x13.75', lbft: 13.75, depth: 8 },
  { name: 'C9x13.4', lbft: 13.4, depth: 9 },
  { name: 'C10x15.3', lbft: 15.3, depth: 10 },
  { name: 'C10x20', lbft: 20, depth: 10 },
  { name: 'C12x20.7', lbft: 20.7, depth: 12 },
  { name: 'C12x25', lbft: 25, depth: 12 },
  { name: 'C15x33.9', lbft: 33.9, depth: 15 },

  // --- MC channels (miscellaneous channels, lighter for their depth) ---
  { name: 'MC8x8.5', lbft: 8.5, depth: 8 },
  { name: 'MC10x8.4', lbft: 8.4, depth: 10 },
  { name: 'MC12x10.6', lbft: 10.6, depth: 12 },
];

/*
 * DEFAULTS — the starting value of every form field (same keys as the `state` object).
 * Lengths are inches. The prices are EXAMPLE RATES, not real quotes.
 */
const DEFAULTS = {
  // Layout
  orientation: 'U-right',      // 'straight', 'inline', 'L-left', 'L-right', 'U-left', 'U-right'
  treads1: 10,                 // treads in flight 1 (bottom flight)
  treads2: 10,                 // treads in flight 2 (ignored for 'straight')
  treadDepth: 11,              // in, going / run per tread
  riserHeight: 7,              // in, rise per riser
  stairWidth: 44,              // in, out-to-out of the outer stringers
  landingDepth: 48,            // in, measured in flight 1's direction of travel
  wellGap: 4,                  // in, gap between flights (U-stairs only)

  // Stringers
  stringerSection: 'C12x20.7', // a SECTIONS name, or 'Custom'
  stringerCustomLbFt: 20,      // lb/ft, used when stringerSection is 'Custom'
  stringersPerFlight: 2,       // 2 = two outer cranked stringers; 4 = 2 outer + 2 inner
  crankAllowance: 12,          // in, extra length added to EACH stringer for cranks / bearing

  // Landings
  landingCount: 1,             // number of landings to price (all the same size)

  // X landing beams — run ACROSS the stair (across flight 1's direction of travel)
  beamXSection: 'C8x11.2',     // a SECTIONS name, or 'Custom'
  beamXCustomLbFt: 11,         // lb/ft, used when beamXSection is 'Custom'
  beamXCount: 2,               // X beams per landing
  beamXLengthAuto: true,       // true = each X beam is the landing width
  beamXLengthOverride: 44,     // in, X beam length when beamXLengthAuto is false

  // Y landing beams — run ALONG the stair (in flight 1's direction of travel)
  beamYSection: 'C8x11.2',     // a SECTIONS name, or 'Custom'
  beamYCustomLbFt: 11,         // lb/ft, used when beamYSection is 'Custom'
  beamYCount: 2,               // Y beams per landing
  beamYLengthAuto: true,       // true = each Y beam is the landing depth
  beamYLengthOverride: 48,     // in, Y beam length when beamYLengthAuto is false

  // Prices (example rates)
  pricePerTread: 85,           // $ per tread (pan, grating, etc.)
  pricePerLb: 1.6,             // $ per lb of channel steel
  connectionAllowancePct: 15,  // % extra steel weight for clips, plates, angles, bolts, welds
  labourHours: 40,             // total shop hours
  shopRate: 110,               // $ per hour
  markupPct: 10,               // % applied to the subtotal
};

/**
 * Turn any form value into a safe, non-negative number.
 * Empty strings, text, undefined, NaN and Infinity become 0; negatives become 0.
 * (Named "calc..." so it cannot clash with a helper in app.js or plan.js.)
 *
 * @param {*} value  anything read from the form or state
 * @returns {number} a finite number >= 0
 */
function calcNum(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Like calcNum, but rounded to a whole number (for counts such as treads).
 *
 * @param {*} value  anything read from the form or state
 * @returns {number} a whole number >= 0
 */
function calcInt(value) {
  return Math.round(calcNum(value));
}

/**
 * Weight of a channel section.
 *
 * @param {string} name        a SECTIONS name, or 'Custom'
 * @param {number} customLbFt  lb/ft to use when name is 'Custom'
 * @returns {number} weight in lb per foot (0 if the name is not found)
 */
function sectionWeight(name, customLbFt) {
  if (name === 'Custom') return calcNum(customLbFt);
  const row = SECTIONS.find((s) => s.name === name);
  return row ? row.lbft : 0;
}

/**
 * Width of the landing across flight 1's direction of travel. This is also the
 * automatic X landing-beam length, because the X beams run across the landing.
 *
 * @param {object} state  the stair state (uses orientation, stairWidth, wellGap; inches)
 * @returns {number} landing width in inches
 */
function landingWidth(state) {
  const s = state || {};
  const width = calcNum(s.stairWidth);
  if (String(s.orientation).indexOf('U-') === 0) {
    // U-stair: the landing spans both flights side by side plus the well gap between them.
    return 2 * width + calcNum(s.wellGap);
  }
  // Straight, inline and L-stairs: the landing is one flight wide.
  return width;
}

/**
 * Length of ONE landing beam on the given axis.
 *   'x' — X beams run across the stair; auto length = landingWidth(state).
 *   'y' — Y beams run along flight 1's direction of travel; auto length = landingDepth.
 * When that axis's auto switch (beamXLengthAuto / beamYLengthAuto) is off, the typed
 * override (beamXLengthOverride / beamYLengthOverride) is used instead.
 * Any axis other than 'y' (or 'Y') counts as 'x'.
 *
 * @param {object} state  the stair state (inches)
 * @param {string} axis   'x' or 'y'
 * @returns {number} beam length in inches (>= 0)
 */
function landingBeamLength(state, axis) {
  const s = state || {};
  const isY = String(axis).toLowerCase() === 'y';
  const auto = isY ? s.beamYLengthAuto : s.beamXLengthAuto;
  // The switch is on unless it is explicitly false (or the text 'false' from a form).
  if (auto !== false && auto !== 'false') {
    return isY ? calcNum(s.landingDepth) : landingWidth(s);
  }
  return calcNum(isY ? s.beamYLengthOverride : s.beamXLengthOverride);
}

/**
 * Work out the full estimate: geometry, steel weights, costs and warnings.
 * Never throws and never returns NaN; bad or missing inputs count as 0.
 *
 * @param {object} state  the stair state (see DEFAULTS for keys; lengths in inches,
 *                        rates in $, percentages as whole numbers e.g. 15 for 15%)
 * @returns {object} result:
 *   flights[]      { treads, risers, run, rise, stringerLength }  (inches; one stringer)
 *   totalTreads, totalRisers, totalRise (inches)
 *   stringers      { section, lbft, count, lengthFt, weightLb }        (lengthFt = all stringers)
 *   beamsX         { section, lbft, count, eachLengthIn, lengthFt, weightLb }  (X landing beams)
 *   beamsY         { section, lbft, count, eachLengthIn, lengthFt, weightLb }  (Y landing beams)
 *   baseSteelLb, allowanceLb, totalSteelLb  (lb)
 *   costs          { steel, treads, labour, subtotal, markup, total }  ($)
 *   warnings[]     short plain-English strings
 */
function computeEstimate(state) {
  const s = state || {};
  const warnings = [];

  // ---- Inputs, cleaned up ----
  const orientation = String(s.orientation || '');
  const treadDepth = calcNum(s.treadDepth);
  const riserHeight = calcNum(s.riserHeight);
  const stairWidth = calcNum(s.stairWidth);
  const landingDepth = calcNum(s.landingDepth);
  const crankAllowance = calcNum(s.crankAllowance);
  const stringersPerFlight = calcInt(s.stringersPerFlight);

  // A straight stair is one flight to a top landing; every other layout has two flights.
  const flightCount = orientation === 'straight' ? 1 : 2;
  const treadCounts = flightCount === 1 ? [calcInt(s.treads1)] : [calcInt(s.treads1), calcInt(s.treads2)];

  // ---- Geometry, one flight at a time ----
  const flights = treadCounts.map((treads) => {
    // A flight has one more riser than treads: the top riser steps up onto the
    // landing / floor, which is not counted as a tread.
    const risers = treads + 1;
    // Horizontal run = the going of each tread added up.
    const run = treads * treadDepth;
    // Vertical rise = every riser stacked up.
    const rise = risers * riserHeight;
    // A stringer runs along the slope, so its length is the hypotenuse of run and rise,
    // plus an allowance for the cranked (bent) ends and bearing at top and bottom.
    const stringerLength = Math.sqrt(run * run + rise * rise) + crankAllowance;
    return { treads, risers, run, rise, stringerLength };
  });

  // Totals over all flights.
  const totalTreads = flights.reduce((sum, f) => sum + f.treads, 0);
  const totalRisers = flights.reduce((sum, f) => sum + f.risers, 0);
  const totalRise = flights.reduce((sum, f) => sum + f.rise, 0); // floor-to-floor height, inches

  // ---- Stringers ----
  const stringerLbFt = sectionWeight(s.stringerSection, s.stringerCustomLbFt);
  // Every flight gets the same number of stringers.
  const stringerCount = flightCount * stringersPerFlight;
  // Total length of all stringers in feet: each flight's stringer length times how many
  // stringers that flight has, divided by 12 to go from inches to feet.
  const stringerLengthFt = flights.reduce((sum, f) => sum + f.stringerLength * stringersPerFlight, 0) / 12;
  const stringers = {
    section: s.stringerSection,
    lbft: stringerLbFt,
    count: stringerCount,
    lengthFt: stringerLengthFt,
    weightLb: stringerLengthFt * stringerLbFt, // weight = feet x lb/ft
  };

  // ---- Landing beams (X across the stair, Y along it) ----
  const landingCount = calcInt(s.landingCount);
  // One axis at a time. Every landing gets the same beams, so the count is landings x
  // beams per landing. By default an X beam is as long as the landing is wide and a
  // Y beam as long as the landing is deep; the shop can type its own length instead
  // (beamXLengthAuto / beamYLengthAuto = false), see landingBeamLength().
  function landingBeams(section, customLbFt, perLanding, axis) {
    const lbft = sectionWeight(section, customLbFt);
    const count = landingCount * calcInt(perLanding);
    const eachLengthIn = landingBeamLength(s, axis);
    const lengthFt = (count * eachLengthIn) / 12; // all beams on this axis, inches -> feet
    return {
      section,
      lbft,
      count,
      eachLengthIn,
      lengthFt,
      weightLb: lengthFt * lbft, // weight = feet x lb/ft
    };
  }
  const beamsX = landingBeams(s.beamXSection, s.beamXCustomLbFt, s.beamXCount, 'x');
  const beamsY = landingBeams(s.beamYSection, s.beamYCustomLbFt, s.beamYCount, 'y');

  // ---- Steel weight ----
  // Main members only (stringers + X and Y landing beams).
  const baseSteelLb = stringers.weightLb + beamsX.weightLb + beamsY.weightLb;
  // Clips, plates, angles, bolts and welds are not taken off one by one; they are
  // covered by a percentage of the main-member weight.
  const allowanceLb = (baseSteelLb * calcNum(s.connectionAllowancePct)) / 100;
  const totalSteelLb = baseSteelLb + allowanceLb;

  // ---- Costs ----
  const steel = totalSteelLb * calcNum(s.pricePerLb);           // material: steel bought by the lb
  const treadsCost = totalTreads * calcNum(s.pricePerTread);    // material: treads bought by the piece
  const labour = calcNum(s.labourHours) * calcNum(s.shopRate);  // shop hours x hourly rate
  const subtotal = steel + treadsCost + labour;
  const markup = (subtotal * calcNum(s.markupPct)) / 100;       // overhead / profit on top of cost
  const total = subtotal + markup;
  const costs = { steel, treads: treadsCost, labour, subtotal, markup, total };

  // ---- Warnings (gentle checks, not a code review) ----
  // 7 3/4" is a common residential maximum and 7" a common commercial one; 7 7/8" is
  // used here as a "this is steep, look again" flag.
  if (riserHeight > 7.875) {
    warnings.push('Riser height over 7 7/8" — check against the applicable building code.');
  }
  // 10" to 11" is the usual minimum tread depth.
  if (treadDepth < 10) {
    warnings.push('Tread depth under 10" — check against the applicable building code.');
  }
  flights.forEach((f, i) => {
    if (f.treads < 1) warnings.push('Flight ' + (i + 1) + ' has no treads.');
  });
  // On an L-stair flight 2 leaves the side of the landing, so the landing must be at
  // least as deep as the stair is wide or flight 2 will not fit.
  if (orientation.indexOf('L-') === 0 && landingDepth < stairWidth) {
    warnings.push('Landing depth is less than the stair width — flight 2 of an L-stair needs a landing at least as deep as the stair is wide.');
  }
  // A 0 lb/ft section silently drops that steel from the price. Landing beams only
  // matter when that axis actually has beams (count > 0).
  if (stringerLbFt === 0) {
    warnings.push('The stringer section weighs 0 lb/ft — pick a section or enter a custom lb/ft.');
  }
  if (beamsX.count > 0 && beamsX.lbft === 0) {
    warnings.push('The X landing beam section weighs 0 lb/ft — pick a section or enter a custom lb/ft.');
  }
  if (beamsY.count > 0 && beamsY.lbft === 0) {
    warnings.push('The Y landing beam section weighs 0 lb/ft — pick a section or enter a custom lb/ft.');
  }

  return {
    flights,
    totalTreads,
    totalRisers,
    totalRise,
    stringers,
    beamsX,
    beamsY,
    baseSteelLb,
    allowanceLb,
    totalSteelLb,
    costs,
    warnings,
  };
}

/**
 * Format inches as feet-inches, rounded to the nearest 1/8".
 *   42 -> 3'-6"     263.56 -> 21'-11 1/2"     7.375 -> 0'-7 3/8"     -6 -> -0'-6"
 * NaN, Infinity or non-numbers show as 0'-0".
 *
 * @param {number} inches  a length in inches
 * @returns {string} the length as feet-inches text
 */
function fmtFtIn(inches) {
  const n = Number(inches);
  if (!Number.isFinite(n)) return "0'-0\"";
  // Work in whole eighths of an inch so rounding happens once, in one place.
  const eighths = Math.round(Math.abs(n) * 8);
  const sign = n < 0 && eighths > 0 ? '-' : '';
  const feet = Math.floor(eighths / 96);     // 96 eighths in a foot (12 x 8)
  const rest = eighths - feet * 96;          // eighths left over after whole feet
  const wholeIn = Math.floor(rest / 8);
  let num = rest % 8;                        // leftover eighths -> fraction
  let den = 8;
  while (num > 0 && num % 2 === 0) {         // reduce: 4/8 -> 1/2, 2/8 -> 1/4
    num /= 2;
    den /= 2;
  }
  const frac = num > 0 ? ' ' + num + '/' + den : '';
  return sign + feet + "'-" + wholeIn + frac + '"';
}

/**
 * Format a number as dollars with cents and thousands separators.
 *   1234.5 -> "$1,234.50"     -20 -> "-$20.00"     NaN -> "$0.00"
 *
 * @param {number} n  an amount in dollars
 * @returns {string} the amount as money text
 */
function fmtMoney(n) {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  const text = Math.abs(safe).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (safe < 0 && text !== '0.00' ? '-$' : '$') + text;
}

/**
 * Format a number with thousands separators and a fixed number of decimals.
 *   fmtNum(1234.5) -> "1,235"     fmtNum(909.27, 1) -> "909.3"     NaN -> "0"
 *
 * @param {number} n             the number to show
 * @param {number} [decimals=0]  digits after the decimal point
 * @returns {string} the formatted number
 */
function fmtNum(n, decimals = 0) {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  const d = Math.min(20, Math.max(0, Math.round(Number(decimals) || 0)));
  const text = safe.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return text.replace(/^-(?=0(\.0+)?$)/, ''); // never show "-0"
}

if (typeof module !== 'undefined') module.exports = { SECTIONS, DEFAULTS, sectionWeight, landingWidth, landingBeamLength, computeEstimate, fmtFtIn, fmtMoney, fmtNum };
