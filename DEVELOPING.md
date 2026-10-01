# Develop the add-on

This document states how to run the checks and how to push the local source into the script project for a test.

## Checks

```sh
npm install
npm test
npm run format:check
```

The harness `test/check.mjs` runs the script in `node:vm` against fakes of the Apps Script services. It sends one real
request to the Funds API, so set `HOLDINGS_API_KEY` in the environment. The option `--offline` skips that request.

## Push the source to the script project

The script project is the one Apps Script project of the add-on. The Test deployment in the Apps Script editor runs the
current content of that project, so a push of the local source is enough to test a change in a spreadsheet.

One-time setup:

1. Run `npx clasp login` and sign in with the account that owns the script project.
2. Create `.clasp.json` beside this file with the script ID and the source directory. Git ignores the file.

   ```json
   { "scriptId": "<the script ID>", "rootDir": "src" }
   ```

   The script ID is in the Apps Script editor under **Project Settings**, or in the output of `npx clasp list-scripts`.

Then, after each change:

```sh
npm run push
```

The push replaces the whole content of the script project with the files under `src/`. Open the spreadsheet that holds
the Test deployment and choose **Refresh**. A change to a cell that the layout writes once, such as a label, needs a
higher `LAYOUT_VERSION` in `src/layout.gs`, or an existing sheet keeps the old cell.

## Release

A push to `main` runs the deploy workflow, which uploads the source, creates a version, and moves the versioned
deployment of the Marketplace listing to it. A local push changes no deployment.
