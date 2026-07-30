import { CORE_ABI_VERSION } from "./constants.js";
import { InspectorError } from "./errors.js";

export interface CoreTypeCapability {
  readonly kind: number;
  readonly name: string;
}

export interface CoreCapabilities {
  readonly abi: number;
  readonly page: "generic-v1";
  readonly types: readonly CoreTypeCapability[];
  readonly encodings: readonly string[];
  readonly nested: "portable-v1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeCoreCapabilities(value: unknown): CoreCapabilities {
  if (!isRecord(value)) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "Core capabilities must be an object",
    );
  }
  const types = value["types"];
  const encodings = value["encodings"];
  if (
    value["abi"] !== CORE_ABI_VERSION ||
    value["page"] !== "generic-v1" ||
    value["nested"] !== "portable-v1" ||
    !Array.isArray(types) ||
    types.length !== 20 ||
    !Array.isArray(encodings) ||
    encodings.length === 0 ||
    !encodings.every(
      (encoding) => typeof encoding === "string" && encoding.length > 0,
    ) ||
    new Set(encodings).size !== encodings.length
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "Core capabilities are incomplete",
    );
  }

  const decodedTypes: CoreTypeCapability[] = [];
  const names = new Set<string>();
  for (let index = 0; index < types.length; index += 1) {
    const type: unknown = types[index];
    if (
      !isRecord(type) ||
      type["kind"] !== index ||
      typeof type["name"] !== "string" ||
      type["name"].length === 0 ||
      names.has(type["name"])
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "Core type capabilities are invalid",
      );
    }
    names.add(type["name"]);
    decodedTypes.push({
      kind: index,
      name: type["name"],
    });
  }
  return {
    abi: CORE_ABI_VERSION,
    page: "generic-v1",
    types: decodedTypes,
    encodings,
    nested: "portable-v1",
  };
}
