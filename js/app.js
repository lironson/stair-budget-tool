/*
 * app.js — wires the page together (Steel Stair Estimator)
 * ========================================================
 *
 * WHAT THIS FILE DOES
 *   1. Fills the two channel-section dropdowns from SECTIONS (+ "Custom…").
 *   2. Loads the last-used values from localStorage (key 'stairEstimator.v1'),
 *      merged over DEFAULTS, and writes them into the form.
 *   3. On every keystroke / change: reads the form into a `state` object, shows or
 *      hides the optional fields, runs computeEstimate(state), fills the estimate
 *      table, redraws the plan with renderPlan(svg, state) and saves the state.
 *   4. Handles the Print, Reset and Dark mode controls.
 *
 * HOW IT CONNECTS TO THE OTHER FILES
 *   index.html loads js/calc.js, then js/plan.js, then this file (classic scripts).
 *   From calc.js it uses: DEFAULTS, SECTIONS, computeEstimate, landingWidth,
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
 *     renderResults() below — copy the "Treads" row.
 *   - Show/hide a field depending on other inputs: give its wrapper an id and add
 *     a line in updateVisibility().
 *   - Change the saved-data key: STORAGE_KEY below (changing it forgets old saves).
 */

(function () {
  'use strict';

  /** localStorage key for the saved form values. */
  const STORAGE_KEY = 'stairEstimator.v1';

  /** localStorage key for the theme; shared with the Steel Size Rolodex app. */
  const THEME_KEY = 'theme';

  /** State keys that are whole numbers (counts). Everything else numeric is a decimal. */
  const INT_KEYS = ['treads1', 'treads2', 'landingCount', 'channelsPerLanding', 'stringersPerFlight'];

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
   * Fill the stringer and landing section dropdowns from SECTIONS (calc.js),
   * each followed by a final "Custom…" option.
   */
  function fillSectionSelects() {
    ['stringerSection', 'landingSection'].forEach(function (id) {
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
   * Load the saved state and merge it over DEFAULTS. Only known keys with the
   * same type as the default are kept, so an old or damaged save can't break the page.
   * @returns {object} a complete state object
   */
  function loadState() {
    const saved = storageGet(STORAGE_KEY);
    const state = Object.assign({}, DEFAULTS);
    if (saved && typeof saved === 'object') {
      Object.keys(DEFAULTS).forEach(function (key) {
        if (key in saved && typeof saved[key] === typeof DEFAULTS[key]) state[key] = saved[key];
      });
    }
    return state;
  }

  /* ---------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------- */

  /**
   * Show/hide the optional fields (el.hidden) for the current state, and show the
   * automatic channel length next to the "Match landing width" switch.
   * @param {object} state  current state
   */
  function updateVisibility(state) {
    const isU = state.orientation.indexOf('U-') === 0;
    const toggles = {
      'field-treads2': state.orientation !== 'straight',
      'field-wellGap': isU,
      'field-stringerCustomLbFt': state.stringerSection === CUSTOM,
      'field-landingCustomLbFt': state.landingSection === CUSTOM,
      'field-channelLengthOverride': !state.channelLengthAuto,
    };
    Object.keys(toggles).forEach(function (id) {
      const el = $(id);
      if (el) el.hidden = !toggles[id];
    });

    const auto = $('channelLengthAutoValue');
    if (auto) auto.textContent = '(' + fmtFtIn(landingWidth(state)) + ')';
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
    const ch = result.channels;
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
      {
        name: 'Landing channels',
        detail: sectionLabel(ch.section, ch.lbft) + ' · ' + fmtNum(ch.count) + ' × ' + fmtFtIn(ch.eachLengthIn),
        qty: fmtNum(ch.count),
        length: fmtNum(ch.lengthFt, 1) + ' ft',
        weight: fmtNum(ch.weightLb) + ' lb',
      },
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
        name: 'Labour',
        detail: fmtQty(state.labourHours) + ' hrs @ ' + fmtMoney(state.shopRate) + '/hr',
        qty: fmtQty(state.labourHours) + ' hrs',
        cost: fmtMoney(c.labour),
      },
      { name: 'Subtotal', cost: fmtMoney(c.subtotal), className: 'row-sub' },
      { name: 'Markup', qty: fmtQty(state.markupPct) + '%', cost: fmtMoney(c.markup) },
      { name: 'Total', cost: fmtMoney(c.total), className: 'row-total' },
    ];

    const tbody = $('results');
    tbody.textContent = '';
    rows.forEach(function (r) { tbody.appendChild(makeRow(r)); });
  }

  /**
   * Update the drawing's title strip with the chosen orientation, e.g. "U-STAIR, RETURN RIGHT".
   */
  function updateTitleBlock() {
    const select = $('orientation');
    const cell = $('tbOrientation');
    if (!select || !cell) return;
    const opt = select.options[select.selectedIndex];
    cell.textContent = opt ? opt.textContent : '';
  }

  /**
   * The main loop: form -> state -> visibility -> estimate -> table -> plan -> save.
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
    storageSet(STORAGE_KEY, state);
  }

  /* ---------------------------------------------------------------------
     Controls
     --------------------------------------------------------------------- */

  /**
   * Form events (delegated: one listener on the form covers every input).
   * When "Match landing width" is switched off, the override starts from the
   * current landing width (rounded to 1/8") so the number doesn't jump.
   * @param {Event} e  input or change event
   */
  function onFormEvent(e) {
    if (e.type === 'change' && e.target && e.target.id === 'channelLengthAuto' && !e.target.checked) {
      const width = landingWidth(readState());
      $('channelLengthOverride').value = String(Math.round(width * 8) / 8);
    }
    update();
  }

  /** Put every input back to DEFAULTS (no confirmation) and recompute. */
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
   * Start-up: fill dropdowns, restore saved values, hook up events, first render.
   */
  function init() {
    logoFallback();
    fillSectionSelects();
    writeState(loadState());

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
