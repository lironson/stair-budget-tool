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
  SECTIONS, DEFAULTS, sectionWeight, landingWidth, computeEstimate, fmtFtIn, fmtMoney, fmtNum,
} = require('../js/calc.js');

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
    ...DEFAULTS, orientation: 'straight', treads1: 19, treadDepth: 11, riserHeight: 7,
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
  const d = DEFAULTS;
  const r = computeEstimate(d);

  // Two flights of 10 treads, 11 risers each.
  const run = 10 * 11;                        // 110"
  const rise = 11 * 7;                        // 77"
  const strLen = Math.sqrt(run * run + rise * rise) + 12;
  const stringerFt = (strLen * 2 * 2) / 12;   // 2 flights x 2 stringers
  const stringerLb = stringerFt * 20.7;       // C12x20.7
  const chanEach = 2 * 44 + 4;                // U-right landing width = 92"
  const chanFt = (1 * 2 * chanEach) / 12;     // 1 landing x 2 channels
  const chanLb = chanFt * 11.2;               // C8x11.2
  const base = stringerLb + chanLb;
  const allowance = base * 0.15;
  const totalLb = base + allowance;
  const steel = totalLb * 1.6;
  const treads = 20 * 85;
  const labour = 40 * 110;
  const subtotal = steel + treads + labour;
  const markup = subtotal * 0.10;
  const total = subtotal + markup;

  assert.equal(r.flights.length, 2);
  assert.equal(r.totalTreads, 20);
  assert.equal(r.totalRisers, 22);
  near(r.totalRise, 154, 1e-9);
  assert.equal(r.stringers.count, 4);
  near(r.stringers.lengthFt, stringerFt, 1e-9);
  near(r.stringers.weightLb, stringerLb, 1e-9);
  assert.equal(r.channels.count, 2);
  near(r.channels.eachLengthIn, 92, 1e-9);
  near(r.channels.weightLb, chanLb, 1e-9);
  near(r.baseSteelLb, base, 1e-9);
  near(r.allowanceLb, allowance, 1e-9);
  near(r.totalSteelLb, totalLb, 1e-9);
  near(r.costs.steel, steel, 1e-6);
  near(r.costs.treads, treads, 1e-9);
  near(r.costs.labour, labour, 1e-9);
  near(r.costs.subtotal, subtotal, 1e-6);
  near(r.costs.markup, markup, 1e-6);
  near(r.costs.total, total, 1e-6);
  assert.deepEqual(r.warnings, []);
});

test("'straight' has 1 flight and ignores treads2; other orientations have 2", () => {
  const r = computeEstimate({ ...DEFAULTS, orientation: 'straight', treads1: 12, treads2: 99 });
  assert.equal(r.flights.length, 1);
  assert.equal(r.totalTreads, 12);
  assert.equal(r.stringers.count, 2);
  for (const o of ['inline', 'L-left', 'L-right', 'U-left', 'U-right']) {
    assert.equal(computeEstimate({ ...DEFAULTS, orientation: o }).flights.length, 2, o);
  }
});

test('landingWidth: U-stairs = 2 x width + gap, others = width', () => {
  assert.equal(landingWidth({ orientation: 'U-left', stairWidth: 44, wellGap: 4 }), 92);
  assert.equal(landingWidth({ orientation: 'U-right', stairWidth: 36, wellGap: 6 }), 78);
  assert.equal(landingWidth({ orientation: 'L-left', stairWidth: 44, wellGap: 4 }), 44);
  assert.equal(landingWidth({ orientation: 'straight', stairWidth: 44, wellGap: 4 }), 44);
});

test('sectionWeight: table values and Custom', () => {
  assert.equal(sectionWeight('C12x20.7'), 20.7);
  assert.equal(sectionWeight('MC10x8.4'), 8.4);
  assert.equal(sectionWeight('Custom', 17.5), 17.5);
  assert.equal(sectionWeight('Custom', ''), 0);
  assert.equal(sectionWeight('nope'), 0);
  // Custom lb/ft flows through to the stringer weight.
  const r = computeEstimate({ ...DEFAULTS, stringerSection: 'Custom', stringerCustomLbFt: 30 });
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

test('channel length override is used when channelLengthAuto is false', () => {
  const r = computeEstimate({ ...DEFAULTS, channelLengthAuto: false, channelLengthOverride: 60 });
  assert.equal(r.channels.eachLengthIn, 60);
  near(r.channels.lengthFt, (2 * 60) / 12, 1e-9);
  near(r.channels.weightLb, 10 * 11.2, 1e-9);
});

test('warnings', () => {
  const steep = computeEstimate({ ...DEFAULTS, riserHeight: 8, treadDepth: 9 });
  assert.ok(steep.warnings.some((w) => w.startsWith('Riser height over')));
  assert.ok(steep.warnings.some((w) => w.startsWith('Tread depth under')));
  const empty = computeEstimate({ ...DEFAULTS, treads1: 0 });
  assert.ok(empty.warnings.includes('Flight 1 has no treads.'));
  const shortL = computeEstimate({ ...DEFAULTS, orientation: 'L-right', landingDepth: 36, stairWidth: 44 });
  assert.ok(shortL.warnings.some((w) => w.startsWith('Landing depth')));
  const shortU = computeEstimate({ ...DEFAULTS, orientation: 'U-right', landingDepth: 36, stairWidth: 44 });
  assert.ok(!shortU.warnings.some((w) => w.startsWith('Landing depth')));
});

test('garbage input never produces NaN', () => {
  const garbage = {};
  for (const k of Object.keys(DEFAULTS)) garbage[k] = '';
  const r1 = computeEstimate(garbage);
  assertAllFinite(r1);
  assert.equal(r1.flights.length, 2); // '' is not 'straight'
  assert.equal(r1.costs.total, 0);

  assertAllFinite(computeEstimate({}));
  assertAllFinite(computeEstimate(undefined));
  assertAllFinite(computeEstimate({ ...DEFAULTS, treads1: 'abc', riserHeight: NaN, stairWidth: Infinity, markupPct: null }));

  // Negatives clamp to 0, fractional tread counts round to whole treads.
  const r2 = computeEstimate({ ...DEFAULTS, orientation: 'straight', treads1: -5, labourHours: -10 });
  assert.equal(r2.totalTreads, 0);
  assert.equal(r2.costs.labour, 0);
  const r3 = computeEstimate({ ...DEFAULTS, orientation: 'straight', treads1: '9.6' });
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
