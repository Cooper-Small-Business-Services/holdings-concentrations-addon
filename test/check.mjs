#!/usr/bin/env node
/**
 * The test harness of src/concentration.gs and src/layout.gs.
 *
 * The harness loads the two script files into one node:vm context with fakes
 * of the Apps Script services. The spreadsheet fake starts with a synthetic
 * Holdings tab alone. It holds each tab as a grid in memory, with the styles,
 * the column widths, the conditional formats, and the data validation that
 * the script sets. No Google service takes part.
 *
 * The harness compares the tabs that the script creates with the accepted
 * layout of the report. The definition files in test/fixtures/ hold that
 * layout.
 *
 * Run 1 sends one real request to the concentration route with the key of the
 * environment variable HOLDINGS_API_KEY. The other runs send no request. The
 * harness prints no part of the key.
 *
 * The option --offline skips the real request. Run 1 then gets a synthetic
 * answer, and the harness uses an invented key. Each other assertion runs.
 * Use it when no key is available, such as in a pull request from a fork.
 *
 * Usage, from the repository root:
 *
 *   HOLDINGS_API_KEY=<your key> node test/check.mjs
 *   node test/check.mjs --offline
 *
 * Exit codes: 0 = each assertion passed, 1 = an assertion failed, 2 = no key.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "src");
const SCRIPT_FILES = ["concentration.gs", "layout.gs"].map((name) => resolve(SRC, name));
const MANIFEST_FILE = resolve(SRC, "appsscript.json");
const ROUTE_URL = "https://data.coopersbs.com/funds/v1/concentration";
const EXPOSURE_TAB = "Concentration.Exposure";
const REPORT_TAB = "Concentration";

/**
 * The user property that holds the key.
 */
const KEY_PROPERTY = "HOLDINGS_API_KEY";

/**
 * The fixture of the accepted layout of each of the two tabs.
 */
const ACCEPTED_FILES = {
  [EXPOSURE_TAB]: resolve(HERE, "fixtures", "concentration-exposure.json"),
  [REPORT_TAB]: resolve(HERE, "fixtures", "concentration.json"),
};

/**
 * The two scopes of the manifest, and the one URL prefix that the script can
 * fetch.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.currentonly",
  "https://www.googleapis.com/auth/script.external_request",
];
const URL_PREFIXES = ["https://data.coopersbs.com/funds/v1/"];

/**
 * The size of the grid of a new tab, as Apps Script makes it.
 */
const NEW_ROWS = 1000;
const NEW_COLUMNS = 26;

/**
 * True when the harness skips the real request.
 */
const OFFLINE = process.argv.includes("--offline");

/**
 * The key of the route. The harness reads it from the environment alone. The
 * offline run uses an invented key in the key format of the route, and it
 * does not read the environment.
 */
const API_KEY = OFFLINE ? `csbs_${"0".repeat(43)}` : (process.env.HOLDINGS_API_KEY ?? "").trim();

/**
 * The synthetic Holdings tab. Each account name, description, and value is
 * invented. The tickers are public symbols that the route knows: two index
 * funds that hold one stock, the stock itself, and a money market fund. The
 * bond identifier is invented, so the route does not know it. The column
 * order differs from a Tiller tab. The values are round, so a reader can
 * check each weight by hand. The two rows of fund A add to one position.
 */
const HOLDINGS_HEADER = ["Symbol", "Account", "Value", "Description"];
const FUND_A = "VOO";
const FUND_B = "IVV";
const STOCK = "AAPL";
const MONEY = "SPAXX";
const PLAN_FUND = "Example Plan Collective Trust";
const BOND = "912810ZZ1";
const HOLDINGS_ROWS = [
  [FUND_A, "Example brokerage", 3000, "Example index fund A"],
  [FUND_B, "Example brokerage", 2000, "Example index fund B"],
  [STOCK, "Example brokerage", 1000, "Example company stock"],
  [FUND_A, "Example retirement", 1000, "Example index fund A"],
  [BOND, "Example brokerage", 1000, "Example Treasury bond"],
  [MONEY, "Example brokerage", 1000, "Example money market fund"],
  ["", "Example plan", 1000, PLAN_FUND],
  ["", "Example brokerage", 500, ""],
  ["XYZ", "Example brokerage", "n/a", "A row with a value that is not a number"],
];

/**
 * The hand calculation: the sum of each key and its share of the total of
 * 10,000. The empty key and the row with no number add nothing.
 */
const EXPECTED = [
  { id: FUND_A, ticker: FUND_A, sum: 3000 + 1000 },
  { id: FUND_B, ticker: FUND_B, sum: 2000 },
  { id: STOCK, ticker: STOCK, sum: 1000 },
  { id: BOND, ticker: BOND, sum: 1000 },
  { id: MONEY, ticker: MONEY, sum: 1000 },
  { id: PLAN_FUND, ticker: null, sum: 1000 },
];
const EXPECTED_TOTAL = 10000;

const MEASURES = [
  "lineCount",
  "top10Weight",
  "hhi",
  "effectiveCount",
  "lookedThroughWeight",
  "notLookedThroughWeight",
  "weightSum",
  "weightDifference",
];
const FUND_FIELDS = [
  "id",
  "ticker",
  "reportDate",
  "accessionNumber",
  "holdingCount",
  "weight",
  "coveredWeight",
  "mergedByTicker",
  "mergedByLei",
  "mergedByName",
];
const LINE_FIELDS = ["key", "name", "ticker", "lei", "class", "weight"];

/**
 * The error of a failed assertion. The message names the assertion.
 */
class AssertionFailure extends Error {}

let passed = 0;

/**
 * Stop the harness with the name of the assertion when the condition is
 * false.
 */
function check(condition, name) {
  if (!condition) throw new AssertionFailure(name);
  passed += 1;
}

/**
 * True when two numbers differ by less than 1e-12.
 */
function near(a, b) {
  return typeof a === "number" && Math.abs(a - b) < 1e-12;
}

/**
 * True when the value is a Date of any realm. The script makes its Date in
 * the vm context, so `instanceof Date` of this realm is false.
 */
function isDate(value) {
  return Object.prototype.toString.call(value) === "[object Date]";
}

/**
 * The column number of a column letter, such as 1 for A and 27 for AA.
 */
function columnNumber(letters) {
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}

/**
 * The bounds of an A1 range inside a grid of the given size. An open end,
 * such as E18:E or U:AZ, runs to the edge of the grid.
 */
function parseA1(a1, maxRows, maxColumns) {
  const m = /^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/.exec(a1);
  if (!m || (!m[1] && !m[2])) throw new Error(`The range "${a1}" is not an A1 range.`);
  const single = !a1.includes(":");
  const row = m[2] ? Number(m[2]) : 1;
  const column = m[1] ? columnNumber(m[1]) : 1;
  const endRowText = single ? m[2] : m[4];
  const endColumnText = single ? m[1] : m[3];
  const endRow = endRowText ? Number(endRowText) : maxRows;
  const endColumn = endColumnText ? columnNumber(endColumnText) : maxColumns;
  return { row, column, rows: endRow - row + 1, columns: endColumn - column + 1 };
}

