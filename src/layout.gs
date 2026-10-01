/**
 * The layout of the two tabs of the concentration report, and the functions
 * that create a tab from its layout.
 *
 * The tab Concentration.Exposure is hidden. It holds the layout version, the
 * answer of the concentration route, the fund mixes that the request sent,
 * the values that the script computes from the answer, and the run times of
 * the 10 newest good refreshes. concentration.gs writes the answer, the
 * mixes, the computed values, and the run times. No computed value reads
 * the threshold, the overlap minimum, or the total value of the Holdings
 * tab. The report formulas read those cells, so a change of one of them
 * shows in the report with no refresh. The tab
 * Concentration is the report. Each of its cells is a label, a formula, or
 * one of the two cells that the person types in: the threshold and the
 * overlap minimum. The formulas read Concentration.Exposure and the Holdings
 * tab.
 *
 * A refresh calls ensureTabs before the request. The function compares the
 * layout version of the hidden tab with LAYOUT_VERSION. When the two are
 * equal, it creates the report tab if that tab is absent. When they differ,
 * or when the hidden tab is absent, it replaces both tabs and keeps the two
 * values that the person typed. Delete the hidden tab to get the layout of
 * both tabs again on the next refresh.
 */

/**
 * The name of the report tab.
 */
const REPORT_TAB = "Concentration";

/**
 * The version of the layout of the two tabs. Add 1 when a change moves a cell
 * that a formula or the script reads. The next refresh then replaces the two
 * tabs of each spreadsheet.
 */
const LAYOUT_VERSION = 5;

/**
 * The cell of the tab Concentration.Exposure that holds the layout version.
 * A tab with no value in this cell holds a layout with no version, and a
 * refresh replaces it.
 */
const VERSION_CELL = "B3";

/**
 * The count of rows of each new tab.
 */
const TAB_ROWS = 1000;

/**
 * The count of columns of the report tab. The last column is Z.
 */
const REPORT_COLUMNS = 26;

/**
 * The two cells of the report tab that the person types in. Each one has a
 * name, the label in column A of its row, and the value of a new tab.
 * readInputs finds a cell by its label. When a label gets another text, make
 * readInputs find the old text too, or a replaced tab loses the typed value.
 */
const INPUTS = {
  threshold: { label: "Threshold", value: 0.01 },
  overlapMinimum: { label: "Overlap minimum", value: 0.1 },
};

/**
 * The count of rows at the top of a report tab that readInputs reads.
 */
const INPUT_ROWS = 40;

/**
 * The row of the status cell and the row of the total value cell of the
 * report tab. Both cells are in column B.
 */
const STATUS_ROW = 3;
const TOTAL_ROW = 6;

/**
 * The row of the header of the block of the security measures, and the row
 * of the header of the composition block.
 */
const STOCKS_ROW = 12;
const COMPOSITION_ROW = 18;

/**
 * The row of the threshold cell, and the row of the overlap minimum cell.
 * Both cells are in column B.
 */
const THRESHOLD_ROW = 23;
const OVERLAP_ROW = 24;

/**
 * The row of the report spill. The spill holds the section Your holdings,
 * the header of the company table, the company table, and each section under
 * it. The row count of the section Your holdings changes with the Holdings
 * tab, so the header of the company table is inside the spill.
 */
const REPORT_ROW = 26;

/**
 * The share of the portfolio at or above which a holding that the route
 * cannot look through gets a row of its own in the section of the funds not
 * looked through.
 */
const UNSEEN_FLOOR = 0.01;

/**
 * The title of the section of the funds not looked through, and the text of
 * each row of a holding with no mix.
 */
const UNSEEN_TITLE = "Funds not looked through";
const ADD_MIX_NOTE = "Add its fund mix: Concentration › Describe a fund";

/**
 * The count of days after which the report asks the person to check a mix.
 */
const MIX_AGE_DAYS = 182;

/**
 * The title of the section of the holdings that are not securities of a
 * company, below the company table, and the title of the section of the
 * groups of the Holdings tab, above it.
 */
const OTHER_TITLE = "Other holdings";
const HOLDINGS_TITLE = "Your holdings";

/**
 * The disclaimer of the report tab, in B1.
 */
const DISCLAIMER =
  "This report is intended for informational purposes only. It does not constitute investment advice. The presented data might be inaccurate, incomplete, or out of date.";

/**
 * The first row of the spill of the fund table, in column D, and the last
 * row that the spill can use. The report spill starts in row REPORT_ROW.
 */
const FUND_ROW = 4;
const FUND_LAST_ROW = REPORT_ROW - 1;

/**
 * A reference to a range of the tab Concentration.Exposure.
 */
function exposure(range) {
  return `'${EXPOSURE_TAB}'!${range}`;
}

/**
 * The cell of the tab Concentration.Exposure that holds one measure.
 */
function measureCell(name) {
  return exposure(`B${FIRST_DATA_ROW + MEASURE_NAMES.indexOf(name)}`);
}

/**
 * The cell of the tab Concentration.Exposure that holds one field of the
 * equity block.
 */
function equityCell(name) {
  return exposure(`B${EQUITY_HEADER_ROW + 1 + EQUITY_NAMES.indexOf(name)}`);
}

/**
 * The column letters of the blocks of the tab Concentration.Exposure that the
 * report formulas read: the funds block, the overlaps block, the mix block,
 * the unseen block, the stock fund block, the own block, the group block,
 * the lines block, and the sources block. The sources block ends at the
 * column of position MAX_POSITIONS, because a request holds MAX_POSITIONS
 * positions at most.
 */
