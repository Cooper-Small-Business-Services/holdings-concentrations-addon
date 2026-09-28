# Listing graphics

The icon, the banner, and the screenshots of the Google Workspace Marketplace listing.

| File                         | Size in pixels | Use                                      |
| ---------------------------- | -------------- | ---------------------------------------- |
| `icon-32.png`                | 32 x 32        | Application icon, transparent background |
| `icon-48.png`                | 48 x 48        | Application icon, transparent background |
| `icon-96.png`                | 96 x 96        | Application icon, transparent background |
| `icon-128.png`               | 128 x 128      | Application icon, transparent background |
| `banner-220x140.png`         | 220 x 140      | Application card banner                  |
| `screenshot-1-report.png`    | 1280 x 800     | The report after a refresh               |
| `screenshot-2-menu.png`      | 1280 x 800     | The add-on menu under Extensions         |
| `screenshot-3-lines.png`     | 1280 x 800     | The company rows and the other lines     |
| `screenshot-4-threshold.png` | 1280 x 800     | The report with a threshold of 2%        |

## Build

Run this command from the repository root:

```sh
npm run build:graphics
```

The command runs `listing/graphics/src/build.mjs` with the package `playwright` of the root `package.json`. It uses the
Chromium build of Playwright, or the installed Google Chrome when that build is absent. It writes each PNG file again
and checks its pixel size.

## Sources

- `src/icon.svg` is the icon at 96 and 128 pixels. `src/icon-small.svg` is a simpler icon at 32 and 48 pixels.
- `src/banner.svg` is the banner. Its words are outlines of the brand font. To change the words, set new outlines from
  the font.
- `src/menu.mjs` holds the menu items that the menu screenshot shows. Change a menu item in this file alone.
- `src/demo-data.mjs` holds the demo portfolio. Every fund, company, symbol, and value in it is invented.
- `src/route.mjs` and `src/report.mjs` calculate the report from the demo portfolio, with the labels, the number
  formats, and the colors of the report layout in the add-on source `src/layout.gs`.
- `src/sheet.mjs` and `src/sheet.css` draw the spreadsheet page of each screenshot.

The build stops when a shown part does not add to its shown total after the rounding of the display.