/**
 * The key of one cell in a style map or a validation map.
 */
function cellKey(row, column) {
  return `${row},${column}`;
}

/**
 * A grid of rows and columns in memory with the methods of an Apps Script
 * Sheet that the script calls. Each change goes into the log of the fake.
 */
class FakeSheet {
  constructor(name, rows, columns, log) {
    this.name = name;
    this.log = log;
    this.grid = Array.from({ length: rows }, () => Array(columns).fill(""));
    this.styles = new Map();
    this.validation = new Map();
    this.widths = new Map();
    this.rules = [];
    this.hidden = false;
    this.frozenRows = 0;
  }

  record(op, extra = {}) {
    this.log.push({ sheet: this.name, op, ...extra });
  }

  getName() {
    return this.name;
  }

  getMaxRows() {
    return this.grid.length;
  }

  getMaxColumns() {
    return this.grid[0].length;
  }

  insertRowsAfter(after, count) {
    if (after !== this.getMaxRows()) throw new Error("The fake inserts rows at the end of the grid alone.");
    for (let i = 0; i < count; i += 1) this.grid.push(Array(this.getMaxColumns()).fill(""));
    this.record("insertRowsAfter", { count });
  }

  insertColumnsAfter(after, count) {
    if (after !== this.getMaxColumns()) throw new Error("The fake inserts columns at the end of the grid alone.");
    for (const row of this.grid) row.push(...Array(count).fill(""));
    this.record("insertColumnsAfter", { count });
  }

  deleteRows(start, count) {
    if (start + count - 1 !== this.getMaxRows()) throw new Error("The fake deletes rows at the end of the grid alone.");
    this.grid.splice(start - 1, count);
    this.record("deleteRows", { count });
  }

  deleteColumns(start, count) {
    if (start + count - 1 !== this.getMaxColumns()) {
      throw new Error("The fake deletes columns at the end of the grid alone.");
    }
    for (const row of this.grid) row.splice(start - 1, count);
    this.record("deleteColumns", { count });
  }

  hideSheet() {
    this.hidden = true;
    this.record("hideSheet");
  }

  setFrozenRows(rows) {
    this.frozenRows = rows;
    this.record("setFrozenRows", { rows });
  }

  setColumnWidths(start, count, width) {
    for (let c = start; c < start + count; c += 1) this.widths.set(c, width);
    this.record("setColumnWidths", { start, count, width });
  }

  setConditionalFormatRules(rules) {
    this.rules = rules.map((rule) => ({ ...rule }));
    this.record("setConditionalFormatRules", { count: rules.length });
  }

  getRange(first, column, rows = 1, columns = 1) {
    let bounds = { row: first, column, rows, columns };
    if (typeof first === "string") bounds = parseA1(first, this.getMaxRows(), this.getMaxColumns());
    const b = bounds;
    if (b.row < 1 || b.column < 1 || b.rows < 1 || b.columns < 1) {
      throw new Error(`The range ${b.row},${b.column},${b.rows},${b.columns} has a bad start or a bad size.`);
    }
    if (b.row + b.rows - 1 > this.getMaxRows() || b.column + b.columns - 1 > this.getMaxColumns()) {
      throw new Error("The coordinates of the range are outside the dimensions of the sheet.");
    }
    return new FakeRange(this, b.row, b.column, b.rows, b.columns);
  }

  getDataRange() {
    let lastRow = 1;
    let lastColumn = 1;
    this.grid.forEach((cells, r) => {
      cells.forEach((value, c) => {
        if (value !== "") {
          lastRow = Math.max(lastRow, r + 1);
          lastColumn = Math.max(lastColumn, c + 1);
        }
      });
    });
    return this.getRange(1, 1, lastRow, lastColumn);
  }

  /**
   * The value of one cell by its A1 name, such as B1.
   */
  cell(a1) {
    const b = parseA1(a1, this.getMaxRows(), this.getMaxColumns());
    return this.grid[b.row - 1]?.[b.column - 1];
  }

  /**
   * The values of a block of cells, with row 1 and column 1 as the start.
   */
  block(row, column, rows, columns) {
    return this.grid.slice(row - 1, row - 1 + rows).map((cells) => cells.slice(column - 1, column - 1 + columns));
  }

  /**
   * A copy of the grid, with each Date as its time in milliseconds.
   */
  snapshot() {
    return this.grid.map((cells) => cells.map((v) => (isDate(v) ? v.getTime() : v)));
  }

  /**
   * A copy of the whole state of the tab as JSON text: the grid, the styles,
   * the validation, the column widths, the conditional formats, the hidden
   * flag, and the frozen rows.
   */
  state() {
    const sorted = (map) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return JSON.stringify({
      grid: this.snapshot(),
      styles: sorted(this.styles).map(([key, style]) => [key, Object.fromEntries(Object.entries(style).sort())]),
      validation: sorted(this.validation),
      widths: sorted(this.widths),
      rules: this.rules.map((rule) => ({ ...rule, ranges: rule.ranges.map((r) => r.bounds()) })),
      hidden: this.hidden,
      frozenRows: this.frozenRows,
    });
  }
}

/**
 * A range of a FakeSheet with the methods of an Apps Script Range that the
 * script calls.
 */
class FakeRange {
  constructor(sheet, row, column, rows, columns) {
    Object.assign(this, { sheet, row, column, rows, columns });
  }

  bounds() {
    const { row, column, rows, columns } = this;
    return { row, column, rows, columns };
  }

  record(op, extra = {}) {
    this.sheet.record(op, { ...this.bounds(), ...extra });
  }

  /**
   * Call the function for the key of each cell of the range.
   */
  eachCell(fn) {
    for (let r = this.row; r < this.row + this.rows; r += 1) {
      for (let c = this.column; c < this.column + this.columns; c += 1) fn(cellKey(r, c));
    }
  }

  /**
   * Set one style property on each cell of the range and log the call.
   */
  style(property, value, op) {
    this.eachCell((key) => {
      const style = this.sheet.styles.get(key) ?? {};
      style[property] = value;
      this.sheet.styles.set(key, style);
    });
    this.record(op, { value });
    return this;
  }

  getValues() {
    return this.sheet.block(this.row, this.column, this.rows, this.columns).map((cells) => [...cells]);
  }

  setValues(values) {
    if (values.length !== this.rows || values.some((cells) => cells.length !== this.columns)) {
      throw new Error(`The data has ${values.length} rows, and the range has ${this.rows} rows.`);
    }
    values.forEach((cells, r) => {
      cells.forEach((value, c) => {
        this.sheet.grid[this.row - 1 + r][this.column - 1 + c] = value;
      });
    });
    this.record("setValues");
    return this;
  }

  setNumberFormat(format) {
    return this.style("numberFormat", format, "setNumberFormat");
  }

  setFontWeight(value) {
    return this.style("fontWeight", value, "setFontWeight");
  }

  setFontStyle(value) {
    return this.style("fontStyle", value, "setFontStyle");
  }

  setFontSize(value) {
    return this.style("fontSize", value, "setFontSize");
  }