function exposureColumns() {
  const fund = (name) => columnLetter(FUND_COLUMN + FUND_FIELDS.indexOf(name));
  const mix = (name) => columnLetter(MIX_COLUMN + MIX_FIELDS.indexOf(name));
  const own = (name) => columnLetter(OWN_COLUMN + OWN_FIELDS.indexOf(name));
  const group = (name) => columnLetter(GROUP_COLUMN + GROUP_FIELDS.indexOf(name));
  const line = (name) => columnLetter(LINE_COLUMN + LINE_FIELDS.indexOf(name));
  return {
    fundId: fund("id"),
    fundWeight: fund("weight"),
    fundPart: fund("partWeight"),
    pairFirst: columnLetter(OVERLAP_COLUMN),
    pairSecond: columnLetter(OVERLAP_COLUMN + 1),
    pairOverlap: columnLetter(OVERLAP_COLUMN + 2),
    pairShared: columnLetter(OVERLAP_COLUMN + 3),
    mixId: mix("mixId"),
    mixWeight: mix("mixWeight"),
    mixEntered: mix("entered"),
    mixTicker: mix("partTicker"),
    mixPart: mix("partWeight"),
    mixSubstitute: mix("substitute"),
    unseenId: columnLetter(UNSEEN_COLUMN),
    unseenWeight: columnLetter(UNSEEN_COLUMN + 1),
    stockFund: columnLetter(STOCK_FUND_COLUMN),
    ownKey: own("ownKey"),
    ownName: own("ownName"),
    ownClass: own("ownClass"),
    ownWeight: own("ownWeight"),
    ownSources: own("ownSources"),
    groupClass: group("groupClass"),
    groupWeight: group("groupWeight"),
    groupCount: group("groupCount"),
    groupSources: group("groupSources"),
    key: line("key"),
    name: line("name"),
    ticker: line("ticker"),
    class: line("class"),
    weight: line("weight"),
    stock: line("stockWeight"),
    part: columnLetter(PART_COLUMN),
    direct: columnLetter(DIRECT_COLUMN),
    first: columnLetter(SOURCE_COLUMN),
    last: columnLetter(SOURCE_COLUMN + MAX_POSITIONS - 1),
  };
}

/**
 * A column of a block of the tab Concentration.Exposure, from the first data
 * row to the last row of the tab.
 */
function exposureColumn(letter) {
  return exposure(`$${letter}$${FIRST_DATA_ROW}:$${letter}`);
}

/**
 * The formula of B6: the sum of the Value column of the Holdings tab. The
 * formula finds the column by the header text in row 1, with the match rule
 * of findColumns. INDIRECT with the R1C1 text "C" and the column number reads
 * the whole column, so the formula holds no column letter. The header text in
 * row 1 adds nothing to the sum. When row 1 holds no Value column, B6 shows a
 * text in place of a number.
 */
const TOTAL_FORMULA = `=LET(c,XMATCH(TRUE,ARRAYFORMULA(EXACT(TRIM(Holdings!$1:$1),"Value"))),
IF(ISNA(c),"No Holdings column Value",SUM(INDIRECT("Holdings!C"&c,FALSE))))`;

/**
 * The formula of D4: the funds that the route looked through, with the
 * report date, the count of holdings, the weight, and the covered part. A
 * fund of a mix shows the holding and the ticker of the fund. When the route
 * looked through no fund, D4 shows a text.
 */
function fundsFormula() {
  const x = exposureColumns();
  const block = exposure(`$${x.fundId}$${FIRST_DATA_ROW}:$${x.fundPart}`);
  const part = FUND_FIELDS.indexOf("partWeight") + 1;
  return `=LET(r,IFNA(FILTER(${block},${exposureColumn(x.fundId)}<>""),""),
IF(INDEX(r,1,1)="","No fund looked through.",
HSTACK(ARRAYFORMULA(IF(CHOOSECOLS(r,${part})="",CHOOSECOLS(r,1),CHOOSECOLS(r,1)&" › "&CHOOSECOLS(r,2))),
CHOOSECOLS(r,3,5,6),ARRAYFORMULA(CHOOSECOLS(r,7)/CHOOSECOLS(r,6)))))`;
}

/**
 * The formula of B9: the seconds of the newest run in A15:B24 of the tab
 * Concentration.Exposure. B9 is empty when no run is recorded.
 */
const RUN_LAST_FORMULA = `=IF(ISNUMBER('Concentration.Exposure'!B15),'Concentration.Exposure'!B15,"")`;

/**
 * The formula of B10: the average seconds of the runs in A15:B24 of the tab
 * Concentration.Exposure. The block keeps 10 runs at most, so the average
 * uses each recorded run when fewer than 10 exist. B10 is empty when no run
 * is recorded.
 */
const RUN_AVERAGE_FORMULA = `=IF(COUNT('Concentration.Exposure'!B15:B24)=0,"",AVERAGE('Concentration.Exposure'!B15:B24))`;

/**
 * The formula of a cell that shows one field of the equity block. The cell is
 * empty when the field holds no number, so a portfolio with no stock shows no
 * error.
 */
function equityFormula(name) {
  return `=IF(ISNUMBER(${equityCell(name)}),${equityCell(name)},"")`;
}

/**
 * The formula of A17: one text when the last good answer holds lines and no
 * equity block. The cell is empty before the first good refresh.
 */
function noStockFormula() {
  return `=IF(AND(ISNUMBER(${measureCell("lineCount")}),NOT(ISNUMBER(${equityCell("weight")}))),"Your portfolio holds no securities.","")`;
}

/**
 * The names at the start of the LET of a formula that reads the holdings
 * that the route cannot look through. uid holds each position id of the last
 * answer, as a column, and uu holds the weight of each position in the
 * unseen block. The script writes the unseen block: the weight of the lines
 * of the class unknown that came through each position with no mix, and 0
 * for a position with a mix.
 */
function unseenNames() {
  const x = exposureColumns();
  const id = exposureColumn(x.unseenId);
  return `uid,IFNA(FILTER(${id},${id}<>""),""),
uu,IFNA(FILTER(${exposureColumn(x.unseenWeight)},${id}<>""),0),`;
}

/**
 * The formula of B4, under the status cell: the count of the holdings that
 * the route cannot look through and that have no mix, with their share of
 * the portfolio. The formula reads the weights of the unseen block. The cell
 * is empty when no such holding exists.
 */
function unseenNoteFormula() {
  const x = exposureColumns();
  return `=LET(uu,${exposureColumn(x.unseenWeight)},
n,COUNTIF(uu,">1E-12"),s,SUM(uu),
IF(n=0,"",n&IF(n=1," holding ("," holdings (")&IF(s<0.01,"less than 1%",TEXT(s,"0%"))&" of your portfolio) "&IF(n=1,"is a fund","are funds")&" not looked through."))`;
}

/**
 * The formula of the coverage label in the header of the block of the
 * security measures: the share of the portfolio outside the lines of the class
 * unknown. The cell is empty when the answer holds no unknownWeight.
 */
function coverageFormula() {
  const cell = measureCell("unknownWeight");
  return `=IF(ISNUMBER(${cell}),"These measures cover "&TEXT(1-${cell},"0.0%")&" of your portfolio.","")`;
}

/**
 * The formula of one row of the Composition block: the sum of the stock
 * weight of the rows of the stock part that meet the comparison with the
 * threshold. The comparison is `>=` or `<`.
 */
