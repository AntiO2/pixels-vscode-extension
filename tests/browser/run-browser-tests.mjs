import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const visualValidationDirectory = path.join(root, "out", "visual-validation");
const mimeTypes = new Map([
  [".cjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".pxl", "application/octet-stream"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
]);

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/") {
      const html =
        "<!doctype html><meta charset=\"utf-8\">" +
        "<script type=\"module\" src=\"/dist/tests/browser-harness.js\"></script>";
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(html),
      });
      response.end(html);
      return;
    }
    if (requestUrl.pathname === "/webview") {
      const html = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/dist/webview/styles.css">
<body class="vscode-dark">
<div id="app"></div>
<script>
globalThis.webviewMessages = [];
globalThis.acquireVsCodeApi = () => ({
  postMessage(message) {
    globalThis.webviewMessages.push(message);
  }
});
</script>
<script src="/dist/webview/main.js"></script>`;
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(html),
      });
      response.end(html);
      return;
    }
    const relative = decodeURIComponent(requestUrl.pathname).replace(
      /^\/+/u,
      "",
    );
    const filePath = path.resolve(root, relative);
    if (
      filePath !== root &&
      !filePath.startsWith(`${root}${path.sep}`)
    ) {
      response.writeHead(403).end();
      return;
    }
    const bytes = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type":
        mimeTypes.get(path.extname(filePath)) ??
        "application/octet-stream",
      "content-length": bytes.byteLength,
      "cache-control": "no-store",
      "cross-origin-resource-policy": "same-origin",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (address === null || typeof address === "string") {
  throw new Error("browser test server did not expose a TCP port");
}

const themeCases = [
  {
    id: "dark",
    bodyClass: "vscode-dark",
    variables: {
      "--vscode-editor-background": "#17191d",
      "--vscode-sideBar-background": "#1d2025",
      "--vscode-editorWidget-background": "#20242a",
      "--vscode-foreground": "#d7dae0",
      "--vscode-descriptionForeground": "#9ca3af",
      "--vscode-panel-border": "#343840",
      "--vscode-contrastBorder": "#6b7280",
      "--vscode-focusBorder": "#3794ff",
      "--vscode-list-activeSelectionBackground": "#264f78",
      "--vscode-list-activeSelectionForeground": "#ffffff",
      "--vscode-list-hoverBackground": "#252a31",
      "--vscode-input-background": "#20242a",
      "--vscode-input-foreground": "#d7dae0",
      "--vscode-input-border": "#4b5563",
      "--vscode-editorStickyScroll-background": "#17191d",
      "--vscode-errorForeground": "#f48771",
      "--vscode-inputValidation-errorBackground": "#5a1d1d",
      "--vscode-editorWarning-foreground": "#cca700",
      "--vscode-textCodeBlock-background": "#20242a",
      "--vscode-disabledForeground": "#6b7280",
      "--vscode-font-family": "Arial, sans-serif",
      "--vscode-font-size": "13px",
      "--vscode-editor-font-family": "monospace",
    },
    expected: {
      canvas: "rgb(23, 25, 29)",
      surface: "rgb(29, 32, 37)",
      text: "rgb(215, 218, 224)",
      selected: "rgb(38, 79, 120)",
      border: "rgb(52, 56, 64)",
      control: "rgb(32, 36, 42)",
    },
  },
  {
    id: "light",
    bodyClass: "vscode-light",
    variables: {
      "--vscode-editor-background": "#ffffff",
      "--vscode-sideBar-background": "#f3f4f6",
      "--vscode-editorWidget-background": "#f8fafc",
      "--vscode-foreground": "#1f2937",
      "--vscode-descriptionForeground": "#5f6b76",
      "--vscode-panel-border": "#c7cdd4",
      "--vscode-contrastBorder": "#6b7280",
      "--vscode-focusBorder": "#005fb8",
      "--vscode-list-activeSelectionBackground": "#d6ebff",
      "--vscode-list-activeSelectionForeground": "#10253f",
      "--vscode-list-hoverBackground": "#e7f2fb",
      "--vscode-input-background": "#ffffff",
      "--vscode-input-foreground": "#1f2937",
      "--vscode-input-border": "#9ca3af",
      "--vscode-editorStickyScroll-background": "#f8fafc",
      "--vscode-errorForeground": "#b91c1c",
      "--vscode-inputValidation-errorBackground": "#fee2e2",
      "--vscode-editorWarning-foreground": "#8a6100",
      "--vscode-textCodeBlock-background": "#eef2f6",
      "--vscode-disabledForeground": "#7b8490",
      "--vscode-font-family": "Arial, sans-serif",
      "--vscode-font-size": "13px",
      "--vscode-editor-font-family": "monospace",
    },
    expected: {
      canvas: "rgb(255, 255, 255)",
      surface: "rgb(243, 244, 246)",
      text: "rgb(31, 41, 55)",
      selected: "rgb(214, 235, 255)",
      border: "rgb(199, 205, 212)",
      control: "rgb(255, 255, 255)",
    },
  },
  {
    id: "high-contrast",
    bodyClass: "vscode-high-contrast",
    variables: {
      "--vscode-editor-background": "#000000",
      "--vscode-sideBar-background": "#000000",
      "--vscode-editorWidget-background": "#000000",
      "--vscode-foreground": "#ffffff",
      "--vscode-descriptionForeground": "#ffffff",
      "--vscode-panel-border": "#ffffff",
      "--vscode-contrastBorder": "#f0f0f0",
      "--vscode-focusBorder": "#f38518",
      "--vscode-list-activeSelectionBackground": "#0f4a85",
      "--vscode-list-activeSelectionForeground": "#ffffff",
      "--vscode-list-hoverBackground": "#292929",
      "--vscode-input-background": "#000000",
      "--vscode-input-foreground": "#ffffff",
      "--vscode-input-border": "#f0f0f0",
      "--vscode-editorStickyScroll-background": "#000000",
      "--vscode-errorForeground": "#ff8080",
      "--vscode-inputValidation-errorBackground": "#000000",
      "--vscode-editorWarning-foreground": "#ffff00",
      "--vscode-textCodeBlock-background": "#000000",
      "--vscode-disabledForeground": "#c8c8c8",
      "--vscode-font-family": "Arial, sans-serif",
      "--vscode-font-size": "13px",
      "--vscode-editor-font-family": "monospace",
    },
    expected: {
      canvas: "rgb(0, 0, 0)",
      surface: "rgb(0, 0, 0)",
      text: "rgb(255, 255, 255)",
      selected: "rgb(15, 74, 133)",
      border: "rgb(240, 240, 240)",
      control: "rgb(0, 0, 0)",
    },
  },
];

function requireText(text, required, context) {
  const missing = required.filter((value) => !text.includes(value));
  if (missing.length > 0) {
    throw new Error(`${context} is missing: ${missing.join(", ")}`);
  }
}

async function assertNoPageOverflow(page, context) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: globalThis.document.body.clientWidth,
    bodyScrollWidth: globalThis.document.body.scrollWidth,
    rootClientWidth: globalThis.document.documentElement.clientWidth,
    rootScrollWidth: globalThis.document.documentElement.scrollWidth,
  }));
  if (
    dimensions.bodyScrollWidth > dimensions.bodyClientWidth + 1 ||
    dimensions.rootScrollWidth > dimensions.rootClientWidth + 1
  ) {
    throw new Error(
      `${context} has page-level horizontal overflow: ${JSON.stringify(dimensions)}`,
    );
  }
}

async function applyTheme(page, theme) {
  await page.evaluate(({ bodyClass, variables }) => {
    globalThis.document.body.className = bodyClass;
    for (const [name, value] of Object.entries(variables)) {
      globalThis.document.documentElement.style.setProperty(name, value);
    }
  }, theme);
}

async function assertThemeColors(page, theme) {
  const colors = await page.evaluate(() => {
    const color = (selector, property) => {
      const element = globalThis.document.querySelector(selector);
      if (element === null) {
        throw new Error(`theme color target is missing: ${selector}`);
      }
      return globalThis.getComputedStyle(element)[property];
    };
    return {
      canvas: color("body", "backgroundColor"),
      text: color("body", "color"),
      surface: color(".context-rail", "backgroundColor"),
      selected: color(
        ".mode-switch button[aria-current='page']",
        "backgroundColor",
      ),
      border: color(".mode-switch", "borderTopColor"),
      control: color(".query-builder input", "backgroundColor"),
    };
  });
  for (const [name, expected] of Object.entries(theme.expected)) {
    if (colors[name] !== expected) {
      throw new Error(
        `${theme.id} theme ${name} resolved to ${colors[name]}, expected ${expected}`,
      );
    }
  }
}

await fs.mkdir(visualValidationDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PIXELS_CHROMIUM_EXECUTABLE === undefined
    ? {}
    : { executablePath: process.env.PIXELS_CHROMIUM_EXECUTABLE }),
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${String(address.port)}/`);
  const result = await page.evaluate(async () => {
    return await globalThis.pixelsBrowserValidation;
  });
  if (
    result.generations !== 3 ||
    result.rangeRequests !== 14 ||
    result.transferredBytes !== "2558"
  ) {
    throw new Error(
      `unexpected browser worker metrics: ${JSON.stringify(result)}`,
    );
  }
  const webview = await browser.newPage();
  const runtimeErrors = [];
  webview.on("pageerror", (error) => {
    runtimeErrors.push(`pageerror: ${error.message}`);
  });
  webview.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`console: ${message.text()}`);
    }
  });
  await webview.goto(`http://127.0.0.1:${String(address.port)}/webview`);
  await webview.waitForFunction(() =>
    globalThis.webviewMessages?.some((message) => message.kind === "ready"),
  );
  await webview.evaluate((validation) => {
    const types = [
      "BOOLEAN", "BYTE", "SHORT", "INT", "LONG", "FLOAT", "DOUBLE",
      "STRING", "BINARY", "TIMESTAMP", "ARRAY", "MAP", "STRUCT",
      "VARBINARY", "DECIMAL", "DATE", "VARCHAR", "CHAR", "TIME",
      "VECTOR",
    ].map((name, kind) => ({ kind, name }));
    const emit = (data) => {
      globalThis.dispatchEvent(
        new globalThis.MessageEvent("message", { data }),
      );
    };
    emit({
      kind: "preferences",
      preferences: {
        pageSize: 100,
        orientation: "rows",
        timestampDisplay: "utc",
      },
    });
    emit({
      kind: "metadata",
      revision: 1,
      source: {
        uri: "vscode-vfs://fixture/tpch-lineitem.pxl",
        size: validation.lineitemSize,
        revision: `${validation.lineitemSize}:1`,
      },
      capabilities: {
        abi: 3,
        page: "generic-v1",
        rows: "rows-v1",
        filter: "filter-v1",
        rowGroup: "layout-v1",
        maxRows: 500,
        defaultRows: 100,
        types,
        encodings: ["NONE", "RUNLENGTH", "DICTIONARY"],
        compression: {
          metadata: ["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"],
          payload: "inactive",
          reason: "postscript-v1-unused",
        },
        nested: "portable-v1",
      },
      metadata: JSON.parse(validation.lineitemMetadata),
    });
    emit({
      kind: "rowGroup",
      revision: 1,
      rowGroup: JSON.parse(validation.lineitemRowGroup),
    });
    emit({
      kind: "page",
      revision: 1,
      page: JSON.parse(validation.lineitemPage),
    });
    emit({
      kind: "rows",
      revision: 1,
      rows: {
        operation: "rows-v1",
        rowGroup: 1,
        offset: "0",
        count: 2,
        columns: [
          { id: 0, name: "l_orderkey", kind: 4 },
          { id: 15, name: "l_comment", kind: 16 },
        ],
        rows: [
          {
            rowGroup: 1,
            localRow: "0",
            absoluteRow: "2",
            values: ["3", "third line"],
          },
          {
            rowGroup: 1,
            localRow: "1",
            absoluteRow: "3",
            values: ["4", "fourth line"],
          },
        ],
      },
    });
    emit({
      kind: "filter",
      revision: 1,
      filter: {
        operation: "filter-v1",
        columns: [
          { id: 0, name: "l_orderkey", kind: 4 },
          { id: 15, name: "l_comment", kind: 16 },
        ],
        rows: [
          {
            rowGroup: 1,
            localRow: "1",
            absoluteRow: "3",
            values: ["4", "fourth line"],
          },
        ],
        progress: {
          scannedRowGroups: 1,
          prunedRowGroups: 1,
          scannedRows: "2",
          prunedRows: "2",
        },
        matched: 1,
        completed: true,
        truncated: false,
        cursor: null,
      },
    });
  }, result);

  await webview.evaluate(async () => {
    await globalThis.document.fonts.ready;
  });

  const modeNavigation = webview.getByRole("navigation", {
    name: "Workspace mode",
  });
  for (const theme of themeCases) {
    const errorCountBeforeTheme = runtimeErrors.length;
    await webview.setViewportSize({ width: 1440, height: 900 });
    await applyTheme(webview, theme);

    await modeNavigation
      .getByRole("button", { name: "Analyze", exact: true })
      .click();
    const analyzeText = await webview.locator("main").innerText();
    requireText(
      analyzeText,
      [
        "File storage map",
        "column chunks",
        "pixel segments",
        "inactive in Pixels V1",
      ],
      `${theme.id} Analyze workspace`,
    );
    const hierarchy = webview.getByRole("navigation", {
      name: "Storage hierarchy",
    });
    requireText(
      await hierarchy.innerText(),
      ["File"],
      `${theme.id} storage breadcrumb`,
    );
    const schemaRail = webview.getByRole("complementary", {
      name: "File context",
    });
    const inspectorRail = webview.getByRole("complementary", {
      name: "Selection inspector",
    });
    if (!(await schemaRail.isVisible()) || !(await inspectorRail.isVisible())) {
      throw new Error(`${theme.id} Analyze side rails are not visible`);
    }
    requireText(
      await schemaRail.innerText(),
      ["Schema", "Row groups", "l_orderkey", "l_comment"],
      `${theme.id} Analyze schema rail`,
    );
    requireText(
      await inspectorRail.innerText(),
      [
        "Compression metadata",
        "inactive; payload decompression is not claimed",
        "NONE, ZLIB, SNAPPY, LZO, LZ4, ZSTD",
      ],
      `${theme.id} Analyze inspector rail`,
    );
    const fileMap = webview.locator("svg.file-map");
    const pixelMap = webview.locator("svg.pixel-map");
    if (!(await fileMap.isVisible()) || !(await pixelMap.isVisible())) {
      throw new Error(
        `${theme.id} Analyze semantic-zoom physical layout SVG is hidden`,
      );
    }
    const rowGroup = webview.getByRole("button", {
      name: "Row group 1, 2 rows, 270 data bytes",
      exact: true,
    });
    await rowGroup.click();
    if ((await rowGroup.getAttribute("aria-pressed")) !== "true") {
      throw new Error(`${theme.id} Analyze row group selection did not link`);
    }
    requireText(
      await hierarchy.innerText(),
      ["File", "Row group 1"],
      `${theme.id} selected storage breadcrumb`,
    );
    requireText(
      await inspectorRail.innerText(),
      ["Row group 1", "Rows", "2"],
      `${theme.id} selected row-group inspector`,
    );
    await assertNoPageOverflow(webview, `${theme.id} wide Analyze workspace`);
    await webview.screenshot({
      path: path.join(
        visualValidationDirectory,
        `${theme.id}-wide-analyze.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });

    await modeNavigation
      .getByRole("button", { name: "Data", exact: true })
      .click();
    const dataText = await webview.locator("main").innerText();
    requireText(
      dataText,
      [
        "Rows",
        "l_orderkey",
        "l_comment",
        "fourth line",
        "Rows per page",
      ],
      `${theme.id} Data Rows workspace`,
    );
    if (
      await webview
        .getByRole("grid", { name: "Projected row page" })
        .count() !== 1
    ) {
      throw new Error(`${theme.id} projected Rows table is unavailable`);
    }

    await modeNavigation
      .getByRole("button", { name: "Query", exact: true })
      .click();
    const queryText = await webview.locator("main").innerText();
    requireText(
      queryText,
      [
        "Typed file filter",
        "Run filter",
        "1 matches in this page",
        "fourth line",
        "Scan complete",
      ],
      `${theme.id} Query workspace`,
    );
    await assertThemeColors(webview, theme);
    await assertNoPageOverflow(webview, `${theme.id} wide Query workspace`);
    await webview.screenshot({
      path: path.join(
        visualValidationDirectory,
        `${theme.id}-wide-query.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });

    await webview.setViewportSize({ width: 640, height: 900 });
    await webview.evaluate(() => {
      globalThis.scrollTo(0, 0);
    });
    if (await inspectorRail.isVisible()) {
      await inspectorRail
        .getByRole("button", { name: "Close inspector", exact: true })
        .click();
    }
    await modeNavigation
      .getByRole("button", { name: "Data", exact: true })
      .click();
    await assertNoPageOverflow(webview, `${theme.id} narrow Data workspace`);
    const openContext = webview.getByRole("button", {
      name: "Open context rail",
      exact: true,
    });
    if (!(await openContext.isVisible())) {
      throw new Error(`${theme.id} narrow context drawer control is hidden`);
    }
    await openContext.click();
    const contextRail = webview.getByRole("complementary", {
      name: "File context",
    });
    if (!(await contextRail.isVisible())) {
      throw new Error(`${theme.id} narrow context drawer did not open`);
    }
    await contextRail
      .getByRole("button", { name: "Close context rail", exact: true })
      .click();
    await webview.screenshot({
      path: path.join(
        visualValidationDirectory,
        `${theme.id}-narrow-data.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
    if (runtimeErrors.length !== errorCountBeforeTheme) {
      throw new Error(
        `${theme.id} Webview emitted runtime errors: ${runtimeErrors
          .slice(errorCountBeforeTheme)
          .join(" | ")}`,
      );
    }
  }
  if (runtimeErrors.length > 0) {
    throw new Error(
      `Webview emitted runtime errors: ${runtimeErrors.join(" | ")}`,
    );
  }
  await webview.close();
  process.stdout.write(
    `${JSON.stringify({
      ...result,
      themes: themeCases.map((theme) => theme.id),
      screenshots: visualValidationDirectory,
    })}\n`,
  );
} finally {
  await browser.close();
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}
