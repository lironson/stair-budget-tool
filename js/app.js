/*
 * app.js — wires the page together (Stair Budget Tool)
 * ========================================================
 *
 * WHAT THIS FILE DOES
 *   1. Fills the three channel-section dropdowns (stringers, X landing beams,
 *      Y landing beams) from SECTIONS (+ "Custom…").
 *   2. Loads the last-used values from localStorage (key 'stairBudgetTool.v1';
 *      falls back to the pre-rename key 'stairEstimator.v1'),
 *      merged over DEFAULTS, and writes them into the form. Saves made before the
 *      landings had X and Y beams (keys landingSection, channelsPerLanding, …) are
 *      migrated onto the X beam keys (see LEGACY_KEYS). Saves made before schema 2
 *      drop the old example labour / markup values (see OLD_DEFAULTS).
 *   3. On every keystroke / change: reads the form into a `state` object, shows or
 *      hides the optional fields, runs computeEstimate(state), fills the estimate
 *      table, redraws the plan with renderPlan(svg, state), refreshes the one-line
 *      summaries of the collapsible input sections and saves the state.
 *   4. Remembers which input sections (<details class="section">) each viewer has
 *      open or closed (localStorage key 'stairBudgetTool.sections').
 *   5. Handles the Print, Reset and Dark mode controls.
 *
 * HOW IT CONNECTS TO THE OTHER FILES
 *   index.html loads js/calc.js, then js/plan.js, then this file (classic scripts).
 *   From calc.js it uses: DEFAULTS, SECTIONS, computeEstimate, landingBeamLength
 *                         (falls back to landingWidth / landingDepth if missing),
 *                         fmtFtIn, fmtMoney, fmtNum.
 *   From plan.js it uses: renderPlan.
 *   Everything in this file sits inside one wrapper function (an "IIFE") so its
 *   helper names can never clash with names in calc.js or plan.js.
 *   The state keys and the result shape are described in docs/ARCHITECTURE.md.
 *
 * HOW TO EDIT
 *   - Add an input: put an element in index.html whose id is the new state key
 *     (with a <label for>), and add the key with its default value to DEFAULTS in
 *     js/calc.js. readState()/writeState() go through every DEFAULTS key, so the
 *     new input is read, typed (number / checkbox / text) and saved automatically.
 *     If it must be a whole number, add its key to INT_KEYS below.
 *   - Add a cost line: compute it in computeEstimate() (calc.js), then add a row in
 *     renderResults() below — copy the "Treads" row (or the "Detailing" row for a
 *     lump sum with only a Cost value).
 *   - Show/hide a field depending on other inputs: give its wrapper an id and add
 *     a line in updateVisibility().
 *   - Landing beams come in two directions, X (across the stair) and Y (along it).
 *     Code that handles both loops over BEAM_AXES below; to add a per-axis input,
 *     add beamX…/beamY… keys to DEFAULTS and matching ids in index.html.
 *   - Rename a state key: add old -> new to LEGACY_KEYS so saved values carry over.
 *   - Change a default that old saves may still hold: saves are written as
 *     { ...state, schema: SAVE_SCHEMA }. Bump SAVE_SCHEMA and list the old values in
 *     OLD_DEFAULTS; loadState() drops them from older saves so the new default applies.
 *   - Change the saved-data key: STORAGE_KEY below (changing it forgets old saves).
 *   - Add an input section: add a <details class="section" id="sec-NAME"> with a
 *     <span class="section-sum" id="sum-NAME"> in index.html (copy one), then add
 *     NAME: function (state) { return '…'; } to SECTION_SUMMARIES below. That text
 *     shows in the heading while the section is collapsed. Keep it short, values only.
 *   - Section open/closed state: initSections() restores it from SECTIONS_KEY and
 *     saves it on every `toggle` event, as { 'sec-NAME': true|false }. New sections
 *     need no extra code; with nothing saved every section starts open.
 */

