/*
 * Tests for js/calc.js. Run from the project folder with:
 *   node --test              (or: node --test tests/*.test.js)
 *
 * Note: on Node 22, `node --test tests/` (a bare folder) fails with
 * "Cannot find module .../tests"; give no path, or the file pattern above.
 * Uses only Node's built-in test runner, no packages to install.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SECTIONS, FINISHES, DEFAULTS, normalizeOrientation, sectionWeight, landingWidth, landingBeamLength, computeEstimate,
  fmtFtIn, fmtMoney, fmtNum,
} = require('../js/calc.js');

/**
 * Example rates for the cost tests. DEFAULTS starts every $ rate and the shop hours at
 * 0, so the tests price with these fixed numbers instead.
 */
const RATES = { pricePerTread: 85, pricePerLb: 1.6, shopRate: 100, labourHours: 52 };
const BASE = { ...DEFAULTS, ...RATES };

/** Assert that two numbers are within `tol` of each other. */
function near(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, (msg || '') + ` expected ${expected}, got ${actual}`);
}

/** Walk any value and fail if a number anywhere inside it is NaN or Infinity. */
function assertAllFinite(value, path = 'result') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} is ${value}`);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`);
  }
}

test('hand check from the contract: 19 treads @ 11", 7" riser, 2 x C12x20.7 -> ~909.3 lb', () => {
  const r = computeEstimate({
    ...BASE, orientation: 'straight', treads1: 19, treadDepth: 11, riserHeight: 7,
    stringerSection: 'C12x20.7', stringersPerFlight: 2, crankAllowance: 12,
  });
  assert.equal(r.flights.length, 1);
  assert.equal(r.flights[0].risers, 20);
  near(r.flights[0].run, 209, 1e-9);
  near(r.flights[0].rise, 140, 1e-9);
  near(r.flights[0].stringerLength, 263.56, 0.01);
  near(r.stringers.weightLb, 909.3, 0.5);
});

test('full cost roll-up on DEFAULTS matches a hand calculation', () => {
  const d = BASE;
  const r = computeEstimate(d);

  // Two flights of 10 treads, 11 risers each.
  const run = 10 * 11;                        // 110"
  const rise = 11 * 7;                        // 77"
  const strLen = Math.sqrt(run * run + rise * rise) + 12;
  const stringerFt = (strLen * 2 * 2) / 12;   // 2 flights x 2 stringers
  const stringerLb = stringerFt * 20.7;       // C12x20.7
  const xEach = 2 * 44 + 4;                   // X beams: U landing width = 92"
  const xFt = (1 * 2 * xEach) / 12;           // 1 landing x 2 X beams
  const xLb = xFt * 11.2;                     // C8x11.2
  const yEach = 48;                           // Y beams: landing depth = 48"
  const yFt = (1 * 2 * yEach) / 12;           // 1 landing x 2 Y beams
  const yLb = yFt * 11.2;                     // C8x11.2
  const base = stringerLb + xLb + yLb;
  const allowance = base * 0.15;
  const totalLb = base + allowance;
  const steel = totalLb * 1.6;
  const treads = 20 * 85;
  const labour = 52 * 100;                    // default standard hours x $100/hr
  const subtotal = steel + treads + labour;   // detailing and installation default to 0
  const markup = 0;                           // default markup 0%
  const pst = (steel + treads) * 0.07;        // 7% PST on materials only
  const total = subtotal + markup + pst;

  assert.equal(r.flights.length, 2);
  assert.equal(r.totalTreads, 20);
  assert.equal(r.totalRisers, 22);
  near(r.totalRise, 154, 1e-9);
  assert.equal(r.stringers.count, 4);
  near(r.stringers.lengthFt, stringerFt, 1e-9);
  near(r.stringers.weightLb, stringerLb, 1e-9);
  assert.equal(r.beamsX.count, 2);
  near(r.beamsX.eachLengthIn, 92, 1e-9);
  near(r.beamsX.weightLb, xLb, 1e-9);
  assert.equal(r.beamsY.count, 2);
  near(r.beamsY.eachLengthIn, 48, 1e-9);
  near(r.beamsY.weightLb, yLb, 1e-9);
  near(r.baseSteelLb, base, 1e-9);
  near(r.allowanceLb, allowance, 1e-9);
  near(r.totalSteelLb, totalLb, 1e-9);
  near(r.costs.steel, steel, 0.011);
  near(r.costs.treads, treads, 1e-9);
  near(r.costs.labour, labour, 1e-9);
  assert.equal(r.costs.detailing, 0);
  assert.equal(r.costs.installation, 0);
  near(r.costs.subtotal, subtotal, 0.011);
  near(r.costs.markup, markup, 0.011);
  near(r.costs.pst, pst, 0.011);
  near(r.costs.total, total, 0.011);
  assert.deepEqual(r.warnings, []);
});