  setFontColor(value) {
    return this.style("fontColor", value, "setFontColor");
  }

  setBackground(value) {
    return this.style("background", value, "setBackground");
  }

  setHorizontalAlignment(value) {
    return this.style("horizontalAlignment", value, "setHorizontalAlignment");
  }

  setWrap(value) {
    return this.style("wrap", value, "setWrap");
  }

  setDataValidation(rule) {
    this.eachCell((key) => this.sheet.validation.set(key, { ...rule }));
    this.record("setDataValidation");
    return this;
  }
}

/**
 * A spreadsheet in memory with the methods of an Apps Script Spreadsheet that
 * the script calls. The tabs keep their order.
 */
class FakeBook {
  constructor(log) {
    this.log = log;
    this.sheets = [];
  }

  getSheetByName(name) {
    state.tabsAsked.add(name);
    return this.sheets.find((sheet) => sheet.name === name) ?? null;
  }

  getNumSheets() {
    return this.sheets.length;
  }

  insertSheet(name, index) {
    if (this.sheets.some((sheet) => sheet.name === name)) throw new Error(`A sheet named "${name}" exists.`);
    const sheet = new FakeSheet(name, NEW_ROWS, NEW_COLUMNS, this.log);
    this.sheets.splice(index, 0, sheet);
    this.log.push({ sheet: name, op: "insertSheet", index });
    return sheet;
  }

  /**
   * The names of the tabs in their order.
   */
  names() {
    return this.sheets.map((sheet) => sheet.name);
  }

  /**
   * A tab by its name, with no entry in the list of the tabs that the script
   * asked for.
   */
  tab(name) {
    return this.sheets.find((sheet) => sheet.name === name);
  }
}

/**
 * A builder of a rule with the chain methods of Apps Script. Each method
 * sets one field of the rule. The method `build` returns a copy of the rule.
 */
function fakeBuilder(methods) {
  const rule = {};
  const builder = { build: () => ({ ...rule }) };
  for (const [method, set] of Object.entries(methods)) {
    builder[method] = (...args) => {
      set(rule, ...args);
      return builder;
    };
  }
  return builder;
}

/**
 * The state of the fakes that the runs change: the log of changes, the user
 * properties, the answers of the key dialog, the messages of the alerts, the
 * lock, the fetch handler, the fetch calls, the menus, the tabs that the
 * script asked for, and the state of the tabs at the time of each request.
 */
const state = {
  log: [],
  userProperties: new Map(),
  promptAnswers: [],
  prompts: [],
  alerts: [],
  lockHeldByOther: false,
  lockTaken: 0,
  lockReleased: 0,
  fetchHandler: null,
  fetchCalls: [],
  menus: [],
  tabsAsked: new Set(),
  atFetch: [],
};

/**
 * A Holdings fake with the synthetic header and the given rows.
 */
function makeHoldings(rows) {
  const holdings = new FakeSheet("Holdings", rows.length + 1, HOLDINGS_HEADER.length, state.log);
  holdings.grid[0] = [...HOLDINGS_HEADER];
  rows.forEach((cells, r) => {
    holdings.grid[r + 1] = [...cells];
  });
  return holdings;
}

/**
 * Put a new Holdings fake in the place of the old one.
 */
function replaceHoldings(rows) {
  book.sheets[book.names().indexOf("Holdings")] = makeHoldings(rows);
}

const book = new FakeBook(state.log);
book.sheets.push(makeHoldings(HOLDINGS_ROWS));

/**
 * The ambient services of Apps Script, as fakes over the state above.
 */
const BUTTON = { OK: "OK", CANCEL: "CANCEL", CLOSE: "CLOSE" };
const BUTTON_SET = { OK: "OK", OK_CANCEL: "OK_CANCEL" };

/**
 * The Ui fake. It has the add-on menu builder, the input dialog, and the
 * alert. The input dialog takes its answer from the queue
 * state.promptAnswers. The Ui methods that need the scope
 * script.container.ui, such as showModalDialog and showSidebar, are absent,
 * so a call to one of them fails the harness. A published add-on puts its
 * menu under Extensions, so createMenu fails the harness too.
 */
function fakeUi() {
  const menu = { addon: true, items: [] };
  const builder = {
    addItem: (label, handler) => {
      menu.items.push({ label, handler });
      return builder;
    },
    addToUi: () => {
      state.menus.push(menu);
    },
  };
  return {
    Button: BUTTON,
    ButtonSet: BUTTON_SET,
    createAddonMenu: () => builder,
    createMenu: () => {
      throw new Error("The script calls createMenu. A published add-on uses createAddonMenu.");
    },
    prompt: (title, text, buttons) => {
      state.prompts.push({ title, text, buttons });
      const answer = state.promptAnswers.shift();
      if (answer === undefined) throw new Error("The harness has no answer for the input dialog.");
      return { getSelectedButton: () => answer.button, getResponseText: () => answer.text };
    },
    alert: (text) => {
      state.alerts.push(String(text));
      return BUTTON.OK;
    },
  };
}

const services = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => book,
    getUi: fakeUi,
    newConditionalFormatRule: () =>
      fakeBuilder({
        whenFormulaSatisfied: (rule, formula) => (rule.formula = formula),
        setRanges: (rule, ranges) => (rule.ranges = ranges),
        setBackground: (rule, value) => (rule.background = value),
        setFontColor: (rule, value) => (rule.color = value),
        setBold: (rule, value) => (rule.bold = value),
        setItalic: (rule, value) => (rule.italic = value),
      }),
    newDataValidation: () =>
      fakeBuilder({
        requireNumberBetween: (rule, min, max) => Object.assign(rule, { min, max }),
        setAllowInvalid: (rule, value) => (rule.allowInvalid = value),
        setHelpText: (rule, text) => (rule.helpText = text),
      }),
  },
  PropertiesService: {
    getScriptProperties: () => {
      throw new Error("The script reads the script properties, which all users of an add-on share.");
    },
    getDocumentProperties: () => {
      throw new Error("The script reads the document properties, which each editor of the spreadsheet can read.");
    },
    getUserProperties: () => ({
      getProperty: (name) => state.userProperties.get(name) ?? null,
      setProperty(name, value) {
        state.userProperties.set(name, String(value));
        return this;
      },
      deleteProperty(name) {
        state.userProperties.delete(name);
        return this;
      },
    }),
  },
  LockService: {
    getScriptLock: () => {
      throw new Error("The script takes the script lock, which blocks all users of an add-on.");
    },
    getDocumentLock: () => ({
      tryLock: (ms) => {
        if (ms !== 0) throw new Error(`The script asked for a lock wait of ${ms} ms, not 0.`);
        if (state.lockHeldByOther) return false;
        state.lockTaken += 1;
        return true;
      },
      releaseLock: () => {
        state.lockReleased += 1;
      },
    }),
  },
  UrlFetchApp: {
    fetch: (url, options) => {
      state.fetchCalls.push({ url, options });
      state.log.push({ op: "fetch" });
      state.atFetch.push({ names: book.names(), tabs: book.sheets.map((sheet) => [sheet.name, sheet.state()]) });
      if (state.fetchHandler === null) throw new Error("The harness allows no fetch in this run.");
      return state.fetchHandler(url, options);
    },
  },
};

