/**
 * The layout of the two tabs of the concentration report, and the functions
 * that create a tab from its layout.
 *
 * The tab Concentration.Exposure is hidden. It holds the answer of the
 * concentration route, and concentration.gs writes that answer. The tab
 * Concentration is the report. Each of its cells is a label, a formula, or
 * the threshold cell B15. The formulas read Concentration.Exposure and the
 * Holdings tab.
 *
 * A refresh calls ensureTabs before the request. The function creates each
 * tab that is absent, and it leaves a tab that exists as it is. Delete a tab
 * to get its layout again on the next refresh.
 */

/**
 * The name of the report tab.
 */
const REPORT_TAB = "Concentration";

/**
 * The count of rows of each new tab.
 */
const TAB_ROWS = 1000;

/**
 * The formula of D3: the funds that the route looked through, with the
 * report date, the count of holdings, the weight, and the covered part.
 */
const FUNDS_FORMULA = `=LET(r,FILTER('Concentration.Exposure'!$D$5:$J,'Concentration.Exposure'!$D$5:$D<>""),
HSTACK(CHOOSECOLS(r,1,3,5,6),ARRAYFORMULA(CHOOSECOLS(r,7)/CHOOSECOLS(r,6))))`;

/**
 * The formula of H17: the header of the columns of the funds that hold a
 * stock, one column for each fund.
 */
const FUND_HEADER_FORMULA = `=LET(LK,'Concentration.Exposure'!$O$5:$O,LN,'Concentration.Exposure'!$P$5:$P,LT,'Concentration.Exposure'!$Q$5:$Q,LC,'Concentration.Exposure'!$S$5:$S,LW,'Concentration.Exposure'!$T$5:$T,
LS,'Concentration.Exposure'!$U$5:$AZ,LH,'Concentration.Exposure'!$U$4:$AZ$4,
fid,FILTER('Concentration.Exposure'!$D$5:$D,'Concentration.Exposure'!$D$5:$D<>""),
f,FILTER(fid,MAP(fid,LAMBDA(x,SUMIFS(INDEX(LS,0,XMATCH(x,LH)),LC,"stock")>0))),
TRANSPOSE(f))`;

/**
 * The formula of A18: the stock table and the block of the lines that are
 * not individual stocks, as one spill.
 */