test('DEFAULTS: every $ rate and the shop hours start at 0', () => {
  assert.equal(DEFAULTS.orientation, 'U');
  for (const k of ['pricePerTread', 'pricePerLb', 'deckRatePerSqFt', 'finishRatePerFt', 'labourHours',
    'shopRate', 'detailingCost', 'installationCost', 'freightCost', 'markupPct']) {
    assert.equal(DEFAULTS[k], 0, k);
  }
  assert.equal(DEFAULTS.pstPct, 7);
  assert.equal(DEFAULTS.connectionAllowancePct, 15);
  // A first visit prices nothing until the user enters rates.
  assert.equal(computeEstimate(DEFAULTS).costs.total, 0);
  const keys = Object.keys(DEFAULTS);
  assert.deepEqual(keys.slice(keys.indexOf('labourHours')),
    ['labourHours', 'shopRate', 'detailingCost', 'installationCost', 'freightCost', 'markupPct', 'pstPct']);
});

test('standard hours do not change labourHours in computeEstimate (the user value is used)', () => {
  const r = computeEstimate({ ...BASE, treads1: 20, labourHours: 30, shopRate: 100 });
  assert.equal(r.costs.labour, 3000);
});

test('detailing and installation lump sums go into the subtotal before markup', () => {
  const base = computeEstimate({ ...BASE, markupPct: 0 });
  const withLs = computeEstimate({ ...BASE, markupPct: 0, detailingCost: 1200, installationCost: 3500 });
  assert.equal(withLs.costs.detailing, 1200);
  assert.equal(withLs.costs.installation, 3500);
  near(withLs.costs.subtotal - base.costs.subtotal, 4700, 0.011);
  near(withLs.costs.total - base.costs.total, 4700, 0.011);
  near(withLs.costs.subtotal,
    withLs.costs.steel + withLs.costs.treads + withLs.costs.labour + 1200 + 3500, 0.011);

  const base10 = computeEstimate({ ...BASE, markupPct: 10 });
  const withLs10 = computeEstimate({ ...BASE, markupPct: 10, detailingCost: 1200, installationCost: 3500 });
  near(withLs10.costs.subtotal - base10.costs.subtotal, 4700, 0.011);
  near(withLs10.costs.markup - base10.costs.markup, 470, 0.011);
  near(withLs10.costs.total - base10.costs.total, 4700 * 1.1, 0.011);
  // Form text works too.
  const txt = computeEstimate({ ...BASE, detailingCost: '1200', installationCost: '3500' });
  assert.equal(txt.costs.detailing, 1200);
  assert.equal(txt.costs.installation, 3500);
});

test('garbage in the new keys never produces NaN', () => {
  for (const v of ['', 'abc', NaN, Infinity, -500, null, undefined]) {
    const r = computeEstimate({ ...BASE, detailingCost: v, installationCost: v });
    assertAllFinite(r);
    assert.equal(r.costs.detailing, 0, String(v));
    assert.equal(r.costs.installation, 0, String(v));
  }
  for (const st of [{}, undefined, null, { orientation: 'straight', treads1: 'abc', stringersPerFlight: NaN },
    { landingCount: 'x', beamXCount: Infinity, beamYCount: -3, treads2: null }]) {
    assertAllFinite(computeEstimate(st));
  }
});