function stockSumFormula(comparison) {
  const x = exposureColumns();
  const stock = exposureColumn(x.stock);
  return `=SUMIFS(${stock},${exposureColumn(x.part)},"${STOCK_PART}",${stock},"${comparison}"&$B$${THRESHOLD_ROW})`;
}

/**
 * The formula of the last row of the Composition block: the sum of the part
 * of each line that is not stock. The part is the weight minus the stock
 * weight, on the rows of the other part.
 */
function otherSumFormula() {
  const x = exposureColumns();
  const part = exposureColumn(x.part);
  return `=SUMIFS(${exposureColumn(x.weight)},${part},"${OTHER_PART}")-SUMIFS(${exposureColumn(x.stock)},${part},"${OTHER_PART}")`;
}

/**
 * The note under the total of the report spill.
 */
const SUM_NOTE =
  "The positions in a fund report can add up to more than 100% of the net assets of the fund. This total can then be above 100%.";

/**
 * The note under the header of the fund overlap list.
 */
const OVERLAP_NOTE = "Overlap is the part of the two funds that sits in the same securities.";

/**
 * The note above the header of the company table.
 */
const TRUST_NOTE = "A commodity trust or a crypto trust, such as GLD or IBIT, counts as one security.";

/**
 * The text of the section Your holdings when the Holdings tab holds no
 * Symbol, Description, or Value column, and the name of a group of rows with
 * an empty Symbol and an empty Description.
 */
const HOLDINGS_COLUMNS_NOTE = "The Holdings tab needs the columns Symbol, Description, and Value.";
const NO_NAME = "No symbol or description";

/**
 * The formula of the report spill, in column A of row REPORT_ROW. The spill
 * holds these blocks from the top: the section Your holdings, the note on
 * trusts, the header of the company table, the company table, the fund
 * overlap list, the section of the funds not looked through, the section of
 * the other holdings, and the total.
 *
 * The section Your holdings reads the Holdings tab alone, so it changes with
 * no refresh. Each Holdings row with a number in Value goes into the group of
 * its key: its Symbol, or its Description when the Symbol is empty, cut to 64
 * characters, as buildPositions makes it. EXACT compares the keys, so two
 * keys that differ in case give two groups, as in the script. A group row
 * holds the Description of the first row of the group, the Symbol, the count
 * of rows, the sum of the values, and the sum divided by the total value
 * cell. The rows sort by value, largest first. A Total row with the total
 * value cell ends the section.
 *
 * LN, LT, LW, LX, and LP are the columns of the lines block: the name, the
 * ticker, the weight, the stock weight, and the part name. LS is the sources
 * block, and LH is the row of the position ids. LS and LH end at the column
 * of position MAX_POSITIONS. f holds each id of the stock fund block, or one
 * empty string when the block is empty. The header of the company table
 * holds one column for each id of f, from column H.
 *
 * Each row of the lines block is one part of a line. pw is the weight of the
 * part: the stock weight on a row of the stock part, and the weight minus the
 * stock weight on a row of the other part. dw is the direct weight column of
 * the lines block: the part of pw that came through no fund. A company row
 * is a row of the stock part with a stock weight at or above the threshold,
 * whatever the class of the line. The source cells of that row are the stock
 * part of each source, so the Direct column and the fund columns add up to
 * the row.
 *
 * The section of the funds not looked through gives one row to each holding
 * with no mix whose lines of the class unknown hold UNSEEN_FLOOR or more of
 * the portfolio, and one row to the rest of those holdings. Then it gives one
 * row to each fund of each mix, with the substitute mark and the entry date
 * of the mix, and one Not described row to each mix with a total under 100%.
 * A mix older than MIX_AGE_DAYS asks the person to check the fact sheet. MI,
 * MW, ME, MT, MP, and MS are the columns of the mix block. hn gives the
 * Description of the Holdings tab for a Symbol, or the text that it gets.
 * Each piece of the section has a seventh column. The text "x" in it marks a
 * row that the section drops.
 *
 * The script writes the rows of the other part that get a row of their own
 * into the own block, and the groups of the other rows of the other part
 * into the group block. A row of the other part gets a row of its own when
 * the class of its line is not stock and the line is a residual line, holds
 * a direct position, or has the class unknown. Each other row of the other
 * part goes into the group of its class. keep selects the rows of the own
 * block, and grp selects the rows of the group block. Both hold 1 and 0, not
 * TRUE and FALSE, because SUM adds no TRUE in an array, and nown and ng count
 * the rows with SUM. The groups of the classes stock and fund always get a
 * row. Another group with a value under 100 goes into one row of small
 * holdings.
 *
 * The formula finds the Symbol, the Description, and the Value columns of the
 * Holdings tab by the header text in row 1, as the total value cell finds the
 * Value column. When the total value cell holds no number, each value cell
 * stays empty. Each FILTER that can find no row has a fallback in IFNA or
 * IFERROR, or an IF before it that uses the FILTER only when a row matches.
 */
