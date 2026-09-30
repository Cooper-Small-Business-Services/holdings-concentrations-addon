/**
 * The concentration script of a Tiller spreadsheet.
 *
 * The script reads the Holdings tab. It sends the weight of each position to
 * the concentration route of the holdings API. It writes the answer into the
 * hidden tab Concentration.Exposure. The report tab Concentration reads that
 * answer. layout.gs holds the layout of the two tabs. The script creates each
 * of them that is absent, and it replaces both when the hidden tab holds
 * another layout version. It reads no other tab, and it writes no other tab.
 * The menu item Refresh of the add-on menu is the one way to run it. The
 * add-on menu is under Extensions, with the name of the add-on. Each good
 * refresh also records its time in the hidden tab.
 *
 * The user properties of each person hold the API key of that person. The
 * menu item Set API key writes it. The script does not use the script
 * properties, because all users of an add-on share them.
 */

/**
 * The address of the concentration route.
 */
const ROUTE_URL = "https://data.coopersbs.com/funds/v1/concentration";

/**
 * The tab that the script reads. Tiller fills it.
 */
const HOLDINGS_TAB = "Holdings";

/**
 * The hidden tab that holds the answer of the route. Each refresh writes it.
 */
const EXPOSURE_TAB = "Concentration.Exposure";

/**
 * The user property that holds the API key.
 */
const KEY_PROPERTY = "HOLDINGS_API_KEY";

/**
 * The function that the menu item Refresh runs.
 */
const HANDLER = "refreshConcentration";

/**
 * The function that the menu item Set API key runs.
 */
const KEY_HANDLER = "setApiKey";

/**
 * The characters that an API key can hold. A key with another character,
 * such as a space or a line break, cannot go into the Authorization header.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * The largest count of positions that the route accepts in one request.
 */
const MAX_POSITIONS = 200;

/**
 * The largest length of a position id, in UTF-16 code units.
 */
const MAX_ID_LENGTH = 64;

/**
 * The ticker pattern of the concentration route. The pattern applies after
 * the route removes one leading `$` and changes each letter to upper case.
 */
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/**
 * The header text of the three columns of the Holdings tab that the script
 * reads.
 */
const HOLDINGS_COLUMNS = ["Description", "Symbol", "Value"];

/**
 * The measures of the answer, in the order of the rows B5:B12.
 */
const MEASURE_NAMES = [
  "lineCount",
  "top10Weight",
  "hhi",
  "effectiveCount",
  "lookedThroughWeight",
  "notLookedThroughWeight",
  "weightSum",
  "weightDifference",
];

/**
 * The fields of the equity block of the measures, in the order of the rows
 * B27:B31. The equity block holds the measures of the stock part alone.
 */
const EQUITY_NAMES = ["weight", "lineCount", "top10Weight", "hhi", "effectiveCount"];

/**
 * The fields of each element of the funds block, in the order of the columns
 * D:M.
 */
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

/**
 * The fields of each line, in the order of the columns T:Z. Column AA holds
 * the part of the line that the row gives: STOCK_PART or OTHER_PART.
 */
const LINE_FIELDS = ["key", "name", "ticker", "lei", "class", "weight", "stockWeight"];

/**
 * The part name of a row that holds the stock part of a line.
 */
const STOCK_PART = "stock";

/**
 * The part name of a row that holds the part of a line that is not stock.
 */
const OTHER_PART = "other";

/**
 * The row of the labels and of the position ids.
 */
const HEADER_ROW = 4;

/**
 * The first row of each data block.
 */
const FIRST_DATA_ROW = 5;

/**
 * The first column of the funds block, D. Column 1 is A.
 */
const FUND_COLUMN = 4;

/**
 * The first column of the overlaps block, O. The block holds the two position
 * ids, the overlap, and the count of shared lines of each pair, in O:R.
 */
const OVERLAP_COLUMN = 15;

/**
 * The first column of the lines block, T.
 */
const LINE_COLUMN = 20;

/**
 * The column of the part name of each row of the lines block, AA.
 */
const PART_COLUMN = LINE_COLUMN + LINE_FIELDS.length;

/**
 * The first column of the sources block, AB. Each position gets one column.
 */
const SOURCE_COLUMN = PART_COLUMN + 1;

/**
 * The row of the header of the run-time block, A14:B14. The block holds one
 * row for each good refresh from row 15: the start time in column A and the
 * seconds in column B, newest first.
 */
