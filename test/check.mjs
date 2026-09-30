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
 * The harness calculates the two run-time formulas B7 and B8 of the report
 * alone, with a small evaluator. It reads the text of each other formula. No
 * formula can hold a column letter of the Holdings tab. Each range of the
 * sources block must end at the column of position MAX_POSITIONS. Each
 * FILTER must sit in IFNA or IFERROR, or GUARDED_FILTERS must name it.
 *
 * The last runs put tabs of another layout version into the spreadsheet
 * fake. They check that a refresh replaces those tabs and keeps the values
 * that the person typed.
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
const EQUITY = ["weight", "lineCount", "top10Weight", "hhi", "effectiveCount"];
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
const LINE_FIELDS = ["key", "name", "ticker", "lei", "class", "weight", "stockWeight"];

/**
 * The first column of each block of the Concentration.Exposure tab: the
 * funds in D, the overlaps in O, the lines in T, the part name in AA, and
 * the sources in AB. Column 1 is A.
 */
const FUND_AT = 4;
const OVERLAP_AT = 15;
const LINE_AT = 20;
const PART_AT = LINE_AT + LINE_FIELDS.length;
const SOURCE_AT = PART_AT + 1;

/**
 * The first row of the equity block of the Concentration.Exposure tab.
 */
const EQUITY_ROW = 27;

/**
 * The cell of the Concentration.Exposure tab that holds the layout version,
 * and the two cells of the Concentration tab that a person types in.
 */
const VERSION_CELL = "B3";
const THRESHOLD_CELL = "B21";
const MINIMUM_CELL = "B22";

/**
 * The cell of the fund header of the Concentration tab, and the cell of the
 * report spill.
 */
