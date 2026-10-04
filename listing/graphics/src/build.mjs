/**
 * Build the icons and the banner of the Marketplace listing from the SVG
 * sources in this directory, and check the screenshots:
 *
 *   node listing/graphics/src/build.mjs
 *
 * The script renders each icon and the banner into a PNG file in
 * listing/graphics/. It does not write the screenshots. The screenshots are
 * captures of the demo spreadsheet in Google Sheets. The script checks the
 * pixel size of each PNG file and stops with an error when a file does not
 * have its size.
 *
 * The script needs the package `playwright`. It uses the Chromium build of
 * Playwright, or the installed Google Chrome when that build is absent.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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

/** The screenshot files, in the order of the listing. */
const SHOTS = [
  "screenshot-1-report.png",
  "screenshot-2-menu.png",
  "screenshot-3-holdings.png",
  "screenshot-4-companies.png",
  "screenshot-5-lines.png",
  "screenshot-6-describe-a-fund.png",
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
} finally {
  await browser.close();
}

for (const shot of SHOTS) {
  expectSize(join(OUT, shot), SHOT.width, SHOT.height);
}
