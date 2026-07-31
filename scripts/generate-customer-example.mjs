import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { repositoryRoot } from "./lib/core-config.mjs";
import { run } from "./lib/process.mjs";

const source = path.join(
  repositoryRoot,
  "third_party",
  "pixels",
  "cpp",
  "pixels-inspector",
);
const outputRoot = path.join(repositoryRoot, "out", "customer-fixture");
const examples = path.join(repositoryRoot, "examples");
const configurations = [
  { id: "gcc", c: "gcc", cxx: "g++" },
  { id: "clang", c: "clang", cxx: "clang++" },
];

await fs.mkdir(outputRoot, { recursive: true });
await fs.mkdir(examples, { recursive: true });

const generated = [];
for (const configuration of configurations) {
  const build = path.join(outputRoot, configuration.id);
  await run(
    "cmake",
    [
      "-S", source,
      "-B", build,
      "-G", "Ninja",
      "-DCMAKE_BUILD_TYPE=Release",
      `-DCMAKE_C_COMPILER=${configuration.c}`,
      `-DCMAKE_CXX_COMPILER=${configuration.cxx}`,
      ...(configuration.id === "clang"
        ? [
            `-DPIXELS_PROTOC_EXECUTABLE=${path.join(
              outputRoot,
              "gcc",
              "third-party",
              "protobuf",
              "protoc",
            )}`,
          ]
        : []),
    ],
    { cwd: repositoryRoot },
  );
  await run(
    "cmake",
    ["--build", build, "--target", "pixels-customer-fixture-generator"],
    { cwd: repositoryRoot },
  );
  const output = path.join(build, "customer.pxl");
  await run(
    path.join(build, "pixels-customer-fixture-generator"),
    [output],
    { cwd: repositoryRoot },
  );
  generated.push(await fs.readFile(output));
}

if (!generated[0].equals(generated[1])) {
  throw new Error("GCC and Clang generated different customer fixtures");
}

const output = path.join(examples, "customer.pxl");
await fs.writeFile(output, generated[0]);
const digest = createHash("sha256").update(generated[0]).digest("hex");
process.stdout.write(
  `Generated ${path.relative(repositoryRoot, output)} (${generated[0].byteLength} bytes, sha256 ${digest})\n`,
);
