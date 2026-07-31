import { InspectorError } from "@pixels-inspector/protocol-client";
import type {
  PageValue,
  ProjectedColumn,
  ProjectedRow,
  RowsResult,
} from "@pixels-inspector/protocol-client";

const DEFAULT_MAX_WINDOWS = 3;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const utf8 = new TextEncoder();

export interface ColumnPageKey {
  readonly sourceRevision: string;
  readonly rowGroup: number;
  readonly offset: string;
  readonly count: number;
}

interface RowIdentity {
  readonly rowGroup: number;
  readonly localRow: string;
  readonly absoluteRow: string;
}

interface CachedColumn {
  readonly descriptor: ProjectedColumn;
  readonly values: readonly PageValue[];
  readonly bytes: number;
  touched: number;
}

interface CacheEntry {
  readonly key: ColumnPageKey;
  readonly identities: readonly RowIdentity[];
  readonly columns: Map<number, CachedColumn>;
  touched: number;
  bytes: number;
}

function cacheKey(key: ColumnPageKey): string {
  return JSON.stringify([
    key.sourceRevision,
    key.rowGroup,
    key.offset,
    key.count,
  ]);
}

function valueBytes(value: PageValue, depth = 0): number {
  if (depth > 64) {
    return 0;
  }
  if (value === null) {
    return 1;
  }
  if (typeof value === "boolean") {
    return 1;
  }
  if (typeof value === "number") {
    return 8;
  }
  if (typeof value === "string") {
    return 8 + utf8.encode(value).byteLength;
  }
  if (Array.isArray(value)) {
    let total = 8;
    for (const item of value as readonly PageValue[]) {
      total += valueBytes(item, depth + 1);
    }
    return total;
  }
  const objectValue = value as Readonly<Record<string, PageValue>>;
  return (
    8 +
    Object.entries(objectValue).reduce(
      (total, [key, item]) =>
        total +
        utf8.encode(key).byteLength +
        valueBytes(item, depth + 1),
      0,
    )
  );
}

function identityBytes(identity: RowIdentity): number {
  return (
    16 +
    utf8.encode(identity.localRow).byteLength +
    utf8.encode(identity.absoluteRow).byteLength
  );
}

function estimateColumnBytes(
  descriptor: ProjectedColumn,
  values: readonly PageValue[],
): number {
  let total = 24 + utf8.encode(descriptor.name).byteLength;
  for (const value of values) {
    total += valueBytes(value);
  }
  return total;
}

export class ColumnPageCache {
  private readonly entries = new Map<string, CacheEntry>();
  private clock = 0;
  private totalBytes = 0;

  public constructor(
    private readonly maxWindows = DEFAULT_MAX_WINDOWS,
    private readonly maxBytes = DEFAULT_MAX_BYTES,
  ) {
    if (maxWindows < 1 || maxBytes < 1) {
      throw new InspectorError(
        "INTERNAL",
        "column page cache bounds must be positive",
      );
    }
  }

  public get windowCount(): number {
    return this.entries.size;
  }

  public get estimatedBytes(): number {
    return this.totalBytes;
  }

  public clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  public missingColumns(
    key: ColumnPageKey,
    columns: readonly number[],
  ): readonly number[] {
    const entry = this.entries.get(cacheKey(key));
    if (entry === undefined) {
      return [...columns];
    }
    this.touch(entry);
    return columns.filter((column) => !entry.columns.has(column));
  }

  public assemble(
    key: ColumnPageKey,
    columns: readonly number[],
  ): RowsResult | undefined {
    const entry = this.entries.get(cacheKey(key));
    if (
      entry === undefined ||
      columns.some((column) => !entry.columns.has(column))
    ) {
      return undefined;
    }
    this.touch(entry);
    return this.assembleEntry(entry, columns);
  }