const RUN_HEADER_ROW = 14;

/**
 * The largest count of refreshes that the run-time block keeps. The rows are
 * A15:B24.
 */
const RUN_LIMIT = 10;

/**
 * The row of the header of the equity block, A26:B26. The block holds one row
 * for each field of EQUITY_NAMES from row 27.
 */
const EQUITY_HEADER_ROW = 26;

/**
 * Add the items Refresh and Set API key to the add-on menu. The add-on menu
 * is under Extensions, with the name of the add-on. The spreadsheet runs this
 * function when a person opens it. The function reads no property and no
 * tab, so it also works before the person gives access.
 */
function onOpen() {
  SpreadsheetApp.getUi().createAddonMenu().addItem("Refresh", HANDLER).addItem("Set API key", KEY_HANDLER).addToUi();
}

/**
 * Add the menu when a person installs the add-on, so the person can use it
 * before the next open of the spreadsheet.
 */
function onInstall() {
  onOpen();
}

/**
 * Ask for the API key and write it into the user properties of the person.
 * An empty answer removes the saved key. Cancel changes nothing. The key does
 * not go into a cell, a log line, or a message.
 */
function setApiKey() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Holdings API key",
    "Paste your API key. Leave the box empty to remove the saved key.",
    ui.ButtonSet.OK_CANCEL,
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const key = String(response.getResponseText() || "").trim();
  const store = PropertiesService.getUserProperties();
  if (key === "") {
    store.deleteProperty(KEY_PROPERTY);
    ui.alert("The saved API key is removed.");
    return;
  }
  if (!KEY_PATTERN.test(key)) {
    ui.alert("This text is not an API key. Nothing changed.");
    return;
  }
  store.setProperty(KEY_PROPERTY, key);
  ui.alert("The API key is saved. Use Refresh in the add-on menu.");
}

/**
 * Send the positions of the Holdings tab to the concentration route and write
 * the answer into the tab Concentration.Exposure. The function takes the
 * document lock first, so two runs in one spreadsheet cannot overlap. Runs in
 * different spreadsheets do not wait for each other. When another run holds
 * the lock, the function stops and changes no cell.
 */
