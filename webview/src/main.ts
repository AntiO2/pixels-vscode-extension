import type {
  CoreCapabilities,
  MetadataResult,
  PageResult,
  RowGroupResult,
  SchemaType,
} from "@pixels-inspector/protocol-client";

import {
  copyPageValues,
  formatPageValue,
} from "./value-format.js";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

type Tab =
  | "overview"
  | "schema"
  | "rowGroups"
  | "preview"
  | "layout";

interface SourceSummary {
  readonly uri: string;
  readonly size: string;
  readonly revision: string;
}

interface ViewState {
  tab: Tab;
  revision: number;
  source: SourceSummary | undefined;
  capabilities: CoreCapabilities | undefined;
  metadata: MetadataResult | undefined;
  rowGroup: RowGroupResult | undefined;
  page: PageResult | undefined;
  loading: string | undefined;
  error: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  } | undefined;
}

const vscode = acquireVsCodeApi();
const rootElement = document.querySelector<HTMLElement>("#app");
if (rootElement === null) {
  throw new Error("Pixels Inspector app root is missing");
}
const root: HTMLElement = rootElement;

const state: ViewState = {
  tab: "overview",
  revision: 0,
  source: undefined,
  capabilities: undefined,
  metadata: undefined,
  rowGroup: undefined,
  page: undefined,
  loading: undefined,
  error: undefined,
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className !== undefined) {
    result.className = className;
  }
  if (text !== undefined) {
    result.textContent = text;
  }
  return result;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const result = element("button", "button", label);
  result.type = "button";
  result.addEventListener("click", action);
  return result;
}

