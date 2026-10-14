/**
 * Build the icons, the banner, and the screenshots of the Marketplace
 * listing:
 *
 *   node listing/graphics/src/build.mjs
 *   node listing/graphics/src/build.mjs --captures <directory>
 *
 * The script renders each icon and the banner from its SVG source in this
 * directory into a PNG file in listing/graphics/. With the option
 * --captures, it also renders each screenshot from the frame template
 * frame.html and a capture of the demo spreadsheet in the given directory.
 * Git does not hold the captures, so without the option the script keeps
 * the screenshots as they are. The script checks the pixel size of each
 * PNG file and stops with an error when a file does not have its size.
 *
 * The script needs the package `playwright`. It uses the Chromium build of
 * Playwright, or the installed Google Chrome when that build is absent. The
 * frame template loads its font from Google Fonts, so a screenshot build
 * needs a network connection.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

/**
 * The screenshots, in the order of the listing. `capture` is the file name
 * in the directory of the option --captures. `x` and `y` are the top left
 * corner of the crop in the capture. The crop is the size of the capture
 * box of frame.html.
 */
const SHOTS = [
  {
    file: "screenshot-1-report.png",
    capture: "report.png",
    x: 0,
    y: 29,
    caption: "The concentration of your portfolio, with each fund looked through",
  },
  {
    file: "screenshot-2-menu.png",
    capture: "menu.png",
    x: 0,
    y: 30,
    caption: "Refresh the report from the Extensions menu",
  },
  {
    file: "screenshot-3-companies.png",
    capture: "companies.png",
    x: 0,
    y: 150,
    caption: "Companies at or over your threshold, and the funds that hold them",
  },
  {
    file: "screenshot-4-overlap.png",
    capture: "lines.png",
    x: 0,
    y: 171,
    caption: "Fund overlap, and the holdings not looked through",
  },
  {
    file: "screenshot-5-describe-a-fund.png",
    capture: "sidebar.png",
    x: 46,
    y: 55,
    caption: "Describe a fund that does not publish its holdings",
  },
];

/** The size of the capture box of frame.html. */
const CROP = { width: 1216, height: 688 };

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

/**
 * Render a screenshot from frame.html and a capture. Stop when the crop
 * leaves the capture, when the caption font did not load, or when the
 * caption does not fit on one line.
 */
async function renderShot(browser, shot, dir) {
  const capture = join(dir, shot.capture);
  const size = pngSize(capture);
  if (shot.x < 0 || shot.y < 0 || shot.x + CROP.width > size.width || shot.y + CROP.height > size.height) {
    throw new Error(`${capture} is ${size.width}x${size.height}, too small for the crop of ${shot.file}`);
  }
  const page = await browser.newPage({ viewport: { width: SHOT.width, height: SHOT.height }, deviceScaleFactor: 1 });
  await page.setContent(readFileSync(join(SRC, "frame.html"), "utf8"), { waitUntil: "networkidle" });
  const data = readFileSync(capture).toString("base64");
  const fit = await page.evaluate(
    async ({ caption, data, x, y }) => {
      const p = document.querySelector(".caption");
      p.textContent = caption;
      const box = document.querySelector(".capture");
      box.style.setProperty("--capture", `url("data:image/png;base64,${data}")`);
      box.style.setProperty("--crop-x", String(x));
      box.style.setProperty("--crop-y", String(y));
      await document.fonts.ready;
      return {
        font: document.fonts.check('600 40px "Cormorant Garamond"', caption),
        fits: p.scrollWidth <= p.clientWidth,
      };
    },
    { caption: shot.caption, data, x: shot.x, y: shot.y },
  );
  if (!fit.font) throw new Error(`${shot.file}: the font Cormorant Garamond did not load`);
  if (!fit.fits) throw new Error(`${shot.file}: the caption is wider than the frame`);
  const file = join(OUT, shot.file);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: SHOT.width, height: SHOT.height } });
  await page.close();
  expectSize(file, SHOT.width, SHOT.height);
}

/**
 * The directory of the option --captures, or null.
 */
function capturesDir() {
  const i = process.argv.indexOf("--captures");
  if (i < 0) return null;
  const dir = process.argv[i + 1];
  if (!dir) throw new Error("--captures needs a directory");
  return resolve(dir);
}

const captures = capturesDir();
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
  if (captures) {
    for (const shot of SHOTS) await renderShot(browser, shot, captures);
  }
} finally {
  await browser.close();
}

if (!captures) {
  for (const shot of SHOTS) expectSize(join(OUT, shot.file), SHOT.width, SHOT.height);
}