function refreshConcentration() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(0)) return;
  try {
    runRefresh();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Do the steps of one refresh. The caller holds the document lock. The first
 * step makes sure that the two tabs of the report hold the layout of
 * layout.gs. A fault writes the status cell B1 and the time cell B2 alone, so
 * the last good answer stays in the other cells.
 *
 * A good refresh records its time in the run-time block. The time starts at
 * the start of this function. It ends after the write of the answer and the
 * status. SpreadsheetApp.flush applies the pending writes before the end, so
 * the time includes them. A fault records no time.
 */
function runRefresh() {
  const started = new Date();
  const book = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabs(book);
  const out = book.getSheetByName(EXPOSURE_TAB);
  const holdings = book.getSheetByName(HOLDINGS_TAB);
  if (holdings === null) {
    writeStatus(out, `FAULT: no ${HOLDINGS_TAB} tab`);
    return;
  }
  const rows = holdings.getDataRange().getValues();
  const columns = findColumns(rows.length > 0 ? rows[0] : []);
  if (columns === null) {
    writeStatus(out, `FAULT: no ${HOLDINGS_TAB} column ${missingColumns(rows.length > 0 ? rows[0] : []).join(", ")}`);
    return;
  }
  const positions = buildPositions(rows.slice(1), columns);
  if (positions.length === 0) {
    writeStatus(out, "FAULT: no positions");
    return;
  }
  if (positions.length > MAX_POSITIONS) {
    writeStatus(out, "FAULT: too many positions");
    return;
  }
  const key = String(PropertiesService.getUserProperties().getProperty(KEY_PROPERTY) || "").trim();
  if (key === "") {
    writeStatus(out, "FAULT: no API key. Use Set API key in the add-on menu.");
    return;
  }
  let response;
  try {
    response = UrlFetchApp.fetch(ROUTE_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + key },
      payload: JSON.stringify({ positions }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    writeStatus(out, "FAULT: no answer");
    throw e;
  }
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status !== 200) {
    writeStatus(out, faultText(status, text));
    return;
  }
  const answer = parseAnswer(text);
  if (answer === null) {
    writeStatus(out, "FAULT: 200 bad_answer");
    return;
  }
  const ids = positions.map((position) => position.id);
  writeAnswer(out, ids, answer);
  writeStatus(out, "OK");
  SpreadsheetApp.flush();
  recordRun(out, started, (Date.now() - started.getTime()) / 1000);
}

/**
 * The text of a cell value with the leading and the trailing white space
 * removed. An empty cell, null, and undefined give an empty string.
 */
function cellText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * The zero-based index of each column that the script reads, found by the
 * header text of row 1. The result is null when the header holds no
 * Description, Symbol, or Value column.
 */
function findColumns(header) {
  const names = header.map(cellText);
  const found = {
    description: names.indexOf("Description"),
    symbol: names.indexOf("Symbol"),
    value: names.indexOf("Value"),
  };
  if (found.description < 0 || found.symbol < 0 || found.value < 0) return null;
  return found;
}

/**
 * The header text of each column that the script reads and that the header
 * row does not hold.
 */
function missingColumns(header) {
  const names = header.map(cellText);
  return HOLDINGS_COLUMNS.filter((name) => names.indexOf(name) < 0);
}

/**
 * The ticker that the request sends for a symbol, or null. The function
 * applies the ticker normalization of the route to a copy of the symbol. A symbol that fails the pattern gives null, so the
 * position goes with no ticker and the route does not refuse the body.
 */
function tickerOf(symbol) {
  if (symbol === "") return null;
  const normal = symbol.replace(/^\$/, "").toUpperCase();
  return TICKER_PATTERN.test(normal) ? symbol : null;
}

/**
 * The positions of the request, in the order of the first row of each key.
 *
 * The key of a row is its Symbol, or its Description when the Symbol is
 * empty, cut to 64 UTF-16 code units. The function skips a row with an empty
 * key or a Value that is not a finite number. It adds the values of each key.
 * The first row of a key decides whether the position has a ticker. A key
 * with a sum that is not above 0 gives no position, because the route accepts
 * a weight above 0 alone. Each weight is the sum of the key divided by the
 * total of the kept keys. A position holds `id`, `ticker` when the key has
 * one, and `weight`. It holds no value, no share count, no account, and no
 * total. The result is empty when no key has a sum above 0.
 */
function buildPositions(rows, columns) {
  const groups = new Map();
  for (const row of rows) {
    const symbol = cellText(row[columns.symbol]);
    const key = (symbol !== "" ? symbol : cellText(row[columns.description])).slice(0, MAX_ID_LENGTH);
    const value = row[columns.value];
    if (key === "" || typeof value !== "number" || !isFinite(value)) continue;
    if (!groups.has(key)) groups.set(key, { id: key, symbol, sum: 0 });
    groups.get(key).sum += value;
  }
  const kept = [...groups.values()].filter((group) => group.sum > 0);
  const total = kept.reduce((sum, group) => sum + group.sum, 0);
  if (!(total > 0)) return [];
  return kept.map((group) => {
    const position = { id: group.id };
    const ticker = tickerOf(group.symbol);
    if (ticker !== null) position.ticker = ticker;
    position.weight = group.sum / total;
    return position;
  });
}

/**
 * The status text of an answer with a status other than 200. A JSON body in
 * the error format of the route adds its error code, such as
 * `FAULT: 429 rate_limited`. Another body gives the
 * status alone, such as `FAULT: 502`.
 */
function faultText(status, text) {
  let code = "";
  try {
    const body = JSON.parse(text);
    if (body && body.error && typeof body.error.code === "string") code = body.error.code;
  } catch {
    code = "";
  }
  return code === "" ? `FAULT: ${status}` : `FAULT: ${status} ${code}`;
}

/**
 * The parsed answer of the route, or null. The result is null when the text
 * is not JSON, when it does not hold the blocks measures, funds, overlaps,
 * and lines, or when a line holds no number in stockWeight. The report cannot
 * show the stock part of an answer with no stock weights.
 */
function parseAnswer(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body.measures !== "object" || body.measures === null) return null;
  if (!Array.isArray(body.funds) || !Array.isArray(body.overlaps) || !Array.isArray(body.lines)) return null;
  if (!body.lines.every((line) => line !== null && typeof line === "object" && isNumber(line.stockWeight))) return null;
  return body;
}

/**
 * True when the value is a finite number.
 */
function isNumber(value) {
  return typeof value === "number" && isFinite(value);
}

/**
 * The value that a cell gets for a field. Null and an absent field give an
 * empty string.
 */
