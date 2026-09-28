/**
 * Build each graphic of the Marketplace listing from the files in this
 * directory:
 *
 *   node listing/graphics/src/build.mjs
 *
 * The script writes the PNG files into listing/graphics/. It renders the
 * icon and the banner from their SVG sources, and it renders each screenshot
 * from the demo spreadsheet page with invented data. It stops with an error
 * when a shown value does not add up after the rounding of the display, or
 * when a file does not have its pixel size.
 *
 * The script needs the package `playwright`. It uses the Chromium build of
 * Playwright, or the installed Google Chrome when that build is absent.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { bookTitle, funds, holdings, lastRun, stockSymbols } from "./demo-data.mjs";
import { buildPositions, concentration } from "./route.mjs";
import { buildReport, findFaults } from "./report.mjs";
import { renderPage } from "./sheet.mjs";

const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = dirname(SRC);

/** The icon sizes. The small source holds a simpler drawing for 32 and 48. */
const ICONS = [
  { size: 32, source: "icon-small.svg" },
  { size: 48, source: "icon-small.svg" },
  { size: 96, source: "icon.svg" },
  { size: 128, source: "icon.svg" },
];

/** The banner size. */
const BANNER = { width: 220, height: 140, source: "banner.svg" };

/** The screenshot size. */
const SHOT = { width: 1280, height: 800 };

/** The views of the screenshots. */
const SHOTS = [
  {
    file: "screenshot-1-report.png",
    threshold: 0.01,
    view: { firstRow: 2, selected: "B4", formula: "=SUM(Holdings!I2:I)" },
  },
  {
    file: "screenshot-2-menu.png",
    threshold: 0.01,
    view: { firstRow: 2, selected: "B4", formula: "=SUM(Holdings!I2:I)", menuOpen: true },
  },
  {
    file: "screenshot-3-lines.png",
    threshold: 0.01,
    view: { firstRow: 10, selected: "B18", formula: "Kestrel Semiconductor" },
  },
  { file: "screenshot-4-threshold.png", threshold: 0.02, view: { firstRow: 2, selected: "B15", formula: "2%" } },
];

/**
 * The width and the height of a PNG file, from its IHDR chunk.
 */
function pngSize(file) {
  const b = readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG file`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/**
 * Stop when a file does not have the expected pixel size.
 */
function expectSize(file, width, height) {
  const got = pngSize(file);
  if (got.width !== width || got.height !== height) {
    throw new Error(`${file} is ${got.width}x${got.height}, not ${width}x${height}`);
  }
  console.log(`${file.slice(OUT.length + 1)} ${width}x${height}`);
}

/**
 * Launch Chromium. Use the installed Google Chrome when the Chromium build of
 * Playwright is absent.
 */
async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: "chrome" });
  }
}

/**
 * Render an SVG source into a PNG file of the given size. `transparent`
 * keeps the page background out of the file.
 */
async function renderSvg(browser, source, width, height, file, transparent) {
  const svg = readFileSync(join(SRC, source), "utf8").replace(
    /<svg\b([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/,
    `<svg$1 width="${width}" height="${height}"`,
  );
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
  await page.close();
  expectSize(file, width, height);
}

const positions = buildPositions(holdings);
const answer = concentration(positions, funds, stockSymbols);
const css = readFileSync(join(SRC, "sheet.css"), "utf8");

const browser = await launch();
try {
  for (const icon of ICONS) {
    await renderSvg(browser, icon.source, icon.size, icon.size, join(OUT, `icon-${icon.size}.png`), true);
  }
  await renderSvg(
    browser,
    BANNER.source,
    BANNER.width,
    BANNER.height,
    join(OUT, `banner-${BANNER.width}x${BANNER.height}.png`),
    false,
  );

  for (const shot of SHOTS) {
    const report = buildReport({ answer, positions, holdings, threshold: shot.threshold, lastRun });
    const faults = findFaults(report);
    if (faults.length > 0) throw new Error(`${shot.file}: ${faults.join("; ")}`);
    const html = renderPage({ report, view: shot.view, css, title: bookTitle });
    const page = await browser.newPage({ viewport: SHOT, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const file = join(OUT, shot.file);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, ...SHOT } });
    await page.close();
    expectSize(file, SHOT.width, SHOT.height);
  }
} finally {
  await browser.close();
}
