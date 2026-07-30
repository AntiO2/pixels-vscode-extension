import type {
  PageValue,
} from "@pixels-inspector/protocol-client";

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