function cellValue(value) {
  return value === null || value === undefined ? "" : value;
}

/**
 * The rows B5:B12: one row for each measure, in the order of MEASURE_NAMES.
 */
function measureRows(measures) {
  return MEASURE_NAMES.map((name) => [cellValue(measures[name])]);
}

/**
 * The rows B27:B31: one row for each field of the equity block, in the order
 * of EQUITY_NAMES. The route gives null for the block when the portfolio
 * holds no stock, and each row is then an empty string.
 */
function equityRows(equity) {
  const block = equity !== null && typeof equity === "object" ? equity : {};
  return EQUITY_NAMES.map((name) => [cellValue(block[name])]);
}

/**
 * The rows D5:M: one row for each element of the funds block, with the
 * fields of FUND_FIELDS.
 */
function fundRows(funds) {
  return funds.map((fund) => FUND_FIELDS.map((name) => cellValue(fund[name])));
}

/**
 * The rows O5:R: one row for each element of the overlaps block, in the order
 * of the answer. A row holds the two position ids, the overlap, and the count
 * of shared lines.
 */
function overlapRows(overlaps) {
  return overlaps.map((pair) => {
    const ids = Array.isArray(pair.ids) ? pair.ids : [];
    return [cellValue(ids[0]), cellValue(ids[1]), cellValue(pair.overlap), cellValue(pair.sharedLineCount)];
  });
}

/**
 * The number that a map of the answer holds for a position id, or null when
 * the map holds no number for it.
 */
function sourceOf(map, id) {
  if (map === null || typeof map !== "object" || !Object.prototype.hasOwnProperty.call(map, id)) return null;
  return isNumber(map[id]) ? map[id] : null;
}

/**
 * The rows from T5: the lines block and the sources block together. A line
 * gives one row for its stock part, one row for its other part, or both, in
 * the order of the answer. A row holds the fields of LINE_FIELDS, then the
 * part name, then one cell for each position id in the order of the request.
 *
 * A cell of a stock row holds the stock weight that came through the
 * position: the entry of stockSources. A cell of an other row holds the
 * weight that came through the position minus that stock weight: the entry
 * of sources minus the entry of stockSources. A cell is an empty string when
 * the position gave nothing to the part.
 *
 * A line gives a stock row when its stock weight is not 0 or when a position
 * has a stock cell. A line gives an other row when a position has an other
 * cell, or when the line gives no stock row. The two rows of a line split
 * each source between them, so the block needs no second column for each
 * position.
 */
function partRows(lines, ids) {
  const rows = [];
  for (const line of lines) {
    const fields = LINE_FIELDS.map((name) => cellValue(line[name]));
    const stockCells = ids.map((id) => cellValue(sourceOf(line.stockSources, id)));
    const otherCells = ids.map((id) => {
      const whole = sourceOf(line.sources, id);
      const stock = sourceOf(line.stockSources, id);
      if (whole === null && stock === null) return "";
      const other = (whole === null ? 0 : whole) - (stock === null ? 0 : stock);
      return other === 0 ? "" : other;
    });
    const hasStock = line.stockWeight !== 0 || stockCells.some((value) => value !== "");
    if (hasStock) rows.push([...fields, STOCK_PART, ...stockCells]);
    if (!hasStock || otherCells.some((value) => value !== "")) rows.push([...fields, OTHER_PART, ...otherCells]);
  }
  return rows;
}

/**
 * Write the status text into B1 and the time of the run into B2 with one
 * call.
 */
function writeStatus(sheet, text) {
  sheet.getRange(1, 2, 2, 1).setValues([[text], [new Date()]]);
}

/**
 * Put one good refresh at the top of the run-time block A15:B24 with one
 * setValues call: the start time in column A and the seconds in column B. The
 * rows of the earlier runs move down one row. The function keeps RUN_LIMIT
 * rows, so the oldest row goes when the block is full. A row with no number
 * of seconds is not a run, and the function drops it.
 */
function recordRun(sheet, started, seconds) {
  const block = sheet.getRange(RUN_HEADER_ROW + 1, 1, RUN_LIMIT, 2);
  const earlier = block.getValues().filter((row) => typeof row[1] === "number");
  const rows = [[started, seconds], ...earlier].slice(0, RUN_LIMIT);
  while (rows.length < RUN_LIMIT) rows.push(["", ""]);
  block.setValues(rows);
}

