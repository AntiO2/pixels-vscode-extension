import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";

import { fromBufferPromise } from "yauzl";

import {
  manifestPath,
  repositoryRoot,
  stagedCore,
} from "./lib/core-config.mjs";

const rootManifest = JSON.parse(
  await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const archivePath = path.resolve(
  process.argv[2] ??
    path.join(
      repositoryRoot,
      "out",
      "vsix",
      `pixels-pxl-inspector-${rootManifest.version}.vsix`,
    ),
);

const expectedMembers = new Set([
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/package.json",
  "extension/THIRD_PARTY_NOTICES.md",
  "extension/readme.md",
  "extension/LICENSE.md",
  "extension/changelog.md",
  "extension/resources/icon.png",
  "extension/examples/customer.pxl",
  "extension/resources/core/pixels-inspector-wasm.wasm",
  "extension/resources/core/pixels-inspector-wasm.cjs",
  "extension/resources/core/core-manifest.json",
  "extension/dist/worker/node.mjs",
  "extension/dist/worker/browser.js",
  "extension/dist/webview/styles.css",
  "extension/dist/webview/main.js",
  "extension/dist/webview/codicons.LICENSE.txt",
  "extension/dist/webview/codicon.ttf",
  "extension/dist/extension/node.cjs",
  "extension/dist/extension/browser.js",
]);
const forbiddenMember =
  /(^|\/)(?:\.agents|\.codex|\.trellis|docs|scripts|tests|third_party|screenshots)(?:\/|$)|(^|\/)(?:AGENTS\.md|GOAL\.md)$|\.(?:exe|dll|dylib|so|jar|class)$/iu;
const textMember = /\.(?:cjs|js|json|md|mjs|txt|xml)$/iu;
const secretPatterns = [
  /(?:AKIA|ASIA)[A-Z0-9]{16}/u,
  /gh[pousr]_[A-Za-z0-9]{36,}/u,
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/u,
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const archiveBytes = await fs.readFile(archivePath);
const zip = await fromBufferPromise(archiveBytes, {
  strictFileNames: true,
  validateEntrySizes: true,
});
const members = new Map();
for await (const entry of zip.eachEntry()) {
  if (entry.fileName.endsWith("/")) {
    continue;
  }
  if (members.has(entry.fileName)) {
    throw new Error(`duplicate VSIX member: ${entry.fileName}`);
  }
  if (entry.uncompressedSize > 64 * 1024 * 1024) {
    throw new Error(`unexpectedly large VSIX member: ${entry.fileName}`);
  }
  members.set(
    entry.fileName,
    await readStream(await zip.openReadStreamPromise(entry)),
  );
}

const actualNames = [...members.keys()].sort();
const expectedNames = [...expectedMembers].sort();
if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
  const missing = expectedNames.filter((name) => !members.has(name));
  const unexpected = actualNames.filter((name) => !expectedMembers.has(name));
  throw new Error(
    `VSIX member set mismatch; missing=${JSON.stringify(missing)}, unexpected=${JSON.stringify(unexpected)}`,
  );
}
for (const name of actualNames) {
  if (forbiddenMember.test(name)) {
    throw new Error(`forbidden VSIX member: ${name}`);
  }
}

const packagedManifest = JSON.parse(
  members.get("extension/package.json").toString("utf8"),
);
for (const field of ["name", "publisher", "version", "main", "browser"]) {
  if (packagedManifest[field] !== rootManifest[field]) {
    throw new Error(`packaged package.json ${field} does not match the root manifest`);
  }
}
for (const entrypoint of [packagedManifest.main, packagedManifest.browser]) {
  if (typeof entrypoint !== "string") {
    throw new Error("packaged extension entrypoints must be strings");
  }
  const member = `extension/${entrypoint.replace(/^\.\//u, "")}`;
  if (!members.has(member)) {
    throw new Error(`packaged extension entrypoint is missing: ${member}`);
  }
}
const vsixManifest = members.get("extension.vsixmanifest").toString("utf8");
if (!vsixManifest.includes(`Version="${rootManifest.version}"`)) {
  throw new Error("extension.vsixmanifest version does not match package.json");
}

const stagedManifestBytes = await fs.readFile(manifestPath);
const archiveManifestBytes = members.get(
  "extension/resources/core/core-manifest.json",
);
if (!archiveManifestBytes.equals(stagedManifestBytes)) {
  throw new Error("archived Core manifest does not equal the staged manifest");
}
const coreManifest = JSON.parse(stagedManifestBytes.toString("utf8"));
for (const fileName of [
  "pixels-inspector-wasm.cjs",
  "pixels-inspector-wasm.wasm",
]) {
  const stagedBytes = await fs.readFile(path.join(stagedCore, fileName));
  const packagedBytes = members.get(`extension/resources/core/${fileName}`);
  const artifact = coreManifest.artifacts?.[fileName];
  if (
    artifact?.bytes !== stagedBytes.byteLength ||
    artifact?.sha256 !== sha256(stagedBytes)
  ) {
    throw new Error(`staged ${fileName} does not match the Core manifest`);
  }
  if (!packagedBytes.equals(stagedBytes)) {
    throw new Error(`archived ${fileName} does not equal the staged artifact`);
  }
}

const customer = members.get("extension/examples/customer.pxl");
if (customer.byteLength === 0 || customer.byteLength > 1_000_000) {
  throw new Error("customer example must be a non-empty modest release fixture");
}

for (const [name, bytes] of members) {
  if (!textMember.test(name)) {
    continue;
  }
  const text = bytes.toString("utf8");
  if (
    text.includes(repositoryRoot) ||
    /(?:\/home\/[^/\s]+|\/Users\/[^/\s]+)\/(?:projects|src|work|workspace)\//u.test(
      text,
    ) ||
    /[A-Za-z]:\\Users\\[^\\\s]+\\/u.test(text)
  ) {
    throw new Error(`local checkout path leaked into VSIX member: ${name}`);
  }
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`secret-like value leaked into VSIX member: ${name}`);
  }
}

const threshold = 300 * 1024;
if (archiveBytes.byteLength > threshold) {
  const decision = await fs.readFile(
    path.join(repositoryRoot, "docs", "release-package.md"),
    "utf8",
  );
  if (!/exceeds the 300 KiB review threshold because/iu.test(decision)) {
    throw new Error(
      "VSIX exceeds 300 KiB without a recorded explanation in docs/release-package.md",
    );
  }
}

process.stdout.write(
  `VSIX verified: ${archivePath} (${members.size} exact members, ${(archiveBytes.byteLength / 1024).toFixed(2)} KiB compressed, sha256 ${sha256(archiveBytes)})\n`,
);