function reportFormula() {
  const x = exposureColumns();
  const column = (letter) => exposureColumn(letter);
  const floor = UNSEEN_FLOOR;
  return `=LET(LN,${column(x.name)},LT,${column(x.ticker)},LW,${column(x.weight)},LX,${column(x.stock)},LP,${column(x.part)},
LS,${exposure(`$${x.first}$${FIRST_DATA_ROW}:$${x.last}`)},LH,${exposure(`$${x.first}$${HEADER_ROW}:$${x.last}$${HEADER_ROW}`)},
f,IFNA(FILTER(${column(x.stockFund)},${column(x.stockFund)}<>""),""),
hh,Holdings!$1:$1,
hs,XMATCH(TRUE,ARRAYFORMULA(EXACT(TRIM(hh),"Symbol"))),
hd,XMATCH(TRUE,ARRAYFORMULA(EXACT(TRIM(hh),"Description"))),
hv,XMATCH(TRUE,ARRAYFORMULA(EXACT(TRIM(hh),"Value"))),
tot,IF(ISNUMBER($B$${TOTAL_ROW}),$B$${TOTAL_ROW},NA()),thr,$B$${THRESHOLD_ROW},
yours,IF(ISNA(hs)+ISNA(hd)+ISNA(hv)>0,"${HOLDINGS_COLUMNS_NOTE}",
 LET(yv,INDIRECT("Holdings!C"&hv,FALSE),
  ys,ARRAYFORMULA(TRIM(INDIRECT("Holdings!C"&hs,FALSE))),yd,ARRAYFORMULA(TRIM(INDIRECT("Holdings!C"&hd,FALSE))),
  yok,ARRAYFORMULA(ISNUMBER(yv)*1),
  IF(SUM(yok)=0,"No holding on the Holdings tab has a value.",
   LET(fk,FILTER(ARRAYFORMULA(LEFT(IF(ys<>"",ys,yd),64)),yok),fs,FILTER(ys,yok),fd,FILTER(yd,yok),fv,FILTER(yv,yok),
    yu,UNIQUE(fk),
    yi,MAP(yu,LAMBDA(k,XMATCH(TRUE,ARRAYFORMULA(EXACT(fk,k))))),
    yn,MAP(yu,yi,LAMBDA(k,i,IF(INDEX(fd,i)<>"",INDEX(fd,i),IF(k<>"",k,"${NO_NAME}")))),
    yt,MAP(yi,LAMBDA(i,INDEX(fs,i))),
    yc,MAP(yu,LAMBDA(k,SUMPRODUCT(EXACT(fk,k)*1))),
    yw,MAP(yu,LAMBDA(k,SUMPRODUCT(EXACT(fk,k)*fv))),
    VSTACK(SORT(HSTACK(yn,yt,yc,yw,ARRAYFORMULA(IFERROR(yw/tot,""))),4,FALSE),
     HSTACK("Total","","",tot,IFERROR(tot/tot,""))))))),
MI,${column(x.mixId)},MW,${column(x.mixWeight)},ME,${column(x.mixEntered)},
MT,${column(x.mixTicker)},MP,${column(x.mixPart)},MS,${column(x.mixSubstitute)},
hn,LAMBDA(n,IF(ISNA(hs)+ISNA(hd),n,IFNA(XLOOKUP(n,INDIRECT("Holdings!C"&hs,FALSE),INDIRECT("Holdings!C"&hd,FALSE)),n))),
pw,ARRAYFORMULA(IF(LP="${STOCK_PART}",LX,IF(LP="${OTHER_PART}",LW-LX,0))),
dw,${column(x.direct)},
sel,ARRAYFORMULA((LP="${STOCK_PART}")*ISNUMBER(LX)*(LX>=thr)),
top,IF(SUM(sel)=0,HSTACK("","No company at or above the threshold."),
 LET(blk,SORT(HSTACK(FILTER(LN,sel),FILTER(LT,sel),FILTER(LX,sel),FILTER(dw,sel),FILTER(LS,sel)),3,FALSE),
  sw,CHOOSECOLS(blk,3),mx,MAX(sw),
  fx,MAKEARRAY(ROWS(sw),ROWS(f),LAMBDA(i,j,IFERROR(N(INDEX(blk,i,4+XMATCH(INDEX(f,j),LH))),0))),
  HSTACK(SEQUENCE(ROWS(sw)),CHOOSECOLS(blk,1,2),ARRAYFORMULA(sw*tot),sw,
   MAP(sw,LAMBDA(x,SPARKLINE(x,{"charttype","bar";"max",mx;"color1","#2a78d6"}))),
   ARRAYFORMULA(ROUND(CHOOSECOLS(blk,4),12)),fx))),
rsel,ARRAYFORMULA((LP="${STOCK_PART}")*ISNUMBER(LX)*(LX<thr)),
rw,SUMIFS(LX,LP,"${STOCK_PART}",LX,"<"&thr),
rc,COUNTIFS(LP,"${STOCK_PART}",LX,"<"&thr,LX,"<>0"),
rf,MAP(f,LAMBDA(x,IFERROR(SUMIFS(INDEX(LS,0,XMATCH(x,LH)),LP,"${STOCK_PART}",LX,"<"&thr),0))),
rest,HSTACK("","Securities under "&TEXT(thr,"0.00%")&" ("&TEXT(rc,"#,##0")&")","",rw*tot,rw,"",ROUND(SUM(IFNA(FILTER(dw,rsel),0)),12),TRANSPOSE(rf)),
${unseenNames()}
cx,{"","","","","","","x"},
cu,LET(q,IFNA(FILTER(uid,uu>=${floor}),""),
 IF(INDEX(q,1,1)="",cx,
  LET(qw,IFNA(FILTER(uu,uu>=${floor}),0),qe,MAKEARRAY(ROWS(q),1,LAMBDA(i,j,"")),
   SORT(HSTACK(MAP(q,LAMBDA(v,hn(v))),qe,ARRAYFORMULA(qw*tot),qw,MAKEARRAY(ROWS(q),1,LAMBDA(i,j,"${ADD_MIX_NOTE}")),qe,qe),4,FALSE)))),
csn,SUM(ARRAYFORMULA(IF((uu>1E-12)*(uu<${floor}),1,0))),
csw,SUM(ARRAYFORMULA(IF(uu<${floor},uu,0))),
cs,IF(csn=0,cx,HSTACK("Holdings under ${floor * 100}% ("&csn&")","",csw*tot,csw,"${ADD_MIX_NOTE}","","")),
cdn,SUM(ARRAYFORMULA(IF(MI<>"",1,0))),
cd,IF(cdn=0,cx,
 LET(ki,IFNA(FILTER(MI,MI<>""),""),kw,IFNA(FILTER(MW,MI<>""),0),ke,IFNA(FILTER(ME,MI<>""),0),
  kt,IFNA(FILTER(MT,MI<>""),""),kp,IFNA(FILTER(MP,MI<>""),0),ks,IFNA(FILTER(MS,MI<>""),FALSE),
  kn,MAP(ke,LAMBDA(d,"Mix entered "&TEXT(d,"mmmm yyyy")&IF(TODAY()-d>${MIX_AGE_DAYS}," — check the fact sheet",""))),
  kr,HSTACK(MAP(ki,LAMBDA(v,hn(v))),ARRAYFORMULA(kt&IF(ks," (substitute)","")),ARRAYFORMULA(kw*kp*tot),ARRAYFORMULA(kw*kp),kn,ki,
   MAKEARRAY(ROWS(ki),1,LAMBDA(i,j,0))),
  ku,UNIQUE(ki),
  kv,MAP(ku,LAMBDA(v,XLOOKUP(v,ki,kw)*(1-SUM(IFNA(FILTER(kp,ki=v),0))))),
  ko,HSTACK(MAP(ku,LAMBDA(v,hn(v))),MAKEARRAY(ROWS(ku),1,LAMBDA(i,j,"Not described")),ARRAYFORMULA(kv*tot),kv,
   MAP(ku,LAMBDA(v,XLOOKUP(v,ki,kn))),ku,MAKEARRAY(ROWS(ku),1,LAMBDA(i,j,1))),
  SORT(VSTACK(kr,IFNA(FILTER(ko,kv>1E-9),cx)),6,TRUE,7,TRUE))),
cv,VSTACK(cu,cs,cd),
can,IFNA(FILTER(CHOOSECOLS(cv,1,2,3,4,5),CHOOSECOLS(cv,7)<>"x"),{"Every fund is looked through.","","","",""}),
cb,MAKEARRAY(ROWS(can),1,LAMBDA(i,j,"")),
keep,ARRAYFORMULA(ISNUMBER(${column(x.ownWeight)})*1),
nown,SUM(keep),
on,FILTER(${column(x.ownName)},keep),ok,FILTER(${column(x.ownKey)},keep),oc,FILTER(${column(x.ownClass)},keep),
ow,FILTER(${column(x.ownWeight)},keep),came,FILTER(${column(x.ownSources)},keep),
oname,IF(ISNA(hs)+ISNA(hd),on,
 LET(sc,INDIRECT("Holdings!C"&hs,FALSE),sy,ARRAYFORMULA(IF(ROW(sc)=1,"",sc)),de,INDIRECT("Holdings!C"&hd,FALSE),
  MAP(on,LAMBDA(n,IFNA(XLOOKUP(n,sy,de),n))))),
kind,MAP(ok,oc,on,LAMBDA(k,c,n,IF(LEFT(k,9)="residual:","not looked through",IF(RIGHT(n,16)=" (not described)","not described",
 SWITCH(c,"fund","fund, no holdings data","unknown","not in the SEC data",c))))),
ownRows,HSTACK(oname,kind,ARRAYFORMULA(ow*tot),ow,came),
grp,ARRAYFORMULA(ISNUMBER(${column(x.groupWeight)})*1),
cls,FILTER(${column(x.groupClass)},grp),
gw,FILTER(${column(x.groupWeight)},grp),
gn,FILTER(${column(x.groupCount)},grp),
gl,MAP(cls,gn,LAMBDA(x,m,SWITCH(x,"stock","Bonds of companies whose stock you hold","fund","Funds held by your funds, not looked through","cash","Cash and money market funds inside funds","derivative","Derivatives inside funds","treasury","Treasury securities inside funds","other","Other holdings inside funds",x&" inside funds")&" ("&TEXT(m,"#,##0")&")")),
gk,MAP(cls,LAMBDA(x,SWITCH(x,"stock","bond or other security","fund","fund, not looked through",x))),
gf,FILTER(${column(x.groupSources)},grp),
grpAll,HSTACK(gl,gk,ARRAYFORMULA(gw*tot),gw,gf),
big,ARRAYFORMULA(IF((cls="stock")+(cls="fund")>0,1,IF(ISNUMBER(gw*tot),IF(ABS(gw*tot)>=100,1,0),1))),
sm,ARRAYFORMULA(1-big),
ng,IF(SUM(grp)=0,0,SUM(big)),
nsm,IF(SUM(grp)=0,0,SUM(sm)),
smallRow,HSTACK("Other small holdings inside funds ("&TEXT(SUM(FILTER(gn,sm)),"#,##0")&")",
 TEXTJOIN(", ",TRUE,FILTER(gk,sm)),SUM(FILTER(gw,sm))*tot,SUM(FILTER(gw,sm)),
 IFERROR(TEXTJOIN(", ",TRUE,UNIQUE(TRANSPOSE(ARRAYFORMULA(TRIM(SPLIT(TEXTJOIN(",",TRUE,FILTER(gf,sm)),",")))))),"")),
main,IF(nown=0,FILTER(grpAll,big),IF(ng=0,ownRows,VSTACK(ownRows,FILTER(grpAll,big)))),
nis,IF(nown+ng=0,IF(nsm=0,"No holding other than securities.",smallRow),
 IF(nsm=0,SORT(main,4,FALSE),VSTACK(SORT(main,4,FALSE),smallRow))),
blank,MAKEARRAY(ROWS(nis),1,LAMBDA(i,j,"")),
pa,${column(x.pairFirst)},pb,${column(x.pairSecond)},po,${column(x.pairOverlap)},pn,${column(x.pairShared)},
fw,${column(x.fundWeight)},
pwt,LAMBDA(v,IFNA(XLOOKUP(v,MI,MW),XLOOKUP(v,${column(x.fundId)},fw,""))),
psel,ARRAYFORMULA(ISNUMBER(po)*(po>=$B$${OVERLAP_ROW})),
plist,IF(SUM(psel)=0,HSTACK("","No pair of funds is at or above the overlap minimum."),
 LET(qa,FILTER(pa,psel),qb,FILTER(pb,psel),gap,MAKEARRAY(ROWS(qa),1,LAMBDA(i,j,"")),
  HSTACK(gap,qa,qb,gap,FILTER(po,psel),FILTER(pn,psel),
   MAP(qa,LAMBDA(v,pwt(v))),MAP(qb,LAMBDA(v,pwt(v)))))),
IFNA(VSTACK("${HOLDINGS_TITLE}",
 {"Holding","Ticker","Accounts","Value","% of portfolio"},
 yours,
 "",
 "${TRUST_NOTE}",
 HSTACK({"Rank","Company","Ticker","Value","% of portfolio","","Direct"},TRANSPOSE(f)),
 top,rest,"",
 HSTACK("","Fund overlap"),
 HSTACK("","${OVERLAP_NOTE}"),
 {"","Fund 1","Fund 2","","Overlap","Shared securities","Fund 1 weight","Fund 2 weight"},
 plist,
 "",
 HSTACK("","${UNSEEN_TITLE}"),
 {"","Holding","Fund in the mix","Value","% of portfolio","Note"},
 HSTACK(cb,can),
 "",
 HSTACK("","${OTHER_TITLE}"),
 {"","Line","Kind","Value","% of portfolio","Came from"},
 HSTACK(blank,nis),
 "",
 HSTACK("","Total of all lines","",SUM(pw)*tot,SUM(pw)),
 HSTACK("","${SUM_NOTE}")),""))`;
}