test("'straight' has 1 flight and ignores treads2; other orientations have 2", () => {
  const r = computeEstimate({ ...BASE, orientation: 'straight', treads1: 12, treads2: 99 });
  assert.equal(r.flights.length, 1);
  assert.equal(r.totalTreads, 12);
  assert.equal(r.stringers.count, 2);
  for (const o of ['inline', 'L', 'U']) {
    assert.equal(computeEstimate({ ...BASE, orientation: o }).flights.length, 2, o);
  }
});

test('landingWidth: U-stairs = 2 x width + gap, others = width', () => {
  assert.equal(landingWidth({ orientation: 'U', stairWidth: 44, wellGap: 4 }), 92);
  assert.equal(landingWidth({ orientation: 'U', stairWidth: 36, wellGap: 6 }), 78);
  assert.equal(landingWidth({ orientation: 'L', stairWidth: 44, wellGap: 4 }), 44);
  assert.equal(landingWidth({ orientation: 'inline', stairWidth: 44, wellGap: 4 }), 44);
  assert.equal(landingWidth({ orientation: 'straight', stairWidth: 44, wellGap: 4 }), 44);
  // No orientation at all counts as the default 'U'.
  assert.equal(landingWidth({ stairWidth: 44, wellGap: 4 }), 92);
});

test('normalizeOrientation: old left/right values, new values, junk', () => {
  // Old saved values map onto the single L / U layouts.
  assert.equal(normalizeOrientation('L-left'), 'L');
  assert.equal(normalizeOrientation('L-right'), 'L');
  assert.equal(normalizeOrientation('U-left'), 'U');
  assert.equal(normalizeOrientation('U-right'), 'U');
  // The four current values pass through.
  for (const o of ['straight', 'inline', 'L', 'U']) assert.equal(normalizeOrientation(o), o);
  // Case and surrounding spaces are ignored.
  assert.equal(normalizeOrientation(' l-RIGHT '), 'L');
  assert.equal(normalizeOrientation('u'), 'U');
  assert.equal(normalizeOrientation('l'), 'L');
  assert.equal(normalizeOrientation('Straight'), 'straight');
  assert.equal(normalizeOrientation(' INLINE\t'), 'inline');
  // Anything unknown falls back to the default 'U'.
  for (const o of [undefined, null, '', '   ', 'junk', 'L-up', 'straightish', 42, NaN, {}, []]) {
    assert.equal(normalizeOrientation(o), 'U', String(o));
  }
  assert.equal(normalizeOrientation(), 'U');
});

test("old orientations give the same numbers as the new ones ('U-left' = 'U', 'L-right' = 'L')", () => {
  for (const [oldO, newO] of [['U-left', 'U'], ['U-right', 'U'], ['L-right', 'L'], ['L-left', 'L']]) {
    for (const extra of [{}, { landingCount: 2, deckRatePerSqFt: 12, finishRatePerFt: 2.5 }, { landingDepth: 30 }]) {
      const st = { ...BASE, ...extra };
      assert.equal(landingWidth({ ...st, orientation: oldO }), landingWidth({ ...st, orientation: newO }), oldO);
      assert.deepEqual(computeEstimate({ ...st, orientation: oldO }), computeEstimate({ ...st, orientation: newO }), oldO);
    }
  }
  // And U really differs from L (so the comparison above is not trivially equal).
  assert.notEqual(landingWidth({ ...BASE, orientation: 'U' }), landingWidth({ ...BASE, orientation: 'L' }));
});