  public mergeAndAssemble(
    key: ColumnPageKey,
    fragment: RowsResult,
    columns: readonly number[],
  ): RowsResult {
    this.validateFragmentKey(key, fragment);
    const id = cacheKey(key);
    let entry = this.entries.get(id);
    if (entry === undefined) {
      const identities = fragment.rows.map((row) => ({
        rowGroup: row.rowGroup,
        localRow: row.localRow,
        absoluteRow: row.absoluteRow,
      }));
      entry = {
        key: { ...key },
        identities,
        columns: new Map(),
        touched: ++this.clock,
        bytes: identities.reduce(
          (total, identity) => total + identityBytes(identity),
          32,
        ),
      };
      this.entries.set(id, entry);
      this.totalBytes += entry.bytes;
    } else {
      this.validateIdentities(entry, fragment.rows);
      this.touch(entry);
    }

    fragment.columns.forEach((descriptor, columnIndex) => {
      const values = fragment.rows.map(
        (row) => row.values[columnIndex] as PageValue,
      );
      const cached: CachedColumn = {
        descriptor,
        values,
        bytes: estimateColumnBytes(descriptor, values),
        touched: ++this.clock,
      };
      const previous = entry.columns.get(descriptor.id);
      if (previous !== undefined) {
        entry.bytes -= previous.bytes;
        this.totalBytes -= previous.bytes;
      }
      entry.columns.set(descriptor.id, cached);
      entry.bytes += cached.bytes;
      this.totalBytes += cached.bytes;
    });

    const result = this.assembleEntry(entry, columns);
    this.trim(id, new Set(columns));
    return result;
  }

  private validateFragmentKey(
    key: ColumnPageKey,
    fragment: RowsResult,
  ): void {
    if (
      fragment.rowGroup !== key.rowGroup ||
      fragment.offset !== key.offset ||
      fragment.count !== key.count ||
      fragment.rows.length !== key.count
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "column fragment does not match its cache window",
      );
    }
  }

  private validateIdentities(
    entry: CacheEntry,
    rows: readonly ProjectedRow[],
  ): void {
    if (
      rows.length !== entry.identities.length ||
      rows.some((row, index) => {
        const identity = entry.identities[index];
        return (
          row.rowGroup !== identity?.rowGroup ||
          row.localRow !== identity.localRow ||
          row.absoluteRow !== identity.absoluteRow
        );
      })
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "column fragment row identities do not match the cached window",
      );
    }
  }

  private assembleEntry(
    entry: CacheEntry,
    columns: readonly number[],
  ): RowsResult {
    const selected = columns.map((column) => {
      const cached = entry.columns.get(column);
      if (cached === undefined) {
        throw new InspectorError(
          "INTERNAL",
          "requested column is absent from the cache",
        );
      }
      return cached;
    });
    for (const column of selected) {
      column.touched = ++this.clock;
    }
    return {
      operation: "rows-v1",
      rowGroup: entry.key.rowGroup,
      offset: entry.key.offset,
      count: entry.key.count,
      columns: selected.map((column) => column.descriptor),
      rows: entry.identities.map((identity, rowIndex) => ({
        ...identity,
        values: selected.map((column) => column.values[rowIndex] as PageValue),
      })),
    };
  }

  private touch(entry: CacheEntry): void {
    entry.touched = ++this.clock;
  }

  private trim(
    protectedId: string,
    selectedColumns: ReadonlySet<number>,
  ): void {
    while (
      this.entries.size > this.maxWindows ||
      this.totalBytes > this.maxBytes
    ) {
      let oldestId: string | undefined;
      let oldest: CacheEntry | undefined;
      for (const [id, entry] of this.entries) {
        if (id === protectedId) {
          continue;
        }
        if (
          oldest === undefined ||
          entry.touched < oldest.touched ||
          (entry.touched === oldest.touched && id < (oldestId ?? id))
        ) {
          oldest = entry;
          oldestId = id;
        }
      }
      if (oldest !== undefined && oldestId !== undefined) {
        this.entries.delete(oldestId);
        this.totalBytes -= oldest.bytes;
        continue;
      }

      const current = this.entries.get(protectedId);
      if (current === undefined) {
        return;
      }
      const removable = [...current.columns.entries()]
        .filter(([column]) => !selectedColumns.has(column))
        .sort((left, right) => {
          const touched = left[1].touched - right[1].touched;
          return touched === 0 ? left[0] - right[0] : touched;
        });
      const next = removable[0];
      if (next !== undefined) {
        current.columns.delete(next[0]);
        current.bytes -= next[1].bytes;
        this.totalBytes -= next[1].bytes;
        continue;
      }

      // The protected selected result remains usable by the caller, but a
      // single oversized selection must not escape the cache byte bound.
      this.entries.delete(protectedId);
      this.totalBytes -= current.bytes;
    }
  }
}