/**
 * The response fake of UrlFetchApp.
 */
function fakeResponse(status, text) {
  return { getResponseCode: () => status, getContentText: () => text };
}

/**
 * The source of the child process that sends the real request. It reads the
 * request from its standard input, so the key never appears in an argument
 * of a process. It prints the status and the body as JSON.
 */
const CHILD = `
let input = "";
for await (const chunk of process.stdin) input += chunk;
const req = JSON.parse(input);
try {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  process.stdout.write(JSON.stringify({ status: res.status, text: await res.text() }));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: String(e && e.message) }));
}
`;

let liveRequests = 0;

/**
 * The body text of the one real answer. The harness compares the cells with
 * it.
 */
let liveText = null;

/**
 * The fetch handler of run 1. It sends the request of the script to the
 * route and blocks until the answer arrives, as UrlFetchApp.fetch does. The
 * harness allows one such request.
 */
function liveFetch(url, options) {
  liveRequests += 1;
  if (liveRequests > 1) throw new Error("The harness sends one real request alone.");
  const request = {
    url,
    method: String(options.method).toUpperCase(),
    headers: { ...options.headers, "Content-Type": options.contentType },
    body: options.payload,
  };
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", CHILD], {
    input: JSON.stringify(request),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120000,
  });
  if (child.status !== 0) throw new Error(`The fetch process stopped with status ${child.status}.`);
  const out = JSON.parse(child.stdout);
  if (out.error) throw new Error(`The fetch failed: ${out.error}`);
  liveText = out.text;
  return fakeResponse(out.status, out.text);
}

let offlineRequests = 0;

/**
 * A synthetic answer of the route for the positions of run 1, in the shape
 * of a real answer. Each index fund holds the direct stock, one invented
 * company, and cash. The direct stock line gets a source from the stock and
 * from each index fund. The bond and the plan fund get the class unknown, and
 * the money market fund gets the class fund, as the route gives them.
 */
function offlineAnswer(positions) {
  const weight = Object.fromEntries(positions.map((p) => [p.id, p.weight]));
  const lines = [];
  const add = (key, name, ticker, cls, sources) => {
    const sum = Object.values(sources).reduce((a, b) => a + b, 0);
    lines.push({ key, name, ticker, lei: null, class: cls, weight: sum, sources });
  };
  const funds = [FUND_A, FUND_B];
  const through = (share) => Object.fromEntries(funds.map((id) => [id, weight[id] * share]));
  add("name:EXAMPLE COMPANY B", "Example Company B", null, "stock", through(0.9));
  add(`ticker:${STOCK}`, "Example company", STOCK, "stock", { ...through(0.05), [STOCK]: weight[STOCK] });
  add("name:CASH", "Cash", null, "cash", through(0.05));
  add(`ticker:${BOND}`, BOND, BOND, "unknown", { [BOND]: weight[BOND] });
  add(`ticker:${MONEY}`, "Example money market fund", MONEY, "fund", { [MONEY]: weight[MONEY] });
  add(`id:${PLAN_FUND}`, PLAN_FUND, null, "unknown", { [PLAN_FUND]: weight[PLAN_FUND] });
  lines.sort((a, b) => b.weight - a.weight);
  const weights = lines.map((line) => line.weight);
  const sum = weights.reduce((a, b) => a + b, 0);
  const squares = weights.reduce((a, w) => a + w * w, 0);
  const lookedThrough = funds.reduce((a, id) => a + weight[id], 0);
  return {
    measures: {
      lineCount: lines.length,
      top10Weight: weights.slice(0, 10).reduce((a, b) => a + b, 0),
      hhi: squares * 10000,
      effectiveCount: 1 / squares,
      lookedThroughWeight: lookedThrough,
      notLookedThroughWeight: 1 - lookedThrough,
      weightSum: sum,
      weightDifference: sum - 1,
    },
    funds: funds.map((id, i) => ({
      id,
      ticker: id,
      reportDate: "2026-06-30",
      accessionNumber: `0000000000-26-00000${i + 1}`,
      holdingCount: 3,
      weight: weight[id],
      coveredWeight: weight[id],
      mergedByTicker: 0,
      mergedByLei: 0,
      mergedByName: 0,
    })),
    lines,
  };
}

/**
 * The fetch handler of run 1 in the offline run. It answers with the
 * synthetic answer and sends no request.
 */
function offlineFetch(url, options) {
  offlineRequests += 1;
  liveText = JSON.stringify(offlineAnswer(JSON.parse(options.payload).positions));
  return fakeResponse(200, liveText);
}

/**
 * The fixture of the accepted layout of one tab.
 */
function acceptedDefinition(tab) {
  return JSON.parse(readFileSync(ACCEPTED_FILES[tab], "utf8"));
}

/**
 * The expected state of a new tab from its accepted definition file, in the
 * form of FakeSheet.state. The function applies the Sheets API meaning of
 * each key of the file: a style entry sets only the properties that it names,
 * and a later entry wins.
 */
function expectedState(definition) {
  const format = definition.format ?? {};
  const rows = NEW_ROWS;
  const columns = Math.max(NEW_COLUMNS, format.columns ?? 0);
  const sheet = new FakeSheet(definition.tab, rows, columns, []);
  for (const entry of definition.cells) {
    const b = parseA1(entry.range, rows, columns);
    entry.values.forEach((cells, r) => {
      cells.forEach((value, c) => {
        sheet.grid[b.row - 1 + r][b.column - 1 + c] = value;
      });
    });
  }
  const names = {
    bold: ["fontWeight", (v) => (v ? "bold" : "normal")],
    italic: ["fontStyle", (v) => (v ? "italic" : "normal")],
    fontSize: ["fontSize", (v) => v],
    color: ["fontColor", (v) => v],
    background: ["background", (v) => v],
    numberFormat: ["numberFormat", (v) => v],
    align: ["horizontalAlignment", (v) => v.toLowerCase()],
    wrap: ["wrap", (v) => v],
  };
  for (const entry of format.cells ?? []) {
    const range = sheet.getRange(entry.range);
    for (const [key, value] of Object.entries(entry)) {
      if (key === "range") continue;
      const [property, convert] = names[key];
      range.style(property, convert(value), "expected");
    }
  }
  for (const [spec, width] of Object.entries(format.columnWidths ?? {})) {
    const [first, last] = spec.split(":");
    for (let c = columnNumber(first); c <= columnNumber(last ?? first); c += 1) sheet.widths.set(c, width);
  }
  sheet.rules = (format.conditional ?? []).map((rule) => {
    const out = { formula: rule.formula, ranges: [sheet.getRange(rule.range)] };
    for (const key of ["background", "color", "bold", "italic"]) if (rule[key] !== undefined) out[key] = rule[key];
    return out;
  });
  for (const v of format.validation ?? []) {
    sheet
      .getRange(v.range)
      .setDataValidation({ min: v.between[0], max: v.between[1], allowInvalid: false, helpText: v.message });
  }
  sheet.hidden = Boolean(format.hidden);
  sheet.frozenRows = format.frozenRows ?? 0;
  return JSON.parse(sheet.state());
}