function formatBytes(decimal: string): string {
  const value = BigInt(decimal);
  if (value < 1024n) {
    return `${value.toString()} B`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let scaled = Number(value);
  let index = -1;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function kindName(kind: number): string {
  return state.capabilities?.types[kind]?.name ?? `KIND_${String(kind)}`;
}

function propertyList(
  entries: readonly (readonly [string, string])[],
): HTMLElement {
  const list = element("dl", "properties");
  for (const [name, value] of entries) {
    list.append(element("dt", undefined, name));
    list.append(element("dd", undefined, value));
  }
  return list;
}

function card(title: string, content: Node): HTMLElement {
  const result = element("section", "card");
  result.append(element("h2", undefined, title), content);
  return result;
}

function renderOverview(): HTMLElement {
  const container = element("div", "card-grid");
  const metadata = state.metadata;
  const source = state.source;
  if (metadata === undefined || source === undefined) {
    return container;
  }
  container.append(
    card(
      "File",
      propertyList([
        ["URI", source.uri],
        ["Size", `${formatBytes(source.size)} (${source.size} bytes)`],
        ["Revision", source.revision],
        ["Magic", metadata.magic],
        ["Format version", String(metadata.version)],
      ]),
    ),
    card(
      "Shape",
      propertyList([
        ["Rows", String(metadata.rows)],
        ["Columns", String(metadata.schemaCount)],
        ["Row groups", String(metadata.rowGroupCount)],
        ["Pixel stride", String(metadata.pixelStride)],
        ["Content length", metadata.postscript.contentLength],
      ]),
    ),
    card(
      "Writer",
      propertyList([
        ["Timezone", metadata.postscript.writerTimezone || "—"],
        ["Compression", String(metadata.postscript.compression)],
        [
          "Compression block",
          String(metadata.postscript.compressionBlockSize),
        ],
        [
          "Chunk alignment",
          String(metadata.postscript.columnChunkAlignment),
        ],
        ["Partitioned", String(metadata.postscript.partitioned)],
        ["Hidden column", String(metadata.postscript.hasHiddenColumn)],
      ]),
    ),
    card(
      "Portable Core",
      propertyList([
        ["ABI", String(state.capabilities?.abi ?? metadata.abi)],
        ["Page contract", state.capabilities?.page ?? "—"],
        ["Layout contract", state.capabilities?.rowGroup ?? "—"],
        ["Nested contract", state.capabilities?.nested ?? "—"],
        [
          "Logical kinds",
          String(state.capabilities?.types.length ?? metadata.schema.length),
        ],
      ]),
    ),
  );
  return container;
}

function schemaRows(metadata: MetadataResult): readonly {
  readonly type: SchemaType;
  readonly depth: number;
}[] {
  const byId = new Map(metadata.schema.map((type) => [type.id, type]));
  const children = new Set(
    metadata.schema.flatMap((type) => [...type.subtypes]),
  );
  const roots = metadata.schema.filter((type) => !children.has(type.id));
  const result: { type: SchemaType; depth: number }[] = [];
  const visited = new Set<number>();
  const visit = (type: SchemaType, depth: number): void => {
    if (visited.has(type.id)) {
      return;
    }
    visited.add(type.id);
    result.push({ type, depth });
    for (const childId of type.subtypes) {
      const child = byId.get(childId);
      if (child !== undefined) {
        visit(child, depth + 1);
      }
    }
  };
  for (const type of roots) {
    visit(type, 0);
  }
  for (const type of metadata.schema) {
    visit(type, 0);
  }
  return result;
}

function renderSchema(): HTMLElement {
  const wrapper = element("div", "table-wrap");
  const metadata = state.metadata;
  if (metadata === undefined) {
    return wrapper;
  }
  const table = element("table");
  table.innerHTML =
    "<thead><tr><th>Column</th><th>Kind</th><th>ID</th>" +
    "<th>Type parameters</th><th>Values</th><th>Nulls</th></tr></thead>";
  const body = element("tbody");
  for (const { type, depth } of schemaRows(metadata)) {
    const row = element("tr");
    const name = element("td");
    const nameText = element("span", "schema-name", type.name);
    nameText.style.setProperty("--depth", String(depth));
    name.append(nameText);
    const parameters = [
      type.maximumLength === undefined
        ? undefined
        : `length ${String(type.maximumLength)}`,
      type.precision === undefined
        ? undefined
        : `precision ${String(type.precision)}`,
      type.scale === undefined ? undefined : `scale ${String(type.scale)}`,
      type.dimension === undefined
        ? undefined
        : `dimension ${String(type.dimension)}`,
    ].filter((value): value is string => value !== undefined);
    const statistics = metadata.fileStatistics[type.id];
    row.append(
      name,
      element("td", "kind", kindName(type.kind)),
      element("td", "numeric", String(type.id)),
      element("td", undefined, parameters.join(", ") || "—"),
      element("td", "numeric", statistics?.numberOfValues ?? "—"),
      element(
        "td",
        undefined,
        statistics === undefined ? "—" : String(statistics.containsNull),
      ),
    );
    body.append(row);
  }
  table.append(body);
  wrapper.append(table);
  return wrapper;
}

function selectGroup(rowGroup: number): void {
  const metadata = state.metadata;
  if (metadata === undefined) {
    return;
  }
  const rows = metadata.rowGroups[rowGroup]?.rows ?? 0;
  if (rows === 0 || metadata.schema.length === 0) {
    return;
  }
  vscode.postMessage({
    kind: "select",
    rowGroup,
    column: state.page?.column ?? 0,
    rowOffset: "0",
    rowCount: Math.min(rows, 100),
  });
}

function renderRowGroups(): HTMLElement {
  const wrapper = element("div", "stack");
  const metadata = state.metadata;
  if (metadata === undefined) {
    return wrapper;
  }
  const tableWrap = element("div", "table-wrap");
  const table = element("table");
  table.innerHTML =
    "<thead><tr><th>Row group</th><th>Rows</th><th>Data bytes</th>" +
    "<th>Footer offset</th><th>Footer bytes</th></tr></thead>";
  const body = element("tbody");
  for (const group of metadata.rowGroups) {
    const row = element("tr", "selectable");
    if (group.index === state.rowGroup?.rowGroup) {
      row.classList.add("selected");
    }
    row.tabIndex = 0;
    row.addEventListener("click", () => {
      selectGroup(group.index);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        selectGroup(group.index);
      }
    });
    row.append(
      element("td", undefined, String(group.index)),
      element("td", "numeric", String(group.rows)),
      element("td", "numeric", String(group.dataLength)),
      element("td", "numeric", group.footerOffset),
      element("td", "numeric", String(group.footerLength)),
    );
    body.append(row);
  }
  table.append(body);
  tableWrap.append(table);
  wrapper.append(tableWrap);

  const layout = state.rowGroup;
  if (layout !== undefined) {
    const detail = element("div", "table-wrap");
    const detailTable = element("table");
    detailTable.innerHTML =
      "<thead><tr><th>Column</th><th>Encoding</th><th>Offset</th>" +
      "<th>Bytes</th><th>Null offset</th><th>Pixels</th></tr></thead>";
    const detailBody = element("tbody");
    for (const column of layout.columns) {
      const schema = metadata.schema[column.column];
      const row = element("tr");
      row.append(
        element(
          "td",
          undefined,
          `${schema?.name ?? "column"} · ${kindName(schema?.kind ?? -1)}`,
        ),
        element("td", undefined, String(column.encoding.kind)),
        element("td", "numeric", column.chunk.offset),
        element("td", "numeric", String(column.chunk.length)),
        element("td", "numeric", String(column.chunk.nullOffset)),
        element("td", "numeric", String(column.chunk.pixels.length)),
      );
      detailBody.append(row);
    }
    detailTable.append(detailBody);
    detail.append(detailTable);
    wrapper.append(card(`Row group ${String(layout.rowGroup)} layout`, detail));
  }
  return wrapper;
}

function renderPreview(): HTMLElement {
  const wrapper = element("div", "stack");
  const metadata = state.metadata;
  if (metadata === undefined) {
    return wrapper;
  }
  const controls = element("form", "controls");
  const groupSelect = element("select");
  for (const group of metadata.rowGroups) {
    const option = element("option", undefined, `Row group ${String(group.index)}`);
    option.value = String(group.index);
    option.selected =
      group.index === (state.page?.rowGroup ?? state.rowGroup?.rowGroup ?? 0);
    groupSelect.append(option);
  }
  const columnSelect = element("select");
  for (const type of metadata.schema) {
    const option = element(
      "option",
      undefined,
      `${type.name} · ${kindName(type.kind)}`,
    );
    option.value = String(type.id);
    option.selected = type.id === (state.page?.column ?? 0);
    columnSelect.append(option);
  }
  const offset = element("input");
  offset.type = "number";
  offset.min = "0";
  offset.step = "1";
  offset.value = String(state.page?.offset ?? 0);
  offset.setAttribute("aria-label", "Row offset");
  const count = element("input");
  count.type = "number";
  count.min = "1";
  count.max = "500";
  count.step = "1";
  count.value = String(state.page?.count ?? 100);
  count.setAttribute("aria-label", "Row count");
  controls.append(
    element("label", undefined, "Group"),
    groupSelect,
    element("label", undefined, "Column"),
    columnSelect,
    element("label", undefined, "Offset"),
    offset,
    element("label", undefined, "Rows"),
    count,
    button("Load", () => {
      controls.requestSubmit();
    }),
    button("Copy values", () => {
      const text = copyPageValues(state.page?.values ?? []);
      void navigator.clipboard.writeText(text);
    }),
  );
  controls.addEventListener("submit", (event) => {
    event.preventDefault();
    const rowGroup = Number(groupSelect.value);
    const groupRows = metadata.rowGroups[rowGroup]?.rows ?? 0;
    const requestedOffset = Math.max(0, Number(offset.value));
    const available = Math.max(0, groupRows - requestedOffset);
    const requestedCount = Math.max(
      1,
      Math.min(500, Number(count.value), available),
    );
    if (available > 0) {
      vscode.postMessage({
        kind: "select",
        rowGroup,
        column: Number(columnSelect.value),
        rowOffset: String(requestedOffset),
        rowCount: requestedCount,
      });
    }
  });
  wrapper.append(controls);

  const page = state.page;
  if (page === undefined) {
    wrapper.append(element("div", "empty", "No preview page loaded."));
    return wrapper;
  }
  const type = metadata.schema[page.column];
  const tableWrap = element("div", "table-wrap");
  const table = element("table", "preview-table");
  const head = element("thead");
  const headRow = element("tr");
  headRow.append(
    element("th", undefined, "Row"),
    element(
      "th",
      undefined,
      `${type?.name ?? "value"} · ${kindName(type?.kind ?? -1)}`,
    ),
  );
  head.append(headRow);
  const body = element("tbody");
  page.values.forEach((value, index) => {
    const row = element("tr");
    const valueCell = element(
      "td",
      value === null ? "null-value" : "value",
      formatPageValue(value),
    );
    valueCell.title = formatPageValue(value);
    row.append(
      element("td", "numeric", String(page.offset + index)),
      valueCell,
    );
    body.append(row);
  });
  table.append(head, body);
  tableWrap.append(table);
  wrapper.append(tableWrap);
  return wrapper;
}

function renderLayout(): HTMLElement {
  const wrapper = element("div", "layout-tree");
  const metadata = state.metadata;
  if (metadata === undefined) {
    return wrapper;
  }
  const intro = element(
    "p",
    "muted",
    "Source-backed hierarchy: Schema → Row Group → Chunk → Pixel",
  );
  wrapper.append(intro);
  const group = state.rowGroup;
  if (group === undefined) {
    wrapper.append(element("div", "empty", "Select a row group to inspect layout."));
    return wrapper;
  }
  const groupSummary = metadata.rowGroups[group.rowGroup];
  const groupNode = element("section", "layout-node group-node");
  groupNode.append(
    element("h2", undefined, `Row Group ${String(group.rowGroup)}`),
    propertyList([
      ["Rows", String(groupSummary?.rows ?? 0)],
      ["Data bytes", String(groupSummary?.dataLength ?? 0)],
      ["Footer offset", groupSummary?.footerOffset ?? "—"],
      ["Footer bytes", String(groupSummary?.footerLength ?? 0)],
    ]),
  );
  for (const column of group.columns) {
    const type = metadata.schema[column.column];
    const columnNode = element("section", "layout-node column-node");
    columnNode.append(
      element(
        "h3",
        undefined,
        `Schema ${type?.name ?? String(column.column)} · ${kindName(type?.kind ?? -1)}`,
      ),
      propertyList([
        ["Chunk offset", column.chunk.offset],
        ["Chunk bytes", String(column.chunk.length)],
        ["Encoding", String(column.encoding.kind)],
        ["Byte order", column.chunk.littleEndian ? "little" : "big"],
        ["Null offset", String(column.chunk.nullOffset)],
        ["Null padding", String(column.chunk.nullsPadding)],
        ["Null alignment", String(column.chunk.nullAlignment)],
      ]),
    );
    const pixels = element("div", "pixels");
    for (const pixel of column.chunk.pixels) {
      const pixelNode = element("article", "pixel");
      pixelNode.append(
        element("strong", undefined, `Pixel ${String(pixel.index)}`),
        element("span", "numeric", `position ${String(pixel.position)}`),
        element(
          "code",
          undefined,
          pixel.statistics === null
            ? "statistics unavailable"
            : JSON.stringify(pixel.statistics),
        ),
      );
      pixels.append(pixelNode);
    }
    columnNode.append(pixels);
    groupNode.append(columnNode);
  }
  wrapper.append(groupNode);
  return wrapper;
}

function render(): void {
  root.replaceChildren();
  const header = element("header", "app-header");
  const title = element("div");
  title.append(
    element("h1", undefined, "Pixels PXL Inspector"),
    element(
      "p",
      "subtitle",
      state.source?.uri ?? "Portable Core · WASM",
    ),
  );
  header.append(
    title,
    button("Refresh", () => {
      vscode.postMessage({ kind: "refresh" });
    }),
  );
  root.append(header);

  if (state.error !== undefined) {
    const error = element("section", "banner error");
    error.append(
      element("strong", undefined, state.error.code),
      document.createTextNode(` — ${state.error.message}`),
    );
    root.append(error);
  } else if (state.loading !== undefined) {
    root.append(
      element("section", "banner loading", `Loading ${state.loading}…`),
    );
  }

  const tabs: readonly (readonly [Tab, string])[] = [
    ["overview", "Overview"],
    ["schema", "Schema"],
    ["rowGroups", "Row Groups"],
    ["preview", "Data Preview"],
    ["layout", "Physical Layout"],
  ];
  const navigation = element("nav", "tabs");
  navigation.setAttribute("aria-label", "Inspector views");
  for (const [tab, label] of tabs) {
    const tabButton = button(label, () => {
      state.tab = tab;
      render();
    });
    tabButton.classList.toggle("active", state.tab === tab);
    tabButton.setAttribute("aria-current", state.tab === tab ? "page" : "false");
    navigation.append(tabButton);
  }
  root.append(navigation);
  const content = element("main", "content");
  switch (state.tab) {
    case "overview":
      content.append(renderOverview());
      break;
    case "schema":
      content.append(renderSchema());
      break;
    case "rowGroups":
      content.append(renderRowGroups());
      break;
    case "preview":
      content.append(renderPreview());
      break;
    case "layout":
      content.append(renderLayout());
      break;
  }
  root.append(content);
}

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    return;
  }
  const value = message as Record<string, unknown>;
  const revision = value["revision"];
  if (
    typeof revision === "number" &&
    revision < state.revision
  ) {
    return;
  }
  if (typeof revision === "number") {
    state.revision = revision;
  }
  switch (value["kind"]) {
    case "loading":
      state.loading =
        typeof value["stage"] === "string" ? value["stage"] : "data";
      state.error = undefined;
      break;
    case "metadata":
      state.source = value["source"] as SourceSummary;
      state.capabilities = value["capabilities"] as CoreCapabilities;
      state.metadata = value["metadata"] as MetadataResult;
      state.rowGroup = undefined;
      state.page = undefined;
      state.loading = undefined;
      state.error = undefined;
      break;
    case "rowGroup":
      state.rowGroup = value["rowGroup"] as RowGroupResult;
      state.loading = undefined;
      break;
    case "page":
      state.page = value["page"] as PageResult;
      state.loading = undefined;
      break;
    case "empty":
      state.loading = undefined;
      break;
    case "error":
      state.loading = undefined;
      state.error = {
        code:
          typeof value["code"] === "string" ? value["code"] : "ERROR",
        message:
          typeof value["message"] === "string"
            ? value["message"]
            : "Unknown inspection failure",
        recoverable: value["recoverable"] === true,
      };
      break;
  }
  render();
});

render();
vscode.postMessage({ kind: "ready" });