test('sectionWeight: table values and Custom', () => {
  assert.equal(sectionWeight('C12x20.7'), 20.7);
  assert.equal(sectionWeight('MC10x8.4'), 8.4);
  assert.equal(sectionWeight('Custom', 17.5), 17.5);
  assert.equal(sectionWeight('Custom', ''), 0);
  assert.equal(sectionWeight('nope'), 0);
  // Custom lb/ft flows through to the stringer weight.
  const r = computeEstimate({ ...BASE, stringerSection: 'Custom', stringerCustomLbFt: 30 });
  assert.equal(r.stringers.lbft, 30);
  near(r.stringers.weightLb, r.stringers.lengthFt * 30, 1e-9);
});

test('SECTIONS rows are well formed', () => {
  assert.equal(SECTIONS.length, 16);
  for (const s of SECTIONS) {
    assert.equal(typeof s.name, 'string');
    assert.ok(s.lbft > 0 && s.depth > 0, s.name);
    // The lb/ft and depth must match the designation, e.g. C12x20.7 -> 12" deep, 20.7 lb/ft.
    const m = s.name.match(/^M?C(\d+)x([\d.]+)$/);
    assert.ok(m, s.name);
    assert.equal(s.depth, Number(m[1]), s.name);
    assert.equal(s.lbft, Number(m[2]), s.name);
  }
});

test('landing beam hand check: U 44" + 4" gap, 48" deep, 2 X + 2 Y C8x11.2', () => {
  const r = computeEstimate({
    ...BASE, orientation: 'U', stairWidth: 44, wellGap: 4, landingDepth: 48,
    landingCount: 1, beamXCount: 2, beamYCount: 2, beamXSection: 'C8x11.2', beamYSection: 'C8x11.2',
  });
  // X: 2 x 92" = 184" = 15.333 ft x 11.2 = 171.73 lb
  assert.equal(r.beamsX.section, 'C8x11.2');
  assert.equal(r.beamsX.lbft, 11.2);
  assert.equal(r.beamsX.count, 2);
  near(r.beamsX.eachLengthIn, 92, 1e-9);
  near(r.beamsX.lengthFt, 15.333, 0.001);
  near(r.beamsX.weightLb, 171.73, 0.01);
  // Y: 2 x 48" = 96" = 8 ft x 11.2 = 89.6 lb
  assert.equal(r.beamsY.section, 'C8x11.2');
  assert.equal(r.beamsY.lbft, 11.2);
  assert.equal(r.beamsY.count, 2);
  near(r.beamsY.eachLengthIn, 48, 1e-9);
  near(r.beamsY.lengthFt, 8, 1e-9);
  near(r.beamsY.weightLb, 89.6, 1e-9);
  near(r.baseSteelLb, r.stringers.weightLb + r.beamsX.weightLb + r.beamsY.weightLb, 1e-9);
});

test('result has beamsX / beamsY and no old channels key', () => {
  const r = computeEstimate(BASE);
  assert.ok('beamsX' in r && 'beamsY' in r);
  assert.ok(!('channels' in r));
  for (const k of ['landingSection', 'landingCustomLbFt', 'channelsPerLanding', 'channelLengthAuto', 'channelLengthOverride']) {
    assert.ok(!(k in DEFAULTS), k);
  }
});

test('beamYCount 0 -> no Y steel and no Y warning, even with a 0 lb/ft Y section', () => {
  const r = computeEstimate({ ...BASE, beamYCount: 0, beamYSection: 'Custom', beamYCustomLbFt: 0 });
  assert.equal(r.beamsY.count, 0);
  assert.equal(r.beamsY.lengthFt, 0);
  assert.equal(r.beamsY.weightLb, 0);
  assert.ok(!r.warnings.some((w) => w.includes('Y landing beam')));
  near(r.baseSteelLb, r.stringers.weightLb + r.beamsX.weightLb, 1e-9);
});