const REPORT_FORMULA = `=LET(LK,'Concentration.Exposure'!$O$5:$O,LN,'Concentration.Exposure'!$P$5:$P,LT,'Concentration.Exposure'!$Q$5:$Q,LC,'Concentration.Exposure'!$S$5:$S,LW,'Concentration.Exposure'!$T$5:$T,
LS,'Concentration.Exposure'!$U$5:$AZ,LH,'Concentration.Exposure'!$U$4:$AZ$4,
fid,FILTER('Concentration.Exposure'!$D$5:$D,'Concentration.Exposure'!$D$5:$D<>""),
f,FILTER(fid,MAP(fid,LAMBDA(x,SUMIFS(INDEX(LS,0,XMATCH(x,LH)),LC,"stock")>0))),
tot,$B$4,thr,$B$15,
num,ARRAYFORMULA(IF(ISNUMBER(LS),LS,0)),
isf,MAP(LH,LAMBDA(h,IF(h="",0,IF(ISNUMBER(XMATCH(h,fid)),1,0)))),
dw,ARRAYFORMULA(IF(ISNUMBER(LW),LW-MMULT(num,TRANSPOSE(isf)),0)),
sel,ARRAYFORMULA((LC="stock")*ISNUMBER(LW)*(LW>=thr)),
top,IF(SUM(sel)=0,HSTACK("","No company at or above the threshold."),
 LET(sn,FILTER(LN,sel),st,FILTER(LT,sel),sw,FILTER(LW,sel),ss,FILTER(LS,sel),mx,MAX(sw),
  fx,MAKEARRAY(ROWS(sw),ROWS(f),LAMBDA(i,j,IFERROR(N(INDEX(ss,i,XMATCH(INDEX(f,j),LH))),0))),
  HSTACK(SEQUENCE(ROWS(sw)),sn,st,ARRAYFORMULA(sw*tot),sw,
   MAP(sw,LAMBDA(x,SPARKLINE(x,{"charttype","bar";"max",mx;"color1","#2a78d6"}))),
   ARRAYFORMULA(ROUND(FILTER(dw,sel),12)),fx))),
rsel,ARRAYFORMULA((LC="stock")*ISNUMBER(LW)*(LW<thr)),
rw,SUMIFS(LW,LC,"stock",LW,"<"&thr),
rc,COUNTIFS(LC,"stock",LW,"<"&thr),
rf,MAP(f,LAMBDA(x,IFERROR(SUMIFS(INDEX(LS,0,XMATCH(x,LH)),LC,"stock",LW,"<"&thr),0))),
rest,HSTACK("","Stocks under "&TEXT(thr,"0.00%")&" ("&TEXT(rc,"#,##0")&")","",rw*tot,rw,"",ROUND(SUM(FILTER(dw,rsel)),12),TRANSPOSE(rf)),
ns,ARRAYFORMULA((LK<>"")*(LC<>"stock")),
own,ARRAYFORMULA(ns*(((LEFT(LK,9)="residual:")+(ABS(dw)>1E-12))>0)),
grp,ARRAYFORMULA(ns*(own=0)),
on,FILTER(LN,own),ok,FILTER(LK,own),oc,FILTER(LC,own),ow,FILTER(LW,own),os,FILTER(LS,own),
oname,MAP(on,LAMBDA(n,IFNA(XLOOKUP(n,Holdings!$G$2:$G,Holdings!$D$2:$D),n))),
kind,MAP(ok,oc,LAMBDA(k,c,IF(LEFT(k,9)="residual:","not looked through",SWITCH(c,"fund","fund, no holdings data","unknown","not in the SEC data",c)))),
came,BYROW(os,LAMBDA(r,IFERROR(TEXTJOIN(", ",TRUE,FILTER(LH,r<>"",r<>0)),""))),
ownAll,HSTACK(oname,kind,ARRAYFORMULA(ow*tot),ow,came),
keep,ARRAYFORMULA(IF((LEFT(ok,9)="residual:")*(ow=0),0,1)),
ownRows,FILTER(ownAll,keep),
cls,UNIQUE(FILTER(LC,grp)),
gw,MAP(cls,LAMBDA(x,SUM(FILTER(LW,grp,LC=x)))),
gn,MAP(cls,LAMBDA(x,ROWS(FILTER(LW,grp,LC=x)))),
gl,MAP(cls,gn,LAMBDA(x,m,SWITCH(x,"cash","Cash and money market funds","derivative","Derivatives","treasury","Treasury securities","other","Other holdings",x)&" inside funds ("&TEXT(m,"#,##0")&")")),
gf,MAP(cls,LAMBDA(x,TEXTJOIN(", ",TRUE,MAP(fid,LAMBDA(y,IF(SUM(FILTER(INDEX(num,0,XMATCH(y,LH)),grp,LC=x))<>0,y,"")))))),
grpAll,HSTACK(gl,cls,ARRAYFORMULA(gw*tot),gw,gf),
big,ARRAYFORMULA(IF(ABS(gw*tot)>=100,1,0)),
sm,ARRAYFORMULA(1-big),
smallRow,HSTACK("Other small holdings inside funds ("&TEXT(SUM(FILTER(gn,sm)),"#,##0")&")",
 TEXTJOIN(", ",TRUE,FILTER(cls,sm)),SUM(FILTER(gw,sm))*tot,SUM(FILTER(gw,sm)),
 TEXTJOIN(", ",TRUE,UNIQUE(TRANSPOSE(ARRAYFORMULA(TRIM(SPLIT(TEXTJOIN(",",TRUE,FILTER(gf,sm)),","))))))),
main,IF(SUM(grp)=0,ownRows,IF(SUM(big)=0,ownRows,VSTACK(ownRows,FILTER(grpAll,big)))),
nis,IF(SUM(grp)=0,SORT(main,4,FALSE),IF(SUM(sm)=0,SORT(main,4,FALSE),VSTACK(SORT(main,4,FALSE),smallRow))),
blank,MAKEARRAY(ROWS(nis),1,LAMBDA(i,j,"")),
IFNA(VSTACK(top,rest,"",
 HSTACK("","Not individual stocks"),
 {"","Line","Kind","Value","% of portfolio","Came from"},
 HSTACK(blank,nis),
 "",
 HSTACK("","Total of all lines","",SUM(LW)*tot,SUM(LW))),""))`;

