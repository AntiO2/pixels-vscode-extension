import fs from "node:fs/promises";
import path from "node:path";

import { repositoryRoot } from "./lib/core-config.mjs";
import { capture } from "./lib/process.mjs";

const forbiddenTracked = /(^|\/)(?:\.agents|\.codex|\.trellis)(?:\/|$)|(^|\/)(?:AGENTS\.md|GOAL\.md|\.gitattributes)$/;
const forbiddenProduct = /\.(?:exe|dll|dylib|so|jar|class)$/i;

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

process.stdout.write(`Package hygiene verified across ${tracked.length} paths\n`);
