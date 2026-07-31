import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { repositoryRoot } from "./lib/core-config.mjs";
import { capture } from "./lib/process.mjs";

const forbiddenTracked = /(^|\/)(?:\.agents|\.codex|\.trellis)(?:\/|$)|(^|\/)(?:AGENTS\.md|GOAL\.md|\.gitattributes)$/;
const forbiddenProduct = /\.(?:exe|dll|dylib|so|jar|class)$/i;
const customerExample = "examples/customer.pxl";
const screenshotPrefix = "resources/screenshots/";
const screenshotDirectory = path.join(repositoryRoot, screenshotPrefix);

const tracked = (
  await capture("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repositoryRoot,
  })
)
  .split(/\r?\n/u)
  .filter(Boolean);

for (const file of tracked) {
  if (forbiddenTracked.test(file)) {
    throw new Error(`local AI/Trellis file entered product scope: ${file}`);
  }
  if (!file.startsWith("third_party/") && forbiddenProduct.test(file)) {
    throw new Error(`native/JVM product artifact is forbidden: ${file}`);
  }
  const absolute = path.join(repositoryRoot, file);
  const stat = await fs.lstat(absolute);
  if (stat.isFile()) {
    const text =
      stat.size <= 2_000_000
        ? await fs.readFile(absolute, "utf8")
        : "";
    if (
      /\/home\/anti\/projects\/pixels(?:\/|$)/u.test(text) ||
      text.includes(repositoryRoot)
    ) {
      throw new Error(`local checkout path leaked into product file: ${file}`);
    }
  }
}

const vscodeIgnore = await fs.readFile(
  path.join(repositoryRoot, ".vscodeignore"),
  "utf8",
);
if (!vscodeIgnore.split(/\r?\n/u).includes("resources/screenshots/**")) {
  throw new Error("release screenshots must be intentionally excluded from VSIX");
}
const exampleStat = await fs.stat(path.join(repositoryRoot, customerExample));
if (!exampleStat.isFile() || exampleStat.size === 0 || exampleStat.size > 1_000_000) {
  throw new Error("customer example must be a non-empty modest release fixture");
}
const packaged = (
  await capture(
    path.join(
      repositoryRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "vsce.cmd" : "vsce",
    ),
    ["ls"],
    { cwd: repositoryRoot },
  )
)
  .split(/\r?\n/u)
  .map((entry) => entry.replace(/^extension\//u, ""))
  .filter(Boolean);
if (!packaged.includes(customerExample)) {
  throw new Error("customer example is missing from the VSIX member list");
}
if (packaged.some((entry) => entry.startsWith(screenshotPrefix))) {
  throw new Error("release screenshots unexpectedly entered the VSIX");
}
const captureManifest = JSON.parse(
  await fs.readFile(path.join(screenshotDirectory, "capture-manifest.json"), "utf8"),
);
for (const name of ["analyze.png", "data.png", "query.png"]) {
  const bytes = await fs.readFile(path.join(screenshotDirectory, name));
  const approved = captureManifest[name];
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    approved?.width !== bytes.readUInt32BE(16) ||
    approved?.height !== bytes.readUInt32BE(20) ||
    approved?.sha256 !== digest
  ) {
    throw new Error(`release screenshot provenance mismatch: ${name}`);
  }
}

process.stdout.write(
  `Package hygiene verified across ${tracked.length} paths; customer example included (${exampleStat.size} bytes), screenshots excluded\n`,
);