/**
 * The layout of the tab Concentration.Exposure. The cells hold the labels
 * alone. The refresh writes the status, the time, and the answer.
 */
function exposureLayout() {
  return {
    name: EXPOSURE_TAB,
    rows: TAB_ROWS,
    columns: 52,
    hidden: true,
    frozenRows: 4,
    columnWidths: { A: 170, B: 150, C: 24, "D:M": 110, N: 24, O: 220, P: 260, "Q:T": 90, "U:AZ": 110 },
    cells: [
      { range: "A1:A2", values: [["Status"], ["Last run"]] },
      {
        range: "A4:A12",
        values: [
          ["measure"],
          ["lineCount"],
          ["top10Weight"],
          ["hhi"],
          ["effectiveCount"],
          ["lookedThroughWeight"],
          ["notLookedThroughWeight"],
          ["weightSum"],
          ["weightDifference"],
        ],
      },
      { range: "B4", values: [["value"]] },
      {
        range: "D4:M4",
        values: [
          [
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
          ],
        ],
      },
      { range: "O4:T4", values: [["key", "name", "ticker", "lei", "class", "weight"]] },
    ],
    styles: [
      { range: "A4:AZ4", bold: true, background: "#f7f6f1" },
      { range: "B2", numberFormat: "yyyy-mm-dd hh:mm:ss" },
      { range: "B5", numberFormat: "#,##0" },
      { range: "B6", numberFormat: "0.000000" },
      { range: "B7", numberFormat: "0.0" },
      { range: "B8", numberFormat: "0.00" },
      { range: "B9:B12", numberFormat: "0.000000" },
      { range: "F5:F", numberFormat: "yyyy-mm-dd" },
      { range: "H5:H", numberFormat: "#,##0" },
      { range: "I5:J", numberFormat: "0.00000" },
      { range: "K5:M", numberFormat: "#,##0" },
      { range: "T5:AZ", numberFormat: "0.00000" },
    ],
    conditional: [],
    validation: [],
  };
}

/**
 * The layout of the tab Concentration. B15 holds the threshold, 1% by
 * default. A person can change it.
 */
