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
        abi: 2,
        page: "generic-v1",
        rowGroup: "layout-v1",
        types,
        encodings: ["NONE", "RUNLENGTH", "DICTIONARY"],
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
  }, result);

  await webview.getByRole("button", { name: "Schema" }).click();
  const schemaText = await webview.locator("main").innerText();
  if (
    !schemaText.includes("l_orderkey") ||
    !schemaText.includes("l_comment")
  ) {
    throw new Error("webview Schema view did not render lineitem columns");
  }
  await webview.getByRole("button", { name: "Row Groups" }).click();
  if (!(await webview.locator("main").innerText()).includes("Row group 1 layout")) {
    throw new Error("webview Row Groups view did not render lineitem layout");
  }
  await webview.getByRole("button", { name: "Data Preview" }).click();
  const previewText = await webview.locator("main").innerText();
  if (
    !previewText.includes("l_comment · VARCHAR") ||
    !previewText.includes("fourth line")
  ) {
    throw new Error("webview Data Preview did not render lineitem values");
  }
  await webview.getByRole("button", { name: "Physical Layout" }).click();
  const layoutText = await webview.locator("main").innerText();
  if (
    !layoutText.includes("Schema → Row Group → Chunk → Pixel") ||
    !layoutText.includes("Pixel 0")
  ) {
    throw new Error("webview Physical Layout hierarchy is incomplete");
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