/**
 * The layout of the tab Concentration.Exposure. The cells hold the layout
 * version and the labels. The refresh writes the status, the time, the
 * answer, the mix block, the unseen block, the stock fund block, the own
 * block, the group block, and the direct weights. A good refresh also writes
 * its start time and its seconds into the run-time block A15:B24, newest
 * first. The grid holds the source column of each position up to
 * MAX_POSITIONS. One narrow empty column separates each block from the next.
 */
function exposureLayout() {
  const x = exposureColumns();
  const letter = columnLetter;
  const span = (first, count) => `${letter(first)}:${letter(first + count - 1)}`;
  const header = (first, count) => `${letter(first)}${HEADER_ROW}:${letter(first + count - 1)}${HEADER_ROW}`;
  const data = (name) => `${name}${FIRST_DATA_ROW}:${name}`;
  const fund = (name) => letter(FUND_COLUMN + FUND_FIELDS.indexOf(name));
  const lastMeasure = FIRST_DATA_ROW + MEASURE_NAMES.length - 1;
  return {
    name: EXPOSURE_TAB,
    rows: TAB_ROWS,
    columns: SOURCE_COLUMN + MAX_POSITIONS - 1,
    hidden: true,
    frozenRows: 4,
    columnWidths: {
      A: 170,
      B: 150,
      C: 24,
      [span(FUND_COLUMN, FUND_FIELDS.length)]: 110,
      [letter(OVERLAP_COLUMN - 1)]: 24,
      [span(OVERLAP_COLUMN, OVERLAP_WIDTH)]: 110,
      [letter(MIX_COLUMN - 1)]: 24,
      [span(MIX_COLUMN, MIX_FIELDS.length)]: 110,
      [letter(UNSEEN_COLUMN - 1)]: 24,
      [span(UNSEEN_COLUMN, UNSEEN_FIELDS.length)]: 110,
      [letter(STOCK_FUND_COLUMN - 1)]: 24,
      [letter(STOCK_FUND_COLUMN)]: 110,
      [letter(OWN_COLUMN - 1)]: 24,
      [span(OWN_COLUMN, OWN_FIELDS.length)]: 110,
      [letter(GROUP_COLUMN - 1)]: 24,
      [span(GROUP_COLUMN, GROUP_FIELDS.length)]: 110,
      [letter(LINE_COLUMN - 1)]: 24,
      [letter(LINE_COLUMN)]: 220,
      [letter(LINE_COLUMN + 1)]: 260,
      [`${letter(LINE_COLUMN + 2)}:${x.direct}`]: 90,
      [`${x.first}:${x.last}`]: 110,
    },
    cells: [
      { range: "A1:A2", values: [["Status"], ["Last run"]] },
      { range: `A3:${VERSION_CELL}`, values: [["layoutVersion", LAYOUT_VERSION]] },
      { range: `A4:A${lastMeasure}`, values: [["measure"], ...MEASURE_NAMES.map((name) => [name])] },
      { range: "B4", values: [["value"]] },
      { range: header(FUND_COLUMN, FUND_FIELDS.length), values: [FUND_FIELDS] },
      {
        range: header(OVERLAP_COLUMN, OVERLAP_WIDTH),
        values: [["firstId", "secondId", "overlap", "sharedLineCount"]],
      },
      { range: header(MIX_COLUMN, MIX_FIELDS.length), values: [MIX_FIELDS] },
      { range: header(UNSEEN_COLUMN, UNSEEN_FIELDS.length), values: [UNSEEN_FIELDS] },
      { range: header(STOCK_FUND_COLUMN, STOCK_FUND_FIELDS.length), values: [STOCK_FUND_FIELDS] },
      { range: header(OWN_COLUMN, OWN_FIELDS.length), values: [OWN_FIELDS] },
      { range: header(GROUP_COLUMN, GROUP_FIELDS.length), values: [GROUP_FIELDS] },
      { range: header(LINE_COLUMN, LINE_FIELDS.length + 2), values: [[...LINE_FIELDS, "part", "directWeight"]] },
      { range: "A14:B14", values: [["runStart", "seconds"]] },
      { range: "A26:B26", values: [["equity", "value"]] },
      { range: "A27:A31", values: EQUITY_NAMES.map((name) => [name]) },
    ],
    styles: [
      { range: `A4:${x.last}4`, bold: true, background: "#f7f6f1" },
      { range: "A14:B14", bold: true, background: "#f7f6f1" },
      { range: "A26:B26", bold: true, background: "#f7f6f1" },
      { range: "A15:A24", numberFormat: "yyyy-mm-dd hh:mm:ss" },
      { range: "B15:B24", numberFormat: "0.000" },
      { range: "B2", numberFormat: "yyyy-mm-dd hh:mm:ss" },
      { range: "B5", numberFormat: "#,##0" },
      { range: "B6", numberFormat: "0.000000" },
      { range: "B7", numberFormat: "0.0" },
      { range: "B8", numberFormat: "0.00" },
      { range: `B9:B${lastMeasure}`, numberFormat: "0.000000" },
      { range: "B27", numberFormat: "0.000000" },
      { range: "B28", numberFormat: "#,##0" },
      { range: "B29", numberFormat: "0.000000" },
      { range: "B30", numberFormat: "0.0" },
      { range: "B31", numberFormat: "0.00" },
      { range: data(fund("reportDate")), numberFormat: "yyyy-mm-dd" },
      { range: data(fund("holdingCount")), numberFormat: "#,##0" },
      { range: `${fund("weight")}${FIRST_DATA_ROW}:${fund("coveredWeight")}`, numberFormat: "0.00000" },
      { range: `${fund("mergedByTicker")}${FIRST_DATA_ROW}:${fund("mergedByName")}`, numberFormat: "#,##0" },
      { range: data(x.fundPart), numberFormat: "0.00000" },
      { range: data(x.pairOverlap), numberFormat: "0.00000" },
      { range: data(x.pairShared), numberFormat: "#,##0" },
      { range: data(x.mixWeight), numberFormat: "0.00000" },
      { range: data(x.mixEntered), numberFormat: "yyyy-mm-dd" },
      { range: data(x.mixPart), numberFormat: "0.00000" },
      { range: data(x.unseenWeight), numberFormat: "0.00000" },
      { range: data(x.ownWeight), numberFormat: "0.00000" },
      { range: data(x.groupWeight), numberFormat: "0.00000" },
      { range: data(x.groupCount), numberFormat: "#,##0" },
      { range: `${x.weight}5:${x.stock}`, numberFormat: "0.00000" },
      { range: data(x.direct), numberFormat: "0.00000" },
      { range: `${x.first}5:${x.last}`, numberFormat: "0.00000" },
    ],
    conditional: [],
    validation: [],
  };
}

