/**
 * The cells of the Concentration tab for one answer of the route.
 *
 * The function follows the labels, the formulas, the number formats, and the
 * styles of the layout of the report tab in the script. Each cell holds the
 * text that the spreadsheet shows, its alignment, and its style. A text value
 * aligns left and a number aligns right, as in the spreadsheet, unless the
 * layout sets the alignment.
 */

/** The colors of the layout. */
const HEADER_BG = "#f7f6f1";
const LABEL = "#57554f";
const NOTE = "#6b6962";
const REST_BG = "#f4f3ee";
const REST_TEXT = "#3c3b37";
const THRESHOLD_BG = "#fff4c7";
const GOOD = { bg: "#dcefe2", color: "#1b5e34", bold: true };
const BAD = { bg: "#f7d4d4", color: "#8a1c1c", bold: true };
const BAR = "#2a78d6";

/** The number formats of the layout. */
const fmt = {
  dollars: (x) => (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("en-US"),
  pct2: (x) => (x * 100).toFixed(2) + "%",
  pct1: (x) => (x * 100).toFixed(1) + "%",
  count: (x) => Math.round(x).toLocaleString("en-US"),
  one: (x) => x.toFixed(1),
  /** The format `0.00%;-0.00%;""`: a zero shows as an empty cell. */
  pctOrBlank: (x) => (Math.abs(x) < 0.000005 ? "" : (x * 100).toFixed(2) + "%"),
};

/** The column letters of the report, A to K. */
export const COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];

/** The column widths of the layout, in pixels. */
export const WIDTHS = { A: 150, B: 300, C: 150, D: 175, E: 110, F: 180, G: 90, H: 84, I: 84, J: 84, K: 84 };

/**
 * The cells of the report. The result maps a row number to a map of column
 * letter to cell. A cell holds `text`, and it can hold `align`, `bold`,
 * `italic`, `color`, `bg`, `size`, and `bar` (a fraction of the cell width).
 * `rowStyle` maps a row number to a style for the cells A:K of that row.
 */
