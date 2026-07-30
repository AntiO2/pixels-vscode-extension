import { InspectorError } from "./errors.js";

export interface CoreArtifact {
  readonly bytes: number;
  readonly sha256: string;
}

export interface CoreManifest {
  readonly schemaVersion: 1;
  readonly abiVersion: number;
  readonly coreCommit: string;
  readonly toolchain: {
    readonly emscripten: string;
    readonly protobuf: string;
  };
  readonly capabilities: readonly string[];
  readonly artifacts: Readonly<Record<string, CoreArtifact>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeCoreManifest(value: unknown): CoreManifest {
  if (!isRecord(value)) {
    throw new InspectorError("INVALID_MESSAGE", "Core manifest must be an object");
  }
  const toolchain = value["toolchain"];
  const artifacts = value["artifacts"];
  if (
    value["schemaVersion"] !== 1 ||
    typeof value["abiVersion"] !== "number" ||
    !Number.isInteger(value["abiVersion"]) ||
    typeof value["coreCommit"] !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value["coreCommit"]) ||
    !isRecord(toolchain) ||
    typeof toolchain["emscripten"] !== "string" ||
    typeof toolchain["protobuf"] !== "string" ||
    !Array.isArray(value["capabilities"]) ||
    !value["capabilities"].every((item) => typeof item === "string") ||
    !isRecord(artifacts)
  ) {
    throw new InspectorError("INVALID_MESSAGE", "Core manifest is invalid");
  }

  const decodedArtifacts: Record<string, CoreArtifact> = {};
  for (const [name, artifact] of Object.entries(artifacts)) {
    if (
      !isRecord(artifact) ||
      typeof artifact["bytes"] !== "number" ||
      !Number.isSafeInteger(artifact["bytes"]) ||
      artifact["bytes"] < 0 ||
      typeof artifact["sha256"] !== "string" ||
      !/^[0-9a-f]{64}$/u.test(artifact["sha256"])
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        `Core artifact entry is invalid: ${name}`,
      );
    }
    decodedArtifacts[name] = {
      bytes: artifact["bytes"],
      sha256: artifact["sha256"],
    };
  }

  return {
    schemaVersion: 1,
    abiVersion: value["abiVersion"],
    coreCommit: value["coreCommit"],
    toolchain: {
      emscripten: toolchain["emscripten"],
      protobuf: toolchain["protobuf"],
    },
    capabilities: value["capabilities"],
    artifacts: decodedArtifacts,
  };
}