/**
 * The layout of the tab Concentration. `inputs` holds the value of the
 * threshold cell and of the overlap minimum cell, by the names of INPUTS. An
 * absent name gets the value of INPUTS. A person can change both cells. B1
 * holds the disclaimer. B4, under the status cell, counts the holdings that
 * are funds not looked through. B9 and B10 show the seconds of the last good
 * refresh and the average of the recorded refreshes. The header of the
 * security measures carries the coverage label.
 *
 * The report spill starts in row REPORT_ROW, and its row count changes with
 * the Holdings tab. So the conditional formats find the titles, the headers,
 * the totals, and the notes of the spill by their text. The number formats
 * and the alignment of the columns apply from row REPORT_ROW to the last row.
 */
function reportLayout(inputs = {}) {
  const threshold = inputs.threshold === undefined ? INPUTS.threshold.value : inputs.threshold;
  const overlapMinimum = inputs.overlapMinimum === undefined ? INPUTS.overlapMinimum.value : inputs.overlapMinimum;
  const last = columnLetter(REPORT_COLUMNS);
  const first = REPORT_ROW;
  const spill = `A${first}:${last}`;
  const status = STATUS_ROW;
  const total = `$B$${TOTAL_ROW}`;
  const stocks = STOCKS_ROW;
  const comp = COMPOSITION_ROW;
  const fund = FUND_ROW;
  return {
    name: REPORT_TAB,
    rows: TAB_ROWS,
    columns: REPORT_COLUMNS,
    hidden: false,
    frozenRows: 2,
    columnWidths: { A: 250, B: 300, C: 150, D: 175, E: 110, F: 180, [`G:${last}`]: 96 },
    cells: [
      { range: "A1:B1", values: [["Concentration", DISCLAIMER]] },
      { range: "B2", values: [["Your securities by company, with a look inside each fund."]] },
      {
        range: "D2",
        values: [
          [
            "A fund that holds other funds uses the newest report of each held fund. The date of a held report can differ from the date in this table.",
          ],
        ],
      },
      {
        range: `A${status}:B${status + 7}`,
        values: [
          ["Status", `=${exposure("B1")}`],
          ["", unseenNoteFormula()],
          ["Last run", `=${exposure("B2")}`],
          ["Total value", TOTAL_FORMULA],
          ["Looked through", `=${measureCell("lookedThroughWeight")}`],
          ["Not looked through", `=${measureCell("notLookedThroughWeight")}`],
          ["Last run time", RUN_LAST_FORMULA],
          ["Average (last 10)", RUN_AVERAGE_FORMULA],
        ],
      },
      {
        range: `D${fund - 1}:H${fund - 1}`,
        values: [["Fund looked through", "Report date", "Holdings", "Weight", "Covered"]],
      },
      { range: `D${fund}`, values: [[fundsFormula()]] },
      {
        range: `A${stocks}:B${stocks + 5}`,
        values: [
          ["Your securities alone", coverageFormula()],
          ["Securities, share of your portfolio", equityFormula("weight")],
          ["Top 10 securities, share of your securities", equityFormula("top10Weight")],
          ["HHI of your securities, 0 to 10,000", equityFormula("hhi")],
          ["Effective number of securities", equityFormula("effectiveCount")],
          [noStockFormula(), ""],
        ],
      },
      {
        range: `A${comp}:C${comp + 3}`,
        values: [
          ["Composition", "Value", "% of portfolio"],
          [
            `="Securities at "&TEXT($B$${THRESHOLD_ROW},"0.00%")&" or more"`,
            `=IF(ISNUMBER(${total}),C${comp + 1}*${total},"")`,
            stockSumFormula(">="),
          ],
          [
            `="Securities under "&TEXT($B$${THRESHOLD_ROW},"0.00%")`,
            `=IF(ISNUMBER(${total}),C${comp + 2}*${total},"")`,
            stockSumFormula("<"),
          ],
          [OTHER_TITLE, `=IF(ISNUMBER(${total}),C${comp + 3}*${total},"")`, otherSumFormula()],
        ],
      },
      {
        range: `A${THRESHOLD_ROW}:C${OVERLAP_ROW}`,
        values: [
          [
            INPUTS.threshold.label,
            threshold,
            "Type a percent. Each company whose securities are at or above it gets a row.",
          ],
          [
            INPUTS.overlapMinimum.label,
            overlapMinimum,
            "Type a percent. The fund overlap list under the company table shows each pair of funds at or above it.",
          ],
        ],
      },
      { range: `A${first}`, values: [[reportFormula()]] },
    ],
    styles: [
      { range: "A1", bold: true, fontSize: 16 },
      { range: "B1:B2", color: "#6b6962", italic: true },
      { range: "D2", color: "#6b6962", italic: true },
      { range: `A${status}:A${comp + 3}`, color: "#57554f" },
      { range: `B${status + 2}`, numberFormat: "yyyy-mm-dd hh:mm" },
      { range: `B${TOTAL_ROW}`, numberFormat: "$#,##0", bold: true },
      { range: `B${status + 4}:B${status + 5}`, numberFormat: "0.00%" },
      { range: `B${status + 6}:B${status + 7}`, numberFormat: '0.0" s"' },
      { range: `B${status}:B${status + 7}`, align: "right" },
      { range: `B${status + 1}`, align: "left", color: "#6b6962", italic: true, wrap: true },
      { range: `A${stocks}:B${stocks}`, bold: true, background: "#f7f6f1", color: "#1d1c1a" },
      { range: `B${stocks}`, bold: false, italic: true, color: "#57554f" },
      { range: `B${stocks + 1}:B${stocks + 2}`, numberFormat: "0.00%" },
      { range: `B${stocks + 3}`, numberFormat: "#,##0" },
      { range: `B${stocks + 4}`, numberFormat: "0.0" },
      { range: `A${stocks + 5}`, color: "#6b6962", italic: true },
      { range: `A${comp}:C${comp}`, bold: true, background: "#f7f6f1", color: "#1d1c1a" },
      { range: `B${comp}:C${comp}`, align: "right" },
      { range: `B${comp + 1}:B${comp + 3}`, numberFormat: "$#,##0" },
      { range: `C${comp + 1}:C${comp + 3}`, numberFormat: "0.00%" },
      { range: `A${THRESHOLD_ROW}:A${OVERLAP_ROW}`, bold: true },
      {
        range: `B${THRESHOLD_ROW}:B${OVERLAP_ROW}`,
        numberFormat: "0.00%",
        bold: true,
        background: "#fff4c7",
        align: "right",
      },
      { range: `C${THRESHOLD_ROW}:C${OVERLAP_ROW}`, color: "#6b6962", italic: true },
      { range: `A${first}:A`, numberFormat: "0" },
      { range: `D${first}:D`, numberFormat: "$#,##0", align: "right" },
      { range: `E${first}:E`, numberFormat: "0.00%", align: "right" },
      { range: `F${first}:F`, numberFormat: "#,##0", wrap: true },
      { range: `G${first}:${last}`, numberFormat: '0.00%;-0.00%;""', align: "right" },
      { range: `D${fund - 1}:H${fund - 1}`, bold: true, background: "#f7f6f1" },
      { range: `D${fund}:D${FUND_LAST_ROW}`, bold: true },
      { range: `E${fund}:E${FUND_LAST_ROW}`, numberFormat: "yyyy-mm-dd" },
      { range: `F${fund}:F${FUND_LAST_ROW}`, numberFormat: "#,##0" },
      { range: `G${fund}:G${FUND_LAST_ROW}`, numberFormat: "0.00%" },
      { range: `H${fund}:H${FUND_LAST_ROW}`, numberFormat: "0.0%" },
    ],
    conditional: [
      { range: `B${status}`, formula: `=$B$${status}="OK"`, background: "#dcefe2", color: "#1b5e34", bold: true },
      { range: `B${status}`, formula: `=$B$${status}<>"OK"`, background: "#f7d4d4", color: "#8a1c1c", bold: true },
      {
        range: spill,
        formula: `=LEFT($B${first},17)="Securities under "`,
        background: "#f4f3ee",
        color: "#3c3b37",
        italic: true,
      },
      {
        range: spill,
        formula: `=OR($A${first}="${HOLDINGS_TITLE}",$B${first}="Fund overlap",$B${first}="${UNSEEN_TITLE}",$B${first}="${OTHER_TITLE}")`,
        bold: true,
      },
      {
        range: spill,
        formula:
          `=OR(AND($A${first}="Holding",$B${first}="Ticker"),AND($A${first}="Rank",$B${first}="Company"),` +
          `$B${first}="Fund 1",AND($B${first}="Holding",$C${first}="Fund in the mix"),$B${first}="Line")`,
        bold: true,
        background: "#f7f6f1",
      },
      {
        range: spill,
        formula: `=OR(AND($A${first}="Total",$B${first}="",$C${first}=""),$B${first}="Total of all lines")`,
        bold: true,
      },
      {
        range: spill,
        formula: `=OR($A${first}="${TRUST_NOTE}",$B${first}="${OVERLAP_NOTE}",$B${first}="${SUM_NOTE}")`,
        color: "#6b6962",
        italic: true,
      },
      {
        range: `F${first}:F`,
        formula: `=RIGHT($F${first},20)="check the fact sheet"`,
        color: "#8a1c1c",
      },
      {
        range: `B${first}:B`,
        formula: `=AND(ISNUMBER($A${first}),N($G${first})>0,SUM($H${first}:$${last}${first})>0)`,
        bold: true,
      },
    ],
    validation: [
      { range: `B${THRESHOLD_ROW}`, min: 0, max: 1, message: "Type a percent from 0% to 100%, such as 1%." },
      { range: `B${OVERLAP_ROW}`, min: 0, max: 1, message: "Type a percent from 0% to 100%, such as 10%." },
    ],
  };
}