const HEADER_CELL = "H24";
const SPILL_CELL = "A25";

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

  getIndex() {
    return book.sheets.indexOf(this) + 1;
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

  getValue() {
    return this.sheet.grid[this.row - 1][this.column - 1];
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

  deleteSheet(sheet) {
    const index = this.sheets.indexOf(sheet);
    if (index < 0) throw new Error(`The spreadsheet holds no sheet "${sheet.name}".`);
    if (this.sheets.filter((other) => other !== sheet && !other.hidden).length === 0) {
      throw new Error("A spreadsheet must keep one visible sheet.");
    }
    this.sheets.splice(index, 1);
    this.log.push({ sheet: sheet.name, op: "deleteSheet", index });
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
    flush: () => {
      state.log.push({ op: "flush" });
    },
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
 * The invented holdings of the two index funds of the synthetic answer. Each
 * holding has a merge key, a name, a ticker, a class, and a percent of the
 * fund. Fund A holds stocks and cash. Fund B holds the stock and a bond of
 * company B, a bond of company C, and a held fund with a negative percent.
 * The percents of each fund add up to 100.
 */
const OFFLINE_FUNDS = {
  [FUND_A]: [
    { key: "name:EXAMPLE COMPANY B", name: "Example Company B", ticker: null, class: "stock", pct: 85 },
    { key: "name:EXAMPLE COMPANY C", name: "Example Company C", ticker: null, class: "stock", pct: 5 },
    { key: `ticker:${STOCK}`, name: "Example company", ticker: STOCK, class: "stock", pct: 5 },
    { key: "name:CASH", name: "Cash", ticker: null, class: "cash", pct: 5 },
  ],
  [FUND_B]: [
    { key: "name:EXAMPLE COMPANY B", name: "Example Company B", ticker: null, class: "stock", pct: 80 },
    { key: "name:EXAMPLE COMPANY B", name: "Example Company B", ticker: null, class: "other", pct: 5 },
    { key: "name:EXAMPLE COMPANY C", name: "Example Company C", ticker: null, class: "other", pct: 5 },
    { key: `ticker:${STOCK}`, name: "Example company", ticker: STOCK, class: "stock", pct: 5 },
    { key: "name:CASH", name: "Cash", ticker: null, class: "cash", pct: 6 },
    { key: "name:EXAMPLE HELD FUND", name: "Example Held Fund", ticker: null, class: "fund", pct: -1 },
  ],
};

/**
 * The line of each direct position of the synthetic answer. The bond and the
 * plan fund get the class unknown, and the money market fund gets the class
 * fund, as the route gives them.
 */
const OFFLINE_DIRECT = {
  [STOCK]: { key: `ticker:${STOCK}`, name: "Example company", ticker: STOCK, class: "stock" },
  [BOND]: { key: `ticker:${BOND}`, name: BOND, ticker: BOND, class: "unknown" },
  [MONEY]: { key: `ticker:${MONEY}`, name: "Example money market fund", ticker: MONEY, class: "fund" },
  [PLAN_FUND]: { key: `id:${PLAN_FUND}`, name: PLAN_FUND, ticker: null, class: "unknown" },
};

/**
 * The equity block of a list of stock weights, or null when their sum is not
 * above 0.
 */
function equityOf(stockWeights) {
  const weight = stockWeights.reduce((a, b) => a + b, 0);
  if (!(weight > 0)) return null;
  const shares = stockWeights.filter((w) => w !== 0).map((w) => w / weight);
  const squares = shares.reduce((a, share) => a + share * share, 0);
  const top = [...shares].sort((a, b) => b - a).slice(0, 10);
  return {
    weight,
    lineCount: shares.length,
    top10Weight: top.reduce((a, b) => a + b, 0),
    hhi: squares * 10000,
    effectiveCount: 1 / squares,
  };
}

/**
 * The overlaps block of a list of funds and lines: one element for each pair
 * of funds that hold stock in one or more of the same lines, largest overlap
 * first.
 */
function overlapsOf(funds, lines) {
  const overlaps = [];
  funds.forEach((first, i) => {
    for (const second of funds.slice(i + 1)) {
      let overlap = 0;
      let sharedLineCount = 0;
      for (const line of lines) {
        const a = (line.stockSources[first.id] ?? 0) / first.weight;
        const b = (line.stockSources[second.id] ?? 0) / second.weight;
        if (a > 0 && b > 0) {
          overlap += Math.min(a, b);
          sharedLineCount += 1;
        }
      }
      if (sharedLineCount > 0) overlaps.push({ ids: [first.id, second.id], overlap, sharedLineCount });
    }
  });
  return overlaps.sort((a, b) => b.overlap - a.overlap);
}

/**
 * A synthetic answer of the route for the positions of run 1, in the shape
 * of a real answer of schema version 1.7. Each name and each number is
 * invented. A position of OFFLINE_FUNDS enters through its holdings and gets
 * a residual line. Each other position enters as one line of OFFLINE_DIRECT.
 * Holdings with one key share one line. The line of company B holds a stock
 * from both funds and a bond from fund B. The line of company C holds a
 * stock from fund A and a bond from fund B.
 */
function offlineAnswer(positions) {
  const byKey = new Map();
  const add = (holding, id, weight) => {
    if (!byKey.has(holding.key)) {
      const { key, name, ticker } = holding;
      byKey.set(key, { key, name, ticker, weight: 0, sources: {}, stockWeight: 0, stockSources: {}, sizes: {} });
    }
    const line = byKey.get(holding.key);
    line.weight += weight;
    line.sources[id] = (line.sources[id] ?? 0) + weight;
    if (holding.class === "stock") {
      line.stockWeight += weight;
      line.stockSources[id] = (line.stockSources[id] ?? 0) + weight;
    }
    line.sizes[holding.class] = (line.sizes[holding.class] ?? 0) + Math.abs(weight);
  };
  const funds = [];
  for (const { id, weight } of positions) {
    const holdings = OFFLINE_FUNDS[id];
    if (holdings === undefined) {
      add(OFFLINE_DIRECT[id], id, weight);
      continue;
    }
    for (const holding of holdings) add(holding, id, (weight * holding.pct) / 100);
    const covered = holdings.reduce((a, holding) => a + holding.pct, 0) / 100;
    const residual = { key: `residual:${id}`, name: `${id} (not looked through)`, ticker: null, class: "other" };
    add(residual, id, weight * Math.max(0, 1 - covered));
    funds.push({
      id,
      ticker: id,
      reportDate: "2026-06-30",
      accessionNumber: `0000000000-26-00000${funds.length + 1}`,
      holdingCount: holdings.length,
      weight,
      coveredWeight: weight * covered,
      mergedByTicker: 1,
      mergedByLei: 0,
      mergedByName: holdings.length - 1,
    });
  }
  const lines = [...byKey.values()].map((line) => ({
    key: line.key,
    name: line.name,
    ticker: line.ticker,
    lei: null,
    class: Object.entries(line.sizes).sort((a, b) => b[1] - a[1])[0][0],
    weight: line.weight,
    sources: line.sources,
    stockWeight: line.stockWeight,
    stockSources: line.stockSources,
  }));
  lines.sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : 1));
  const weights = lines.map((line) => line.weight);
  const sum = weights.reduce((a, b) => a + b, 0);
  const squares = weights.reduce((a, w) => a + w * w, 0);
  const lookedThrough = funds.reduce((a, fund) => a + fund.coveredWeight, 0);
  return {
    measures: {
      lineCount: lines.length,
      top10Weight: weights.slice(0, 10).reduce((a, b) => a + b, 0),
      hhi: squares * 10000,
      effectiveCount: 1 / squares,
      lookedThroughWeight: lookedThrough,
      notLookedThroughWeight: sum - lookedThrough,
      weightSum: sum,
      weightDifference: sum - 1,
      equity: equityOf(lines.map((line) => line.stockWeight)),
    },
    funds,
    overlaps: overlapsOf(funds, lines),
    lines,
    meta: {
      schemaVersion: "1.7",
      source: "Invented data of the offline run",
      pctValueUnit: "percent of net assets",
      disclaimer: "Invented data. Not investment advice.",
    },
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
 * Check that a run with tabs of the current layout creates no tab, deletes
 * no tab, changes no part of the report tab, and changes no cell of the
 * Holdings tab. `names` holds the tabs of the spreadsheet in their order.
 */
function checkNoTabChange(reportBefore, logFrom, name, names = ["Holdings", EXPOSURE_TAB, REPORT_TAB]) {
  const entries = state.log.slice(logFrom);
  check(
    !entries.some((e) => e.op === "insertSheet" || e.op === "deleteSheet"),
    `${name}: the script creates no tab and deletes no tab`,
  );
  check(
    JSON.stringify(book.names()) === JSON.stringify(names),
    `${name}: the spreadsheet holds the same three tabs in the same order`,
  );
  check(book.tab(REPORT_TAB).state() === reportBefore, `${name}: no cell and no format of the report tab changes`);
  check(
    entries.every((e) => e.sheet === undefined || e.sheet === EXPOSURE_TAB),
    `${name}: the script changes the Concentration.Exposure tab alone`,
  );
}

/**
 * The rows of the run-time block A15:B24 of the Exposure tab, with each
 * start time in milliseconds.
 */
function runRows() {
  return book
    .tab(EXPOSURE_TAB)
    .block(15, 1, 10, 2)
    .map(([start, seconds]) => [isDate(start) ? start.getTime() : start, seconds]);
}

/**
 * The value of a formula of the report that reads the run-time block. The
 * evaluator knows the parts that the two run-time formulas use alone: a
 * number, a text in quotes, a reference to a cell or a range of the tab
 * Concentration.Exposure, the comparison `=`, and the functions IF,
 * ISNUMBER, COUNT, and AVERAGE. COUNT and AVERAGE read the numbers of a
 * range and skip each other cell, as Google Sheets does. AVERAGE of no number
 * gives the error #DIV/0!. Another part stops the harness.
 */
function calculate(formula, sheet) {
  const body = formula.replace(/^=/, "");
  const tokens =
    body.match(/'[^']*'!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|"[^"]*"|[A-Z]+\(|\d+(?:\.\d+)?|[(),=]/g) ?? [];
  if (tokens.join("") !== body) throw new Error(`The evaluator cannot read the formula ${formula}.`);
  let i = 0;
  const next = () => tokens[i++];
  const expect = (token) => {
    if (next() !== token) throw new Error(`The evaluator expected "${token}" in ${formula}.`);
  };
  const primary = () => {
    const token = next();
    if (token.endsWith("(")) {
      const args = [];
      if (tokens[i] !== ")") {
        args.push(expression());
        while (tokens[i] === ",") {
          next();
          args.push(expression());
        }
      }
      expect(")");
      return { call: token.slice(0, -1), args };
    }
    if (token.startsWith("'")) {
      const [tab, a1] = token.split("!");
      if (tab !== `'${EXPOSURE_TAB}'`) throw new Error(`The evaluator reads ${EXPOSURE_TAB} alone, not ${tab}.`);
      return {
        ref: parseA1(a1.replaceAll("$", ""), sheet.getMaxRows(), sheet.getMaxColumns()),
        single: !a1.includes(":"),
      };
    }
    if (token.startsWith('"')) return { value: token.slice(1, -1) };
    if (/^\d/.test(token)) return { value: Number(token) };
    throw new Error(`The evaluator cannot read "${token}" in ${formula}.`);
  };
  const expression = () => {
    const left = primary();
    if (tokens[i] !== "=") return left;
    next();
    return { equal: [left, primary()] };
  };
  const numbers = (node) => {
    if (!node.ref) throw new Error("COUNT and AVERAGE take a range in the run-time formulas.");
    const { row, column, rows, columns } = node.ref;
    return sheet
      .block(row, column, rows, columns)
      .flat()
      .filter((v) => typeof v === "number");
  };
  const value = (node) => {
    if ("value" in node) return node.value;
    if (node.ref) {
      if (!node.single) throw new Error("A range stands alone in the run-time formulas.");
      return sheet.block(node.ref.row, node.ref.column, 1, 1)[0][0];
    }
    if (node.equal) return value(node.equal[0]) === value(node.equal[1]);
    const { call, args } = node;
    if (call === "IF") return value(args[0]) ? value(args[1]) : value(args[2]);
    if (call === "ISNUMBER") return typeof value(args[0]) === "number";
    if (call === "COUNT") return numbers(args[0]).length;
    if (call === "AVERAGE") {
      const list = numbers(args[0]);
      return list.length === 0 ? "#DIV/0!" : list.reduce((a, b) => a + b, 0) / list.length;
    }
    throw new Error(`The evaluator does not know the function ${call}.`);
  };
  const tree = expression();
  if (i !== tokens.length) throw new Error(`The evaluator did not read the whole formula ${formula}.`);
  return value(tree);
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
 * The rows that the script must write for the lines of an answer, by the
 * part rule: one row for the stock part of a line, one row for its other
 * part, or both. A row holds the fields of LINE_FIELDS, the part name, and
 * one cell for each position id. A stock cell holds the entry of
 * stockSources. An other cell holds the entry of sources minus the entry of
 * stockSources. A part of 0 gives an empty cell.
 */
function expectedParts(lines, ids) {
  const entry = (map, id) => (Object.hasOwn(map ?? {}, id) ? map[id] : null);
  const rows = [];
  for (const line of lines) {
    const fields = LINE_FIELDS.map((name) => line[name] ?? "");
    const stock = ids.map((id) => entry(line.stockSources, id) ?? "");
    const other = ids.map((id) => {
      const part = (entry(line.sources, id) ?? 0) - (entry(line.stockSources, id) ?? 0);
      return part === 0 ? "" : part;
    });
    const hasStock = line.stockWeight !== 0 || stock.some((value) => value !== "");
    if (hasStock) rows.push([...fields, "stock", ...stock]);
    if (!hasStock || other.some((value) => value !== "")) rows.push([...fields, "other", ...other]);
  }
  return rows;
}

/**
 * The sum of the numbers of a list of cells. A cell with no number adds 0.
 */
function sumCells(cells) {
  return cells.reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
}

/**
 * A synthetic answer of the route for the given position ids: one fund, no
 * pair of funds, no equity block, and the given count of lines. Line i has
 * one source, the position i modulo the count of ids, and no stock.
 */
function bigAnswer(ids, lineCount) {
  const weight = 1 / lineCount;
  return {
    measures: { ...Object.fromEntries(MEASURES.map((name, i) => [name, i + 0.5])), equity: null },
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
    overlaps: [],
    lines: Array.from({ length: lineCount }, (_, i) => ({
      key: `line:${i}`,
      name: `Line ${i}`,
      ticker: null,
      lei: null,
      class: "other",
      weight,
      sources: { [ids[i % ids.length]]: weight },
      stockWeight: 0,
      stockSources: {},
    })),
  };
}

/**
 * The FILTER calls of the report formulas that need no IFNA and no IFERROR,
 * by the text of their condition arguments. The guards are texts of the
 * same formula. Together they make a call with no match unused. The reason
 * states why.
 */
const GUARDED_FILTERS = {
  sel: {
    guards: ["top,IF(SUM(sel)=0,"],
    reason: "top uses the stock rows only when a stock is at or above the threshold",
  },
  keep: {
    guards: ["main,IF(nown=0,FILTER(grpAll,big),", "nis,IF(nown+ng=0,"],
    reason: "main uses ownRows only when nown, the count of the rows of their own, is above 0",
  },
  grp: {
    guards: ["ng,IF(SUM(grp)=0,0,SUM(big)),", "nsm,IF(SUM(grp)=0,0,SUM(sm)),"],
    reason: "ng and nsm are 0 when no line is in a group, so no group row is used",
  },
  "grp,LC=x": {
    guards: ["cls,UNIQUE(FILTER(LC,grp)),"],
    reason: "each class x comes from the lines of grp, so a line always matches",
  },
  big: {
    guards: ["ng,IF(SUM(grp)=0,0,SUM(big)),", "main,IF(nown=0,FILTER(grpAll,big),IF(ng=0,", "nis,IF(nown+ng=0,"],
    reason: "main uses the big group rows only when ng, the count of the big groups, is above 0",
  },
  sm: {
    guards: ["nsm,IF(SUM(grp)=0,0,SUM(sm)),", "nis,IF(nown+ng=0,IF(nsm=0,", "IF(nsm=0,SORT(main,4,FALSE),"],
    reason: "nis uses smallRow only when nsm, the count of the small groups, is above 0",
  },
  psel: {
    guards: ["plist,IF(SUM(psel)=0,"],
    reason: "plist uses the pair rows only when a pair is at or above the overlap minimum",
  },
};

/**
 * Each formula of a tab state: each cell text that starts with "=", and the
 * formula of each conditional format.
 */
function formulasOf(stateText) {
  const tab = JSON.parse(stateText);
  const cells = [];
  tab.grid.forEach((row, r) => {
    row.forEach((value, c) => {
      if (typeof value === "string" && value.startsWith("=")) cells.push({ at: `row ${r + 1} column ${c + 1}`, value });
    });
  });
  return [...cells, ...tab.rules.map((rule, i) => ({ at: `conditional format ${i + 1}`, value: rule.formula }))];
}

/**
 * The string literals of a formula, and the formula with each literal
 * replaced by an empty literal.
 */
function splitLiterals(formula) {
  const literals = [];
  const code = formula.replace(/"(?:[^"]|"")*"/g, (text) => {
    literals.push(text);
    return '""';
  });
  return { code, literals };
}

/**
 * Each FILTER call of a formula. A call holds its text, the text of its
 * condition arguments, and the enclosing calls from the outside in, each
 * with the index of the argument that holds the FILTER. The parser skips
 * string literals, and it treats an array literal in braces as one call.
 */
function filterCalls(formula) {
  const calls = [];
  const stack = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      i += 1;
      while (i < formula.length && !(formula[i] === '"' && formula[i + 1] !== '"')) i += formula[i] === '"' ? 2 : 1;
    } else if (ch === "(" || ch === "{") {
      const name = ch === "{" ? "{" : (/[A-Za-z_][A-Za-z0-9_.]*$/.exec(formula.slice(0, i))?.[0] ?? "");
      const outer = stack.map((f) => ({ name: f.name, arg: f.arg }));
      stack.push({ name: name.toUpperCase(), arg: 0, start: i - name.length, commas: [], outer });
    } else if (ch === "," || ch === ";") {
      const top = stack.at(-1);
      if (top) {
        top.arg += 1;
        top.commas.push(i);
      }
    } else if (ch === ")" || ch === "}") {
      const frame = stack.pop();
      if (frame?.name === "FILTER") {
        const conditionAt = frame.commas[0] ?? i;
        calls.push({
          text: formula.slice(frame.start, i + 1),
          condition: formula.slice(conditionAt + 1, i),
          outer: frame.outer,
        });
      }
    }
    i += 1;
  }
  return calls;
}