function reportLayout() {
  return {
    name: REPORT_TAB,
    rows: TAB_ROWS,
    columns: 26,
    hidden: false,
    frozenRows: 1,
    columnWidths: { A: 150, B: 300, C: 150, D: 175, E: 110, F: 180, G: 90, "H:K": 84 },
    cells: [
      { range: "A1", values: [["Concentration"]] },
      { range: "D1", values: [["Look-through exposure of the Holdings tab, by company."]] },
      {
        range: "A2:B7",
        values: [
          ["Status", "='Concentration.Exposure'!B1"],
          ["Last run", "='Concentration.Exposure'!B2"],
          ["Total value", "=SUM(Holdings!I2:I)"],
          ["Looked through", "='Concentration.Exposure'!B9"],
          ["Not looked through", "='Concentration.Exposure'!B10"],
          [
            "Sum check",
            `=IF(ISNUMBER('Concentration.Exposure'!B12),IF(ABS('Concentration.Exposure'!B12)<=0.005,"pass","fail"),"fail")`,
          ],
        ],
      },
      { range: "D2:H2", values: [["Fund looked through", "Report date", "Holdings", "Weight", "Covered"]] },
      { range: "D3", values: [[FUNDS_FORMULA]] },
      {
        range: "A10:B13",
        values: [
          ["Measures", ""],
          ["Top 10 weight", "='Concentration.Exposure'!B6"],
          ["HHI, 0 to 10,000", "='Concentration.Exposure'!B7"],
          ["Effective holdings", "='Concentration.Exposure'!B8"],
        ],
      },
      {
        range: "D10:F13",
        values: [
          ["Composition", "Value", "% of portfolio"],
          [
            '="Stocks at "&TEXT($B$15,"0.00%")&" or more"',
            "=F11*$B$4",
            `=SUMIFS('Concentration.Exposure'!$T$5:$T,'Concentration.Exposure'!$S$5:$S,"stock",'Concentration.Exposure'!$T$5:$T,">="&$B$15)`,
          ],
          [
            '="Stocks under "&TEXT($B$15,"0.00%")',
            "=F12*$B$4",
            `=SUMIFS('Concentration.Exposure'!$T$5:$T,'Concentration.Exposure'!$S$5:$S,"stock",'Concentration.Exposure'!$T$5:$T,"<"&$B$15)`,
          ],
          [
            "Not individual stocks",
            "=F13*$B$4",
            `=SUMIFS('Concentration.Exposure'!$T$5:$T,'Concentration.Exposure'!$S$5:$S,"<>stock")`,
          ],
        ],
      },
      { range: "A15:C15", values: [["Threshold", 0.01, "Type a percent. Each company at or above it gets a row."]] },
      { range: "A17:G17", values: [["Rank", "Company", "Ticker", "Value", "% of portfolio", "", "Direct"]] },
      { range: "H17", values: [[FUND_HEADER_FORMULA]] },
      { range: "A18", values: [[REPORT_FORMULA]] },
    ],
    styles: [
      { range: "A1", bold: true, fontSize: 16 },
      { range: "D1", color: "#6b6962", italic: true },
      { range: "A2:A13", color: "#57554f" },
      { range: "B3", numberFormat: "yyyy-mm-dd hh:mm" },
      { range: "B4", numberFormat: "$#,##0", bold: true },
      { range: "B5:B6", numberFormat: "0.00%" },
      { range: "A10:F10", bold: true, background: "#f7f6f1", color: "#1d1c1a" },
      { range: "B11", numberFormat: "0.00%" },
      { range: "B12", numberFormat: "#,##0" },
      { range: "B13", numberFormat: "0.0" },
      { range: "E11:E13", numberFormat: "$#,##0" },
      { range: "F11:F13", numberFormat: "0.00%" },
      { range: "A15", bold: true },
      { range: "B15", numberFormat: "0.00%", bold: true, background: "#fff4c7", align: "right" },
      { range: "C15", color: "#6b6962", italic: true },
      { range: "A17:K17", bold: true, background: "#f7f6f1" },
      { range: "A17", align: "right" },
      { range: "D17:K17", align: "right" },
      { range: "A18:A", numberFormat: "0" },
      { range: "D18:D", numberFormat: "$#,##0" },
      { range: "E18:E", numberFormat: "0.00%" },
      { range: "G18:K", numberFormat: '0.00%;-0.00%;""' },
      { range: "F18:F", wrap: true },
      { range: "B2:B7", align: "right" },
      { range: "D2:H2", bold: true, background: "#f7f6f1" },
      { range: "D3:D9", bold: true },
      { range: "E3:E9", numberFormat: "yyyy-mm-dd" },
      { range: "F3:F9", numberFormat: "#,##0" },
      { range: "G3:G9", numberFormat: "0.00%" },
      { range: "H3:H9", numberFormat: "0.0%" },
    ],
    conditional: [
      { range: "B2", formula: '=$B$2="OK"', background: "#dcefe2", color: "#1b5e34", bold: true },
      { range: "B2", formula: '=$B$2<>"OK"', background: "#f7d4d4", color: "#8a1c1c", bold: true },
      { range: "B7", formula: '=$B$7="pass"', background: "#dcefe2", color: "#1b5e34", bold: true },
      { range: "B7", formula: '=$B$7<>"pass"', background: "#f7d4d4", color: "#8a1c1c", bold: true },
      {
        range: "A18:K",
        formula: '=LEFT($B18,13)="Stocks under "',
        background: "#f4f3ee",
        color: "#3c3b37",
        italic: true,
      },
      { range: "A18:K", formula: '=$B18="Not individual stocks"', bold: true },
      { range: "A18:K", formula: '=$B18="Line"', bold: true, background: "#f7f6f1" },
      { range: "A18:K", formula: '=$B18="Total of all lines"', bold: true },
      { range: "B18:B", formula: "=AND(ISNUMBER($A18),N($G18)>0,SUM($H18:$K18)>0)", bold: true },
    ],
    validation: [{ range: "B15", min: 0, max: 1, message: "Type a percent from 0% to 100%, such as 1%." }],
  };
}