/**
 * The value of each cell of a report tab that the person types in, by the
 * names of INPUTS. The function finds a cell by its label in column A, so it
 * also reads a tab of another layout version. A name gets the value of INPUTS
 * when the tab is absent, when no row holds the label, or when the cell holds
 * no number from 0 to 1.
 */
function readInputs(report) {
  const rows =
    report === null || report.getMaxColumns() < 2
      ? []
      : report.getRange(1, 1, Math.min(INPUT_ROWS, report.getMaxRows()), 2).getValues();
  const inputs = {};
  for (const [name, input] of Object.entries(INPUTS)) {
    const row = rows.find((cells) => cellText(cells[0]) === input.label);
    const typed = row === undefined ? null : row[1];
    inputs[name] = isNumber(typed) && typed >= 0 && typed <= 1 ? typed : input.value;
  }
  return inputs;
}

/**
 * Make sure that the two tabs of the report hold the layout of this file.
 *
 * The function reads the layout version of Concentration.Exposure. When the
 * version equals LAYOUT_VERSION and Concentration exists, both tabs stay as
 * they are. When the version equals LAYOUT_VERSION and Concentration is
 * absent, the function creates Concentration. In each other condition, such
 * as an older version, no version, or no hidden tab, the function deletes
 * each of the two tabs that exists and creates both from the layout. A new
 * Concentration tab gets the threshold and the overlap minimum of the old
 * one.
 *
 * The function creates Concentration.Exposure first, because the formulas of
 * Concentration read it. It hides Concentration.Exposure last, because a
 * spreadsheet must keep one visible tab through each step. It changes no
 * other tab.
 */