test('zero lb/ft warning per axis, only when that axis has beams', () => {
  const x0 = computeEstimate({ ...BASE, beamXSection: 'Custom', beamXCustomLbFt: 0 });
  assert.ok(x0.warnings.some((w) => w.includes('X landing beam')));
  assert.ok(!x0.warnings.some((w) => w.includes('Y landing beam')));
  const y0 = computeEstimate({ ...BASE, beamYSection: 'Custom', beamYCustomLbFt: 0 });
  assert.ok(y0.warnings.some((w) => w.includes('Y landing beam')));
  assert.ok(!y0.warnings.some((w) => w.includes('X landing beam')));
  const x0none = computeEstimate({ ...BASE, beamXCount: 0, beamXSection: 'nope' });
  assert.ok(!x0none.warnings.some((w) => w.includes('X landing beam')));
  const s0 = computeEstimate({ ...BASE, stringerSection: 'Custom', stringerCustomLbFt: 0 });
  assert.ok(s0.warnings.some((w) => w.includes('stringer')));
});

test('length override on each axis is used when its auto switch is off', () => {
  const rx = computeEstimate({ ...BASE, beamXLengthAuto: false, beamXLengthOverride: 60 });
  assert.equal(rx.beamsX.eachLengthIn, 60);
  near(rx.beamsX.lengthFt, (2 * 60) / 12, 1e-9);
  near(rx.beamsX.weightLb, 10 * 11.2, 1e-9);
  assert.equal(rx.beamsY.eachLengthIn, 48);          // Y still automatic

  const ry = computeEstimate({ ...BASE, beamYLengthAuto: false, beamYLengthOverride: 30 });
  assert.equal(ry.beamsY.eachLengthIn, 30);
  near(ry.beamsY.lengthFt, (2 * 30) / 12, 1e-9);
  near(ry.beamsY.weightLb, 5 * 11.2, 1e-9);
  assert.equal(ry.beamsX.eachLengthIn, 92);          // X still automatic

  // The text 'false' from a form counts as off too.
  const rs = computeEstimate({ ...BASE, beamYLengthAuto: 'false', beamYLengthOverride: 30 });
  assert.equal(rs.beamsY.eachLengthIn, 30);
});

test('Custom lb/ft on each axis', () => {
  const r = computeEstimate({
    ...BASE, beamXSection: 'Custom', beamXCustomLbFt: 15, beamYSection: 'Custom', beamYCustomLbFt: 9,
  });
  assert.equal(r.beamsX.section, 'Custom');
  assert.equal(r.beamsX.lbft, 15);
  near(r.beamsX.weightLb, ((2 * 92) / 12) * 15, 1e-9);
  assert.equal(r.beamsY.section, 'Custom');
  assert.equal(r.beamsY.lbft, 9);
  near(r.beamsY.weightLb, ((2 * 48) / 12) * 9, 1e-9);
  assert.deepEqual(r.warnings, []);
  // A custom lb/ft is ignored while a table section is picked.
  const t = computeEstimate({ ...BASE, beamXCustomLbFt: 99, beamYCustomLbFt: 99 });
  assert.equal(t.beamsX.lbft, 11.2);
  assert.equal(t.beamsY.lbft, 11.2);
});

test('landingCount 2 doubles both beam counts and weights', () => {
  const one = computeEstimate({ ...BASE, landingCount: 1, beamXCount: 2, beamYCount: 3 });
  const two = computeEstimate({ ...BASE, landingCount: 2, beamXCount: 2, beamYCount: 3 });
  assert.equal(one.beamsX.count, 2);
  assert.equal(one.beamsY.count, 3);
  assert.equal(two.beamsX.count, 4);
  assert.equal(two.beamsY.count, 6);
  near(two.beamsX.weightLb, 2 * one.beamsX.weightLb, 1e-9);
  near(two.beamsY.weightLb, 2 * one.beamsY.weightLb, 1e-9);
  assert.equal(two.beamsX.eachLengthIn, one.beamsX.eachLengthIn);
  assert.equal(two.beamsY.eachLengthIn, one.beamsY.eachLengthIn);
});