export function buildReport({ answer, positions, holdings, threshold, lastRun }) {
  const rows = new Map();
  const rowStyle = new Map();
  const put = (ref, cell) => {
    const [, col, row] = ref.match(/^([A-Z]+)(\d+)$/);
    const r = Number(row);
    if (!rows.has(r)) rows.set(r, {});
    rows.get(r)[col] = { ...(rows.get(r)[col] || {}), ...cell };
  };
  const text = (ref, value, style = {}) => put(ref, { text: value, align: "left", ...style });
  const num = (ref, value, style = {}) => put(ref, { text: value, align: "right", ...style });

  const total = holdings.reduce((s, h) => s + h.value, 0);
  const m = answer.measures;
  const lines = answer.lines;
  const ids = positions.map((p) => p.id);
  const fid = answer.funds.map((f) => f.id);
  const src = (line, id) => line.sources[id] || 0;
  const thr = threshold;

  // Row 1.
  text("A1", "Concentration", { bold: true, size: 16 });
  text("D1", "Look-through exposure of the Holdings tab, by company.", { italic: true, color: NOTE });

  // A2:B7, with the conditional formats of B2 and B7.
  const labels = ["Status", "Last run", "Total value", "Looked through", "Not looked through", "Sum check"];
  labels.forEach((label, i) => text(`A${i + 2}`, label, { color: LABEL }));
  const status = "OK";
  const sumCheck = Math.abs(m.weightDifference) <= 0.005 ? "pass" : "fail";
  num("B2", status, status === "OK" ? GOOD : BAD);
  num("B3", lastRun);
  num("B4", fmt.dollars(total), { bold: true });
  num("B5", fmt.pct2(m.lookedThroughWeight));
  num("B6", fmt.pct2(m.notLookedThroughWeight));
  num("B7", sumCheck, sumCheck === "pass" ? GOOD : BAD);

  // D2:H2 and the funds spill from D3.
  ["Fund looked through", "Report date", "Holdings", "Weight", "Covered"].forEach((label, i) =>
    text(`${COLUMNS[3 + i]}2`, label, { bold: true, bg: HEADER_BG }),
  );
  answer.funds.forEach((f, i) => {
    const r = 3 + i;
    text(`D${r}`, f.id, { bold: true });
    num(`E${r}`, f.reportDate);
    num(`F${r}`, fmt.count(f.holdingCount));
    num(`G${r}`, fmt.pct2(f.weight));
    num(`H${r}`, fmt.pct1(f.coveredWeight / f.weight));
  });

  // A10:F13.
  for (const c of COLUMNS.slice(0, 6)) put(`${c}10`, { bold: true, bg: HEADER_BG, color: "#1d1c1a" });
  text("A10", "Measures");
  text("D10", "Composition");
  text("E10", "Value");
  text("F10", "% of portfolio");
  text("A11", "Top 10 weight", { color: LABEL });
  text("A12", "HHI, 0 to 10,000", { color: LABEL });
  text("A13", "Effective holdings", { color: LABEL });
  num("B11", fmt.pct2(m.top10Weight));
  num("B12", fmt.count(m.hhi));
  num("B13", fmt.one(m.effectiveCount));
  const stockAt = lines.filter((l) => l.class === "stock" && l.weight >= thr).reduce((s, l) => s + l.weight, 0);
  const stockUnder = lines.filter((l) => l.class === "stock" && l.weight < thr).reduce((s, l) => s + l.weight, 0);
  const notStock = lines.filter((l) => l.class !== "stock").reduce((s, l) => s + l.weight, 0);
  const composition = [
    [`Stocks at ${fmt.pct2(thr)} or more`, stockAt],
    [`Stocks under ${fmt.pct2(thr)}`, stockUnder],
    ["Not individual stocks", notStock],
  ];
  composition.forEach(([label, w], i) => {
    text(`D${11 + i}`, label);
    num(`E${11 + i}`, fmt.dollars(w * total));
    num(`F${11 + i}`, fmt.pct2(w));
  });

  // Row 15.
  text("A15", "Threshold", { bold: true });
  num("B15", fmt.pct2(thr), { bold: true, bg: THRESHOLD_BG });
  text("C15", "Type a percent. Each company at or above it gets a row.", { italic: true, color: NOTE });

  // Row 17 and the header of the fund columns.
  const f = fid.filter((x) => lines.some((l) => l.class === "stock" && src(l, x) > 0));
  const header = ["Rank", "Company", "Ticker", "Value", "% of portfolio", "", "Direct", ...f];
  for (const c of COLUMNS) put(`${c}17`, { bold: true, bg: HEADER_BG });
  header.forEach((label, i) => {
    const c = COLUMNS[i];
    const right = c === "A" || i >= 3;
    put(`${c}17`, { text: label, align: right ? "right" : "left" });
  });

  // The spill from A18.
  const direct = (l) => l.weight - fid.reduce((s, x) => s + src(l, x), 0);
  const spill = [];
  const sel = lines.filter((l) => l.class === "stock" && l.weight >= thr);
  if (sel.length === 0) {
    spill.push({ cells: [null, { text: "No company at or above the threshold.", align: "left" }] });
  } else {
    const mx = Math.max(...sel.map((l) => l.weight));
    sel.forEach((l, i) => {
      const d = direct(l);
      const fx = f.map((x) => src(l, x));
      const both = d > 0 && fx.reduce((s, x) => s + x, 0) > 0;
      spill.push({
        cells: [
          { text: String(i + 1), align: "right" },
          { text: l.name, align: "left", bold: both },
          { text: l.ticker ?? "", align: "left" },
          { text: fmt.dollars(l.weight * total), align: "right" },
          { text: fmt.pct2(l.weight), align: "right" },
          { bar: l.weight / mx, color: BAR },
          { text: fmt.pctOrBlank(d), align: "right" },
          ...fx.map((x) => ({ text: fmt.pctOrBlank(x), align: "right" })),
        ],
      });
    });
  }
  const under = lines.filter((l) => l.class === "stock" && l.weight < thr);
  spill.push({
    style: { italic: true, bg: REST_BG, color: REST_TEXT },
    cells: [
      null,
      { text: `Stocks under ${fmt.pct2(thr)} (${fmt.count(under.length)})`, align: "left" },
      null,
      { text: fmt.dollars(stockUnder * total), align: "right" },
      { text: fmt.pct2(stockUnder), align: "right" },
      null,
      { text: fmt.pctOrBlank(under.reduce((s, l) => s + direct(l), 0)), align: "right" },
      ...f.map((x) => ({ text: fmt.pctOrBlank(under.reduce((s, l) => s + src(l, x), 0)), align: "right" })),
    ],
  });
  spill.push({ cells: [] });
  spill.push({ style: { bold: true }, cells: [null, { text: "Not individual stocks", align: "left" }] });
  spill.push({
    style: { bold: true, bg: HEADER_BG },
    cells: ["", "Line", "Kind", "Value", "% of portfolio", "Came from"].map((t) =>
      t ? { text: t, align: "left" } : null,
    ),
  });

  // The lines that are not individual stocks.
  const ns = lines.filter((l) => l.class !== "stock");
  const isOwn = (l) => l.key.startsWith("residual:") || Math.abs(direct(l)) > 1e-12;
  const came = (l) => ids.filter((id) => src(l, id) !== 0).join(", ");
  const nameOf = (n) => holdings.find((h) => h.symbol === n)?.description ?? n;
  const kindOf = (l) =>
    l.key.startsWith("residual:")
      ? "not looked through"
      : ({ fund: "fund, no holdings data", unknown: "not in the SEC data" }[l.class] ?? l.class);
  const own = ns
    .filter(isOwn)
    .filter((l) => !(l.key.startsWith("residual:") && l.weight === 0))
    .map((l) => ({ name: nameOf(l.name), kind: kindOf(l), w: l.weight, from: came(l) }));
  const grp = ns.filter((l) => !isOwn(l));
  const classes = [...new Set(grp.map((l) => l.class))];
  const groupLabel = {
    cash: "Cash and money market funds",
    derivative: "Derivatives",
    treasury: "Treasury securities",
    other: "Other holdings",
  };
  const groups = classes.map((c) => {
    const members = grp.filter((l) => l.class === c);
    return {
      cls: c,
      n: members.length,
      name: `${groupLabel[c] ?? c} inside funds (${fmt.count(members.length)})`,
      kind: c,
      w: members.reduce((s, l) => s + l.weight, 0),
      from: fid.filter((x) => members.reduce((s, l) => s + src(l, x), 0) !== 0).join(", "),
    };
  });
  const big = groups.filter((g) => Math.abs(g.w * total) >= 100);
  const small = groups.filter((g) => Math.abs(g.w * total) < 100);
  const main = [...own, ...big].sort((a, b) => b.w - a.w);
  if (small.length > 0) {
    const from = [...new Set(small.flatMap((g) => g.from.split(",").map((s) => s.trim())).filter(Boolean))];
    main.push({
      name: `Other small holdings inside funds (${fmt.count(small.reduce((s, g) => s + g.n, 0))})`,
      kind: small.map((g) => g.cls).join(", "),
      w: small.reduce((s, g) => s + g.w, 0),
      from: from.join(", "),
    });
  }
  for (const row of main) {
    spill.push({
      cells: [
        null,
        { text: row.name, align: "left" },
        { text: row.kind, align: "left" },
        { text: fmt.dollars(row.w * total), align: "right" },
        { text: fmt.pct2(row.w), align: "right" },
        { text: row.from, align: "left" },
      ],
    });
  }
  spill.push({ cells: [] });
  const sumW = lines.reduce((s, l) => s + l.weight, 0);
  spill.push({
    style: { bold: true },
    cells: [
      null,
      { text: "Total of all lines", align: "left" },
      null,
      { text: fmt.dollars(sumW * total), align: "right" },
      { text: fmt.pct2(sumW), align: "right" },
    ],
  });

  spill.forEach((row, i) => {
    const r = 18 + i;
    if (row.style) rowStyle.set(r, row.style);
    row.cells.forEach((cell, c) => {
      if (cell) put(`${COLUMNS[c]}${r}`, cell);
    });
  });

  return {
    rows,
    rowStyle,
    lastRow: 17 + spill.length,
    checks: { total, composition, stockUnder, sel, f, under, main, sumW, answer },
  };
}