/**
 * Add rows and columns at the end of the grid until the grid holds the given
 * count of rows and columns. The grid never shrinks.
 */
function growGrid(sheet, rows, columns) {
  const haveRows = sheet.getMaxRows();
  if (rows > haveRows) sheet.insertRowsAfter(haveRows, rows - haveRows);
  const haveColumns = sheet.getMaxColumns();
  if (columns > haveColumns) sheet.insertColumnsAfter(haveColumns, columns - haveColumns);
}

/**
 * Set the number format `@` on the text columns: D:E, G, O:P, and T:W from
 * row 5, and row 4 from column AB. A name that starts with `=`, `+`, `-`, or
 * `@` then stays text, and a ticker such as 0700 stays text.
 */
function setTextFormat(sheet) {
  const dataRows = sheet.getMaxRows() - HEADER_ROW;
  const lastColumn = sheet.getMaxColumns();
  sheet.getRange(FIRST_DATA_ROW, FUND_COLUMN, dataRows, 2).setNumberFormat("@");
  sheet.getRange(FIRST_DATA_ROW, FUND_COLUMN + 3, dataRows, 1).setNumberFormat("@");
  sheet.getRange(FIRST_DATA_ROW, OVERLAP_COLUMN, dataRows, 2).setNumberFormat("@");
  sheet.getRange(FIRST_DATA_ROW, LINE_COLUMN, dataRows, 4).setNumberFormat("@");
  sheet.getRange(HEADER_ROW, SOURCE_COLUMN, 1, lastColumn - SOURCE_COLUMN + 1).setNumberFormat("@");
}

/**
 * Copy a block of rows into the answer grid. The row and the column are
 * sheet positions, and the grid starts at the sheet position B4.
 */
function placeBlock(grid, row, column, values) {
  values.forEach((cells, r) => {
    cells.forEach((value, c) => {
      grid[row - HEADER_ROW + r][column - 2 + c] = value;
    });
  });
}

/**
 * Write a good answer into the tab. The function grows the grid to fit the
 * rows of the lines and the positions, and sets the text format. Then it
 * writes the range from B4 to the last column and the last row of the grid
 * with one setValues call. The range holds the labels of row 4, the position
 * ids, the measures, the equity measures, the funds, the overlaps, the lines,
 * and the sources. It also holds column B of the run-time block and of the
 * header of the equity block, and the function copies those cells as they
 * are. Each other cell gets an empty string, so no cell of the last answer
 * stays. One call replaces the whole answer, so a report formula never reads
 * an empty block.
 */
function writeAnswer(sheet, ids, answer) {
  const funds = fundRows(answer.funds);
  const overlaps = overlapRows(answer.overlaps);
  const parts = partRows(answer.lines, ids);
  const lastRow = Math.max(
    EQUITY_HEADER_ROW + EQUITY_NAMES.length,
    HEADER_ROW + funds.length,
    HEADER_ROW + overlaps.length,
    HEADER_ROW + parts.length,
  );
  growGrid(sheet, lastRow, SOURCE_COLUMN - 1 + ids.length);
  const rows = sheet.getMaxRows() - HEADER_ROW + 1;
  const width = sheet.getMaxColumns() - 1;
  const labels = sheet.getRange(HEADER_ROW, 2, 1, width).getValues()[0];
  const kept = sheet.getRange(RUN_HEADER_ROW, 2, EQUITY_HEADER_ROW - RUN_HEADER_ROW + 1, 1).getValues();
  const grid = Array.from({ length: rows }, () => new Array(width).fill(""));
  labels.slice(0, SOURCE_COLUMN - 2).forEach((value, c) => {
    grid[0][c] = value;
  });
  placeBlock(grid, HEADER_ROW, SOURCE_COLUMN, [ids]);
  placeBlock(grid, FIRST_DATA_ROW, 2, measureRows(answer.measures));
  placeBlock(grid, RUN_HEADER_ROW, 2, kept);
  placeBlock(grid, EQUITY_HEADER_ROW + 1, 2, equityRows(answer.measures.equity));
  placeBlock(grid, FIRST_DATA_ROW, FUND_COLUMN, funds);
  placeBlock(grid, FIRST_DATA_ROW, OVERLAP_COLUMN, overlaps);
  placeBlock(grid, FIRST_DATA_ROW, LINE_COLUMN, parts);
  setTextFormat(sheet);
  sheet.getRange(HEADER_ROW, 2, rows, width).setValues(grid);
}
