import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
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
<body class="vscode-dark" style="--vscode-editor-background:#17191d;--vscode-sideBar-background:#1d2025;--vscode-foreground:#d7dae0;--vscode-descriptionForeground:#9ca3af;--vscode-panel-border:#343840;--vscode-focusBorder:#3794ff;--vscode-list-activeSelectionBackground:#264f78;--vscode-list-hoverBackground:#252a31;--vscode-input-background:#20242a;--vscode-input-foreground:#d7dae0">
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

  const analyzeText = await webview.locator("main").innerText();
  if (
    !analyzeText.includes("File storage map") ||
    !analyzeText.includes("column chunks") ||
    !analyzeText.includes("pixel segments") ||
    !analyzeText.includes("inactive in Pixels V1")
  ) {
    throw new Error("Analyze workspace did not render the storage hierarchy");
  }
  const hierarchy = await webview
    .getByRole("navigation", { name: "Storage hierarchy" })
    .innerText();
  if (!hierarchy.includes("File")) {
    throw new Error("storage breadcrumb is unavailable");
  }
  await webview.getByRole("button", { name: "Data" }).click();
  const dataText = await webview.locator("main").innerText();
  if (
    !dataText.includes("l_orderkey") ||
    !dataText.includes("l_comment") ||
    !dataText.includes("fourth line") ||
    !dataText.includes("Rows per page")
  ) {
    throw new Error("Data Rows mode did not render the projected result");
  }
  await webview.getByRole("button", { name: "Query" }).click();
  const queryText = await webview.locator("main").innerText();
  if (
    !queryText.includes("Typed file filter") ||
    !queryText.includes("1 matches in this page") ||
    !queryText.includes("fourth line") ||
    !queryText.includes("Scan complete")
  ) {
    throw new Error("Query mode did not render progress and typed results");
  }
  await webview.evaluate(() => {
    globalThis.document.body.className = "vscode-light";
    globalThis.document.body.style.setProperty(
      "--vscode-editor-background",
      "#ffffff",
    );
    globalThis.document.body.style.setProperty(
      "--vscode-sideBar-background",
      "#f3f4f6",
    );
    globalThis.document.body.style.setProperty(
      "--vscode-foreground",
      "#1f2937",
    );
  });
  const lightBackground = await webview
    .locator("body")
    .evaluate(
      (element) => globalThis.getComputedStyle(element).backgroundColor,
    );
  if (lightBackground !== "rgb(255, 255, 255)") {
    throw new Error("runtime Light theme variables did not update the Webview");
  }
  await webview.close();
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
