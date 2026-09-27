/**
 * A small model of the script and of the concentration route, for the demo
 * data alone. It builds the positions from the Holdings rows as the script
 * does, and it builds the answer of the route: the measures, the funds, and
 * the lines. It is not the route. It knows only the cases that the demo data
 * holds.
 */

/**
 * The positions of the request: one for each symbol, or for each description
 * when the symbol is empty, with the weight of its share of the total value.
 */
export function buildPositions(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.symbol !== "" ? row.symbol : row.description;
    if (!groups.has(key)) groups.set(key, { id: key, symbol: row.symbol, sum: 0 });
    groups.get(key).sum += row.value;
  }
  const kept = [...groups.values()].filter((g) => g.sum > 0);
  const total = kept.reduce((s, g) => s + g.sum, 0);
  return kept.map((g) => {
    const position = { id: g.id };
    if (g.symbol !== "") position.ticker = g.symbol;
    position.weight = g.sum / total;
    return position;
  });
}

/**
 * The answer of the route for the positions. `funds` maps a fund symbol to
 * its portfolio report. `stockSymbols` lists the symbols that are a company
 * stock. Each other symbol with no report is unknown.
 */
export function concentration(positions, funds, stockSymbols) {
  const lines = new Map();
  const fundBlock = [];
  let lookedThrough = 0;

  function add(key, name, ticker, cls, weight, sourceId) {
    if (!lines.has(key)) lines.set(key, { key, parts: [], sources: {} });
    const line = lines.get(key);
    line.parts.push({ name, ticker, cls, weight });
    line.sources[sourceId] = (line.sources[sourceId] || 0) + weight;
  }

  for (const position of positions) {
    const report = position.ticker ? funds[position.ticker] : undefined;
    if (report) {
      let pctSum = 0;
      let count = 0;
      for (const h of report.holdings) {
        const w = (position.weight * h.pct) / 100;
        add(h.key, h.name, h.ticker || null, h.class, w, position.id);
        pctSum += h.pct;
        count += h.count || 1;
        lookedThrough += w;
      }
      const rest = position.weight * Math.max(0, 1 - pctSum / 100);
      add(`residual:${position.ticker}`, `${position.ticker} (not looked through)`, null, "other", rest, position.id);
      fundBlock.push({
        id: position.id,
        ticker: position.ticker,
        reportDate: report.reportDate,
        holdingCount: count,
        weight: position.weight,
        coveredWeight: (position.weight * pctSum) / 100,
      });
    } else if (position.ticker) {
      const cls = stockSymbols.includes(position.ticker) ? "stock" : "unknown";
      add(`ticker:${position.ticker}`, position.ticker, position.ticker, cls, position.weight, position.id);
    } else {
      add(`id:${position.id}`, position.id, null, "unknown", position.weight, position.id);
    }
  }

  const out = [...lines.values()].map((line) => {
    const largest = line.parts.reduce((a, b) => (Math.abs(b.weight) > Math.abs(a.weight) ? b : a));
    const weight = line.parts.reduce((s, p) => s + p.weight, 0);
    const named = line.parts.filter((p) => p.name && p.ticker !== p.name);
    const nameFrom = named.length > 0 ? named.reduce((a, b) => (b.weight > a.weight ? b : a)) : largest;
    const byClass = {};
    for (const p of line.parts) byClass[p.cls] = (byClass[p.cls] || 0) + Math.abs(p.weight);
    const cls = Object.entries(byClass).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    return {
      key: line.key,
      name: nameFrom.name,
      ticker: line.parts.find((p) => p.ticker)?.ticker ?? null,
      lei: null,
      class: cls,
      weight,
      sources: line.sources,
    };
  });
  out.sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : 1));

  const squares = out.reduce((s, l) => s + l.weight * l.weight, 0);
  const weightSum = out.reduce((s, l) => s + l.weight, 0);
  return {
    measures: {
      lineCount: out.length,
      top10Weight: out.slice(0, 10).reduce((s, l) => s + l.weight, 0),
      hhi: 10000 * squares,
      effectiveCount: 1 / squares,
      lookedThroughWeight: lookedThrough,
      notLookedThroughWeight: weightSum - lookedThrough,
      weightSum,
      weightDifference: weightSum - 1,
    },
    funds: fundBlock,
    lines: out,
  };
}
