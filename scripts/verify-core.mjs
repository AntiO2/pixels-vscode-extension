import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  coreAbi,
  coreCapabilities,
  coreCommit,
  coreRoot,
  loaderFileName,
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
requireCondition(
  JSON.stringify(manifest.capabilities) === JSON.stringify(coreCapabilities),
  "manifest capability inventory mismatch",
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

const require = createRequire(import.meta.url);
const createPixelsInspector = require(
  path.join(stagedCore, loaderFileName),
);
const module = await createPixelsInspector({
  locateFile(fileName) {
    return path.join(stagedCore, fileName);
  },
  print() {
    return undefined;
  },
  printErr() {
    return undefined;
  },
});
requireCondition(
  module._pixels_inspector_abi_version() === coreAbi,
  "staged Core export reports the wrong ABI",
);
const capabilitySizePointer = module._malloc(8);
try {
  requireCondition(
    module._pixels_inspector_capabilities_size(capabilitySizePointer) === 0,
    "staged Core capability size is unavailable",
  );
  const capabilitySize = Number(
    new DataView(module.HEAPU8.buffer, capabilitySizePointer, 8)
      .getBigUint64(0, true),
  );
  const capabilityPointer = module._malloc(capabilitySize);
  try {
    requireCondition(
      module._pixels_inspector_copy_capabilities(
        capabilityPointer,
        BigInt(capabilitySize),
      ) === 0,
      "staged Core capabilities are unavailable",
    );
    const capabilities = JSON.parse(
      new TextDecoder().decode(
        module.HEAPU8.slice(
          capabilityPointer,
          capabilityPointer + capabilitySize,
        ),
      ),
    );
    requireCondition(
      capabilities.abi === coreAbi &&
        capabilities.rows === "rows-v1" &&
        capabilities.filter === "filter-v1" &&
        capabilities.defaultRows === 100 &&
        capabilities.maxRows === 500,
      "staged Core row/filter capabilities are incomplete",
    );
    requireCondition(
      capabilities.compression?.payload === "inactive" &&
        capabilities.compression?.reason === "postscript-v1-unused" &&
        JSON.stringify(capabilities.compression?.metadata) ===
          JSON.stringify(["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"]),
      "staged Core compression metadata capability is inaccurate",
    );
  } finally {
    module._free(capabilityPointer);
  }
} finally {
  module._free(capabilitySizePointer);
}

process.stdout.write(
  `Core ${coreCommit.slice(0, 8)} ABI ${String(coreAbi)} verified\n`,
);
