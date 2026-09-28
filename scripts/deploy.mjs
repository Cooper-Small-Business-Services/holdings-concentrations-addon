#!/usr/bin/env node
/**
 * The deploy of the add-on through the Apps Script API.
 *
 * The deploy does three steps on the standalone script project:
 *
 * 1. It replaces the files of the project with each `.gs` file of `src/` and
 *    `src/appsscript.json`. No other file goes up.
 * 2. It creates a new version of the project.
 * 3. It moves the one versioned deployment of the project to that version.
 *    When the project has no versioned deployment, it creates one. When the
 *    project has more than one, it stops with an error and changes nothing.
 *
 * The deploy reads two environment variables:
 *
 * - ADDON_SCRIPT_ID: the script ID of the standalone project.
 * - ADDON_ACCESS_TOKEN: an access token of the project owner with the scopes
 *   `script.projects` and `script.deployments`.
 *
 * The deploy prints no part of the token, no script ID, and no deployment
 * ID, because the log of a public workflow is public.
 *
 * Usage, from the repository root:
 *
 *   node scripts/deploy.mjs --dry-run
 *   node scripts/deploy.mjs
 *
 * The option --dry-run prints the files of the upload and sends no request.
 *
 * Exit codes: 0 = done, 1 = an API call failed, 2 = a variable is absent.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const API = "https://script.googleapis.com/v1";
const MANIFEST = "appsscript";

/**
 * The file list of the upload. The manifest has the type JSON and each
 * script file has the type SERVER_JS. The name of each file has no
 * extension, as the Apps Script API requires.
 *
 * @returns {{ name: string, type: string, source: string }[]} The files.
 */
function projectFiles() {
  const scripts = readdirSync(SRC)
    .filter((name) => extname(name) === ".gs")
    .sort()
    .map((name) => ({
      name: name.slice(0, -".gs".length),
      type: "SERVER_JS",
      source: readFileSync(resolve(SRC, name), "utf8"),
    }));
  const manifest = {
    name: MANIFEST,
    type: "JSON",
    source: readFileSync(resolve(SRC, `${MANIFEST}.json`), "utf8"),
  };
  return [manifest, ...scripts];
}

/**
 * The values that the log must not show: the token, the script ID, and each
 * deployment ID. The deploy adds each value when it learns it.
 */
const hidden = [];

/**
 * Replace each hidden value in a text with `<hidden>`.
 *
 * @param {string} text The text.
 * @returns {string} The text with no hidden value.
 */
function redact(text) {
  let out = text;
  for (const value of hidden) {
    if (value !== "") out = out.split(value).join("<hidden>");
  }
  return out;
}

/**
 * Sends one request to the Apps Script API and returns the parsed body.
 * A status outside 2xx stops the deploy with the error text of the API. The
 * error text goes to the log with each hidden value replaced.
 *
 * @param {string} token The access token.
 * @param {string} scriptId The script ID.
 * @param {string} method The HTTP method.
 * @param {string} path The path under the project.
 * @param {unknown} [body] The request body.
 * @returns {Promise<any>} The parsed response body.
 */
async function call(token, scriptId, method, path, body) {
  const response = await fetch(`${API}/projects/${scriptId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`${method} ${redact(path)}: HTTP ${response.status}`);
    console.error(redact(text));
    process.exit(1);
  }
  return text === "" ? {} : JSON.parse(text);
}

/**
 * Returns each deployment of the project that points to a version. The HEAD
 * deployment has no version number, so the list leaves it out.
 *
 * @param {string} token The access token.
 * @param {string} scriptId The script ID.
 * @returns {Promise<any[]>} The versioned deployments.
 */
async function versionedDeployments(token, scriptId) {
  const found = [];
  let pageToken = "";
  do {
    const query = pageToken === "" ? "" : `?pageToken=${encodeURIComponent(pageToken)}`;
    const page = await call(token, scriptId, "GET", `/deployments${query}`);
    for (const deployment of page.deployments ?? []) {
      hidden.push(deployment.deploymentId ?? "");
      if (deployment.deploymentConfig?.versionNumber !== undefined) {
        found.push(deployment);
      }
    }
    pageToken = page.nextPageToken ?? "";
  } while (pageToken !== "");
  return found;
}

/**
 * Runs the deploy.
 */
async function main() {
  const files = projectFiles();
  if (process.argv.includes("--dry-run")) {
    for (const file of files) {
      console.log(`${file.name} ${file.type} ${file.source.length} characters`);
    }
    return;
  }

  const scriptId = (process.env.ADDON_SCRIPT_ID ?? "").trim();
  const token = (process.env.ADDON_ACCESS_TOKEN ?? "").trim();
  if (scriptId === "" || token === "") {
    console.error("Set ADDON_SCRIPT_ID and ADDON_ACCESS_TOKEN.");
    process.exit(2);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(scriptId)) {
    console.error("ADDON_SCRIPT_ID holds a character that a script ID cannot hold.");
    process.exit(2);
  }

  hidden.push(token, scriptId);

  const commit = (process.env.GITHUB_SHA ?? "local").slice(0, 12);
  const description = `holdings-concentrations-addon ${commit}`;

  const deployments = await versionedDeployments(token, scriptId);
  if (deployments.length > 1) {
    console.error(`The project has ${deployments.length} versioned deployments. Delete all but one.`);
    process.exit(1);
  }

  await call(token, scriptId, "PUT", "/content", { files });
  console.log(`Uploaded ${files.length} files.`);

  const version = await call(token, scriptId, "POST", "/versions", { description });
  console.log(`Created version ${version.versionNumber}.`);

  const deploymentConfig = {
    scriptId,
    versionNumber: version.versionNumber,
    manifestFileName: MANIFEST,
    description,
  };
  if (deployments.length === 0) {
    await call(token, scriptId, "POST", "/deployments", deploymentConfig);
    console.log(`Created the deployment at version ${version.versionNumber}.`);
    return;
  }
  const id = deployments[0].deploymentId;
  await call(token, scriptId, "PUT", `/deployments/${id}`, { deploymentConfig });
  console.log(`Moved the deployment to version ${version.versionNumber}.`);
}

await main();