test('landingCount is clamped to 1 or 2 (straight: always 1)', () => {
  const est = (st) => computeEstimate({ ...BASE, beamXCount: 2, beamYCount: 3, ...st });
  // Through computeEstimate: beams = landings x beams per landing.
  assert.equal(est({ landingCount: 0 }).beamsX.count, 2);             // 0 -> 1
  assert.equal(est({ landingCount: 5 }).beamsX.count, 4);             // 5 -> 2
  assert.equal(est({ landingCount: 5 }).beamsY.count, 6);
  assert.equal(est({ landingCount: 'abc' }).beamsX.count, 2);         // 'abc' -> 1
  assert.equal(est({ orientation: 'straight', landingCount: 2 }).beamsX.count, 2); // straight -> 1
  assert.equal(est({ orientation: 'L', landingCount: 2 }).beamsX.count, 4);        // L keeps 2
  assert.equal(est({ landingCount: '2' }).beamsY.count, 6);           // form text '2' -> 2
});

test('landingBeamLength: x and y, auto and override', () => {
  const st = { ...BASE, orientation: 'U', stairWidth: 44, wellGap: 4, landingDepth: 48 };
  assert.equal(landingBeamLength(st, 'x'), 92);                // auto X = landingWidth
  assert.equal(landingBeamLength(st, 'y'), 48);                // auto Y = landingDepth
  assert.equal(landingBeamLength({ ...st, orientation: 'L' }, 'x'), 44);
  assert.equal(landingBeamLength({ ...st, beamXLengthAuto: false, beamXLengthOverride: 50 }, 'x'), 50);
  assert.equal(landingBeamLength({ ...st, beamYLengthAuto: false, beamYLengthOverride: 40 }, 'y'), 40);
  // One axis's override does not touch the other.
  assert.equal(landingBeamLength({ ...st, beamXLengthAuto: false, beamXLengthOverride: 50 }, 'y'), 48);
  // Anything but 'y' is treated as 'x'; 'Y' works too.
  assert.equal(landingBeamLength(st, 'Y'), 48);
  assert.equal(landingBeamLength(st, undefined), 92);
  assert.equal(landingBeamLength(st, 'z'), 92);
  // Garbage never gives NaN.
  assert.equal(landingBeamLength(undefined, 'y'), 0);
  assert.equal(landingBeamLength({ beamYLengthAuto: false, beamYLengthOverride: 'abc' }, 'y'), 0);
  assert.equal(landingBeamLength({ beamXLengthAuto: false, beamXLengthOverride: -5 }, 'x'), 0);
});

test('warnings', () => {
  const steep = computeEstimate({ ...BASE, riserHeight: 8, treadDepth: 9 });
  assert.ok(steep.warnings.some((w) => w.startsWith('Riser height over')));
  assert.ok(steep.warnings.some((w) => w.startsWith('Tread depth under')));
  const empty = computeEstimate({ ...BASE, treads1: 0 });
  assert.ok(empty.warnings.includes('Flight 1 has no treads.'));
  const shortL = computeEstimate({ ...BASE, orientation: 'L', landingDepth: 36, stairWidth: 44 });
  assert.ok(shortL.warnings.some((w) => w.startsWith('Landing depth')));
  const shortU = computeEstimate({ ...BASE, orientation: 'U', landingDepth: 36, stairWidth: 44 });
  assert.ok(!shortU.warnings.some((w) => w.startsWith('Landing depth')));
  // An old saved 'L-left' still gets the L-stair landing-depth check.
  const shortOldL = computeEstimate({ ...BASE, orientation: 'L-left', landingDepth: 36, stairWidth: 44 });
  assert.ok(shortOldL.warnings.some((w) => w.startsWith('Landing depth')));
});

