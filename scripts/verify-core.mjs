import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  coreAbi,
  coreCommit,
  coreRoot,
  manifestPath,
  repositoryRoot,
  stagedCore,
} from "./lib/core-config.mjs";
import { capture } from "./lib/process.mjs";

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const submoduleCommit = await capture("git", ["rev-parse", "HEAD"], {
  cwd: coreRoot,
});
requireCondition(
  submoduleCommit === coreCommit,
  `submodule commit mismatch: ${submoduleCommit}`,
);

const submoduleStatus = await capture("git", ["status", "--porcelain"], {
  cwd: coreRoot,
});
requireCondition(
  submoduleStatus === "",
  "Pixels submodule has uncommitted changes",
);

const gitlink = await capture(
  "git",
  ["ls-files", "--stage", "third_party/pixels"],
  { cwd: repositoryRoot },
);
requireCondition(
  gitlink.includes(`160000 ${coreCommit} `),
  "parent index does not pin the validated Core commit",
);

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
requireCondition(manifest.schemaVersion === 1, "manifest schema mismatch");
requireCondition(manifest.abiVersion === coreAbi, "manifest ABI mismatch");
requireCondition(
  manifest.coreCommit === coreCommit,
  "manifest Core commit mismatch",
);

for (const [fileName, expected] of Object.entries(manifest.artifacts)) {
  requireCondition(
    typeof expected === "object" && expected !== null,
    `invalid artifact entry: ${fileName}`,
  );
  const filePath = path.join(stagedCore, fileName);
  const bytes = await fs.readFile(filePath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  requireCondition(
    digest === expected.sha256,
    `artifact digest mismatch: ${fileName}`,
  );
  requireCondition(
    bytes.byteLength === expected.bytes,
    `artifact size mismatch: ${fileName}`,
  );
}

process.stdout.write(
  `Core ${coreCommit.slice(0, 8)} ABI ${String(coreAbi)} verified\n`,
);