/**
 * Create each tab of the report that is absent, from its layout. The function
 * creates Concentration.Exposure first, because the formulas of Concentration
 * read it. It leaves a tab that exists as it is, and it changes no other tab.
 */
function ensureTabs(book) {
  for (const layout of [exposureLayout(), reportLayout()]) {
    if (book.getSheetByName(layout.name) === null) createTab(book, layout);
  }
}

/**
 * Add a tab at the end of the spreadsheet and apply its layout: the grid
 * size, the cells, the styles, the column widths, the frozen rows, the
 * conditional formats, the data validation, and the hidden flag.
 */
function createTab(book, layout) {
  const sheet = book.insertSheet(layout.name, book.getNumSheets());
  sizeGrid(sheet, layout.rows, layout.columns);
  for (const cell of layout.cells) sheet.getRange(cell.range).setValues(cell.values);
  for (const style of layout.styles) applyStyle(sheet.getRange(style.range), style);
  for (const [columns, width] of Object.entries(layout.columnWidths)) {
    const [first, last] = columns.split(":");
    const start = columnNumber(first);
    sheet.setColumnWidths(start, columnNumber(last || first) - start + 1, width);
  }
  sheet.setFrozenRows(layout.frozenRows);
  sheet.setConditionalFormatRules(layout.conditional.map((rule) => conditionalRule(sheet, rule)));
  for (const check of layout.validation) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireNumberBetween(check.min, check.max)
      .setAllowInvalid(false)
      .setHelpText(check.message)
      .build();
    sheet.getRange(check.range).setDataValidation(rule);
  }
  if (layout.hidden) sheet.hideSheet();
}

/**
 * Add or delete rows and columns at the end of the grid until the grid holds
 * the given count of rows and columns.
 */
function sizeGrid(sheet, rows, columns) {
  const haveRows = sheet.getMaxRows();
  if (rows > haveRows) sheet.insertRowsAfter(haveRows, rows - haveRows);
  if (rows < haveRows) sheet.deleteRows(rows + 1, haveRows - rows);
  const haveColumns = sheet.getMaxColumns();
  if (columns > haveColumns) sheet.insertColumnsAfter(haveColumns, columns - haveColumns);
  if (columns < haveColumns) sheet.deleteColumns(columns + 1, haveColumns - columns);
}

/**
 * The column number of a column letter, such as 1 for A and 27 for AA.
 */
function columnNumber(letters) {
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}

/**
 * Apply one style entry of a layout to a range. The keys are bold, italic,
 * fontSize, color, background, numberFormat, align, and wrap. The function
 * changes only the properties that the entry names.
 */
function applyStyle(range, style) {
  if (style.bold !== undefined) range.setFontWeight(style.bold ? "bold" : "normal");
  if (style.italic !== undefined) range.setFontStyle(style.italic ? "italic" : "normal");
  if (style.fontSize !== undefined) range.setFontSize(style.fontSize);
  if (style.color !== undefined) range.setFontColor(style.color);
  if (style.background !== undefined) range.setBackground(style.background);
  if (style.numberFormat !== undefined) range.setNumberFormat(style.numberFormat);
  if (style.align !== undefined) range.setHorizontalAlignment(style.align);
  if (style.wrap !== undefined) range.setWrap(style.wrap);
}

/**
 * The conditional format rule of one entry of a layout: a custom formula
 * and the style of a cell that meets it.
 */
function conditionalRule(sheet, rule) {
  const builder = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(rule.formula)
    .setRanges([sheet.getRange(rule.range)]);
  if (rule.background !== undefined) builder.setBackground(rule.background);
  if (rule.color !== undefined) builder.setFontColor(rule.color);
  if (rule.bold !== undefined) builder.setBold(rule.bold);
  if (rule.italic !== undefined) builder.setItalic(rule.italic);
  return builder.build();
}