test('garbage input never produces NaN', () => {
  const garbage = {};
  for (const k of Object.keys(DEFAULTS)) garbage[k] = '';
  const r1 = computeEstimate(garbage);
  assertAllFinite(r1);
  assert.equal(r1.flights.length, 2); // '' normalises to the default 'U'
  assert.equal(r1.costs.total, 0);

  assertAllFinite(computeEstimate({}));
  assertAllFinite(computeEstimate(undefined));
  assertAllFinite(computeEstimate({ ...BASE, treads1: 'abc', riserHeight: NaN, stairWidth: Infinity, markupPct: null }));
  assertAllFinite(computeEstimate({
    ...BASE, landingDepth: 'x', beamXCount: 'two', beamYCount: NaN, beamXCustomLbFt: null,
    beamXSection: 'Custom', beamYSection: undefined, beamXLengthAuto: false, beamXLengthOverride: 'abc',
    beamYLengthAuto: 'false', beamYLengthOverride: Infinity,
  }));
  // The garbage state above (every key '') has no landing steel at all.
  assert.equal(r1.beamsX.weightLb, 0);
  assert.equal(r1.beamsY.weightLb, 0);

  // Negatives clamp to 0, fractional tread counts round to whole treads.
  const r2 = computeEstimate({ ...BASE, orientation: 'straight', treads1: -5, labourHours: -10 });
  assert.equal(r2.totalTreads, 0);
  assert.equal(r2.costs.labour, 0);
  const r3 = computeEstimate({ ...BASE, orientation: 'straight', treads1: '9.6' });
  assert.equal(r3.totalTreads, 10);
  assert.equal(r3.flights[0].risers, 11);
});

test('fmtFtIn', () => {
  assert.equal(fmtFtIn(42), '3\'-6"');
  assert.equal(fmtFtIn(263.56), '21\'-11 1/2"');
  assert.equal(fmtFtIn(7.375), '0\'-7 3/8"');
  assert.equal(fmtFtIn(0), '0\'-0"');
  assert.equal(fmtFtIn(12), '1\'-0"');
  assert.equal(fmtFtIn(11.99), '1\'-0"');      // rounds up to the next foot
  assert.equal(fmtFtIn(0.25), '0\'-0 1/4"');
  assert.equal(fmtFtIn(-6), '-0\'-6"');
  assert.equal(fmtFtIn(-0.01), '0\'-0"');      // rounds to zero, no "-0"
  assert.equal(fmtFtIn(NaN), '0\'-0"');
  assert.equal(fmtFtIn(undefined), '0\'-0"');
  assert.equal(fmtFtIn('42'), '3\'-6"');
});

test('fmtMoney and fmtNum', () => {
  assert.equal(fmtMoney(1234.5), '$1,234.50');
  assert.equal(fmtMoney(0), '$0.00');
  assert.equal(fmtMoney(-20), '-$20.00');
  assert.equal(fmtMoney(NaN), '$0.00');
  assert.equal(fmtNum(1234.5), '1,235');
  assert.equal(fmtNum(909.27, 1), '909.3');
  assert.equal(fmtNum(NaN), '0');
  assert.equal(fmtNum(-0.2), '0');
});

test('money lines are rounded to the cent and add up exactly', () => {
  const r = computeEstimate({ ...BASE, deckRatePerSqFt: 12.37, finishRatePerFt: 2.33, freightCost: 450.5, markupPct: 7.5 });
  const c = r.costs;
  for (const k of Object.keys(c)) assert.equal(Math.round(c[k] * 100) / 100, c[k], k + ' is whole cents');
  assert.equal(Math.round((c.steel + c.treads + c.deck + c.finish + c.labour + c.detailing + c.installation + c.freight) * 100), Math.round(c.subtotal * 100));
  assert.equal(Math.round((c.subtotal + c.markup + c.pst) * 100), Math.round(c.total * 100));
});

test('PST: charged on materials only (steel + treads), after markup', () => {
  const r = computeEstimate({ ...BASE, markupPct: 10, detailingCost: 1200, installationCost: 3500 });
  near(r.costs.pst, (r.costs.steel + r.costs.treads) * 0.07, 0.011);
  near(r.costs.total, r.costs.subtotal + r.costs.markup + r.costs.pst, 0.011);
  // Labour, detailing, installation and markup do not change the PST.
  const more = computeEstimate({ ...BASE, markupPct: 25, labourHours: 200, detailingCost: 9999, installationCost: 5000 });
  near(more.costs.pst, r.costs.pst, 0.011);
  // 0% and garbage give no tax and no NaN.
  assert.equal(computeEstimate({ ...BASE, pstPct: 0 }).costs.pst, 0);
  assert.equal(computeEstimate({ ...BASE, pstPct: 'abc' }).costs.pst, 0);
});

