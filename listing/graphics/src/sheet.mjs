/**
 * The HTML page of one screenshot: a spreadsheet frame around the cells of
 * the Concentration tab.
 */

import { COLUMNS, WIDTHS } from "./report.mjs";
import { EDITOR_MENUS, MENU, TABS } from "./menu.mjs";

/** The columns that the grid draws. L is the first column past the report. */
const GRID_COLUMNS = [...COLUMNS, "L"];
const GRID_WIDTHS = { ...WIDTHS, L: 100 };

/** The width of the row header column, in pixels. */
const ROW_HEADER = 46;

/** The height of row 1, which holds the title at 16 pt. */
const TITLE_ROW_HEIGHT = 30;

/**
 * Escape a text for HTML.
 */
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The inline style of a cell.
 */
function cellStyle(cell) {
  const s = [];
  if (cell.bold) s.push("font-weight:bold");
  if (cell.italic) s.push("font-style:italic");
  if (cell.color) s.push(`color:${cell.color}`);
  if (cell.bg) s.push(`background:${cell.bg}`);
  if (cell.size) s.push(`font-size:${(cell.size * 4) / 3}px`);
  if (cell.align) s.push(`text-align:${cell.align}`);
  return s.join(";");
}

/**
 * The table row of one sheet row.
 */
function renderRow(report, r, selected) {
  const cells = report.rows.get(r) || {};
  const rowStyle = report.rowStyle.get(r) || {};
  const height = r === 1 ? TITLE_ROW_HEIGHT : 21;
  const parts = [`<th style="height:${height}px">${r}</th>`];
  GRID_COLUMNS.forEach((c, i) => {
    const own = cells[c] || {};
    const inRow = COLUMNS.includes(c) ? rowStyle : {};
    const cell = { ...own, ...inRow, bold: own.bold || inRow.bold };
    const next = cells[GRID_COLUMNS[i + 1]];
    const spill = cell.text && cell.align !== "right" && !(next && (next.text || next.bar !== undefined));
    const classes = [spill ? "spill" : "", selected === `${c}${r}` ? "selected" : ""].filter(Boolean).join(" ");
    const inner =
      cell.bar !== undefined
        ? `<div style="position:relative;height:18px"><div class="bar" style="width:calc(${(cell.bar * 100).toFixed(3)}% - 4px);background:${cell.color}"></div></div>`
        : esc(cell.text ?? "");
    parts.push(`<td${classes ? ` class="${classes}"` : ""} style="${cellStyle(cell)}">${inner}</td>`);
  });
  return `<tr${r === 1 ? ' class="frozen"' : ""}>${parts.join("")}</tr>`;
}

/**
 * The HTML page of one view. `view.firstRow` is the first row under the
 * frozen row 1. `view.zoom` is the zoom of the grid, 0.87 when absent.
 * `view.menuOpen` opens the menu of the add-on. `view.selected` names the
 * selected cell, and `view.formula` is the text of the formula bar.
 */
export function renderPage({ report, view, css, title }) {
  const rows = [1];
  for (let r = view.firstRow; rows.length < 40; r++) rows.push(r);
  const cols = GRID_COLUMNS.map((c) => `<col style="width:${GRID_WIDTHS[c]}px">`).join("");
  const head = GRID_COLUMNS.map((c) => `<th>${c}</th>`).join("");
  const menus = EDITOR_MENUS.map(
    (m) => `<span${view.menuOpen && m === MENU.parent ? ' class="open"' : ""}>${esc(m)}</span>`,
  ).join("");
  const arrow = '<span class="arrow">&#9656;</span>';
  const submenu = `<div class="dropdown sub" id="submenu">${MENU.items
    .map((item) => `<div class="item${item === MENU.highlight ? " hover" : ""}">${esc(item)}</div>`)
    .join("")}</div>`;
  const dropdown = view.menuOpen
    ? `<div class="dropdown" id="dropdown">${MENU.before
        .map((item) => `<div class="item">${esc(item)}${arrow}</div>`)
        .join("")}<hr><div class="item hover" id="addon">${esc(MENU.title)}${arrow}</div>${submenu}</div>`
    : "";
  const tabs = TABS.map((t) => `<div class="tab${t === "Concentration" ? " active" : ""}">${esc(t)}</div>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="titlebar">${esc(title)}</div>
<div class="menubar" id="menubar">${menus}${dropdown}</div>
<div class="formulabar"><div class="name">${esc(view.selected)}</div><div class="fx">fx</div><div class="content">${esc(view.formula)}</div></div>
<div class="gridwrap">
<table class="grid" style="zoom:${view.zoom ?? 0.87};width:${ROW_HEADER + GRID_COLUMNS.reduce((s, c) => s + GRID_WIDTHS[c], 0)}px">
<colgroup><col style="width:${ROW_HEADER}px">${cols}</colgroup>
<thead><tr><th></th>${head}</tr></thead>
<tbody>${rows.map((r) => renderRow(report, r, view.selected)).join("\n")}</tbody>
</table>
</div>
<div class="tabs"><div class="tool">+</div><div class="tool">&#8801;</div>${tabs}</div>
<script>
  const open = document.querySelector(".menubar span.open");
  const drop = document.getElementById("dropdown");
  if (open && drop) {
    drop.style.left = open.offsetLeft + "px";
    const addon = document.getElementById("addon");
    const sub = document.getElementById("submenu");
    sub.style.left = drop.offsetWidth - 4 + "px";
    sub.style.top = addon.offsetTop - 6 + "px";
  }
</script>
</body>
</html>`;
}