/**
 * The treatment of one FILTER call: the IFNA or IFERROR that holds it in its
 * first argument, the guards of GUARDED_FILTERS, or null.
 */
function filterTreatment(call, formula) {
  const wrap = call.outer.findLast((f) => (f.name === "IFNA" || f.name === "IFERROR") && f.arg === 0);
  if (wrap) return wrap.name;
  const guarded = GUARDED_FILTERS[call.condition];
  if (guarded && guarded.guards.every((text) => formula.includes(text))) return `guard ${call.condition}`;
  return null;
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
  for (const name of ["onOpen", "onInstall", "setApiKey", "refreshConcentration", "ensureTabs", "readInputs"]) {
    check(typeof context[name] === "function", `the script defines ${name}`);
  }
  const accepted = {
    [EXPOSURE_TAB]: expectedState(acceptedDefinition(EXPOSURE_TAB)),
    [REPORT_TAB]: expectedState(acceptedDefinition(REPORT_TAB)),
  };

  /**
   * Run Refresh once, and give the time before and after the call in
   * milliseconds.
   */
  const timedRun = () => {
    const before = Date.now();
    context.refreshConcentration();
    return { before, after: Date.now() };
  };

  /**
   * The start time of each good run, newest first, as the harness expects
   * the run-time block to hold it.
   */
  const runStarts = [];

  /**
   * Check that a good run put its start time and its seconds at the top of
   * the run-time block, and that the block holds the 10 newest good runs
   * alone, newest first.
   */
  const checkRecorded = (name, times) => {
    const rows = runRows();
    const [start, seconds] = rows[0];
    check(start >= times.before && start <= times.after, `${name}: A15 holds the start time of the run`);
    check(
      typeof seconds === "number" && seconds >= 0 && seconds <= (times.after - times.before) / 1000 + 1e-9,
      `${name}: B15 holds the seconds of the run (${seconds})`,
    );
    runStarts.unshift(start);
    checkBlock(name);
  };

  /**
   * Check that the run-time block holds the 10 newest good runs alone,
   * newest first.
   */
  const checkBlock = (name) => {
    const kept = runStarts.slice(0, 10);
    check(
      runRows().every(([s, sec], n) =>
        n < kept.length ? s === kept[n] && typeof sec === "number" : s === "" && sec === "",
      ),
      `${name}: the run-time block holds the ${kept.length} newest good runs, newest first`,
    );
  };

  /**
   * Check that a run with a fault, or a run that cannot get the lock, adds
   * no row to the run-time block.
   */
  const checkNoRecord = (name) => checkBlock(`${name} adds no run time`);

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
  check(
    [1, 26, 27, 52, 220, 702, 703].every((n) => context.columnNumber(context.columnLetter(n)) === n),
    "columnLetter is the inverse of columnNumber",
  );
  const small = new FakeSheet("small", 2, 2, []);
  context.growGrid(small, 3, 5);
  context.growGrid(small, 1, 1);
  check(small.getMaxRows() === 3 && small.getMaxColumns() === 5, "growGrid adds rows and columns and never shrinks");

  const handLines = [
    {
      key: "name:BOTH",
      class: "stock",
      weight: 0.5,
      sources: { A: 0.25, B: 0.25 },
      stockWeight: 0.375,
      stockSources: { A: 0.25, B: 0.125 },
    },
    { key: "name:BOND", class: "other", weight: 0.125, sources: { A: 0.125 }, stockWeight: 0, stockSources: {} },
    {
      key: "name:STOCK",
      class: "stock",
      weight: 0.0625,
      sources: { B: 0.0625 },
      stockWeight: 0.0625,
      stockSources: { B: 0.0625 },
    },
    { key: "residual:A", class: "other", weight: 0, sources: { A: 0 }, stockWeight: 0, stockSources: {} },
    {
      key: "name:SHORT",
      class: "stock",
      weight: 0,
      sources: { A: 0.5, B: -0.5 },
      stockWeight: 0,
      stockSources: { A: 0.5, B: -0.5 },
    },
  ];
  const handRows = context
    .partRows(handLines, ["A", "B"])
    .map((cells) => [cells[0], ...cells.slice(LINE_FIELDS.length)]);
  check(
    JSON.stringify(handRows) ===
      JSON.stringify([
        ["name:BOTH", "stock", 0.25, 0.125],
        ["name:BOTH", "other", "", 0.125],
        ["name:BOND", "other", 0.125, ""],
        ["name:STOCK", "stock", "", 0.0625],
        ["residual:A", "other", "", ""],
        ["name:SHORT", "stock", 0.5, -0.5],
      ]),
    `partRows gives the stock part and the other part of each source (${JSON.stringify(handRows)})`,
  );

  const defaults = JSON.stringify({ threshold: 0.01, overlapMinimum: 0.1 });
  const typed = new FakeSheet("typed", 30, 3, []);
  check(JSON.stringify(context.readInputs(null)) === defaults, "readInputs gives the defaults for an absent tab");
  check(
    JSON.stringify(context.readInputs(typed)) === defaults,
    "readInputs gives the defaults for a tab with no label",
  );
  typed.grid[4] = ["Threshold", 1.5, ""];
  typed.grid[5] = [" Overlap minimum ", "10%", ""];
  check(
    JSON.stringify(context.readInputs(typed)) === defaults,
    "readInputs gives the default for a number above 1 and for a text",
  );
  typed.grid[4][1] = 0;
  typed.grid[5][1] = 1;
  check(
    JSON.stringify(context.readInputs(typed)) === JSON.stringify({ threshold: 0, overlapMinimum: 1 }),
    "readInputs reads 0 and 1 from the cells next to the two labels",
  );
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
  const runOne = timedRun();
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
  const layoutVersion = vm.runInContext("LAYOUT_VERSION", context);
  check(
    Number.isInteger(layoutVersion) && JSON.parse(created[EXPOSURE_TAB]).grid[2][1] === layoutVersion,
    `${VERSION_CELL} of the hidden tab holds the layout version of layout.gs (${layoutVersion})`,
  );
  check(report.cell(THRESHOLD_CELL) === 0.01, `the threshold cell ${THRESHOLD_CELL} holds its default 0.01`);
  check(report.cell(MINIMUM_CELL) === 0.1, `the overlap minimum cell ${MINIMUM_CELL} holds its default 0.1`);
  check(
    report.cell(SPILL_CELL).startsWith("=LET(") && report.cell(SPILL_CELL).includes("\n"),
    `${SPILL_CELL} holds the report formula`,
  );

  console.log("\n== Report formulas");
  const formulas = [EXPOSURE_TAB, REPORT_TAB].flatMap((tab) =>
    formulasOf(created[tab]).map((f) => ({ ...f, at: `${tab} ${f.at}` })),
  );
  check(formulas.length > 10, `the two tabs hold the report formulas (${formulas.length})`);

  const lettered = formulas.filter(({ value }) => {
    const { code, literals } = splitLiterals(value);
    return /'?Holdings'?!\$?[A-Z]/i.test(code) || literals.some((text) => /Holdings'?!\$?[A-Z]+\$?[\d:]/i.test(text));
  });
  check(
    lettered.length === 0,
    `no formula holds a reference of the form Holdings!<letter> (${lettered.map((f) => f.at).join(", ")})`,
  );
  const holdingsColumns = vm.runInContext("HOLDINGS_COLUMNS", context);
  check(
    report.cell("B4").includes('EXACT(TRIM(Holdings!$1:$1),"Value")'),
    "B4 finds the Value column by the header text in row 1",
  );
  check(
    holdingsColumns.every(
      (name) => report.cell("B4").includes(`"${name}"`) || report.cell(SPILL_CELL).includes(`"${name}"`),
    ),
    `B4 and ${SPILL_CELL} find each column of findColumns by its header text (${holdingsColumns.join(", ")})`,
  );
  check(report.cell("B4").includes('"No Holdings column Value"'), "B4 shows a text when no Value column exists");

  const lastSource = vm.runInContext("SOURCE_COLUMN + MAX_POSITIONS - 1", context);
  const firstSource = vm.runInContext("SOURCE_COLUMN", context);
  check(firstSource === SOURCE_AT, `the sources block starts at column ${SOURCE_AT}`);
  const exposureRange = /'Concentration\.Exposure'!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d*)/g;
  for (const cell of [HEADER_CELL, SPILL_CELL]) {
    const sourceRanges = [...report.cell(cell).matchAll(exposureRange)].filter(
      (m) => columnNumber(m[1]) === firstSource,
    );
    check(sourceRanges.length === 2, `${cell} reads the sources block and the id row (${sourceRanges.length} ranges)`);
    check(
      sourceRanges.every((m) => columnNumber(m[3]) === lastSource),
      `the source ranges of ${cell} end at column ${lastSource}, the column of position MAX_POSITIONS ` +
        `(${sourceRanges.map((m) => m[0]).join(", ")})`,
    );
  }
  const exposureState = JSON.parse(created[EXPOSURE_TAB]);
  const exposureStyles = new Map(exposureState.styles);
  check(exposureState.grid[0].length >= lastSource, `the Exposure grid holds column ${lastSource}`);
  check(
    new Map(exposureState.widths).get(lastSource) === 110,
    `the column width of the sources block reaches column ${lastSource}`,
  );
  check(
    exposureStyles.get(cellKey(4, lastSource))?.fontWeight === "bold" &&
      exposureStyles.get(cellKey(5, lastSource))?.numberFormat === "0.00000",
    `the header format and the number format of the sources block reach column ${lastSource}`,
  );

  const reportFormulas = formulas.filter((f) => f.at.startsWith(`${REPORT_TAB} `));
  const allLines = reportFormulas.filter((f) => /'Concentration\.Exposure'!\$?B\$?[678]\b/.test(f.value));
  check(
    allLines.length === 0,
    `no formula reads the top 10 weight, the HHI, or the effective count of all the lines (${allLines.map((f) => f.at).join(", ")})`,
  );
  const reportCells = JSON.parse(created[REPORT_TAB]).grid.flat();
  check(
    !reportCells.includes("Sum check") && reportFormulas.every((f) => !/"pass"|"fail"/.test(f.value)),
    "the report holds no Sum check cell and no pass or fail text",
  );
  check(
    reportCells.every((value) => typeof value !== "string" || !value.includes("fund inside funds")) &&
      report.cell(SPILL_CELL).includes('"fund","Funds held by your funds, not looked through"'),
    "the class fund has a label of its own, so no row shows the text fund inside funds",
  );

  const filterRows = [];
  const usedGuards = new Set();
  for (const { at, value } of formulas) {
    for (const call of filterCalls(value)) {
      const treatment = filterTreatment(call, value);
      check(treatment !== null, `${at}: ${call.text} sits in IFNA or IFERROR, or GUARDED_FILTERS names it`);
      if (treatment.startsWith("guard")) usedGuards.add(call.condition);
      filterRows.push([at.replace(/^Concentration /, ""), call.text, treatment]);
    }
  }
  check(filterRows.length > 0, "the report formulas hold FILTER calls");
  check(
    Object.keys(GUARDED_FILTERS).every((condition) => usedGuards.has(condition)),
    "each entry of GUARDED_FILTERS guards a FILTER call",
  );
  console.log("  pass");
  console.log("\nFILTER calls and their treatment:");
  table(["cell", "call", "treatment"], filterRows);
  console.log("\nGuards of GUARDED_FILTERS:");
  for (const [condition, { reason }] of Object.entries(GUARDED_FILTERS)) console.log(`  ${condition}: ${reason}`);

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

  /**
   * The values that B27:B31 must hold for an equity block. A null block
   * gives five empty cells.
   */
  const equityWant = (equity) => EQUITY.map((name) => equity?.[name] ?? "");
  const equityCells = (sheet) => sheet.block(EQUITY_ROW, 2, EQUITY.length, 1).map((cells) => cells[0]);
  check(
    JSON.stringify(equityCells(x)) === JSON.stringify(equityWant(answer.measures.equity)),
    `B${EQUITY_ROW}:B${EQUITY_ROW + EQUITY.length - 1} holds the equity measures, in the order ${EQUITY.join(", ")}`,
  );

  const funds = answer.funds;
  const fundCells = x.block(5, FUND_AT, funds.length, 10);
  funds.forEach((fund, i) => {
    FUND_FIELDS.forEach((name, c) => {
      check(fundCells[i][c] === (fund[name] ?? ""), `D${5 + i}:M holds ${name} of fund ${i}`);
    });
  });

  const pairs = answer.overlaps;
  /**
   * The count of cells of the overlaps block that differ from the answer.
   */
  const pairFaults = (sheet) => {
    const now = sheet.block(5, OVERLAP_AT, pairs.length, 4);
    return pairs.filter((pair, i) => {
      const want = [pair.ids[0], pair.ids[1], pair.overlap, pair.sharedLineCount];
      return want.some((value, c) => now[i][c] !== value);
    }).length;
  };
  check(
    pairFaults(x) === 0,
    `O5:R holds the two ids, overlap, and sharedLineCount of each of the ${pairs.length} pairs`,
  );
  check(
    x.block(5 + pairs.length, OVERLAP_AT, x.getMaxRows() - 4 - pairs.length, 4).every((c) => c.every((v) => v === "")),
    "the rows under the last pair are empty",
  );

  const ids = sent.map((p) => p.id);
  const idCells = x.block(4, SOURCE_AT, 1, x.getMaxColumns() - SOURCE_AT + 1)[0];
  check(
    ids.every((id, i) => idCells[i] === id),
    "AB4 onward holds the ids in the body order",
  );
  check(
    idCells.slice(ids.length).every((v) => v === ""),
    "no id follows the last position",
  );

  const lines = answer.lines;
  const parts = expectedParts(lines, ids);
  const partWidth = LINE_FIELDS.length + 1 + ids.length;
  /**
   * The count of cells of the lines block and of the sources block that
   * differ from the part rows of the answer.
   */
  const partFaults = (sheet) => {
    let faults = 0;
    const now = sheet.block(5, LINE_AT, parts.length, partWidth);
    parts.forEach((cells, r) => {
      cells.forEach((value, c) => {
        if (now[r]?.[c] !== value) faults += 1;
      });
    });
    return faults;
  };
  check(
    partFaults(x) === 0,
    `T5:AA and the sources from AB5 hold the ${parts.length} part rows of the ${lines.length} lines, in the answer order`,
  );
  check(
    x
      .block(5 + parts.length, LINE_AT, x.getMaxRows() - 4 - parts.length, partWidth)
      .every((c) => c.every((v) => v === "")),
    "the rows under the last part row are empty",
  );
  const partCells = x.block(5, LINE_AT, parts.length, partWidth);
  const stockIndex = LINE_FIELDS.indexOf("stockWeight");
  const weightIndex = LINE_FIELDS.indexOf("weight");
  const partIndex = LINE_FIELDS.length;
  const stockRows = partCells.filter((cells) => cells[partIndex] === "stock");
  const otherRows = partCells.filter((cells) => cells[partIndex] === "other");
  check(stockRows.length + otherRows.length === partCells.length, "column AA of each row holds stock or other");
  check(
    stockRows.every((cells) => Math.abs(sumCells(cells.slice(partIndex + 1)) - cells[stockIndex]) < 1e-9),
    "the source cells of each stock row add up to the stock weight of its line",
  );
  check(
    otherRows.every(
      (cells) => Math.abs(sumCells(cells.slice(partIndex + 1)) - (cells[weightIndex] - cells[stockIndex])) < 1e-9,
    ),
    "the source cells of each other row add up to the weight minus the stock weight of its line",
  );
  const stockSum = sumCells(stockRows.map((cells) => cells[stockIndex]));
  const otherSum = otherRows.reduce((sum, cells) => sum + cells[weightIndex] - cells[stockIndex], 0);
  check(
    Math.abs(stockSum + otherSum - answer.measures.weightSum) < 1e-9,
    `the stock rows and the other rows add up to weightSum (${stockSum + otherSum} for ${answer.measures.weightSum})`,
  );
  if (answer.measures.equity !== null) {
    check(
      Math.abs(stockSum - answer.measures.equity.weight) < 1e-9,
      `the stock weights of the stock rows add up to equity.weight (${stockSum} for ${answer.measures.equity.weight})`,
    );
  }
  const lostLabels = [];
  accepted[EXPOSURE_TAB].grid.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== "" && x.grid[r][c] !== value) lostLabels.push(`row ${r + 1} column ${c + 1}`);
    });
  });
  check(lostLabels.length === 0, `each label of Concentration.Exposure stays after the write (${lostLabels.join()})`);

  const afterFetch = state.log.slice(fetchAt + 1);
  check(
    afterFetch.every((e) => e.sheet === EXPOSURE_TAB || e.op === "flush"),
    "after the request, run 1 changes the Concentration.Exposure tab alone",
  );
  check(
    [...state.tabsAsked].every((name) => ["Holdings", EXPOSURE_TAB, REPORT_TAB].includes(name)),
    "the script asks for the Holdings tab and the two report tabs alone",
  );
  check(
    writesSince(fetchAt) === 3,
    "after the request, run 1 makes 1 setValues call for the data, 1 for the status, and 1 for the run time " +
      `(${writesSince(fetchAt)})`,
  );
  const writeRanges = afterFetch
    .filter((e) => e.op === "setValues")
    .map((e) => `${e.row},${e.column},${e.rows},${e.columns}`);
  const flushAt = afterFetch.findIndex((e) => e.op === "flush");
  const setAt = afterFetch.map((e, n) => (e.op === "setValues" ? n : -1)).filter((n) => n >= 0);
  check(
    writeRanges[1] === "1,2,2,1" && writeRanges[2] === "15,1,10,2",
    `the status write B1:B2 comes before the run-time write A15:B24 (${writeRanges.slice(1).join("; ")})`,
  );
  check(
    flushAt > setAt[1] && flushAt < setAt[2] && afterFetch.filter((e) => e.op === "flush").length === 1,
    "run 1 calls SpreadsheetApp.flush once, after the status write and before the run-time write",
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
    [
      `5,${FUND_AT},2`,
      `5,${FUND_AT + 3},1`,
      `5,${OVERLAP_AT},2`,
      `5,${LINE_AT},4`,
      `4,${SOURCE_AT},${x.getMaxColumns() - SOURCE_AT + 1}`,
    ].every((r) => textRanges.includes(r)),
    "the script sets the text format on D:E, G, O:P, T:W, and row 4 from AB",
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

  console.log("\n== Run time of run 1");
  checkRecorded("run 1", runOne);
  check(x.cell("A14") === "runStart" && x.cell("B14") === "seconds", "the header of the run-time block stays");
  console.log(`  A15: ${new Date(runRows()[0][0]).toISOString()}; B15: ${runRows()[0][1]} seconds`);

  const partHeader = [...LINE_FIELDS, "part", ...ids.map((id) => id.slice(0, 12))];
  console.log("\nGrid of Concentration.Exposure after run 1:", `${x.getMaxRows()} rows, ${x.getMaxColumns()} columns.`);
  console.log(`The answer holds ${lines.length} lines, and the tab holds ${parts.length} part rows.`);
  console.log("\nFunds block, D5:M:");
  table(FUND_FIELDS, fundCells);
  console.log("\nOverlaps block, O5:R:");
  table(["firstId", "secondId", "overlap", "sharedLineCount"], x.block(5, OVERLAP_AT, pairs.length, 4));
  console.log("\nFirst 10 part rows, T5:AA and the sources from AB5:");
  table(partHeader, partCells.slice(0, 10));
  console.log("\nPart rows of the lines of the direct positions:");
  const directKeys = new Set(
    lines.filter((l) => [STOCK, BOND, MONEY, PLAN_FUND].some((id) => l.sources && id in l.sources)).map((l) => l.key),
  );
  table(
    partHeader,
    partCells.filter((cells) => directKeys.has(cells[0])),
  );
  console.log("\nMeasures, B5:B12:");
  table(
    ["measure", "value"],
    MEASURES.map((name, i) => [name, measures[i]]),
  );
  console.log("\nEquity measures, B27:B31:");
  table(
    ["equity", "value"],
    EQUITY.map((name, i) => [name, equityCells(x)[i]]),
  );

  const reportState = report.state();

  const bigLines = x.getMaxRows() - 4 + 200;
  const bigRows = bigLines + 4;
  console.log(`\n== Run 2: status 200 with 40 positions, ${bigLines} lines, no pair, and no equity block`);
  const forty = Array.from({ length: 40 }, (_, i) => [`T${String(i).padStart(3, "0")}`, "Example brokerage", 1, "A"]);
  replaceHoldings(forty);
  const fortyIds = forty.map((row) => row[0]);
  const big = bigAnswer(fortyIds, bigLines);
  const at = (row, column) => x.block(row, column, 1, 1)[0][0];
  let logFrom = state.log.length;
  let fetches = state.fetchCalls.length;
  state.fetchHandler = () => fakeResponse(200, JSON.stringify(big));
  pause(2);
  const runTwo = timedRun();
  check(state.fetchCalls.length === fetches + 1, "run 2 calls the fake once");
  checkRecorded("run 2", runTwo);
  checkNoTabChange(reportState, logFrom, "run 2");
  check(x.cell("B1") === "OK", `B1 is OK (B1 holds "${x.cell("B1")}")`);
  const exposureColumns = accepted[EXPOSURE_TAB].grid[0].length;
  check(
    x.getMaxRows() === bigRows && x.getMaxColumns() === exposureColumns,
    `the grid grew to ${bigRows} rows and keeps ${exposureColumns} columns (${x.getMaxRows()} by ${x.getMaxColumns()})`,
  );
  check(
    at(5, LINE_AT + 1) === "Line 0" && at(bigRows, LINE_AT + 1) === `Line ${bigLines - 1}`,
    `column U holds the ${bigLines} lines`,
  );
  check(
    at(5, PART_AT) === "other" && at(bigRows, PART_AT) === "other",
    "a line with no stock gives one row of the other part",
  );
  const lastId = fortyIds[(bigLines - 1) % 40];
  check(
    at(4, SOURCE_AT + fortyIds.indexOf(lastId)) === lastId &&
      near(at(bigRows, SOURCE_AT + fortyIds.indexOf(lastId)), 1 / bigLines),
    `the source column of ${lastId} holds the weight of the last line`,
  );
  check(at(4, SOURCE_AT + 39) === "T039", "the column of position 40 holds the id T039");
  check(
    equityCells(x).every((value) => value === ""),
    "B27:B31 is empty when the answer holds no equity block",
  );
  check(x.cell("A26") === "equity" && x.cell("B26") === "value", "the header of the equity block stays");
  check(
    x.block(5, OVERLAP_AT, x.getMaxRows() - 4, 4).every((c) => c.every((v) => v === "")),
    "O5:R is empty when the answer holds no pair",
  );
  console.log(`  B1: ${x.cell("B1")}; grid ${x.getMaxRows()} rows, ${x.getMaxColumns()} columns`);

  console.log("\n== Run 3: status 200 with the answer of run 1 again, and tabs of the current layout version");
  replaceHoldings(HOLDINGS_ROWS);
  logFrom = state.log.length;
  state.fetchHandler = () => fakeResponse(200, liveText);
  pause(2);
  const runThree = timedRun();
  checkNoTabChange(reportState, logFrom, "run 3");
  check(x.cell(VERSION_CELL) === layoutVersion, `${VERSION_CELL} holds the current layout version, so both tabs stay`);
  checkRecorded("run 3", runThree);
  check(x.getMaxRows() === bigRows && x.getMaxColumns() === exposureColumns, "the grid does not shrink");
  check(partFaults(x) === 0, "the part rows of run 1 are back");
  check(pairFaults(x) === 0, "the pairs of run 1 are back");
  check(
    JSON.stringify(equityCells(x)) === JSON.stringify(equityWant(answer.measures.equity)),
    "the equity measures of run 1 are back",
  );
  check(
    x.block(5 + funds.length, FUND_AT, x.getMaxRows() - 4 - funds.length, 10).every((c) => c.every((v) => v === "")),
    "the rows under the last fund are empty",
  );
  check(
    x
      .block(5 + parts.length, LINE_AT, x.getMaxRows() - 4 - parts.length, x.getMaxColumns() - LINE_AT + 1)
      .every((c) => c.every((v) => v === "")),
    "the rows under the last part row are empty, so no line of run 2 stays",
  );
  check(
    x.block(4, SOURCE_AT + ids.length, 1, x.getMaxColumns() - SOURCE_AT + 1 - ids.length)[0].every((v) => v === ""),
    "no id of run 2 follows the last position",
  );
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 4: status 429 with an error body of the route");
  let before = x.snapshot();
  const thirdTime = x.cell("B2").getTime();
  check(thirdTime >= firstTime, "B2 holds the time of run 3");
  pause(5);
  logFrom = state.log.length;
  fetches = state.fetchCalls.length;
  state.fetchHandler = () =>
    fakeResponse(
      429,
      JSON.stringify({ error: { code: "rate_limited", message: "The request is over the limit.", status: 429 } }),
    );
  context.refreshConcentration();
  check(state.fetchCalls.length === fetches + 1, "run 4 calls the fake once");
  check(x.cell("B1") === "FAULT: 429 rate_limited", `B1 is FAULT: 429 rate_limited (B1 holds "${x.cell("B1")}")`);
  check(isDate(x.cell("B2")) && x.cell("B2").getTime() > thirdTime, "B2 holds a later time");
  checkKept(before, "run 4");
  checkNoRecord("run 4");
  checkNoTabChange(reportState, logFrom, "run 4");
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 5: status 200 with an answer that the report cannot show");
  const noOverlaps = JSON.parse(liveText);
  delete noOverlaps.overlaps;
  const nullStock = JSON.parse(liveText);
  nullStock.lines[0].stockWeight = null;
  const noStock = JSON.parse(liveText);
  delete noStock.lines.at(-1).stockWeight;
  const textStock = JSON.parse(liveText);
  textStock.lines[0].stockWeight = "0.1";
  const badAnswers = [
    ["an answer with no overlaps list", noOverlaps],
    ["a line with null in stockWeight", nullStock],
    ["a line with no stockWeight field", noStock],
    ["a line with a text in stockWeight", textStock],
  ];
  for (const [name, bad] of badAnswers) {
    check(context.parseAnswer(JSON.stringify(bad)) === null, `parseAnswer refuses ${name}`);
    before = x.snapshot();
    const lastTime = x.cell("B2").getTime();
    pause(5);
    logFrom = state.log.length;
    fetches = state.fetchCalls.length;
    state.fetchHandler = () => fakeResponse(200, JSON.stringify(bad));
    context.refreshConcentration();
    check(state.fetchCalls.length === fetches + 1, `${name}: run 5 calls the fake once`);
    check(
      x.cell("B1") === "FAULT: 200 bad_answer",
      `${name}: B1 is FAULT: 200 bad_answer (B1 holds "${x.cell("B1")}")`,
    );
    check(x.cell("B2").getTime() > lastTime, `${name}: B2 holds a later time`);
    checkKept(before, name);
    checkNoRecord(name);
    checkNoTabChange(reportState, logFrom, name);
  }
  check(context.parseAnswer(liveText) !== null, "parseAnswer accepts the answer of run 1");
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 6: Set API key with an empty box removes the key");
  before = x.snapshot();
  const fifthTime = x.cell("B2").getTime();
  pause(5);
  logFrom = state.log.length;
  fetches = state.fetchCalls.length;
  state.promptAnswers.push({ button: BUTTON.OK, text: "  " });
  context.setApiKey();
  check(!state.userProperties.has(KEY_PROPERTY), "an empty box removes the saved key");
  check(state.alerts.at(-1) === "The saved API key is removed.", "the person sees the removal");
  state.fetchHandler = null;
  context.refreshConcentration();
  check(state.fetchCalls.length === fetches, "run 6 calls no fetch");
  check(
    x.cell("B1") === "FAULT: no API key. Use Set API key in the add-on menu.",
    `B1 names the missing key and the menu item (B1 holds "${x.cell("B1")}")`,
  );
  check(x.cell("B2").getTime() > fifthTime, "B2 holds a later time");
  checkKept(before, "run 6");
  checkNoRecord("run 6");
  checkNoTabChange(reportState, logFrom, "run 6");
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 7: the lock is held");
  state.userProperties.set(KEY_PROPERTY, API_KEY);
  state.lockHeldByOther = true;
  before = x.snapshot();
  const logSeven = state.log.length;
  pause(5);
  context.refreshConcentration();
  check(state.fetchCalls.length === fetches, "run 7 calls no fetch");
  check(state.log.length === logSeven, "run 7 changes no cell");
  check(JSON.stringify(x.snapshot()) === JSON.stringify(before), "run 7 leaves each cell, B1 and B2 too");
  checkNoRecord("run 7");
  state.lockHeldByOther = false;
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 8: 201 keys");
  const many = Array.from({ length: 201 }, (_, i) => [`T${String(i).padStart(3, "0")}`, "Example brokerage", 1, "A"]);
  replaceHoldings(many);
  before = x.snapshot();
  logFrom = state.log.length;
  context.refreshConcentration();
  check(state.fetchCalls.length === fetches, "run 8 calls no fetch");
  check(x.cell("B1") === "FAULT: too many positions", `B1 is FAULT: too many positions (B1 holds "${x.cell("B1")}")`);
  checkKept(before, "run 8");
  checkNoRecord("run 8");
  checkNoTabChange(reportState, logFrom, "run 8");
  console.log(`  B1: ${x.cell("B1")}`);

  console.log("\n== Run 9: eight good runs, so eleven good runs in all");
  replaceHoldings(HOLDINGS_ROWS);
  state.fetchHandler = () => fakeResponse(200, liveText);
  const firstStart = runStarts.at(-1);
  for (let n = 4; n <= 11; n += 1) {
    pause(2);
    const times = timedRun();
    check(x.cell("B1") === "OK", `good run ${n}: B1 is OK`);
    checkRecorded(`good run ${n}`, times);
  }
  check(runStarts.length === 11, "the harness counted eleven good runs");
  const rowsNow = runRows();
  check(
    rowsNow.every(([start]) => start !== firstStart) && rowsNow.at(-1)[0] === runStarts[9],
    "the eleventh good run keeps 10 rows and drops the run of run 1, the oldest",
  );
  table(
    ["row", "runStart", "seconds"],
    rowsNow.map(([start, seconds], n) => [`${15 + n}`, new Date(start).toISOString(), seconds]),
  );

  console.log("\n== Run-time formulas B7 and B8 of the report");
  const lastFormula = report.cell("B7");
  const averageFormula = report.cell("B8");
  check(
    report.cell("A7") === "Last run time" && report.cell("A8") === "Average (last 10)",
    "A7 and A8 hold the labels of the run time",
  );
  const known = (seconds) => {
    const sheet = new FakeSheet(EXPOSURE_TAB, 30, 4, []);
    sheet.grid[13][0] = "runStart";
    sheet.grid[13][1] = "seconds";
    seconds.forEach((value, n) => {
      sheet.grid[14 + n][0] = new Date(Date.UTC(2026, 0, 10 - n));
      sheet.grid[14 + n][1] = value;
    });
    return sheet;
  };
  const cases = [
    { name: "no recorded run", seconds: [], last: "", average: "" },
    { name: "one run", seconds: [4.2], last: 4.2, average: 4.2 },
    { name: "three runs", seconds: [3, 1.5, 6], last: 3, average: 3.5 },
    { name: "ten runs", seconds: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], last: 10, average: 5.5 },
  ];
  const formulaRows = [];
  for (const c of cases) {
    const sheet = known(c.seconds);
    const last = calculate(lastFormula, sheet);
    const average = calculate(averageFormula, sheet);
    check(c.last === "" ? last === "" : near(last, c.last), `${c.name}: B7 is ${JSON.stringify(c.last)} (${last})`);
    check(
      c.average === "" ? average === "" : near(average, c.average),
      `${c.name}: B8 is ${JSON.stringify(c.average)} (${average})`,
    );
    formulaRows.push([c.name, c.seconds.join(", ") || "(none)", JSON.stringify(last), JSON.stringify(average)]);
  }
  const recorded = runRows().map(([, seconds]) => seconds);
  check(near(calculate(lastFormula, x), recorded[0]), "B7 gives B15 of the Exposure tab after eleven good runs");
  check(
    near(calculate(averageFormula, x), recorded.reduce((a, b) => a + b, 0) / 10),
    "B8 gives the average of the 10 kept runs of the Exposure tab",
  );
  table(["block", "seconds, newest first", "B7", "B8"], formulaRows);

  /**
   * The accepted state of the report tab with other values in the two cells
   * that a person types in.
   */
  const withInputs = (threshold, minimum) => {
    const expected = structuredClone(accepted[REPORT_TAB]);
    const at = (a1) => parseA1(a1, NEW_ROWS, NEW_COLUMNS);
    expected.grid[at(THRESHOLD_CELL).row - 1][at(THRESHOLD_CELL).column - 1] = threshold;
    expected.grid[at(MINIMUM_CELL).row - 1][at(MINIMUM_CELL).column - 1] = minimum;
    return expected;
  };

  /**
   * The tab operations of the log from the index `from`: each delete and
   * each insert, with the name of the tab.
   */
  const tabOps = (from) =>
    state.log
      .slice(from)
      .filter((e) => e.op === "deleteSheet" || e.op === "insertSheet")
      .map((e) => `${e.op} ${e.sheet}`);

  /**
   * Check the two tabs after a refresh that replaced them: the layout at the
   * time of the request, the two typed values, the layout version, the
   * hidden flags, and the answer.
   */
  const checkReplaced = (name, threshold, minimum) => {
    const tabs = Object.fromEntries(state.atFetch.at(-1).tabs);
    checkLayout(`${name}, ${EXPOSURE_TAB}`, tabs[EXPOSURE_TAB], accepted[EXPOSURE_TAB]);
    checkLayout(`${name}, ${REPORT_TAB}`, tabs[REPORT_TAB], withInputs(threshold, minimum));
    const hidden = book.tab(EXPOSURE_TAB);
    check(hidden.cell(VERSION_CELL) === layoutVersion, `${name}: the new hidden tab holds the current layout version`);
    check(
      hidden.hidden && !book.tab(REPORT_TAB).hidden,
      `${name}: the hidden tab is hidden, and the report tab is not`,
    );
    check(hidden.cell("B1") === "OK", `${name}: B1 is OK (B1 holds "${hidden.cell("B1")}")`);
    check(partFaults(hidden) === 0 && pairFaults(hidden) === 0, `${name}: the new hidden tab holds the answer`);
  };

  console.log("\n== Run 10: tabs with no layout version are replaced and keep a threshold of 2.5%");
  const oldExposure = new FakeSheet(EXPOSURE_TAB, 1200, 220, state.log);
  oldExposure.grid[0][0] = "Status";
  oldExposure.grid[0][1] = "OK";
  oldExposure.grid[4][14] = "ticker:OLD";
  oldExposure.grid[4][19] = 0.5;
  oldExposure.hidden = true;
  const oldReport = new FakeSheet(REPORT_TAB, NEW_ROWS, NEW_COLUMNS, state.log);
  oldReport.grid[14][0] = "Threshold";
  oldReport.grid[14][1] = 0.025;
  oldReport.grid[17][0] = "=LET(old,1,old)";
  book.sheets.splice(0, book.sheets.length, oldReport, makeHoldings(HOLDINGS_ROWS), oldExposure);
  state.fetchHandler = () => fakeResponse(200, liveText);
  runStarts.length = 0;
  logFrom = state.log.length;
  pause(2);
  const runTen = timedRun();
  check(
    JSON.stringify(tabOps(logFrom)) ===
      JSON.stringify([
        `deleteSheet ${EXPOSURE_TAB}`,
        `insertSheet ${EXPOSURE_TAB}`,
        `deleteSheet ${REPORT_TAB}`,
        `insertSheet ${REPORT_TAB}`,
      ]),
    `run 10 deletes each old tab and creates it again, the hidden tab first (${tabOps(logFrom).join("; ")})`,
  );
  check(
    indexSince(logFrom, (e) => e.op === "fetch") > indexSince(logFrom, (e) => e.op === "hideSheet"),
    "run 10 replaces the tabs before the request",
  );
  check(!book.sheets.includes(oldExposure) && !book.sheets.includes(oldReport), "run 10: no old tab stays");
  check(
    JSON.stringify(book.names()) === JSON.stringify([REPORT_TAB, "Holdings", EXPOSURE_TAB]),
    "run 10: each new tab takes the position of the old tab",
  );
  check(book.tab(REPORT_TAB).cell(THRESHOLD_CELL) === 0.025, "run 10: the new report tab keeps the threshold of 2.5%");
  check(
    book.tab(REPORT_TAB).cell(MINIMUM_CELL) === 0.1,
    "run 10: the overlap minimum gets its default, because the old tab holds none",
  );
  checkReplaced("run 10", 0.025, 0.1);
  checkRecorded("run 10", runTen);

  console.log("\n== Run 11: tabs with the current layout version stay");
  const keptOrder = [REPORT_TAB, "Holdings", EXPOSURE_TAB];
  const keptExposure = book.tab(EXPOSURE_TAB);
  const keptReport = book.tab(REPORT_TAB);
  const keptState = keptReport.state();
  logFrom = state.log.length;
  pause(2);
  const runEleven = timedRun();
  checkNoTabChange(keptState, logFrom, "run 11", keptOrder);
  check(
    book.tab(EXPOSURE_TAB) === keptExposure && book.tab(REPORT_TAB) === keptReport,
    "run 11: both tabs are the tabs of run 10",
  );
  check(keptReport.cell(THRESHOLD_CELL) === 0.025, "run 11: the threshold of 2.5% stays");
  checkRecorded("run 11", runEleven);

  console.log("\n== Run 12: tabs with an older layout version are replaced and keep both typed values");
  keptExposure.grid[2][1] = layoutVersion - 1;
  keptReport.grid[20][1] = 0.03;
  keptReport.grid[21][1] = 0.25;
  runStarts.length = 0;
  logFrom = state.log.length;
  pause(2);
  const runTwelve = timedRun();
  check(tabOps(logFrom).length === 4, `run 12 deletes and creates both tabs (${tabOps(logFrom).join("; ")})`);
  check(
    JSON.stringify(book.names()) === JSON.stringify(keptOrder),
    "run 12: each new tab takes the position of the old tab",
  );
  check(
    book.tab(REPORT_TAB).cell(THRESHOLD_CELL) === 0.03 && book.tab(REPORT_TAB).cell(MINIMUM_CELL) === 0.25,
    "run 12: the new report tab keeps the threshold of 3% and the overlap minimum of 25%",
  );
  checkReplaced("run 12", 0.03, 0.25);
  checkRecorded("run 12", runTwelve);

  console.log("\n== Run 13: the report tab is absent, and the hidden tab holds the current layout version");
  const stayed = book.tab(EXPOSURE_TAB);
  book.sheets.splice(book.sheets.indexOf(book.tab(REPORT_TAB)), 1);
  logFrom = state.log.length;
  pause(2);
  const runThirteen = timedRun();
  check(
    JSON.stringify(tabOps(logFrom)) === JSON.stringify([`insertSheet ${REPORT_TAB}`]),
    `run 13 creates the report tab alone (${tabOps(logFrom).join("; ")})`,
  );
  check(book.tab(EXPOSURE_TAB) === stayed, "run 13: the hidden tab stays");
  check(
    JSON.stringify(book.names()) === JSON.stringify(["Holdings", EXPOSURE_TAB, REPORT_TAB]),
    "run 13: the new report tab is the last tab",
  );
  checkLayout(`run 13, ${REPORT_TAB}`, Object.fromEntries(state.atFetch.at(-1).tabs)[REPORT_TAB], accepted[REPORT_TAB]);
  checkRecorded("run 13", runThirteen);

  console.log("\n== Run 14: the hidden tab is absent, so the script replaces the report tab too");
  book.tab(REPORT_TAB).grid[20][1] = 0.04;
  book.sheets.splice(book.sheets.indexOf(book.tab(EXPOSURE_TAB)), 1);
  runStarts.length = 0;
  logFrom = state.log.length;
  pause(2);
  const runFourteen = timedRun();
  check(
    JSON.stringify(tabOps(logFrom)) ===
      JSON.stringify([`insertSheet ${EXPOSURE_TAB}`, `deleteSheet ${REPORT_TAB}`, `insertSheet ${REPORT_TAB}`]),
    `run 14 creates the hidden tab, then deletes and creates the report tab (${tabOps(logFrom).join("; ")})`,
  );
  checkReplaced("run 14", 0.04, 0.1);
  checkRecorded("run 14", runFourteen);

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
