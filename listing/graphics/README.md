# Listing graphics

The icon, the banner, and the screenshots of the Google Workspace Marketplace listing.

| File                               | Size in pixels | Content                                                                         |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| `icon-32.png`                      | 32 x 32        | Application icon, transparent background                                        |
| `icon-48.png`                      | 48 x 48        | Application icon, transparent background                                        |
| `icon-96.png`                      | 96 x 96        | Application icon, transparent background                                        |
| `icon-128.png`                     | 128 x 128      | Application icon, transparent background                                        |
| `banner-220x140.png`               | 220 x 140      | Application card banner                                                         |
| `screenshot-1-report.png`          | 1280 x 800     | The top of the report: the status, the measures, and the funds looked through   |
| `screenshot-2-menu.png`            | 1280 x 800     | The Extensions menu with the add-on menu: Refresh, Describe a fund, Set API key |
| `screenshot-3-companies.png`       | 1280 x 800     | The company table and the company chart                                         |
| `screenshot-4-overlap.png`         | 1280 x 800     | The fund overlap and the holdings not looked through                            |
| `screenshot-5-describe-a-fund.png` | 1280 x 800     | The Describe a fund sidebar beside the report, with a saved fund mix            |

## Build

Run this command from the repository root:

```sh
npm run build:graphics
```

The command runs `listing/graphics/src/build.mjs` with the package `playwright` of the root `package.json`. It uses the
Chromium build of Playwright, or the installed Google Chrome when that build is absent. It renders each icon and the
banner from its SVG source into its PNG file. It checks the pixel size of each icon, of the banner, and of each
screenshot, and it stops with an error when a file does not have its size.

The command does not write the screenshots, because Git does not hold the captures that they come from. To write the
screenshots, put the five captures in one directory and run this command:

```sh
node listing/graphics/src/build.mjs --captures <directory>
```

## Sources

- `src/icon.svg` is the icon at 96 and 128 pixels. `src/icon-small.svg` is a simpler icon at 32 and 48 pixels.
- `src/banner.svg` is the banner. Its words are outlines of the brand font. To change the words, set new outlines from
  the font.
- `src/frame.html` is the frame of each screenshot: a slate background, one caption line in Cormorant Garamond, and a
  crop of a capture at its own pixel size. The page loads the font from Google Fonts, so a screenshot build needs a
  network connection. The list `SHOTS` in `src/build.mjs` holds the caption, the capture file, and the crop of each
  screenshot. The crop is 1216 x 688 pixels.

## Screenshots

Each screenshot shows a crop of the demo spreadsheet in Google Sheets, on the Concentration tab after a refresh. Every
name and every number in the demo spreadsheet is invented. No crop shows the title bar, the toolbar, the formula bar,
the Share button, the account avatar, or the browser window.

### Take the captures

1. Open the demo spreadsheet from a test deployment of the add-on (**Deploy > Test deployments** in the Apps Script
   editor), so that the Extensions menu holds the add-on menu.
2. Set the Sheets zoom to 100%.
3. Set a browser viewport of 1280 pixels wide at a device scale factor of 1. Use the height in the table below.
4. Before each capture, select a cell outside the crop, so that no selection border shows.
5. Take each capture of the full viewport as a PNG file with the name in the table below.

| Capture         | Height | View                                                                      | Rows at the top of the crop  | Crop x, y |
| --------------- | ------ | ------------------------------------------------------------------------- | ---------------------------- | --------- |
| `report.png`    | 860    | **View > Full screen**                                                    | The column letters and row 1 | 0, 29     |
| `menu.png`      | 1000   | The normal view, with the page changes below and the add-on menu open     | The menu bar and row 1       | 0, 30     |
| `companies.png` | 1000   | **View > Full screen**                                                    | Row 70                       | 0, 150    |
| `lines.png`     | 1000   | **View > Full screen**                                                    | Row 108                      | 0, 171    |
| `sidebar.png`   | 1000   | The normal view, with the page changes below and **Describe a fund** open | The column letters and row 1 | 46, 55    |

To scroll the tab without a reload, set the URL fragment to `#gid=<tab id>&range=A70`. Go to a far row first, such as
`A300`, so that the target row comes to the top under the frozen rows. Press Escape to leave the full screen view.

The menu and the sidebar need the menu bar, so they use the normal view. For these two captures, add this style to the
page and then send a `resize` event to the window, so that the grid moves up into the space of the toolbar and the
formula bar:

```css
#docs-toolbar-wrapper,
#docs-additional-bars {
  display: none !important;
}
#docs-header {
  visibility: hidden !important;
}
#docs-menubar > [role="menuitem"]:not(#docs-extensions-menu) {
  visibility: hidden !important;
}
```

For the sidebar capture, also hide `#docs-extensions-menu` with `visibility: hidden`. Close the sidebar with the button
**Close side sheet**. Reload the page to remove the style.

When a layout change moves a table, find the new top row and the new crop y on a capture, and change the crop in
`SHOTS`. A caption that is wider than the frame stops the build.

The Google rule for the size, from https://developers.google.com/workspace/marketplace/create-listing#graphic-assets :

> The recommended size is 1280x800 pixels, though 640x400 or 2560x1600 pixels are also accepted. Screenshots should have
> square corners and no padding (full bleed).

The listing accepts up to 10 screenshots.