/**
 * Compare the state of a tab with the expected state, part by part. The
 * assertion names the first cell or the first entry that differs.
 */
function checkLayout(tab, actualText, expected) {
  const actual = JSON.parse(actualText);
  check(
    actual.grid.length === expected.grid.length && actual.grid[0].length === expected.grid[0].length,
    `${tab}: the grid is ${expected.grid.length} rows by ${expected.grid[0].length} columns ` +
      `(${actual.grid.length} by ${actual.grid[0].length})`,
  );
  const cells = [];
  expected.grid.forEach((row, r) => {
    row.forEach((value, c) => {
      if (actual.grid[r][c] !== value) cells.push(`row ${r + 1} column ${c + 1}`);
    });
  });
  check(cells.length === 0, `${tab}: each formula and label is at its cell (differs: ${cells.slice(0, 3).join(", ")})`);
  const differ = (part) => {
    const a = new Map(actual[part].map(([k, v]) => [String(k), JSON.stringify(v)]));
    const e = new Map(expected[part].map(([k, v]) => [String(k), JSON.stringify(v)]));
    const keys = [...new Set([...a.keys(), ...e.keys()])].filter((k) => a.get(k) !== e.get(k));
    return keys.slice(0, 3).map((k) => `${k}: ${a.get(k) ?? "none"} for ${e.get(k) ?? "none"}`);
  };
  check(differ("styles").length === 0, `${tab}: each cell style matches (${differ("styles").join("; ")})`);
  check(differ("widths").length === 0, `${tab}: each column width matches (${differ("widths").join("; ")})`);
  check(differ("validation").length === 0, `${tab}: the data validation matches (${differ("validation").join("; ")})`);
  check(
    JSON.stringify(actual.rules) === JSON.stringify(expected.rules),
    `${tab}: the ${expected.rules.length} conditional formats match in their order`,
  );
  check(actual.hidden === expected.hidden, `${tab}: the hidden flag is ${expected.hidden}`);
  check(actual.frozenRows === expected.frozenRows, `${tab}: ${expected.frozenRows} rows are frozen`);
}

/**
 * Wait the given count of milliseconds, so the next Date differs.
 */
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Print rows as a table with a header, with each number to 6 decimals.
 */
function table(header, rows) {
  const text = (v) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(6) : String(v));
  const all = [header, ...rows].map((cells) => cells.map(text));
  const widths = header.map((_, c) => Math.min(48, Math.max(...all.map((cells) => cells[c].length))));
  for (const cells of all) {
    console.log(`  ${cells.map((v, c) => v.slice(0, 48).padEnd(widths[c])).join("  ")}`);
  }
}

/**
 * Each number inside a JSON value.
 */
function numbersOf(value) {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numbersOf);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(numbersOf);
  return [];
}

/**
 * Check that every cell of the Exposure grid outside B1:B2 matches the
 * snapshot.
 */
function checkKept(before, name) {
  const after = book.tab(EXPOSURE_TAB).snapshot();
  check(after.length === before.length && after[0].length === before[0].length, `${name}: the grid size stays`);
  const changed = [];
  after.forEach((cells, r) => {
    cells.forEach((value, c) => {
      if (c === 1 && r < 2) return;
      if (value !== before[r][c]) changed.push(`row ${r + 1} column ${c + 1}`);
    });
  });
  check(changed.length === 0, `${name}: the lines and the funds stay (changed: ${changed.slice(0, 3).join(", ")})`);
}

/**
 * Check that a run after the first creates no tab, changes no part of the
 * report tab, and changes no cell of the Holdings tab.
 */
function checkNoTabChange(reportBefore, logFrom, name) {
  const entries = state.log.slice(logFrom);
  check(!entries.some((e) => e.op === "insertSheet"), `${name}: the script creates no tab`);
  check(
    JSON.stringify(book.names()) === JSON.stringify(["Holdings", EXPOSURE_TAB, REPORT_TAB]),
    `${name}: the spreadsheet holds the same three tabs`,
  );
  check(book.tab(REPORT_TAB).state() === reportBefore, `${name}: no cell and no format of the report tab changes`);
  check(
    entries.every((e) => e.sheet === undefined || e.sheet === EXPOSURE_TAB),
    `${name}: the script changes the Concentration.Exposure tab alone`,
  );
}

/**
 * The count of setValues calls in the log from the index `from`.
 */
function writesSince(from) {
  return state.log.slice(from).filter((entry) => entry.op === "setValues").length;
}

/**
 * The index of the first log entry from the index `from` that meets the
 * test, or -1.
 */
function indexSince(from, test) {
  const index = state.log.slice(from).findIndex(test);
  return index < 0 ? -1 : from + index;
}

/**
 * A synthetic answer of the route for the given position ids: one fund and
 * the given count of lines. Line i has one source, the position i modulo the
 * count of ids.
 */
function bigAnswer(ids, lineCount) {
  const weight = 1 / lineCount;
  return {
    measures: Object.fromEntries(MEASURES.map((name, i) => [name, i + 0.5])),
    funds: [
      {
        id: ids[0],
        ticker: ids[0],
        reportDate: "2026-06-30",
        accessionNumber: "0000000000-26-000001",
        holdingCount: 100,
        weight: 0.025,
        coveredWeight: 0.025,
        mergedByTicker: 0,
        mergedByLei: 0,
        mergedByName: 0,
      },
    ],
    lines: Array.from({ length: lineCount }, (_, i) => ({
      key: `line:${i}`,
      name: `Line ${i}`,
      ticker: null,
      lei: null,
      class: "stock",
      weight,
      sources: { [ids[i % ids.length]]: weight },
    })),
  };
}