/**
 * The arithmetic faults that a careful reader could find in the shown
 * values: parts that do not add to their whole after the rounding of the
 * display. The result is a list of messages. An empty list means no fault.
 */
export function findFaults(report) {
  const faults = [];
  const { total, composition, sel, f, under, main, sumW } = report.checks;
  const cents = (w) => Math.round(w * 10000);
  const dollars = (w) => Math.round(w * total);
  const shown = composition.map(([, w]) => w);
  if (shown.reduce((s, w) => s + dollars(w), 0) !== Math.round(total))
    faults.push("composition values do not add to the total value");
  if (shown.reduce((s, w) => s + cents(w), 0) !== 10000) faults.push("composition percents do not add to 100.00%");
  const m = report.checks.answer.measures;
  if (cents(m.lookedThroughWeight) + cents(m.notLookedThroughWeight) !== 10000)
    faults.push("looked through parts do not add to 100.00%");
  const fid = report.checks.answer.funds.map((x) => x.id);
  for (const l of sel) {
    const parts = [l.weight - fid.reduce((s, x) => s + (l.sources[x] || 0), 0), ...f.map((x) => l.sources[x] || 0)];
    if (parts.reduce((s, p) => s + cents(p), 0) !== cents(l.weight))
      faults.push(`row ${l.name}: the parts do not add to the percent`);
  }
  const table = [...sel.map((l) => l.weight), under.reduce((s, l) => s + l.weight, 0)];
  if (table.reduce((s, w) => s + cents(w), 0) !== cents(shown[0]) + cents(shown[1]))
    faults.push("stock rows do not add to the stock composition percents");
  if (table.reduce((s, w) => s + dollars(w), 0) !== dollars(shown[0]) + dollars(shown[1]))
    faults.push("stock rows do not add to the stock composition values");
  if (main.reduce((s, r) => s + cents(r.w), 0) !== cents(shown[2]))
    faults.push("lines that are not stocks do not add to their composition percent");
  if (main.reduce((s, r) => s + dollars(r.w), 0) !== dollars(shown[2]))
    faults.push("lines that are not stocks do not add to their composition value");
  const all = [...table, ...main.map((r) => r.w)];
  if (all.reduce((s, w) => s + cents(w), 0) !== cents(sumW))
    faults.push("the rows do not add to the total of all lines");
  return faults;
}
