import type {
  PageValue,
  SchemaType,
} from "@pixels-inspector/protocol-client";

import type {
  TimestampDisplay,
} from "./app/model.js";

export function formatPageValue(value: PageValue): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function copyPageValues(values: readonly PageValue[]): string {
  return values.map(formatPageValue).join("\n");
}

export function formatBytes(decimal: string): string {
  const value = BigInt(decimal);
  if (value < 1024n) {
    return `${value.toString()} B`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"] as const;
  let scaled = Number(value);
  let index = -1;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  const unit = units[index];
  return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${unit ?? "B"}`;
}

function padded(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function timestampParts(microseconds: bigint): {
  readonly milliseconds: number;
  readonly fractional: string;
} | undefined {
  let seconds = microseconds / 1_000_000n;
  let remainder = microseconds % 1_000_000n;
  if (remainder < 0n) {
    seconds -= 1n;
    remainder += 1_000_000n;
  }
  const milliseconds = Number(seconds * 1_000n + remainder / 1_000n);
  if (!Number.isSafeInteger(milliseconds)) {
    return undefined;
  }
  return {
    milliseconds,
    fractional: remainder.toString().padStart(6, "0"),
  };
}

export function formatTimestamp(
  canonicalMicroseconds: string,
  precision: number,
  display: TimestampDisplay,
): string {
  if (display === "raw") {
    return canonicalMicroseconds;
  }
  let microseconds: bigint;
  try {
    microseconds = BigInt(canonicalMicroseconds);
  } catch {
    return canonicalMicroseconds;
  }
  const parts = timestampParts(microseconds);
  if (parts === undefined) {
    return canonicalMicroseconds;
  }
  const instant = new Date(parts.milliseconds);
  if (Number.isNaN(instant.valueOf())) {
    return canonicalMicroseconds;
  }
  const fractional =
    precision <= 0
      ? ""
      : `.${parts.fractional.slice(0, Math.min(6, precision))}`;
  if (display === "utc") {
    return `${instant.toISOString().slice(0, 19)}${fractional}Z`;
  }
  const offsetMinutes = -instant.getTimezoneOffset();
  const offsetSign = offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(offsetMinutes);
  return (
    `${padded(instant.getFullYear(), 4)}-${padded(instant.getMonth() + 1)}-` +
    `${padded(instant.getDate())}T${padded(instant.getHours())}:` +
    `${padded(instant.getMinutes())}:${padded(instant.getSeconds())}` +
    `${fractional}${offsetSign}${padded(Math.floor(absoluteOffset / 60))}:` +
    padded(absoluteOffset % 60)
  );
}

export function formatDisplayValue(
  value: PageValue,
  type: SchemaType | undefined,
  timestampDisplay: TimestampDisplay,
): string {
  if (
    value !== null &&
    typeof value === "string" &&
    type?.kind === 9
  ) {
    return formatTimestamp(
      value,
      type.precision ?? 3,
      timestampDisplay,
    );
  }
  return formatPageValue(value);
}

const COMPRESSION_NAMES = [
  "NONE",
  "ZLIB",
  "SNAPPY",
  "LZO",
  "LZ4",
  "ZSTD",
] as const;

export function compressionName(kind: number): string {
  return COMPRESSION_NAMES[kind] ?? `UNKNOWN_${String(kind)}`;
}

export function encodingName(
  kind: number,
  encodings: readonly string[] | undefined,
): string {
  return encodings?.[kind] ?? `ENCODING_${String(kind)}`;
}