function main() {
  if (OFFLINE) {
    console.log("OFFLINE: the harness skips the one real request to the concentration route.\n");
  } else if (API_KEY === "") {
    console.error("Set HOLDINGS_API_KEY in the environment. The usage line in the header of check.mjs shows how.");
    process.exit(2);
  }
  const context = vm.createContext({ ...services });
  for (const file of SCRIPT_FILES) {
    const source = readFileSync(file, "utf8");
    const name = file.slice(SRC.length + 1);
    for (const text of ["ScriptApp", "newTrigger", "getScriptProperties", "Logger", "console."]) {
      check(!source.includes(text), `${name} holds no "${text}" text`);
    }
    vm.runInContext(source, context, { filename: file });
  }
  for (const name of ["onOpen", "onInstall", "setApiKey", "refreshConcentration", "ensureTabs"]) {
    check(typeof context[name] === "function", `the script defines ${name}`);
  }
  const accepted = {
    [EXPOSURE_TAB]: expectedState(acceptedDefinition(EXPOSURE_TAB)),
    [REPORT_TAB]: expectedState(acceptedDefinition(REPORT_TAB)),
  };

  console.log("== Manifest");
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
  check(JSON.stringify(manifest.oauthScopes) === JSON.stringify(SCOPES), "the manifest holds the two scopes alone");
  check(
    JSON.stringify(manifest.urlFetchWhitelist) === JSON.stringify(URL_PREFIXES),
    "the manifest allows fetches under https://data.coopersbs.com/funds/v1/ alone",
  );
  check(ROUTE_URL.startsWith(URL_PREFIXES[0]), "the route is under the allowed prefix");
  check(manifest.runtimeVersion === "V8", "the manifest sets the V8 runtime");
  console.log("  pass");

  console.log("\n== Pure functions");
  check(context.faultText(502, "<html>") === "FAULT: 502", "a body that is not JSON gives the status alone");
  check(
    context.faultText(401, '{"error":{"code":"invalid_key","status":401}}') === "FAULT: 401 invalid_key",
    "a JSON error body gives the status and the code",
  );
  const long = "D".repeat(70);
  const cut = context.buildPositions(
    [
      ["", 1, long],
      ["", 1, `${long}x`],
    ],
    { symbol: 0, value: 1, description: 2 },
  );
  check(cut.length === 1 && cut[0].id.length === 64, "two keys with one first 64 code units give one position");
  check(context.tickerOf("BRK.B") === "BRK.B" && context.tickerOf("$abc") === "$abc", "a valid symbol is a ticker");
  check(context.tickerOf("CASH SWEEP") === null, "a symbol that fails the ticker pattern gives no ticker");
  check(context.columnNumber("A") === 1 && context.columnNumber("AZ") === 52, "columnNumber reads A and AZ");
  console.log("  pass");

  console.log("\n== onOpen and onInstall");
  const menuItems = [
    { label: "Refresh", handler: "refreshConcentration" },
    { label: "Set API key", handler: "setApiKey" },
  ];
  context.onOpen({ authMode: "NONE" });
  context.onInstall({ authMode: "FULL" });
  check(state.menus.length === 2, "onOpen and onInstall each add one menu");
  for (const menu of state.menus) {
    check(
      menu.addon === true && JSON.stringify(menu.items) === JSON.stringify(menuItems),
      "the add-on menu holds Refresh and Set API key",
    );
  }
  check(state.log.length === 0, "onOpen and onInstall change no tab");
  check(state.userProperties.size === 0, "onOpen and onInstall write no property");
  console.log("  pass");

  console.log("\n== Set API key");
  state.promptAnswers.push({ button: BUTTON.CANCEL, text: API_KEY });
  context.setApiKey();
  check(state.userProperties.size === 0 && state.alerts.length === 0, "Cancel saves nothing and shows no message");
  state.promptAnswers.push({ button: BUTTON.CLOSE, text: API_KEY });
  context.setApiKey();
  check(state.userProperties.size === 0 && state.alerts.length === 0, "the close button saves nothing");
  state.promptAnswers.push({ button: BUTTON.OK, text: "not a key\nsecond line" });
  context.setApiKey();
  check(state.userProperties.size === 0, "a text with a space or a line break is not saved");
  check(
    state.alerts.at(-1) === "This text is not an API key. Nothing changed.",
    "the person sees that nothing changed",
  );
  state.promptAnswers.push({ button: BUTTON.OK, text: `  ${API_KEY}\n` });
  context.setApiKey();
  check(state.userProperties.get(KEY_PROPERTY) === API_KEY, "OK saves the key without the white space");
  check(state.userProperties.size === 1, "the key is the one user property");
  check(state.alerts.at(-1) === "The API key is saved. Use Refresh in the add-on menu.", "the person sees the save");
  check(
    state.prompts.every((p) => p.buttons === BUTTON_SET.OK_CANCEL),
    "the input dialog has the buttons OK and Cancel",
  );
  check(
    [...state.alerts, ...state.prompts.flatMap((p) => [p.title, p.text])].every((text) => !text.includes(API_KEY)),
    "no dialog text and no message holds the key",
  );
  check(state.log.length === 0, "Set API key changes no tab");
  console.log("  pass");

  console.log("\n== Run 1: the Holdings tab alone, then one real request to the route");
  check(JSON.stringify(book.names()) === '["Holdings"]', "the spreadsheet fake starts with the Holdings tab alone");
  state.fetchHandler = OFFLINE ? offlineFetch : liveFetch;
  const logStart = state.log.length;
  context.refreshConcentration();
  check(state.fetchCalls.length === 1 && liveRequests + offlineRequests === 1, "run 1 sends one request");
  check(state.lockTaken === 1 && state.lockReleased === 1, "run 1 takes the lock and releases it");

  const inserts = state.log.slice(logStart).filter((e) => e.op === "insertSheet");
  check(
    inserts.map((e) => e.sheet).join() === `${EXPOSURE_TAB},${REPORT_TAB}`,
    "run 1 creates Concentration.Exposure, then Concentration",
  );
  check(
    JSON.stringify(book.names()) === JSON.stringify(["Holdings", EXPOSURE_TAB, REPORT_TAB]),
    "the two new tabs follow the Holdings tab",
  );
  const fetchAt = indexSince(logStart, (e) => e.op === "fetch");
  const createCalls = state.log.slice(logStart, fetchAt);
  check(
    fetchAt > logStart && createCalls.every((e) => e.sheet === EXPOSURE_TAB || e.sheet === REPORT_TAB),
    `the script creates and formats the two tabs before the request (${createCalls.length} calls)`,
  );
  const [snap] = state.atFetch;
  check(snap.names.length === 3, "both tabs exist at the time of the request");
  const created = Object.fromEntries(snap.tabs);
  for (const tab of [EXPOSURE_TAB, REPORT_TAB]) checkLayout(tab, created[tab], accepted[tab]);
  const report = book.tab(REPORT_TAB);
  check(report.cell("B15") === 0.01, "the threshold cell B15 holds its default 0.01");
  check(report.cell("A18").startsWith("=LET(") && report.cell("A18").includes("\n"), "A18 holds the report formula");

  const call = state.fetchCalls[0];
  check(call.url === ROUTE_URL, "the request goes to the concentration route");
  check(call.options.method === "post", "the method is post");
  check(call.options.contentType === "application/json", "the content type is application/json");
  check(call.options.muteHttpExceptions === true, "muteHttpExceptions is true");
  check(
    Object.keys(call.options.headers).join() === "Authorization" &&
      call.options.headers.Authorization === `Bearer ${API_KEY}`,
    "the Authorization header holds the key of the user property alone",
  );
  const body = JSON.parse(call.options.payload);
  check(Object.keys(body).join() === "positions", "the body holds only positions");
  const sent = body.positions;
  check(sent.length === EXPECTED.length, `the body holds ${EXPECTED.length} positions`);
  sent.forEach((p, i) => {
    const want = EXPECTED[i];
    check(
      Object.keys(p).every((k) => ["id", "ticker", "weight"].includes(k)),
      `position ${i} holds id, ticker, and weight alone`,
    );
    check(p.id === want.id, `position ${i} has the id of the hand calculation`);
    check(
      want.ticker === null ? !("ticker" in p) : p.ticker === want.ticker,
      `position ${i} has the ticker of the hand calculation`,
    );
    check(near(p.weight, want.sum / EXPECTED_TOTAL), `position ${i} has the weight of the hand calculation`);
  });
  check(!sent.some((p) => p.id === "" || p.id === "XYZ"), "the two skipped rows send nothing");
  check(!("ticker" in sent.find((p) => p.id === PLAN_FUND)), "the plan fund sends no ticker");
  check(
    numbersOf(body).every((n) => n > 0 && n <= 1),
    "each number of the body is a weight, and no dollar value appears",
  );
  check(
    !/Test (brokerage|IRA|plan)/.test(call.options.payload) &&
      !/\b(3000|2000|1000|500|10000)\b/.test(call.options.payload),
    "no account name and no value of the Holdings fake appears in the body",
  );

  console.log("\nPositions sent, with the hand calculation (total of the kept rows: 10,000):");
  table(
    ["id", "ticker", "sum of the key", "sum / 10,000", "weight sent"],
    sent.map((p, i) => [p.id, p.ticker ?? "(none)", EXPECTED[i].sum, EXPECTED[i].sum / EXPECTED_TOTAL, p.weight]),
  );

  const x = book.tab(EXPOSURE_TAB);
  check(x.cell("B1") === "OK", `B1 is OK (B1 holds "${x.cell("B1")}")`);
  check(isDate(x.cell("B2")), "B2 is a Date");
  const firstTime = x.cell("B2").getTime();

  const answer = JSON.parse(liveText);
  const measures = x.block(5, 2, 8, 1).map((cells) => cells[0]);
  MEASURES.forEach((name, i) => check(measures[i] === answer.measures[name], `B${5 + i} holds ${name}`));

  const funds = answer.funds;
  const fundCells = x.block(5, 4, funds.length, 10);
  funds.forEach((fund, i) => {
    FUND_FIELDS.forEach((name, c) => {
      check(fundCells[i][c] === (fund[name] ?? ""), `D${5 + i}:M holds ${name} of fund ${i}`);
    });
  });

  const ids = sent.map((p) => p.id);
  const idCells = x.block(4, 21, 1, x.getMaxColumns() - 20)[0];
  check(
    ids.every((id, i) => idCells[i] === id),
    "U4 onward holds the ids in the body order",
  );
  check(
    idCells.slice(ids.length).every((v) => v === ""),
    "no id follows the last position",
  );

  const lines = answer.lines;
  const lineCells = x.block(5, 15, lines.length, 6);
  const sourceCells = x.block(5, 21, lines.length, ids.length);
  /**
   * The count of cells of the lines block and of the sources block that
   * differ from the live answer.
   */
  const lineFaults = () => {
    let faults = 0;
    const lineNow = x.block(5, 15, lines.length, 6);
    const sourceNow = x.block(5, 21, lines.length, ids.length);
    lines.forEach((line, i) => {
      LINE_FIELDS.forEach((name, c) => {
        if (lineNow[i][c] !== (line[name] ?? "")) faults += 1;
      });
      ids.forEach((id, c) => {
        const want = id in (line.sources ?? {}) ? (line.sources[id] ?? "") : "";
        if (sourceNow[i][c] !== want) faults += 1;
      });
    });
    return faults;
  };
  check(lineFaults() === 0, "O5:T and the sources from U5 hold each line in the answer order");
  check(
    x
      .block(5 + lines.length, 15, x.getMaxRows() - 4 - lines.length, 6 + ids.length)
      .every((c) => c.every((v) => v === "")),
    "the rows under the last line are empty",
  );
  const lostLabels = [];
  accepted[EXPOSURE_TAB].grid.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== "" && x.grid[r][c] !== value) lostLabels.push(`row ${r + 1} column ${c + 1}`);
    });
  });
  check(lostLabels.length === 0, `each label of Concentration.Exposure stays after the write (${lostLabels.join()})`);

  const afterFetch = state.log.slice(fetchAt + 1);
  check(
    afterFetch.every((e) => e.sheet === EXPOSURE_TAB),
    "after the request, run 1 changes the Concentration.Exposure tab alone",
  );
  check(
    [...state.tabsAsked].every((name) => ["Holdings", EXPOSURE_TAB, REPORT_TAB].includes(name)),
    "the script asks for the Holdings tab and the two report tabs alone",
  );
  check(
    writesSince(fetchAt) === 2,
    `after the request, run 1 makes 1 setValues call for the data and 1 for the status (${writesSince(fetchAt)})`,
  );
  const dataWrite = afterFetch.find((e) => e.op === "setValues");
  check(
    dataWrite.row === 4 &&
      dataWrite.column === 2 &&
      dataWrite.rows === x.getMaxRows() - 3 &&
      dataWrite.columns === x.getMaxColumns() - 1,
    "the data write follows the request and covers B4 to the last column and the last row of the grid",
  );
  const textRanges = afterFetch
    .filter((e) => e.op === "setNumberFormat" && e.value === "@")
    .map((e) => `${e.row},${e.column},${e.columns}`);
  check(
    ["5,4,2", "5,7,1", "5,15,4", `4,21,${x.getMaxColumns() - 20}`].every((r) => textRanges.includes(r)),
    "the script sets the text format on D:E, G, O:R, and row 4 from U",
  );
  const firstFormat = afterFetch.findIndex((e) => e.op === "setNumberFormat");
  const firstWrite = afterFetch.findIndex((e) => e.op === "setValues");
  check(firstFormat >= 0 && firstFormat < firstWrite, "the text format comes before the data write");

  const stock = lines.find((l) => l.sources && STOCK in l.sources);
  check(stock !== undefined, "a line holds a source from the direct stock");
  check(
    [STOCK, FUND_A, FUND_B].every((id) => typeof stock.sources[id] === "number" && stock.sources[id] > 0),
    "the direct stock line has a source from the stock and from each of the two index funds",
  );
  const plan = lines.find((l) => l.sources && PLAN_FUND in l.sources);
  check(plan?.class === "unknown", `the plan fund line has the class unknown (${plan?.class})`);
  const money = lines.find((l) => l.sources && MONEY in l.sources);
  check(money?.class === "fund", `the money market fund line has the class fund (${money?.class})`);

  console.log("\nGrid of Concentration.Exposure after run 1:", `${x.getMaxRows()} rows, ${x.getMaxColumns()} columns.`);
  console.log("\nFunds block, D5:M:");
  table(FUND_FIELDS, fundCells);
  console.log("\nFirst 10 lines, O5:T and the sources from U5:");
  table(
    [...LINE_FIELDS, ...ids.map((id) => id.slice(0, 12))],
    [...lineCells.slice(0, 10).map((cells, i) => [...cells, ...sourceCells[i]])],
  );
  console.log("\nLines of the direct positions:");
  table(
    [...LINE_FIELDS, ...ids.map((id) => id.slice(0, 12))],
    lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => [STOCK, BOND, MONEY, PLAN_FUND].some((id) => line.sources && id in line.sources))
      .map(({ i }) => [...lineCells[i], ...sourceCells[i]]),
  );
  console.log("\nMeasures, B5:B12:");
  table(
    ["measure", "value"],
    MEASURES.map((name, i) => [name, measures[i]]),
  );

  const reportState = report.state();

  const bigLines = x.getMaxRows() - 4 + 200;
  const bigRows = bigLines + 4;
  console.log(`\n== Run 2: status 200 with 40 positions and ${bigLines} lines`);
  const forty = Array.from({ length: 40 }, (_, i) => [`T${String(i).padStart(3, "0")}`, "Example brokerage", 1, "A"]);
  replaceHoldings(forty);
  const fortyIds = forty.map((row) => row[0]);
  const big = bigAnswer(fortyIds, bigLines);
  const at = (row, column) => x.block(row, column, 1, 1)[0][0];
  let logFrom = state.log.length;
  state.fetchHandler = () => fakeResponse(200, JSON.stringify(big));
  context.refreshConcentration();
  check(state.fetchCalls.length === 2, "run 2 calls the fake once");
  checkNoTabChange(reportState, logFrom, "run 2");
  check(x.cell("B1") === "OK", `B1 is OK (B1 holds "${x.cell("B1")}")`);
  check(
    x.getMaxRows() === bigRows && x.getMaxColumns() === 60,
    `the grid grew to ${bigRows} rows and 60 columns (${x.getMaxRows()} by ${x.getMaxColumns()})`,
  );
  check(at(5, 16) === "Line 0" && at(bigRows, 16) === `Line ${bigLines - 1}`, `column P holds the ${bigLines} lines`);
  const lastId = fortyIds[(bigLines - 1) % 40];
  check(
    at(4, 21 + fortyIds.indexOf(lastId)) === lastId && near(at(bigRows, 21 + fortyIds.indexOf(lastId)), 1 / bigLines),
    `the source column of ${lastId} holds the weight of the last line`,
  );
  check(at(4, 60) === "T039", "column BH holds the id T039");
  console.log(`  B1: ${x.cell("B1")}; grid ${x.getMaxRows()} rows, ${x.getMaxColumns()} columns`);

  console.log("\n== Run 3: status 200 with the answer of run 1 again");
  replaceHoldings(HOLDINGS_ROWS);
  logFrom = state.log.length;
  state.fetchHandler = () => fakeResponse(200, liveText);
  context.refreshConcentration();
  checkNoTabChange(reportState, logFrom, "run 3");
  check(x.getMaxRows() === bigRows && x.getMaxColumns() === 60, "the grid does not shrink");
  check(lineFaults() === 0, "the lines and the sources of run 1 are back");
  check(
    x.block(5 + funds.length, 4, x.getMaxRows() - 4 - funds.length, 10).every((c) => c.every((v) => v === "")),
    "the rows under the last fund are empty",
  );
  check(
    x
      .block(5 + lines.length, 15, x.getMaxRows() - 4 - lines.length, x.getMaxColumns() - 14)
      .every((c) => c.every((v) => v === "")),
    "the rows under the last line are empty, so no line of run 2 stays",
  );
  check(
    x.block(4, 21 + ids.length, 1, x.getMaxColumns() - 20 - ids.length)[0].every((v) => v === ""),
    "no id of run 2 follows the last position",
  );
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 4: status 429 with an error body of the route");
  let before = x.snapshot();
  const thirdTime = x.cell("B2").getTime();
  check(thirdTime >= firstTime, "B2 holds the time of run 3");
  pause(5);
  logFrom = state.log.length;
  state.fetchHandler = () =>
    fakeResponse(
      429,
      JSON.stringify({ error: { code: "rate_limited", message: "The request is over the limit.", status: 429 } }),
    );
  context.refreshConcentration();
  check(state.fetchCalls.length === 4, "run 4 calls the fake once");
  check(x.cell("B1") === "FAULT: 429 rate_limited", `B1 is FAULT: 429 rate_limited (B1 holds "${x.cell("B1")}")`);
  check(isDate(x.cell("B2")) && x.cell("B2").getTime() > thirdTime, "B2 holds a later time");
  checkKept(before, "run 4");
  checkNoTabChange(reportState, logFrom, "run 4");
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 5: Set API key with an empty box removes the key");
  before = x.snapshot();
  const fourthTime = x.cell("B2").getTime();
  pause(5);
  logFrom = state.log.length;
  state.promptAnswers.push({ button: BUTTON.OK, text: "  " });
  context.setApiKey();
  check(!state.userProperties.has(KEY_PROPERTY), "an empty box removes the saved key");
  check(state.alerts.at(-1) === "The saved API key is removed.", "the person sees the removal");
  state.fetchHandler = null;
  context.refreshConcentration();
  check(state.fetchCalls.length === 4, "run 5 calls no fetch");
  check(
    x.cell("B1") === "FAULT: no API key. Use Set API key in the add-on menu.",
    `B1 names the missing key and the menu item (B1 holds "${x.cell("B1")}")`,
  );
  check(x.cell("B2").getTime() > fourthTime, "B2 holds a later time");
  checkKept(before, "run 5");
  checkNoTabChange(reportState, logFrom, "run 5");
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 6: the lock is held");
  state.userProperties.set(KEY_PROPERTY, API_KEY);
  state.lockHeldByOther = true;
  before = x.snapshot();
  const logSix = state.log.length;
  pause(5);
  context.refreshConcentration();
  check(state.fetchCalls.length === 4, "run 6 calls no fetch");
  check(state.log.length === logSix, "run 6 changes no cell");
  check(JSON.stringify(x.snapshot()) === JSON.stringify(before), "run 6 leaves each cell, B1 and B2 too");
  state.lockHeldByOther = false;
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 7: 201 keys");
  const many = Array.from({ length: 201 }, (_, i) => [`T${String(i).padStart(3, "0")}`, "Example brokerage", 1, "A"]);
  replaceHoldings(many);
  before = x.snapshot();
  logFrom = state.log.length;
  context.refreshConcentration();
  check(state.fetchCalls.length === 4, "run 7 calls no fetch");
  check(x.cell("B1") === "FAULT: too many positions", `B1 is FAULT: too many positions (B1 holds "${x.cell("B1")}")`);
  checkKept(before, "run 7");
  checkNoTabChange(reportState, logFrom, "run 7");
  console.log(`  B1: ${x.cell("B1")}`);

  const keyCells = book.sheets.flatMap((sheet) =>
    sheet.grid.flatMap((cells) => cells.filter((v) => typeof v === "string" && v.includes(API_KEY))),
  );
  check(keyCells.length === 0, "no cell of any tab holds the key");
  check(
    state.alerts.every((text) => !text.includes(API_KEY)),
    "no message holds the key",
  );
  check(liveRequests === (OFFLINE ? 0 : 1), `the harness sent ${OFFLINE ? "no" : "one"} real request`);
  console.log(`\nAll ${passed} assertions passed. The harness sent ${OFFLINE ? "no" : "one"} real request.`);
}

try {
  main();
} catch (e) {
  if (e instanceof AssertionFailure) {
    console.error(`\nFAILED: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
