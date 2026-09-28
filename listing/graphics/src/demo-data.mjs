/**
 * The invented portfolio of the listing screenshots.
 *
 * Every fund, company, symbol, identifier, weight, and value in this file is
 * invented. A match with a real symbol or a real name is chance. The data
 * gives no advice.
 *
 * `holdings` holds the rows of the Holdings tab that the script reads: the
 * description, the symbol, and the value. `funds` holds the portfolio report
 * of each fund symbol. The build sends the rows through the same steps as the
 * script and the route, so each value on a screenshot agrees with the others.
 */

/**
 * The rows of the Holdings tab. One fund is in two accounts, so it has two
 * rows. The script adds the values of the rows of one symbol.
 */
export const holdings = [
  { description: "Northfield Total Market Index Fund", symbol: "NTMX", value: 121500 },
  { description: "Northfield Total Market Index Fund", symbol: "NTMX", value: 46500 },
  { description: "Harborline International Index Fund", symbol: "HGIX", value: 62000 },
  { description: "Westbrook Large Cap Growth Fund", symbol: "WLCX", value: 48000 },
  { description: "Tidewater Treasury Bond Fund", symbol: "TBDX", value: 54000 },
  { description: "Kestrel Semiconductor", symbol: "KSTL", value: 21000 },
  { description: "Brightwater Foods", symbol: "BWFD", value: 9500 },
  { description: "Brokerage cash", symbol: "", value: 7500 },
];

/**
 * The symbols that the route knows as a company stock.
 */
export const stockSymbols = ["KSTL", "BWFD"];

/**
 * The invented companies that a fund names in its top holdings.
 */
const companies = {
  KSTL: "Kestrel Semiconductor",
  ADPS: "Alderpoint Software",
  CRVN: "Corvane Systems",
  HLVD: "Halvard Health",
  MRDN: "Meridane Retail",
  QLPY: "Quillon Payments",
  OSTV: "Ostrevan Energy",
  PNCB: "Pinecrest Bancorp",
  RDFM: "Redfern Motors",
  TMSB: "Tamsin Biotech",
};

/**
 * A deterministic list of small holdings with a total percent. The weights
 * fall with the rank, as in an index fund. The identifier of each holding
 * starts with the prefix, so two funds share a holding only when they share
 * the prefix.
 */
function tail(prefix, count, totalPct) {
  const raw = Array.from({ length: count }, (_, i) => 1 / Math.pow(i + 40, 1.15));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((r, i) => ({
    key: `ticker:${prefix}${String(i).padStart(4, "0")}`,
    name: `${prefix} holding ${i}`,
    class: "stock",
    pct: (r / sum) * totalPct,
  }));
}

/**
 * A named company holding of a fund.
 */
function company(ticker, pct) {
  return { key: `ticker:${ticker}`, name: companies[ticker], ticker, class: "stock", pct };
}

/**
 * Holdings of one class other than stock, one for each percent.
 */
function several(prefix, cls, pcts) {
  return pcts.map((pct, i) => ({
    key: `lei:${prefix}${i}`,
    name: `${prefix} ${i}`,
    class: cls,
    pct,
  }));
}

/**
 * The large-cap fund holds the 172 largest holdings of the total market
 * fund. The two lists share their identifiers, so the route merges them.
 */
const sharedTail = tail("US", 3480, 68.9);
const largeCapTail = tail("US", 172, 65.9);

/**
 * The portfolio report of each fund symbol. A fund with a sum of percents
 * under 100 gets a residual line for the part that the report does not
 * cover.
 */
export const funds = {
  NTMX: {
    reportDate: "2026-06-30",
    holdings: [
      company("KSTL", 6.22),
      company("ADPS", 5.38),
      company("CRVN", 4.58),
      company("HLVD", 2.88),
      company("MRDN", 2.6),
      company("QLPY", 2.2),
      company("OSTV", 1.78),
      company("PNCB", 1.51),
      company("RDFM", 1.29),
      company("TMSB", 1.07),
      ...sharedTail,
      ...several("NTMX cash", "cash", [1.13]),
      ...several("NTMX future", "derivative", [0.02]),
    ],
  },
  HGIX: {
    reportDate: "2026-07-31",
    holdings: [
      ...tail("INTL", 2155, 96.7),
      ...several("HGIX cash", "cash", [1.57]),
      ...several("HGIX other", "other", Array(14).fill(0.9 / 14)),
      ...several("HGIX forward", "derivative", [0.05]),
    ],
  },
  WLCX: {
    reportDate: "2026-06-30",
    holdings: [
      company("KSTL", 9.03),
      company("ADPS", 8.07),
      company("CRVN", 6.78),
      company("QLPY", 4.43),
      company("HLVD", 3.19),
      company("TMSB", 2.03),
      ...largeCapTail,
      ...several("WLCX cash", "cash", [0.39]),
    ],
  },
  // The 212 Treasury issues of the bond fund share one issuer identifier,
  // so the route merges them into one line. `count` keeps the count of
  // holdings of the funds block.
  TBDX: {
    reportDate: "2026-05-31",
    holdings: [
      { ...several("TBDX treasury", "treasury", [96.8])[0], count: 212 },
      ...several("TBDX repo", "cash", [0.98, 0.99, 1.0]),
    ],
  },
};

/**
 * The time of the last refresh that the report shows.
 */
export const lastRun = "2026-09-25 07:42";

/**
 * The title of the demo spreadsheet.
 */
export const bookTitle = "Sample portfolio (invented data)";