test('finish: $/ft over stringers + landing beams only (treads excluded)', () => {
  assert.ok(FINISHES.some((f) => f.name === 'SP3/Standard Primer'));
  assert.equal(DEFAULTS.finishType, 'SP3/Standard Primer');
  assert.equal(DEFAULTS.finishRatePerFt, 0);

  const zero = computeEstimate(BASE);
  assert.equal(zero.costs.finish, 0);                 // default rate 0 -> no cost

  const r = computeEstimate({ ...BASE, finishRatePerFt: 2.5 });
  const ft = r.stringers.lengthFt + r.beamsX.lengthFt + r.beamsY.lengthFt;
  near(r.finish.lengthFt, ft, 1e-9);
  near(r.finish.lengthFt, 72.09, 0.01);               // ~48.76 + 15.33 + 8.0 on the default stair
  assert.equal(r.finish.treadFt, undefined);          // treads no longer counted
  near(r.costs.finish, ft * 2.5, 0.006);
  assert.equal(r.finish.type, 'SP3/Standard Primer');
  // In the subtotal, not taxed.
  near(r.costs.subtotal - zero.costs.subtotal, r.costs.finish, 0.011);
  assert.equal(r.costs.pst, zero.costs.pst);
  // More treads do not change the finish footage.
  const more = computeEstimate({ ...BASE, finishRatePerFt: 2.5, treads1: 15 });
  near(more.finish.lengthFt - more.stringers.lengthFt, r.finish.lengthFt - r.stringers.lengthFt, 1e-9);
  // Garbage rate -> 0, no NaN.
  assert.equal(computeEstimate({ ...BASE, finishRatePerFt: 'x' }).costs.finish, 0);
});

test('landing deck: $/sq.ft over every landing, taxed with materials', () => {
  assert.equal(DEFAULTS.deckRatePerSqFt, 0);
  const zero = computeEstimate(BASE);
  near(zero.deck.sqFt, (92 * 48) / 144, 1e-9);        // U: 2 x 44 + 4 wide, 48 deep = 30.67 sq.ft
  assert.equal(zero.costs.deck, 0);

  const r = computeEstimate({ ...BASE, deckRatePerSqFt: 12 });
  near(r.costs.deck, 368, 0.006);                      // 30.667 x $12
  near(r.costs.subtotal - zero.costs.subtotal, 368, 0.011);
  near(r.costs.pst - zero.costs.pst, 368 * 0.07, 0.011);  // deck is a material: PST applies

  const L = computeEstimate({ ...BASE, orientation: 'L', deckRatePerSqFt: 1 });
  near(L.deck.sqFt, (44 * 48) / 144, 1e-9);
  const two = computeEstimate({ ...BASE, landingCount: 2 });
  near(two.deck.sqFt, 2 * zero.deck.sqFt, 1e-9);
  // landingCount 0 is clamped up to 1, so it prices the 1-landing deck (368), not 0.
  near(computeEstimate({ ...BASE, landingCount: 0, deckRatePerSqFt: 12 }).costs.deck, 368, 0.006);
  assert.equal(computeEstimate({ ...BASE, deckRatePerSqFt: 'x' }).costs.deck, 0);
});

test('freight: lump sum in the subtotal, not taxed', () => {
  assert.equal(DEFAULTS.freightCost, 0);
  const zero = computeEstimate(BASE);
  const r = computeEstimate({ ...BASE, freightCost: 500 });
  assert.equal(r.costs.freight, 500);
  near(r.costs.total - zero.costs.total, 500, 0.011);
  assert.equal(r.costs.pst, zero.costs.pst);
  assert.equal(computeEstimate({ ...BASE, freightCost: '' }).costs.freight, 0);
});
