# Listing graphics

The icon, the banner, and the screenshots of the Google Workspace Marketplace listing.

| File                               | Size in pixels | Content                                                                                       |
| ---------------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `icon-32.png`                      | 32 x 32        | Application icon, transparent background                                                      |
| `icon-48.png`                      | 48 x 48        | Application icon, transparent background                                                      |
| `icon-96.png`                      | 96 x 96        | Application icon, transparent background                                                      |
| `icon-128.png`                     | 128 x 128      | Application icon, transparent background                                                      |
| `banner-220x140.png`               | 220 x 140      | Application card banner                                                                       |
| `screenshot-1-report.png`          | 1280 x 800     | The top of the report: the status, the measures, the composition, the funds, and the holdings |
| `screenshot-2-menu.png`            | 1280 x 800     | The add-on menu under Extensions: Refresh, Describe a fund, and Set API key                   |
| `screenshot-3-holdings.png`        | 1280 x 800     | The holdings table and the bar chart of the holdings                                          |
| `screenshot-4-companies.png`       | 1280 x 800     | The company table and the company chart, with the bars stacked by source                      |
| `screenshot-5-lines.png`           | 1280 x 800     | The fund overlap, the holdings that the report does not look through, and the other holdings  |
| `screenshot-6-describe-a-fund.png` | 1280 x 800     | The Describe a fund sidebar beside the report, with a saved fund mix                          |

## Build

Run this command from the repository root:

```sh
npm run build:graphics
```

The command runs `listing/graphics/src/build.mjs` with the package `playwright` of the root `package.json`. It uses the
Chromium build of Playwright, or the installed Google Chrome when that build is absent. It renders each icon and the
banner from its SVG source into its PNG file. It does not write the screenshots. It checks the pixel size of each icon,
of the banner, and of each screenshot, and it stops with an error when a file does not have its size.

## Sources

- `src/icon.svg` is the icon at 96 and 128 pixels. `src/icon-small.svg` is a simpler icon at 32 and 48 pixels.
- `src/banner.svg` is the banner. Its words are outlines of the brand font. To change the words, set new outlines from
  the font.

## Screenshots

Each screenshot is a capture of the demo spreadsheet in Google Sheets, on the Concentration tab after a refresh. Every
name and every number in the demo spreadsheet is invented.

Take each screenshot with these settings:

- A browser viewport of 1280 x 800 pixels at a device scale factor of 1.
- The account avatar hidden.
- The Sheets zoom and the window of each view:

| File                               | Zoom | Window                                         |
| ---------------------------------- | ---- | ---------------------------------------------- |
| `screenshot-1-report.png`          | 83%  | Full screen view, with the formula bar hidden  |
| `screenshot-2-menu.png`            | 83%  | The normal Sheets window, with the formula bar |
| `screenshot-3-holdings.png`        | 75%  | Full screen view, with the formula bar hidden  |
| `screenshot-4-companies.png`       | 75%  | Full screen view, with the formula bar hidden  |
| `screenshot-5-lines.png`           | 75%  | Full screen view, with the formula bar hidden  |
| `screenshot-6-describe-a-fund.png` | 83%  | The normal Sheets window                       |

The Google rule for the size, from https://developers.google.com/workspace/marketplace/create-listing#graphic-assets :

> The recommended size is 1280x800 pixels, though 640x400 or 2560x1600 pixels are also accepted. Screenshots should have
> square corners and no padding (full bleed).

The listing accepts up to 10 screenshots.
