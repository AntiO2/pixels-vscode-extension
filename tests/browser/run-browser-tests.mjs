import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const mimeTypes = new Map([
  [".cjs", "text/javascript; charset=utf-8"],
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
    result.generations !== 2 ||
    result.rangeRequests !== 6 ||
    result.transferredBytes !== "802"
  ) {
    throw new Error(
      `unexpected browser worker metrics: ${JSON.stringify(result)}`,
    );
  }
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