(function () {
  'use strict';

  /** localStorage key for the saved form values. */
  const STORAGE_KEY = 'stairBudgetTool.v1';
  /**
   * Key used before the app was renamed (Steel Stair Estimator -> Stair Budget
   * Tool). Read only when nothing is saved under STORAGE_KEY yet, so returning
   * users keep their settings; new saves always go to STORAGE_KEY.
   */
  const OLD_STORAGE_KEY = 'stairEstimator.v1';

  /**
   * Version written with every save ({ ...state, schema: SAVE_SCHEMA }). Saves
   * without it are older and get OLD_DEFAULTS dropped on load.
   */
  const SAVE_SCHEMA = 2;

  /**
   * Example values from before schema 2. A save without `schema: 2` that still holds
   * exactly one of these was never changed by the user, so it is dropped on load and
   * the current DEFAULTS value is used instead. Values the user changed are kept.
   */
  const OLD_DEFAULTS = { labourHours: 40, shopRate: 110, markupPct: 10 };

  /** localStorage key for which input sections are open: { 'sec-NAME': bool }. */
  const SECTIONS_KEY = 'stairBudgetTool.sections';
  /** Pre-rename key for the open/closed sections, read as a fallback. */
  const OLD_SECTIONS_KEY = 'stairEstimator.sections';

  /** localStorage key for the theme; shared with the Steel Size Rolodex app. */
  const THEME_KEY = 'theme';

  /** State keys that are whole numbers (counts). Everything else numeric is a decimal. */
  const INT_KEYS = ['treads1', 'treads2', 'landingCount', 'beamXCount', 'beamYCount', 'stringersPerFlight'];

  /**
   * The two landing-beam directions: `key` is the id / state-key prefix, `axis`
   * the name passed to landingBeamLength().
   *   X = across flight 1's travel (the old "landing channels")
   *   Y = along flight 1's travel (landing edges, the U-stair well)
   */
  const BEAM_AXES = [
    { axis: 'x', key: 'beamX' },
    { axis: 'y', key: 'beamY' },
  ];

  /**
   * Old saved keys (v1, single set of landing "channels") -> current keys.
   * Applied on load only when the new key isn't saved yet; see loadState().
   */
  const LEGACY_KEYS = {
    landingSection: 'beamXSection',
    landingCustomLbFt: 'beamXCustomLbFt',
    channelsPerLanding: 'beamXCount',
    channelLengthAuto: 'beamXLengthAuto',
    channelLengthOverride: 'beamXLengthOverride',
  };

  /** Value of the extra "Custom…" option at the end of each section dropdown. */
  const CUSTOM = 'Custom';

  /* ---------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------- */

  /**
   * Shorthand for document.getElementById.
   * @param {string} id  element id
   * @returns {HTMLElement|null}
   */
  function $(id) {
    return document.getElementById(id);
  }

  /**
   * Show a number with only the decimals it needs (up to `max`), via fmtNum.
   *   40 -> "40"    37.5 -> "37.5"    1.625 -> "1.63"
   * @param {number} n        the number
   * @param {number} [max=2]  most decimals to show
   * @returns {string}
   */
  function fmtQty(n, max) {
    const limit = max === undefined ? 2 : max;
    const v = Number(n) || 0;
    let d = 0;
    while (d < limit && Math.abs(Math.round(v * Math.pow(10, d)) - v * Math.pow(10, d)) > 1e-9) d++;
    return fmtNum(v, d);
  }

  /**
   * Read a JSON value from localStorage. Never throws (private mode, blocked storage…).
   * @param {string} key  storage key
   * @returns {*} the parsed value, or null
   */
  function storageGet(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Write a JSON value to localStorage. Never throws.
   * @param {string} key    storage key
   * @param {*}      value  anything JSON can store
   */
  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* storage unavailable: the page still works, it just won't remember */
    }
  }

  /* ---------------------------------------------------------------------
     Form <-> state
     --------------------------------------------------------------------- */

  /**
   * Fill the stringer, X beam and Y beam section dropdowns from SECTIONS
   * (calc.js), each followed by a final "Custom…" option.
   */
  function fillSectionSelects() {
    // Finishes: plain names from FINISHES (calc.js); no "Custom…" option.
    const finish = $('finishType');
    if (finish && typeof FINISHES !== 'undefined') {
      finish.textContent = '';
      FINISHES.forEach(function (f) {
        const opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = f.name;
        finish.appendChild(opt);
      });
    }
    ['stringerSection', 'beamXSection', 'beamYSection'].forEach(function (id) {
      const select = $(id);
      if (!select) return;
      select.textContent = '';
      SECTIONS.forEach(function (s) {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name + ' (' + fmtQty(s.lbft) + ' lb/ft)';
        select.appendChild(opt);
      });
      const custom = document.createElement('option');
      custom.value = CUSTOM;
      custom.textContent = 'Custom…';
      select.appendChild(custom);
    });
  }

  /**
   * Read every input whose id is a DEFAULTS key into a state object, with types:
   * checkboxes -> boolean, numbers -> parseFloat (fallback to DEFAULTS, never
   * negative; INT_KEYS rounded), selects/text -> string (stringersPerFlight -> int).
   * @returns {object} state (lengths in inches; see docs/ARCHITECTURE.md §1)
   */
  function readState() {
    const state = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      const el = $(key);
      const def = DEFAULTS[key];
      if (!el) {
        state[key] = def;
      } else if (typeof def === 'boolean') {
        state[key] = !!el.checked;
      } else if (typeof def === 'number') {
        let n = parseFloat(el.value);
        if (!Number.isFinite(n)) n = def;
        n = Math.max(0, n);
        if (INT_KEYS.indexOf(key) !== -1) n = Math.round(n);
        state[key] = n;
      } else {
        state[key] = String(el.value);
      }
    });
    return state;
  }

  /**
   * Write a state object into the form. A select that has no option for the given
   * value falls back to the DEFAULTS value.
   * @param {object} state  values keyed like DEFAULTS
   */
  function writeState(state) {
    Object.keys(DEFAULTS).forEach(function (key) {
      const el = $(key);
      if (!el) return;
      const value = key in state ? state[key] : DEFAULTS[key];
      if (el.type === 'checkbox') {
        el.checked = !!value;
      } else {
        el.value = String(value);
        if (el.tagName === 'SELECT' && el.value !== String(value)) el.value = String(DEFAULTS[key]);
      }
    });
  }

  /**
   * Copy values saved under old key names (LEGACY_KEYS) onto the current names,
   * unless the current name is already saved. Returns a new object; the old keys
   * are dropped.
   *   { channelsPerLanding: 3 } -> { beamXCount: 3 }
   * @param {object} saved  parsed localStorage value
   * @returns {{state: object, migrated: boolean}}
   */
  function migrateSaved(saved) {
    const out = Object.assign({}, saved);
    let migrated = false;
    Object.keys(LEGACY_KEYS).forEach(function (oldKey) {
      if (!(oldKey in out)) return;
      const newKey = LEGACY_KEYS[oldKey];
      if (!(newKey in out)) out[newKey] = out[oldKey];
      delete out[oldKey];
      migrated = true;
    });
    return { state: out, migrated: migrated };
  }

  /**
   * Drop the old example values (OLD_DEFAULTS) from a save made before schema 2,
   * so the current defaults apply. Values the user changed are kept.
   *   { labourHours: 40, shopRate: 125 }  ->  { shopRate: 125 }
   * Saves that already have `schema: SAVE_SCHEMA` are returned unchanged.
   * @param {object} saved  parsed localStorage value (may be changed in place)
   * @returns {boolean} true when the save was older than SAVE_SCHEMA
   */
  function dropOldDefaults(saved) {
    if (saved.schema === SAVE_SCHEMA) return false;
    Object.keys(OLD_DEFAULTS).forEach(function (key) {
      if (saved[key] === OLD_DEFAULTS[key]) delete saved[key];
    });
    return true;
  }

  /**
   * Save the state as { ...state, schema: SAVE_SCHEMA }. `schema` lives only in
   * storage: loadState() keeps DEFAULTS keys only, so it never reaches the form
   * or computeEstimate().
   * @param {object} state  current state
   */
  function saveState(state) {
    storageSet(STORAGE_KEY, Object.assign({}, state, { schema: SAVE_SCHEMA }));
  }

  /**
   * Load the saved state (migrating old key names and old example defaults) and
   * merge it over DEFAULTS. Only known keys with the same type as the default are
   * kept, so an old or damaged save can't break the page. A migrated save is
   * written straight back in the new format (same STORAGE_KEY, schema 2).
   * @returns {object} a complete state object (DEFAULTS keys only)
   */
  function loadState() {
    const raw = storageGet(STORAGE_KEY) || storageGet(OLD_STORAGE_KEY);
    const state = Object.assign({}, DEFAULTS);
    if (raw && typeof raw === 'object') {
      const m = migrateSaved(raw);
      const older = dropOldDefaults(m.state);
      Object.keys(DEFAULTS).forEach(function (key) {
        if (key in m.state && typeof m.state[key] === typeof DEFAULTS[key]) state[key] = m.state[key];
      });
      if (m.migrated || older) saveState(state);
    }
    return state;
  }

  /* ---------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------- */

  /**
   * The automatic length of one landing beam on an axis, ignoring the override:
   * X = landing width (landingWidth), Y = landing depth. Uses calc.js's
   * landingBeamLength() when it exists, so the page and the estimate agree.
   * @param {object} state  current state
   * @param {'x'|'y'} axis  beam direction
   * @returns {number} inches
   */
  function autoBeamLength(state, axis) {
    if (typeof landingBeamLength === 'function') {
      const forced = Object.assign({}, state, axis === 'x' ? { beamXLengthAuto: true } : { beamYLengthAuto: true });
      return landingBeamLength(forced, axis);
    }
    return axis === 'x' ? landingWidth(state) : state.landingDepth;
  }

  /**
   * Show/hide the optional fields (el.hidden) for the current state, and show the
   * automatic beam length next to each "Match landing width/depth" switch.
   * @param {object} state  current state
   */
  function updateVisibility(state) {
    const isU = state.orientation.indexOf('U-') === 0;
    const toggles = {
      'field-treads2': state.orientation !== 'straight',
      'field-wellGap': isU,
      'field-stringerCustomLbFt': state.stringerSection === CUSTOM,
    };
    BEAM_AXES.forEach(function (b) {
      toggles['field-' + b.key + 'CustomLbFt'] = state[b.key + 'Section'] === CUSTOM;
      toggles['field-' + b.key + 'LengthOverride'] = !state[b.key + 'LengthAuto'];
    });
    Object.keys(toggles).forEach(function (id) {
      const el = $(id);
      if (el) el.hidden = !toggles[id];
    });

    BEAM_AXES.forEach(function (b) {
      const out = $(b.key + 'LengthAutoValue');
      if (out) out.textContent = '(' + fmtFtIn(autoBeamLength(state, b.axis)) + ')';
    });

    // Landing deck area (one landing x landingCount), shown under the Deck rate.
    const deckOut = $('deckAreaValue');
    if (deckOut && typeof landingWidth === 'function') {
      const sqFt = (state.landingCount * landingWidth(state) * state.landingDepth) / 144;
      deckOut.textContent = fmtNum(sqFt, 1) + ' sq.ft';
    }
  }

  /**
   * Build one <tr> for the breakdown table.
   * @param {object} row
   * @param {string} row.name          item name (first column)
   * @param {string} [row.detail]      small grey line under the name
   * @param {string} [row.qty]         Qty column text
   * @param {string} [row.length]      Length column text
   * @param {string} [row.weight]      Weight column text
   * @param {string} [row.cost]        Cost column text
   * @param {string} [row.className]   'row-sub' or 'row-total' for ruled rows
   * @returns {HTMLTableRowElement}
   */
  function makeRow(row) {
    const tr = document.createElement('tr');
    if (row.className) tr.className = row.className;

    const item = document.createElement('td');
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = row.name;
    item.appendChild(name);
    if (row.detail) {
      const detail = document.createElement('span');
      detail.className = 'item-detail';
      detail.textContent = row.detail;
      item.appendChild(detail);
    }
    tr.appendChild(item);

    ['qty', 'length', 'weight', 'cost'].forEach(function (col) {
      const td = document.createElement('td');
      td.className = 'num';
      td.textContent = row[col] || ''; // empty cell when the column doesn't apply
      tr.appendChild(td);
    });
    return tr;
  }

  /**
   * Name of a section for display: the SECTIONS name, or "Custom (x lb/ft)".
   * @param {string} section  section name or 'Custom'
   * @param {number} lbft     weight per foot
   * @returns {string}
   */
  function sectionLabel(section, lbft) {
    return section === CUSTOM ? 'Custom ' + fmtQty(lbft) + ' lb/ft' : section + ' · ' + fmtQty(lbft) + ' lb/ft';
  }

  /**
   * One landing-beam row ("Landing beams — X (across)" / "— Y (along)").
   * Detail line e.g. "C8x11.2 · 11.2 lb/ft · 2 × 4'-0"". If the result has no
   * entry for the axis, the row shows a dash instead of throwing.
   * @param {string} name   row name
   * @param {object} [b]    result.beamsX or result.beamsY:
   *                        { section, lbft, count, eachLengthIn, lengthFt, weightLb }
   * @returns {object} a row for makeRow()
   */
  function beamRow(name, b) {
    if (!b || typeof b !== 'object') return { name: name, detail: '—' };
    return {
      name: name,
      detail: sectionLabel(b.section, b.lbft) + ' · ' + fmtNum(b.count) + ' × ' + fmtFtIn(b.eachLengthIn),
      qty: fmtNum(b.count),
      length: fmtNum(b.lengthFt, 1) + ' ft',
      weight: fmtNum(b.weightLb) + ' lb',
    };
  }

  /**
   * Fill the grand total, summary line, warnings list and breakdown table.
   * Add new cost rows here (see HOW TO EDIT at the top).
   * @param {object} result  return value of computeEstimate()
   * @param {object} state   the state it was computed from (for rates in the detail lines)
   */
  function renderResults(result, state) {
    const c = result.costs;

    // --- Grand total: "$" in accent, figure in ink ---
    const total = $('grandTotal');
    const money = fmtMoney(c.total);
    total.textContent = '';
    const cur = document.createElement('span');
    cur.className = 'cur';
    const dollarAt = money.indexOf('$');
    cur.textContent = money.slice(0, dollarAt + 1);
    total.appendChild(cur);
    total.appendChild(document.createTextNode(money.slice(dollarAt + 1)));

    // --- Summary line ---
    const n = result.flights.length;
    $('summary').textContent = [
      n + (n === 1 ? ' flight' : ' flights'),
      fmtNum(result.totalTreads) + ' treads',
      fmtNum(result.totalRisers) + ' risers',
      'total rise ' + fmtFtIn(result.totalRise),
      fmtNum(result.totalSteelLb) + ' lb steel',
    ].join(' · ');

    // --- Warnings (hidden when empty) ---
    const list = $('warnings');
    list.textContent = '';
    (result.warnings || []).forEach(function (w) {
      const li = document.createElement('li');
      li.textContent = w;
      list.appendChild(li);
    });
    list.hidden = list.children.length === 0;

    // --- Breakdown table ---
    const s = result.stringers;
    // Cut lengths: "4 × 12'-2 1/4"" when all flights match, else per flight
    // ("F1 2 × 12'-2 1/4", F2 2 × 9'-8"").
    const lengths = result.flights.map(function (f) { return fmtFtIn(f.stringerLength); });
    const allSame = lengths.every(function (l) { return l === lengths[0]; });
    const perFlight = allSame
      ? fmtNum(s.count) + ' × ' + (lengths[0] || fmtFtIn(0))
      : lengths.map(function (l, i) { return 'F' + (i + 1) + ' ' + state.stringersPerFlight + ' × ' + l; }).join(', ');

    const rows = [
      {
        name: 'Stringers',
        detail: sectionLabel(s.section, s.lbft) + ' · ' + perFlight,
        qty: fmtNum(s.count),
        length: fmtNum(s.lengthFt, 1) + ' ft',
        weight: fmtNum(s.weightLb) + ' lb',
      },
      beamRow('Landing beams — X (across)', result.beamsX),
      beamRow('Landing beams — Y (along)', result.beamsY),
      {
        name: 'Connections & misc allowance',
        detail: 'Clips, plates, angles, bolts, welds',
        qty: fmtQty(state.connectionAllowancePct) + '%',
        weight: fmtNum(result.allowanceLb) + ' lb',
      },
      {
        name: 'Steel subtotal',
        detail: fmtNum(result.totalSteelLb) + ' lb @ ' + fmtMoney(state.pricePerLb) + '/lb',
        weight: fmtNum(result.totalSteelLb) + ' lb',
        cost: fmtMoney(c.steel),
        className: 'row-sub',
      },
      {
        name: 'Treads',
        detail: fmtNum(result.totalTreads) + ' @ ' + fmtMoney(state.pricePerTread) + ' / tread',
        qty: fmtNum(result.totalTreads),
        cost: fmtMoney(c.treads),
      },
      {
        // Landing deck: $/sq.ft over every landing's area (deck.sqFt).
        name: 'Landing deck',
        detail: (result.deck ? fmtNum(result.deck.sqFt, 1) : '0') + ' sq.ft @ ' +
          fmtMoney(state.deckRatePerSqFt) + ' / sq.ft',
        qty: result.deck ? fmtNum(result.deck.sqFt, 1) + ' sq.ft' : '',
        cost: fmtMoney(c.deck || 0),
      },
      {
        // Finish: $/ft over stringers + landing beams (finish.lengthFt). Tread
        // finish is part of the tread supply price.
        name: 'Finish',
        detail: (result.finish ? result.finish.type : state.finishType) + ' · ' +
          fmtMoney(state.finishRatePerFt) + ' / ft · stringers + beams',
        length: result.finish ? fmtNum(result.finish.lengthFt, 1) + ' ft' : '',
        cost: fmtMoney(c.finish || 0),
      },
      {
        name: 'Labour',
        detail: fmtQty(state.labourHours) + ' hrs @ ' + fmtMoney(state.shopRate) + '/hr',
        qty: fmtQty(state.labourHours) + ' hrs',
        cost: fmtMoney(c.labour),
      },
      // Lump sums: Cost column only.
      { name: 'Detailing', detail: 'Shop drawings — lump sum', cost: fmtMoney(c.detailing) },
      { name: 'Installation', detail: 'Erection — lump sum', cost: fmtMoney(c.installation) },
      { name: 'Freight', detail: 'Delivery — lump sum', cost: fmtMoney(c.freight || 0) },
      { name: 'Subtotal', cost: fmtMoney(c.subtotal), className: 'row-sub' },
      { name: 'Markup', qty: fmtQty(state.markupPct) + '%', cost: fmtMoney(c.markup) },
      // PST is charged on materials only (steel, treads, landing deck), after markup.
      { name: 'PST', detail: 'On materials: steel, treads, deck', qty: fmtQty(state.pstPct) + '%', cost: fmtMoney(c.pst) },
      { name: 'Total', detail: 'GST excluded', cost: fmtMoney(c.total), className: 'row-total' },
    ];

    const tbody = $('results');
    tbody.textContent = '';
    rows.forEach(function (r) { tbody.appendChild(makeRow(r)); });
  }

  /**
   * The chosen orientation's dropdown text, e.g. "U-stair, return right".
   * @returns {string} '' when nothing is selected
   */
  function orientationLabel() {
    const select = $('orientation');
    const opt = select ? select.options[select.selectedIndex] : null;
    return opt ? opt.textContent : '';
  }

  /**
   * Update the drawing's title strip with the chosen orientation, e.g. "U-STAIR, RETURN RIGHT".
   */
  function updateTitleBlock() {
    const cell = $('tbOrientation');
    if (cell) cell.textContent = orientationLabel();
  }

  /* ---------------------------------------------------------------------
     Collapsible input sections
     --------------------------------------------------------------------- */

  /**
   * Short name of a section for the collapsed summaries: the SECTIONS name, or
   * "Custom 20 lb/ft".
   * @param {string} section    section name or 'Custom'
   * @param {number} customLbFt lb/ft used for 'Custom'
   * @returns {string}
   */
  function shortSection(section, customLbFt) {
    return section === CUSTOM ? 'Custom ' + fmtQty(customLbFt) + ' lb/ft' : section;
  }

  /**
   * One-line text for each input section, shown in its heading while it is
   * collapsed. Key NAME fills <span id="sum-NAME"> in <details id="sec-NAME">.
   * Each function gets the current state and returns plain text (values only).
   * To add a section, add an entry here (see HOW TO EDIT at the top).
   */
  const SECTION_SUMMARIES = {
    // "U-stair, return right · 10 + 10 TR"   /   "Straight run · 12 TR"
    layout: function (s) {
      const treads = s.orientation === 'straight'
        ? fmtNum(s.treads1)
        : fmtNum(s.treads1) + ' + ' + fmtNum(s.treads2);
      return orientationLabel() + ' · ' + treads + ' TR';
    },
    // "C12x20.7 × 2 / flight"
    stringers: function (s) {
      return shortSection(s.stringerSection, s.stringerCustomLbFt) + ' × ' + fmtNum(s.stringersPerFlight) + ' / flight';
    },
    // "1 landing · X 2 × C8x11.2 · Y 2 × C8x11.2"
    landings: function (s) {
      const parts = [fmtNum(s.landingCount) + (s.landingCount === 1 ? ' landing' : ' landings')];
      BEAM_AXES.forEach(function (b) {
        parts.push(b.axis.toUpperCase() + ' ' + fmtNum(s[b.key + 'Count']) + ' × ' +
          shortSection(s[b.key + 'Section'], s[b.key + 'CustomLbFt']));
      });
      if (s.deckRatePerSqFt > 0) parts.push('deck ' + fmtMoney(s.deckRatePerSqFt) + ' / sq.ft');
      return parts.join(' · ');
    },
    // "$85.00 / tread · $1.60 / lb"
    material: function (s) {
      return fmtMoney(s.pricePerTread) + ' / tread · ' + fmtMoney(s.pricePerLb) + ' / lb';
    },
    // "SP3/Standard Primer · $0.00 / ft"
    finish: function (s) {
      return s.finishType + ' · ' + fmtMoney(s.finishRatePerFt) + ' / ft';
    },
    // "52 hrs @ $100.00 / hr"
    labour: function (s) {
      return fmtQty(s.labourHours) + ' hrs @ ' + fmtMoney(s.shopRate) + ' / hr';
    },
    // "$1,200.00"
    detailing: function (s) { return fmtMoney(s.detailingCost); },
    // "$3,500.00"
    installation: function (s) { return fmtMoney(s.installationCost); },
    // "$500.00"
    freight: function (s) { return fmtMoney(s.freightCost); },
    // "0%"
    markup: function (s) { return fmtQty(s.markupPct) + '%'; },
    pst: function (s) { return fmtQty(s.pstPct) + '% on materials'; },
  };

  /**
   * Fill every section's collapsed summary (<span id="sum-NAME">) from the state.
   * CSS shows the text only while that section is closed.
   * @param {object} state  current state
   */
  function updateSectionSummaries(state) {
    Object.keys(SECTION_SUMMARIES).forEach(function (name) {
      const el = $('sum-' + name);
      if (el) el.textContent = SECTION_SUMMARIES[name](state);
    });
  }

  /**
   * Restore each <details class="section">'s open/closed state from SECTIONS_KEY
   * (sections not saved stay open), then save the state of all sections, as
   * { 'sec-NAME': bool }, whenever one is opened or closed (`toggle` event).
   */
  function initSections() {
    const sections = Array.prototype.slice.call(document.querySelectorAll('details.section'));
    const saved = storageGet(SECTIONS_KEY) || storageGet(OLD_SECTIONS_KEY);
    if (saved && typeof saved === 'object') {
      sections.forEach(function (d) {
        if (typeof saved[d.id] === 'boolean') d.open = saved[d.id];
      });
    }

    function save() {
      const open = {};
      sections.forEach(function (d) { if (d.id) open[d.id] = d.open; });
      storageSet(SECTIONS_KEY, open);
    }
    // `toggle` does not bubble, so listen on each section.
    sections.forEach(function (d) { d.addEventListener('toggle', save); });
  }

  /**
   * The main loop: form -> state -> visibility -> estimate -> table -> plan ->
   * section summaries -> save.
   * Runs on every input/change event.
   */
  function update() {
    const state = readState();
    updateVisibility(state);

    const result = computeEstimate(state);
    renderResults(result, state);

    // A drawing bug must never break the estimate.
    try {
      if (typeof renderPlan === 'function') renderPlan($('plan'), state);
    } catch (e) {
      console.error('renderPlan failed:', e);
    }

    updateTitleBlock();
    updateSectionSummaries(state);
    saveState(state);
  }

  /* ---------------------------------------------------------------------
     Controls
     --------------------------------------------------------------------- */

  /**
   * Form events (delegated: one listener on the form covers every input).
   * When a "Match landing width/depth" switch (beamXLengthAuto / beamYLengthAuto)
   * is switched off, its override starts from the current automatic length
   * (rounded to 1/8") so the number doesn't jump.
   * @param {Event} e  input or change event
   */
  function onFormEvent(e) {
    const t = e.target;
    if (e.type === 'change' && t && !t.checked) {
      BEAM_AXES.forEach(function (b) {
        if (t.id !== b.key + 'LengthAuto') return;
        const len = autoBeamLength(readState(), b.axis);
        $(b.key + 'LengthOverride').value = String(Math.round(len * 8) / 8);
      });
    }
    update();
  }

  /**
   * Put every input back to DEFAULTS (no confirmation; labourHours goes back to the
   * default shop hours) and recompute. Section open/closed state is left alone.
   */
  function resetToDefaults() {
    writeState(Object.assign({}, DEFAULTS));
    update();
  }

  /**
   * Apply a theme and remember it under the shared 'theme' key.
   * @param {boolean} dark  true for dark mode
   */
  function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      window.localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch (e) {
      /* not remembered, but still applied */
    }
  }

  /**
   * When the page is opened straight from disk (file://), browsers block the logo
   * PNG as a CSS mask. Swap in a plain <img> instead (styled by .logo--file).
   */
  function logoFallback() {
    const logo = document.querySelector('.logo');
    if (!logo || window.location.protocol !== 'file:') return;
    const img = document.createElement('img');
    img.src = 'assets/grizzly-logo.png';
    img.alt = '';
    logo.classList.add('logo--file');
    logo.appendChild(img);
  }

  /**
   * Start-up: fill dropdowns, restore saved values and open/closed sections, hook
   * up events, first render.
   */
  function init() {
    logoFallback();
    fillSectionSelects();
    writeState(loadState());
    initSections();

    const form = $('inputs');
    form.addEventListener('input', onFormEvent);
    form.addEventListener('change', onFormEvent);
    // Enter in a field must not submit/reload the page.
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    const printBtn = $('printBtn');
    let framed = true;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    if (framed) printBtn.hidden = true;
    printBtn.addEventListener('click', function () { window.print(); });

    $('resetBtn').addEventListener('click', resetToDefaults);

    // Dark mode switch: reflects the theme set by the inline script in <head>.
    const dark = $('dark');
    dark.checked = document.documentElement.dataset.theme === 'dark';
    dark.addEventListener('change', function () { setTheme(dark.checked); });

    update();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