function ensureTabs(book) {
  const hidden = book.getSheetByName(EXPOSURE_TAB);
  const report = book.getSheetByName(REPORT_TAB);
  const current = hidden !== null && hidden.getRange(VERSION_CELL).getValue() === LAYOUT_VERSION;
  if (current && report !== null) return;
  const inputs = readInputs(report);
  const made = current ? null : replaceTab(book, hidden, exposureLayout());
  replaceTab(book, report, reportLayout(inputs));
  if (made !== null) made.hideSheet();
}

/**
 * Create a tab from its layout in the place of an old tab, and return the
 * new tab. The function deletes the old tab first, and the new tab takes its
 * position. When the old tab is null, the new tab goes to the end of the
 * spreadsheet.
 */
function replaceTab(book, old, layout) {
  let index = book.getNumSheets();
  if (old !== null) {
    index = old.getIndex() - 1;
    book.deleteSheet(old);
  }
  return createTab(book, layout, index);
}

/**
 * Add a tab at the given position of the spreadsheet, apply its layout, and
 * return the tab. The layout holds the grid size, the cells, the styles, the
 * column widths, the frozen rows, the conditional formats, and the data
 * validation. The caller hides a tab with the hidden flag.
 */
function createTab(book, layout, index) {
  const sheet = book.insertSheet(layout.name, index);
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
  return sheet;
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
 * The column letter of a column number, such as A for 1 and AA for 27.
 */
function columnLetter(number) {
  let letters = "";
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
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
