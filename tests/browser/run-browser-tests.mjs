import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const coreOverrideDirectory = process.env.PIXELS_SCAN_WASM_DIR;
let coreOverrideManifest;
if (coreOverrideDirectory !== undefined) {
  const wasm = await fs.readFile(
    path.join(coreOverrideDirectory, "pixels-inspector-wasm.wasm"),
  );
  coreOverrideManifest = Buffer.from(
    `${JSON.stringify({
      schemaVersion: 1,
      abiVersion: 4,
      coreCommit: "0".repeat(40),
      toolchain: {
        emscripten: "6.0.5",
        protobuf: "3.21.6",
      },
      capabilities: ["scan-v2"],
      artifacts: {
        "pixels-inspector-wasm.wasm": {
          bytes: wasm.byteLength,
          sha256: createHash("sha256").update(wasm).digest("hex"),
        },
      },
    })}\n`,
  );
}
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
    if (
      coreOverrideDirectory !== undefined &&
      requestUrl.pathname.startsWith("/resources/core/")
    ) {
      const name = path.posix.basename(requestUrl.pathname);
      const bytes =
        name === "core-manifest.json"
          ? coreOverrideManifest
          : name === "pixels-inspector-wasm.cjs" ||
              name === "pixels-inspector-wasm.wasm"
            ? await fs.readFile(path.join(coreOverrideDirectory, name))
            : undefined;
      if (bytes === undefined) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type":
          mimeTypes.get(path.extname(name)) ??
          "application/octet-stream",
        "content-length": bytes.byteLength,
        "cache-control": "no-store",
        "cross-origin-resource-policy": "same-origin",
      });
      response.end(bytes);
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
      canvas: "rgb(17, 23, 29)",
      surface: "rgb(24, 33, 41)",
      text: "rgb(237, 244, 249)",
      selected: "color(srgb 0.120314 0.213804 0.326431)",
      border: "rgb(52, 71, 83)",
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
      canvas: "rgb(247, 249, 251)",
      surface: "rgb(237, 242, 246)",
      text: "rgb(23, 33, 43)",
      selected: "color(srgb 0.76 0.849412 0.933176)",
      border: "rgb(199, 211, 220)",
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
      border: "rgb(255, 255, 255)",
      control: "rgb(0, 0, 0)",
    },
  },
];
const lightTheme = themeCases.find((theme) => theme.id === "light");
if (lightTheme === undefined) {
  throw new Error("light theme fixture is missing");
}
themeCases.push({
  ...lightTheme,
  id: "high-contrast-light",
  bodyClass: "vscode-high-contrast-light",
  expected: {
    ...lightTheme.expected,
    canvas: "rgb(255, 255, 255)",
    surface: "rgb(255, 255, 255)",
    text: "rgb(31, 41, 55)",
    selected: "rgb(214, 235, 255)",
    border: "rgb(31, 41, 55)",
  },
});
themeCases.push({
  ...lightTheme,
  id: "light-empty-optional-colors",
  variables: {
    ...lightTheme.variables,
    "--vscode-focusBorder": "",
    "--vscode-contrastBorder": "",
    "--vscode-contrastActiveBorder": "",
    "--vscode-sideBar-background": "",
    "--vscode-editorWidget-background": "",
    "--vscode-panel-border": "",
    "--vscode-widget-border": "",
    "--vscode-widget-shadow": "",
    "--vscode-editorHoverWidget-background": "",
    "--vscode-editorHoverWidget-border": "",
    "--vscode-charts-blue": "",
    "--vscode-charts-green": "",
    "--vscode-charts-foreground": "",
    "--vscode-textLink-foreground": "",
    "--vscode-textLink-activeForeground": "",
    "--vscode-list-activeSelectionBackground": "",
    "--vscode-list-activeSelectionForeground": "",
    "--vscode-list-focusBackground": "",
    "--vscode-list-focusForeground": "",
    "--vscode-list-focusOutline": "",
    "--vscode-list-hoverBackground": "",
    "--vscode-list-hoverForeground": "",
    "--vscode-selection-background": "",
    "--vscode-editor-selectionBackground": "",
    "--vscode-symbolIcon-classForeground": "",
    "--vscode-debugTokenExpression-value": "",
  },
});

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

async function assertAnalyzeStickyChrome(page, width, context) {
  await page.setViewportSize({ width, height: 700 });
  await page.evaluate(() => {
    globalThis.scrollTo(0, 0);
  });
  await page.evaluate(async () => {
    await new Promise((resolve) => globalThis.requestAnimationFrame(() => {
      globalThis.requestAnimationFrame(resolve);
    }));
  });
  const readGeometry = () => page.evaluate(() => {
    const bounds = (selector) => {
      const element = globalThis.document.querySelector(selector);
      if (element === null) {
        throw new Error(`sticky chrome target is missing: ${selector}`);
      }
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      };
    };
    const railBounds = (selector) => {
      const element = globalThis.document.querySelector(selector);
      if (
        element === null ||
        element.getAttribute("aria-hidden") === "true" ||
        globalThis.getComputedStyle(element).position !== "sticky"
      ) {
        return null;
      }
      return bounds(selector);
    };
    const breadcrumb = globalThis.document.querySelector(
      "nav[aria-label='Storage hierarchy']",
    );
    if (breadcrumb === null) {
      throw new Error("Analyze hierarchy breadcrumb is missing");
    }
    const chrome = bounds(".workspace-chrome");
    return {
      scrollY: globalThis.scrollY,
      viewportHeight: globalThis.innerHeight,
      documentHeight: globalThis.document.documentElement.scrollHeight,
      measuredChromeHeight: Number.parseFloat(
        globalThis.getComputedStyle(
          globalThis.document.querySelector(".app"),
        ).getPropertyValue("--px-workspace-chrome-height"),
      ),
      chrome,
      header: bounds(".instrument-header"),
      breadcrumb: bounds("nav[aria-label='Storage hierarchy']"),
      workspace: bounds(".workspace-shell"),
      context: railBounds(".context-rail"),
      inspector: railBounds(".inspector-panel"),
      breadcrumbClientWidth: breadcrumb.clientWidth,
      breadcrumbScrollWidth: breadcrumb.scrollWidth,
      breadcrumbScrollLeft: breadcrumb.scrollLeft,
      backdropFilter: globalThis.getComputedStyle(
        globalThis.document.querySelector(".workspace-chrome"),
      ).backdropFilter,
      borderColor: globalThis.getComputedStyle(
        globalThis.document.querySelector(".workspace-chrome"),
      ).borderBottomColor,
    };
  });
  const before = await readGeometry();
  const close = (left, right) => Math.abs(left - right) <= 1;
  if (
    !close(before.chrome.top, 0) ||
    !close(before.header.top, 0) ||
    !close(before.header.bottom, before.breadcrumb.top) ||
    !close(before.breadcrumb.bottom, before.chrome.bottom) ||
    !close(before.measuredChromeHeight, before.chrome.height) ||
    before.workspace.top < before.chrome.bottom - 1 ||
    before.documentHeight <= before.viewportHeight + 100
  ) {
    throw new Error(
      `${context} ${String(width)}px initial sticky stack is invalid: ${JSON.stringify(before)}`,
    );
  }
  await page.evaluate(() => {
    globalThis.scrollTo(0, globalThis.document.documentElement.scrollHeight);
  });
  await page.evaluate(async () => {
    await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
  });
  const after = await readGeometry();
  if (
    after.scrollY < 100 ||
    !close(after.header.top, before.header.top) ||
    !close(after.header.bottom, before.header.bottom) ||
    !close(after.breadcrumb.top, before.breadcrumb.top) ||
    !close(after.breadcrumb.bottom, before.breadcrumb.bottom)
  ) {
    throw new Error(
      `${context} ${String(width)}px chrome moved while scrolling: ${JSON.stringify({ before, after })}`,
    );
  }
  for (const [name, rail] of [
    ["Context", after.context],
    ["Inspector", after.inspector],
  ]) {
    if (
      rail !== null &&
      (!close(rail.top, after.chrome.bottom) ||
        !close(rail.bottom, after.viewportHeight))
    ) {
      throw new Error(
        `${context} ${String(width)}px ${name} rail is misaligned: ${JSON.stringify({ chrome: after.chrome, rail })}`,
      );
    }
  }
  if (width === 330) {
    if (after.breadcrumbScrollWidth <= after.breadcrumbClientWidth + 1) {
      throw new Error(`${context} compact breadcrumb no longer scrolls horizontally`);
    }
    await page.locator("nav[aria-label='Storage hierarchy']").evaluate(
      (element) => {
        element.scrollLeft = element.scrollWidth;
      },
    );
    const scrolledBreadcrumb = await readGeometry();
    if (
      scrolledBreadcrumb.breadcrumbScrollLeft <= 0 ||
      !close(scrolledBreadcrumb.breadcrumb.top, before.breadcrumb.top)
    ) {
      throw new Error(
        `${context} compact breadcrumb horizontal scroll broke stickiness: ${JSON.stringify(scrolledBreadcrumb)}`,
      );
    }
  }
  await page.evaluate(() => {
    globalThis.scrollTo(0, 0);
  });
  return after;
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
  const colors = await page.evaluate((variables) => {
    const color = (selector, property) => {
      const element = globalThis.document.querySelector(selector);
      if (element === null) {
        throw new Error(`theme color target is missing: ${selector}`);
      }
      return globalThis.getComputedStyle(element)[property];
    };
    const normalized = (value) => {
      const probe = globalThis.document.createElement("span");
      probe.style.color = value;
      globalThis.document.body.append(probe);
      const result = globalThis.getComputedStyle(probe).color;
      probe.remove();
      return result;
    };
    return {
      canvas: color("body", "backgroundColor"),
      text: color("body", "color"),
      surface: color(".query-builder", "backgroundColor"),
      selected: color(
        ".mode-switch button.is-current",
        "backgroundColor",
      ),
      selectedMarker: color(
        ".mode-switch button.is-current",
        "boxShadow",
      ),
      border: color(".mode-switch", "borderTopColor"),
      control: color(".query-builder input", "backgroundColor"),
      nativeCanvas: normalized(variables["--vscode-editor-background"]),
      nativeSurface: normalized(variables["--vscode-sideBar-background"]),
      nativeText: normalized(variables["--vscode-foreground"]),
      nativeSelected: normalized(
        variables["--vscode-list-activeSelectionBackground"],
      ),
      nativeBorder: normalized(variables["--vscode-panel-border"]),
      nativeControl: normalized(variables["--vscode-input-background"]),
    };
  }, theme.variables);
  for (const [name, expected] of Object.entries(theme.expected)) {
    if (colors[name] !== expected) {
      throw new Error(
        `${theme.id} theme ${name} resolved to ${colors[name]}, expected ${expected}`,
      );
    }
  }
  if (colors.selectedMarker === "none") {
    throw new Error(
      `${theme.id} active workspace mode lost its non-color marker`,
    );
  }
}

async function assertStorageMapPaint(page, themeId, state) {
  const selector = state === "selected"
    ? "svg.file-map g[role='button'][aria-pressed='true']"
    : "svg.file-map g[role='button'][aria-pressed='false']";
  const paint = await page.locator(selector).first()
    .evaluate((group) => {
      const rect = group.querySelector("rect");
      const label = group.querySelector("text");
      if (rect === null || label === null) {
        throw new Error("storage-map paint targets are missing");
      }
      const parseColor = (value) => {
        const rgb = /^rgba?\(([^)]+)\)$/u.exec(value);
        if (rgb !== null) {
          return rgb[1].split(/[ ,/]+/u).slice(0, 3).map(Number);
        }
        const srgb = /^color\(srgb ([^ )]+) ([^ )]+) ([^ )]+)/u.exec(value);
        if (srgb !== null) {
          return srgb.slice(1, 4).map((channel) => Number(channel) * 255);
        }
        throw new Error(`unsupported computed color: ${value}`);
      };
      const luminance = (channels) => {
        const linear = channels.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const fill = globalThis.getComputedStyle(rect).fill;
      const text = globalThis.getComputedStyle(label).fill;
      const stroke = globalThis.getComputedStyle(rect).stroke;
      const fillChannels = parseColor(fill);
      const textChannels = parseColor(text);
      const lighter = Math.max(luminance(fillChannels), luminance(textChannels));
      const darker = Math.min(luminance(fillChannels), luminance(textChannels));
      return {
        fill,
        text,
        stroke,
        contrast: (lighter + 0.05) / (darker + 0.05),
        black: fillChannels.every((channel) => channel < 1),
      };
    });
  const expected =
    state === "selected"
      ? {
        fill: "rgb(189, 220, 242)",
        text: "rgb(16, 42, 67)",
      }
      : state === "hover"
        ? {
            fill: "rgb(216, 234, 250)",
            text: "rgb(23, 50, 77)",
          }
        : {
            fill: "rgb(231, 241, 248)",
            text: "rgb(23, 50, 77)",
          };
  if (
    paint.fill !== expected.fill ||
    paint.text !== expected.text ||
    paint.stroke !== "rgb(103, 137, 164)" ||
    paint.black ||
    paint.contrast < 4.5
  ) {
    throw new Error(
      `${themeId} ${state} storage-map paint is unreadable: ${JSON.stringify(paint)}`,
    );
  }
}

async function assertExactValueTooltip(page, tooltip, compact, context) {
  const geometry = await tooltip.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const code = element.querySelector("code");
    if (code === null) {
      throw new Error("exact-value tooltip code is missing");
    }
    const codeBounds = code.getBoundingClientRect();
    const lineHeight = Number.parseFloat(globalThis.getComputedStyle(code).lineHeight);
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      width: bounds.width,
      codeWidth: codeBounds.width,
      codeHeight: codeBounds.height,
      lineHeight,
      viewportWidth: globalThis.document.documentElement.clientWidth,
      viewportHeight: globalThis.document.documentElement.clientHeight,
    };
  });
  if (
    geometry.left < 0 ||
    geometry.top < 0 ||
    geometry.right > geometry.viewportWidth + 0.5 ||
    geometry.bottom > geometry.viewportHeight + 0.5 ||
    geometry.width < (compact ? geometry.viewportWidth - 24 : 400) ||
    geometry.codeWidth < (compact ? 260 : 360) ||
    geometry.codeHeight > geometry.lineHeight * 4.2
  ) {
    throw new Error(
      `${context} exact-value tooltip geometry collapsed or overflowed: ${JSON.stringify(geometry)}`,
    );
  }
}

async function assertInstalledSurfaceHierarchy(page, themeId) {
  const colors = await page.evaluate(() => {
    const color = (selector, property) => {
      const element = globalThis.document.querySelector(selector);
      if (element === null) {
        throw new Error(`surface hierarchy target is missing: ${selector}`);
      }
      return globalThis.getComputedStyle(element)[property];
    };
    return {
      canvas: color(".primary-workspace", "backgroundColor"),
      summary: color(".summary-strip", "backgroundColor"),
      context: color(".context-rail", "backgroundColor"),
      inspector: color(".inspector-panel", "backgroundColor"),
      contextBorder: color(".context-rail", "borderRightColor"),
      inspectorBorder: color(".inspector-panel", "borderLeftColor"),
    };
  });
  const transparent = new Set(["transparent", "rgba(0, 0, 0, 0)"]);
  if (
    transparent.has(colors.canvas) ||
    transparent.has(colors.summary) ||
    transparent.has(colors.context) ||
    transparent.has(colors.inspector) ||
    transparent.has(colors.contextBorder) ||
    transparent.has(colors.inspectorBorder) ||
    colors.canvas === colors.summary ||
    colors.canvas === colors.context ||
    colors.summary === colors.context ||
    colors.context !== colors.inspector
  ) {
    throw new Error(
      `${themeId} installed-like surface hierarchy collapsed: ${JSON.stringify(colors)}`,
    );
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
    result.generations !== 5 ||
    result.rangeRequests < 73 ||
    BigInt(result.transferredBytes) < 6802n
  ) {
    throw new Error(
      `unexpected browser worker metrics: ${JSON.stringify(result)}`,
    );
  }
  const webview = await browser.newPage();
  await webview.context().grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: `http://127.0.0.1:${String(address.port)}` },
  );
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
        abi: 4,
        page: "generic-v1",
        rows: "rows-v1",
        filter: "filter-v1",
        scan: "scan-v2",
        rowGroup: "layout-v1",
        maxRows: 500,
        defaultRows: 100,
        defaultScanRows: 20,
        maxScanRows: 500,
        maxProjectionColumns: 128,
        maxExpressionNodes: 64,
        maxOrderKeys: 8,
        maxOrderedWindowRows: 4096,
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

  const dataLifecycleWebview = await browser.newPage();
  await dataLifecycleWebview.goto(
    `http://127.0.0.1:${String(address.port)}/webview`,
  );
  await dataLifecycleWebview
    .getByRole("tab", { name: "Data", exact: true })
    .click();
  await dataLifecycleWebview.evaluate((validation) => {
    const emit = (data) => globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", { data }),
    );
    const types = [
      "BOOLEAN", "BYTE", "SHORT", "INT", "LONG", "FLOAT", "DOUBLE",
      "STRING", "BINARY", "TIMESTAMP", "ARRAY", "MAP", "STRUCT",
      "VARBINARY", "DECIMAL", "DATE", "VARCHAR", "CHAR", "TIME",
      "VECTOR",
    ].map((name, kind) => ({ kind, name }));
    globalThis.dataLifecycleMetadata = {
      kind: "metadata",
      revision: 1,
      source: {
        uri: "vscode-vfs://fixture/data-lifecycle.pxl",
        size: validation.lineitemSize,
        revision: "data-lifecycle:1",
      },
      capabilities: {
        abi: 4,
        page: "generic-v1",
        rows: "rows-v1",
        filter: "filter-v1",
        scan: "scan-v2",
        rowGroup: "layout-v1",
        maxRows: 500,
        defaultRows: 100,
        defaultScanRows: 20,
        maxScanRows: 500,
        maxProjectionColumns: 128,
        maxExpressionNodes: 64,
        maxOrderKeys: 8,
        maxOrderedWindowRows: 4096,
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
    };
    emit({
      kind: "preferences",
      preferences: {
        pageSize: 25,
        orientation: "column",
        timestampDisplay: "utc",
      },
    });
    emit(globalThis.dataLifecycleMetadata);
  }, result);
  await dataLifecycleWebview.waitForTimeout(50);
  const initialDataReads = await dataLifecycleWebview.evaluate(() =>
    globalThis.webviewMessages.filter(
      (message) => message.kind === "select" || message.kind === "selectRows",
    ));
  if (
    initialDataReads.length !== 1 ||
    initialDataReads[0].kind !== "select" ||
    initialDataReads[0].rowGroup !== 0 ||
    initialDataReads[0].column !== 0 ||
    initialDataReads[0].rowOffset !== "0" ||
    initialDataReads[0].rowCount !== 2
  ) {
    throw new Error(
      `pre-metadata Data entry did not issue one configured default read: ${JSON.stringify(initialDataReads)}`,
    );
  }
  await dataLifecycleWebview
    .getByRole("tab", { name: "Analyze", exact: true })
    .click();
  await dataLifecycleWebview
    .getByRole("tab", { name: "Data", exact: true })
    .click();
  await dataLifecycleWebview.waitForTimeout(50);
  const revisitDataReadCount = await dataLifecycleWebview.evaluate(() =>
    globalThis.webviewMessages.filter(
      (message) => message.kind === "select" || message.kind === "selectRows",
    ).length);
  if (revisitDataReadCount !== 1) {
    throw new Error("Data revisit repeated the automatic configured read");
  }
  await dataLifecycleWebview.evaluate(() => {
    globalThis.dispatchEvent(new globalThis.MessageEvent("message", {
      data: {
        kind: "error",
        revision: 2,
        code: "IO_ERROR",
        message: "read failed",
        recoverable: true,
      },
    }));
  });
  await dataLifecycleWebview.locator(".status-banner.error").waitFor({
    state: "visible",
  });
  await dataLifecycleWebview.locator(".status-banner.error button").click();
  await dataLifecycleWebview.waitForTimeout(50);
  const retryDataReadCount = await dataLifecycleWebview.evaluate(() =>
    globalThis.webviewMessages.filter(
      (message) => message.kind === "select" || message.kind === "selectRows",
    ).length);
  if (retryDataReadCount !== 2) {
    throw new Error("Data retry did not issue exactly one explicit repeat read");
  }
  await dataLifecycleWebview.evaluate((validation) => {
    const emit = (data) => globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", { data }),
    );
    emit({
      kind: "page",
      revision: 3,
      page: JSON.parse(validation.lineitemPage),
    });
    emit({ ...globalThis.dataLifecycleMetadata, revision: 3 });
  }, result);
  await dataLifecycleWebview
    .getByRole("tab", { name: "Analyze", exact: true })
    .click();
  await dataLifecycleWebview
    .getByRole("tab", { name: "Data", exact: true })
    .click();
  await dataLifecycleWebview.waitForTimeout(50);
  const replayDataReadCount = await dataLifecycleWebview.evaluate(() =>
    globalThis.webviewMessages.filter(
      (message) => message.kind === "select" || message.kind === "selectRows",
    ).length);
  if (replayDataReadCount !== 2) {
    throw new Error("same-source metadata replay discarded or reloaded Data");
  }
  await dataLifecycleWebview.evaluate(() => {
    const emit = (data) => globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", { data }),
    );
    emit({ kind: "loading", revision: 4, stage: "source" });
    emit({
      ...globalThis.dataLifecycleMetadata,
      revision: 4,
      source: {
        ...globalThis.dataLifecycleMetadata.source,
        revision: "data-lifecycle:2",
      },
    });
  });
  await dataLifecycleWebview.waitForTimeout(50);
  const refreshedDataReadCount = await dataLifecycleWebview.evaluate(() =>
    globalThis.webviewMessages.filter(
      (message) => message.kind === "select" || message.kind === "selectRows",
    ).length);
  if (refreshedDataReadCount !== 3) {
    throw new Error("accepted Data source refresh did not re-arm one read");
  }
  await dataLifecycleWebview.evaluate(() => {
    const emit = (data) => globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", { data }),
    );
    emit({ kind: "loading", revision: 5, stage: "source" });
    emit({
      ...globalThis.dataLifecycleMetadata,
      revision: 5,
      source: {
        ...globalThis.dataLifecycleMetadata.source,
        revision: "data-lifecycle:empty",
      },
      metadata: {
        ...globalThis.dataLifecycleMetadata.metadata,
        rowGroups: [],
        rowGroupCount: 0,
        rowGroupStatistics: [],
      },
    });
  });
  await dataLifecycleWebview.getByText(
    "This file has no Row Groups to browse.",
    { exact: true },
  ).waitFor({ state: "visible" });
  await dataLifecycleWebview.waitForTimeout(50);
  const emptyDataReadCount = await dataLifecycleWebview.evaluate(() =>
    globalThis.webviewMessages.filter(
      (message) => message.kind === "select" || message.kind === "selectRows",
    ).length);
  if (emptyDataReadCount !== 3) {
    throw new Error("empty Data source emitted a row request");
  }
  await dataLifecycleWebview.evaluate((validation) => {
    const emit = (data) => globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", { data }),
    );
    emit({
      kind: "preferences",
      preferences: {
        pageSize: 25,
        orientation: "rows",
        timestampDisplay: "utc",
      },
    });
    emit({ kind: "loading", revision: 6, stage: "source" });
    globalThis.customerLifecycleMetadata = {
      ...globalThis.dataLifecycleMetadata,
      revision: 6,
      source: {
        uri: "vscode-vfs://fixture/customer-lifecycle.pxl",
        size: validation.customerSize,
        revision: "customer-lifecycle:1",
      },
      metadata: JSON.parse(validation.customerMetadata),
    };
    emit(globalThis.customerLifecycleMetadata);
  }, result);
  await dataLifecycleWebview.waitForTimeout(50);
  const customerLifecycleReads = await dataLifecycleWebview.evaluate(() =>
    globalThis.webviewMessages.filter(
      (message) => message.kind === "select" || message.kind === "selectRows",
    ));
  const customerLifecycleRead = customerLifecycleReads.at(-1);
  if (
    customerLifecycleReads.length !== 4 ||
    customerLifecycleRead?.kind !== "selectRows" ||
    JSON.stringify(customerLifecycleRead.columns) !==
      JSON.stringify([0, 1, 2, 3, 4, 5]) ||
    customerLifecycleRead.rowCount !== 25
  ) {
    throw new Error(
      `lineitem-to-customer lifecycle retained numeric projection IDs: ${JSON.stringify(customerLifecycleReads)}`,
    );
  }
  await dataLifecycleWebview.evaluate((validation) => {
    globalThis.dispatchEvent(new globalThis.MessageEvent("message", {
      data: {
        kind: "rows",
        revision: 6,
        rows: JSON.parse(validation.customerRows),
      },
    }));
  }, result);
  await dataLifecycleWebview.locator(".columns-control > summary").click();
  await dataLifecycleWebview
    .locator(".columns-control input[type='checkbox']")
    .evaluateAll((checkboxes) => {
      for (const checkbox of checkboxes) {
        if (checkbox.checked && !checkbox.closest("label")?.textContent?.startsWith("c_custkey")) {
          checkbox.click();
        }
      }
    });
  await dataLifecycleWebview.waitForTimeout(150);
  const differentShapeStart = await dataLifecycleWebview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await dataLifecycleWebview.evaluate(() => {
    const emit = (data) => globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", { data }),
    );
    emit({ kind: "loading", revision: 7, stage: "source" });
    emit({
      ...globalThis.customerLifecycleMetadata,
      revision: 7,
      source: {
        uri: "vscode-vfs://fixture/different-customer-shape.pxl",
        size: globalThis.customerLifecycleMetadata.source.size,
        revision: "customer-lifecycle:2",
      },
      metadata: {
        ...globalThis.customerLifecycleMetadata.metadata,
        schema: globalThis.customerLifecycleMetadata.metadata.schema.map(
          (type) => ({ ...type, name: `replacement_${type.name}` }),
        ),
      },
    });
  });
  await dataLifecycleWebview.waitForTimeout(50);
  const differentShapeReads = await dataLifecycleWebview.evaluate((start) =>
    globalThis.webviewMessages.slice(start).filter(
      (message) => message.kind === "selectRows" || message.kind === "select",
    ), differentShapeStart);
  if (
    differentShapeReads.length !== 1 ||
    differentShapeReads[0].kind !== "selectRows" ||
    JSON.stringify(differentShapeReads[0].columns) !==
      JSON.stringify([0, 1, 2, 3, 4, 5])
  ) {
    throw new Error(
      `customer-to-different-shape replacement mapped overlapping IDs: ${JSON.stringify(differentShapeReads)}`,
    );
  }
  await dataLifecycleWebview.close();

  await webview.evaluate(async () => {
    await globalThis.document.fonts.ready;
  });
  await applyTheme(webview, themeCases[0]);
  await webview.emulateMedia({ reducedMotion: "reduce" });
  const reducedTransition = await webview
    .locator(".mode-switch button")
    .first()
    .evaluate((element) => globalThis.getComputedStyle(element).transitionDuration);
  if (
    !reducedTransition.split(",").every((duration) => {
      const value = duration.trim();
      const milliseconds = value.endsWith("ms")
        ? Number.parseFloat(value)
        : value.endsWith("s")
          ? Number.parseFloat(value) * 1_000
          : Number.NaN;
      return Number.isFinite(milliseconds) && milliseconds <= 0.01;
    })
  ) {
    throw new Error(`reduced-motion transition remained active: ${reducedTransition}`);
  }
  await webview.emulateMedia({ reducedMotion: "no-preference" });
  const mediaSession = await webview.context().newCDPSession(webview);
  await mediaSession.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-transparency", value: "reduce" },
    ],
  });
  const reducedTransparency = await webview
    .locator(".workspace-chrome")
    .evaluate((element) => ({
      backdropFilter: globalThis.getComputedStyle(element).backdropFilter,
      backgroundColor: globalThis.getComputedStyle(element).backgroundColor,
    }));
  if (
    reducedTransparency.backdropFilter !== "none" ||
    reducedTransparency.backgroundColor === "rgba(0, 0, 0, 0)"
  ) {
    throw new Error(
      `reduced-transparency chrome remained translucent: ${JSON.stringify(reducedTransparency)}`,
    );
  }
  const reducedTransparencySource = webview
    .locator(".summary-strip .property")
    .filter({
      has: webview.locator("dt").filter({ hasText: /^Source$/u }),
    })
    .locator(".exact-value-preview");
  await reducedTransparencySource.focus();
  const reducedTransparencyTooltip = webview.getByRole("tooltip");
  await reducedTransparencyTooltip.waitFor({ state: "visible" });
  const reducedTransparencyTooltipPaint = await reducedTransparencyTooltip
    .evaluate((element) => ({
      backdropFilter: globalThis.getComputedStyle(element).backdropFilter,
      backgroundColor: globalThis.getComputedStyle(element).backgroundColor,
    }));
  if (
    reducedTransparencyTooltipPaint.backdropFilter !== "none" ||
    reducedTransparencyTooltipPaint.backgroundColor === "rgba(0, 0, 0, 0)"
  ) {
    throw new Error(
      `reduced-transparency ExactValue remained glass: ${JSON.stringify(reducedTransparencyTooltipPaint)}`,
    );
  }
  await webview.keyboard.press("Escape");
  await mediaSession.send("Emulation.setEmulatedMedia", { features: [] });
  await mediaSession.detach();

  const modeNavigation = webview.getByRole("tablist", {
    name: "Workspace mode",
  });

  const loadedDataRevisitStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await modeNavigation
    .getByRole("tab", { name: "Data", exact: true })
    .click();
  await webview.waitForTimeout(50);
  const loadedDataRevisitReads = await webview.evaluate((start) =>
    globalThis.webviewMessages.slice(start).filter(
      (message) => message.kind === "selectRows" || message.kind === "select",
    ), loadedDataRevisitStart);
  if (loadedDataRevisitReads.length !== 0) {
    throw new Error(
      `entering Data with a current page repeated the read: ${JSON.stringify(loadedDataRevisitReads)}`,
    );
  }
  const dataTab = modeNavigation.getByRole("tab", {
    name: "Data",
    exact: true,
  });
  await dataTab.hover();
  await webview.mouse.down();
  const pressedTransform = await dataTab.evaluate(
    (element) => globalThis.getComputedStyle(element).transform,
  );
  await webview.mouse.up();
  if (pressedTransform === "none") {
    throw new Error("workspace tab did not respond on pointer-down");
  }
  await dataTab.focus();
  const firstQueryEntryStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await dataTab.press("ArrowRight");
  if (
    (await modeNavigation
      .getByRole("tab", { name: "Query", exact: true })
      .getAttribute("aria-selected")) !== "true"
  ) {
    throw new Error("workspace tab ArrowRight navigation failed");
  }
  await webview.waitForTimeout(50);
  const firstEntryScans = await webview.evaluate((start) =>
    globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "runScan"),
  firstQueryEntryStart);
  if (
    firstEntryScans.length !== 1 ||
    firstEntryScans[0].plan.projection.kind !== "all" ||
    firstEntryScans[0].plan.limit !== 20
  ) {
    throw new Error(
      `first Query entry did not auto-run one default scan: ${JSON.stringify(firstEntryScans)}`,
    );
  }
  await modeNavigation
    .getByRole("tab", { name: "Query", exact: true })
    .press("Home");
  if (
    (await modeNavigation
      .getByRole("tab", { name: "Analyze", exact: true })
      .getAttribute("aria-selected")) !== "true"
  ) {
    throw new Error("workspace tab Home navigation failed");
  }
  await modeNavigation
    .getByRole("tab", { name: "Analyze", exact: true })
    .press("End");
  if (
    (await modeNavigation
      .getByRole("tab", { name: "Query", exact: true })
      .getAttribute("aria-selected")) !== "true"
  ) {
    throw new Error("workspace tab End navigation failed");
  }
  await webview.waitForTimeout(50);
  const revisitScans = await webview.evaluate((start) =>
    globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "runScan"),
  firstQueryEntryStart);
  if (revisitScans.length !== 1) {
    throw new Error("revisiting Query repeated the automatic default scan");
  }
  const cancelBorder = await webview
    .getByRole("button", { name: "Cancel", exact: true })
    .evaluate((element) => {
      const probe = globalThis.document.createElement("span");
      probe.style.color = globalThis.getComputedStyle(
        globalThis.document.documentElement,
      ).getPropertyValue("--vscode-editorWarning-foreground").trim();
      globalThis.document.body.append(probe);
      const warning = globalThis.getComputedStyle(probe).color;
      probe.remove();
      return {
        border: globalThis.getComputedStyle(element).borderTopColor,
        warning,
      };
    });
  if (cancelBorder.border === cancelBorder.warning) {
    throw new Error("ordinary Query cancellation retained warning styling");
  }
  await webview.evaluate(() => {
    globalThis.dispatchEvent(new globalThis.MessageEvent("message", {
      data: { kind: "scanCancelled", revision: 1 },
    }));
  });
  await dataTab.click();
  const projectedRows = webview
    .getByRole("grid", { name: "Projected row page" })
    .locator("tbody tr");
  if (
    JSON.stringify(await projectedRows.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("tabindex")),
    )) !== JSON.stringify(["0", "-1"])
  ) {
    throw new Error("projected rows did not expose one roving tab stop");
  }
  await projectedRows.first().focus();
  await projectedRows.first().press("ArrowDown");
  if (!(await projectedRows.nth(1).evaluate((row) => row.matches(":focus")))) {
    throw new Error("projected row ArrowDown navigation did not move focus");
  }
  const orientationControl = webview.getByRole("radiogroup", {
    name: "Data orientation",
  });
  const rowsOrientation = orientationControl.getByRole("radio", {
    name: "Rows",
    exact: true,
  });
  const columnOrientation = orientationControl.getByRole("radio", {
    name: "Column",
    exact: true,
  });
  if (
    (await rowsOrientation.getAttribute("aria-checked")) !== "true" ||
    (await columnOrientation.getAttribute("tabindex")) !== "-1"
  ) {
    throw new Error("Data segmented control did not expose roving radio state");
  }
  await rowsOrientation.focus();
  await rowsOrientation.press("End");
  if (
    (await columnOrientation.getAttribute("aria-checked")) !== "true" ||
    !(await columnOrientation.evaluate((element) =>
      element.matches(":focus"),
    ))
  ) {
    throw new Error("End did not select and focus Column orientation");
  }
  if (
    await webview.getByText("Column", { exact: true }).count() < 2 ||
    await webview.getByText("Focused column", { exact: true }).count() !== 0
  ) {
    throw new Error(
      "Column orientation did not expose the immediate Column selector",
    );
  }
  const columnRequestStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await webview
    .locator(".data-toolbar label")
    .filter({ hasText: /^Column/u })
    .locator("select")
    .selectOption("15");
  const columnRequests = await webview.evaluate((start) => {
    return globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "select");
  }, columnRequestStart);
  if (
    columnRequests.length !== 1 ||
    columnRequests[0].column !== 15 ||
    columnRequests[0].rowOffset !== "0"
  ) {
    throw new Error(
      `Column selection did not load immediately: ${JSON.stringify(columnRequests)}`,
    );
  }
  await columnOrientation.press("Home");
  if (
    (await rowsOrientation.getAttribute("aria-checked")) !== "true" ||
    !(await rowsOrientation.evaluate((element) => element.matches(":focus")))
  ) {
    throw new Error("Home did not select and focus Rows orientation");
  }
  if (await webview.getByText("Focused column", { exact: true }).count() !== 0) {
    throw new Error("Rows orientation exposed the irrelevant Column selector");
  }
  if (await webview.getByText("Timestamp display", { exact: true }).count() !== 0) {
    throw new Error("Data exposed timestamp controls without a visible timestamp column");
  }
  const pageSizeRequestStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await webview.getByLabel("Rows per page").selectOption("25");
  const pageSizeRequests = await webview.evaluate((start) => {
    return globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "selectRows");
  }, pageSizeRequestStart);
  if (
    pageSizeRequests.length !== 1 ||
    pageSizeRequests[0].rowOffset !== "0" ||
    pageSizeRequests[0].rowCount !== 2
  ) {
    throw new Error(
      `page-size change did not load the bounded current Row Group: ${JSON.stringify(pageSizeRequests)}`,
    );
  }

  await webview.locator(".projection-editor summary").click();
  const projectionEditor = webview.locator(".projection-editor");
  const reorderRequestStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await webview
    .getByRole("button", { name: "Move l_comment up", exact: true })
    .click();
  const reorderedHeaders = await webview
    .getByRole("grid", { name: "Projected row page" })
    .locator("th")
    .allInnerTexts();
  if (
    !reorderedHeaders[1]?.startsWith("l_comment") ||
    !reorderedHeaders[2]?.startsWith("l_orderkey")
  ) {
    throw new Error(
      `projection header order did not update immediately: ${JSON.stringify(reorderedHeaders)}`,
    );
  }
  const reorderedValues = await webview
    .getByRole("grid", { name: "Projected row page" })
    .locator("tbody tr")
    .first()
    .locator("td")
    .allInnerTexts();
  if (
    reorderedValues[1] !== "third line" ||
    reorderedValues[2] !== "3"
  ) {
    throw new Error(
      `projection reorder broke row/value association: ${JSON.stringify(reorderedValues)}`,
    );
  }
  await webview.waitForTimeout(150);
  const reorderRequests = await webview.evaluate((start) => {
    return globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "selectRows");
  }, reorderRequestStart);
  if (reorderRequests.length !== 0) {
    throw new Error(
      `projection reorder performed an unnecessary read: ${JSON.stringify(reorderRequests)}`,
    );
  }

  await webview
    .getByRole("button", { name: "Move l_comment down", exact: true })
    .click();
  const removalRequestStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await projectionEditor
    .getByRole("checkbox", { name: /^l_comment\b/u })
    .click();
  await webview.waitForTimeout(150);
  const removalRequests = await webview.evaluate((start) => {
    return globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "selectRows");
  }, removalRequestStart);
  const removalHeaders = await webview
    .getByRole("grid", { name: "Projected row page" })
    .locator("th")
    .allInnerTexts();
  if (
    removalRequests.length !== 0 ||
    removalHeaders.length !== 2 ||
    !removalHeaders[1]?.startsWith("l_orderkey")
  ) {
    throw new Error(
      `projection removal was not a local hide: ${JSON.stringify({ removalRequests, removalHeaders })}`,
    );
  }

  const cachedAddStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await projectionEditor
    .getByRole("checkbox", { name: /^l_comment\b/u })
    .click();
  await webview.waitForTimeout(150);
  const cachedAddRequests = await webview.evaluate((start) => {
    return globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "selectRows");
  }, cachedAddStart);
  if (cachedAddRequests.length !== 0) {
    throw new Error(
      `re-adding a cached column performed an unnecessary read: ${JSON.stringify(cachedAddRequests)}`,
    );
  }

  const uncachedAddStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await projectionEditor.locator("input[type='checkbox']").evaluateAll(
    (checkboxes) => {
      for (const checkbox of checkboxes) {
        const label = checkbox.closest("label")?.textContent ?? "";
        if (
          !checkbox.checked &&
          (label.startsWith("l_partkey") || label.startsWith("l_suppkey"))
        ) {
          checkbox.click();
        }
      }
    },
  );
  await webview
    .getByText("Updating columns…", { exact: true })
    .waitFor({ state: "visible" });
  await webview.waitForTimeout(150);
  const uncachedAddRequests = await webview.evaluate((start) => {
    return globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "selectRows");
  }, uncachedAddStart);
  if (
    uncachedAddRequests.length !== 1 ||
    JSON.stringify(uncachedAddRequests[0].columns) !==
      JSON.stringify([0, 15, 1, 2]) ||
    uncachedAddRequests[0].rowOffset !== "0"
  ) {
    throw new Error(
      `uncached additions did not coalesce to one latest read: ${JSON.stringify(uncachedAddRequests)}`,
    );
  }
  await projectionEditor
    .getByRole("checkbox", { name: /^l_partkey\b/u })
    .click();
  await projectionEditor
    .getByRole("checkbox", { name: /^l_suppkey\b/u })
    .click();

  await webview.evaluate(() => {
    globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", {
        data: {
          kind: "rows",
          revision: 1,
          rows: {
            operation: "rows-v1",
            rowGroup: 1,
            offset: "1",
            count: 1,
            columns: [
              { id: 0, name: "l_orderkey", kind: 4 },
              { id: 15, name: "l_comment", kind: 16 },
            ],
            rows: [{
              rowGroup: 1,
              localRow: "1",
              absoluteRow: "3",
              values: ["4", "fourth line"],
            }],
          },
        },
      }),
    );
  });
  const currentWindowAddStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await projectionEditor
    .getByRole("checkbox", { name: /^l_partkey\b/u })
    .click();
  await webview.waitForTimeout(150);
  const currentWindowRequests = await webview.evaluate((start) => {
    return globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "selectRows");
  }, currentWindowAddStart);
  if (
    currentWindowRequests.length !== 1 ||
    currentWindowRequests[0].rowOffset !== "1" ||
    currentWindowRequests[0].rowCount !== 1
  ) {
    throw new Error(
      `projection miss changed the current page window: ${JSON.stringify(currentWindowRequests)}`,
    );
  }
  await projectionEditor
    .getByRole("checkbox", { name: /^l_partkey\b/u })
    .click();

  const emptyRequestStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await projectionEditor
    .getByRole("checkbox", { name: /^l_comment\b/u })
    .click();
  await projectionEditor
    .getByRole("checkbox", { name: /^l_orderkey\b/u })
    .click();
  await webview.waitForTimeout(150);
  if (
    !(await webview
      .getByText(
        "Select at least one column in Columns to preview rows. No request is sent for an empty projection.",
        {
        exact: true,
        },
      )
      .isVisible())
  ) {
    throw new Error("empty projection did not expose its explicit empty state");
  }
  const emptyRequests = await webview.evaluate((start) => {
    return globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "selectRows");
  }, emptyRequestStart);
  if (emptyRequests.length !== 0) {
    throw new Error(
      `empty projection emitted an invalid request: ${JSON.stringify(emptyRequests)}`,
    );
  }

  await projectionEditor
    .getByRole("checkbox", { name: /^l_orderkey\b/u })
    .click();
  await projectionEditor
    .getByRole("checkbox", { name: /^l_comment\b/u })
    .click();
  await webview.waitForTimeout(150);
  await webview.evaluate(() => {
    globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", {
        data: {
          kind: "rows",
          revision: 0,
          rows: {
            operation: "rows-v1",
            rowGroup: 1,
            offset: "0",
            count: 1,
            columns: [
              { id: 0, name: "l_orderkey", kind: 4 },
              { id: 15, name: "l_comment", kind: 16 },
            ],
            rows: [{
              rowGroup: 1,
              localRow: "0",
              absoluteRow: "0",
              values: ["0", "STALE RESPONSE"],
            }],
          },
        },
      }),
    );
  });
  if ((await webview.locator("main").innerText()).includes("STALE RESPONSE")) {
    throw new Error("a stale projection response replaced the current rows");
  }
  await webview
    .getByRole("button", { name: "Copy page as TSV", exact: true })
    .click();
  await webview
    .getByRole("button", { name: "Copied", exact: true })
    .waitFor({ state: "visible" });

  const dataHeadersBeforeQueryOrder = await webview
    .getByRole("grid", { name: "Projected row page" })
    .getByRole("columnheader")
    .allInnerTexts();
  const queryOrderMessageStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await modeNavigation
    .getByRole("tab", { name: "Query", exact: true })
    .click();
  await webview.getByRole("button", { name: "Run scan", exact: true }).waitFor();
  const queryOutputDisclosure = webview.locator(
    "button[aria-controls='query-projection-panel']",
  );
  await queryOutputDisclosure.click();
  const embeddedQueryColumns = webview.locator(
    "#query-projection-panel .columns-control",
  );
  if (
    await embeddedQueryColumns.count() !== 1 ||
    await webview.locator("#query-projection-panel details").count() !== 0 ||
    await embeddedQueryColumns.locator(":scope > summary").count() !== 0
  ) {
    throw new Error("Query Output columns rendered a nested disclosure");
  }
  await embeddedQueryColumns
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  const queryOrderkeyItem = embeddedQueryColumns
    .locator(".projection-item")
    .first();
  const queryOrderkeyName = queryOrderkeyItem.locator(
    ".projection-column-name",
  );
  const queryShortName = embeddedQueryColumns.locator(
    ".projection-column-name",
    { hasText: /^l_tax$/u },
  );
  if ((await queryShortName.getAttribute("class"))?.includes("is-truncated")) {
    throw new Error("short Query column name was incorrectly marked truncated");
  }
  await queryShortName.hover();
  await webview.waitForTimeout(120);
  if (await webview.getByRole("tooltip").count() !== 0) {
    throw new Error("short Query column name exposed a full-name tooltip");
  }
  await queryOrderkeyName.evaluate((element) => {
    element.style.width = "42px";
  });
  await webview.waitForFunction((element) =>
    element.classList.contains("is-truncated"),
  await queryOrderkeyName.elementHandle());
  const queryNameBounds = await queryOrderkeyName.boundingBox();
  if (queryNameBounds === null) {
    throw new Error("truncated Query column name has no geometry");
  }
  const pointerStart = {
    x: queryNameBounds.x + 5,
    y: queryNameBounds.y + 5,
  };
  await webview.mouse.move(pointerStart.x, pointerStart.y);
  const queryNameTooltip = webview.getByRole("tooltip");
  await queryNameTooltip.waitFor({ state: "visible" });
  if (
    (await queryNameTooltip.innerText()) !== "l_orderkey" ||
    (await queryNameTooltip.getAttribute("data-origin")) !== "pointer"
  ) {
    throw new Error("truncated Query column hover did not reveal its full name");
  }
  const pointerPlacement = await queryNameTooltip.evaluate((element, point) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      viewportWidth: globalThis.document.documentElement.clientWidth,
      viewportHeight: globalThis.document.documentElement.clientHeight,
      coversPointer:
        point.x >= bounds.left && point.x <= bounds.right &&
        point.y >= bounds.top && point.y <= bounds.bottom,
    };
  }, pointerStart);
  if (
    pointerPlacement.coversPointer ||
    pointerPlacement.left < 0 ||
    pointerPlacement.top < 0 ||
    pointerPlacement.right > pointerPlacement.viewportWidth ||
    pointerPlacement.bottom > pointerPlacement.viewportHeight
  ) {
    throw new Error(
      `Query pointer tooltip placement is invalid: ${JSON.stringify(pointerPlacement)}`,
    );
  }
  const pointerMoved = {
    x: queryNameBounds.x + queryNameBounds.width - 3,
    y: queryNameBounds.y + queryNameBounds.height - 3,
  };
  await webview.mouse.move(pointerMoved.x, pointerMoved.y);
  await webview.waitForFunction((previousLeft) => {
    const tooltip = globalThis.document.querySelector("[role='tooltip']");
    return tooltip !== null &&
      Math.abs(tooltip.getBoundingClientRect().left - previousLeft) > 4;
  }, pointerPlacement.left);
  const edgePointer = await webview.evaluate(() => ({
    x: globalThis.document.documentElement.clientWidth - 3,
    y: globalThis.document.documentElement.clientHeight - 3,
  }));
  await queryOrderkeyName.dispatchEvent("pointermove", {
    bubbles: true,
    clientX: edgePointer.x,
    clientY: edgePointer.y,
    pointerType: "mouse",
  });
  await webview.waitForTimeout(30);
  const edgeTooltipPlacement = await queryNameTooltip.evaluate(
    (element, point) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        viewportWidth: globalThis.document.documentElement.clientWidth,
        viewportHeight: globalThis.document.documentElement.clientHeight,
        flippedLeft: bounds.right < point.x,
        flippedAbove: bounds.bottom < point.y,
        coversPointer:
          point.x >= bounds.left && point.x <= bounds.right &&
          point.y >= bounds.top && point.y <= bounds.bottom,
      };
    },
    edgePointer,
  );
  if (
    !edgeTooltipPlacement.flippedLeft ||
    !edgeTooltipPlacement.flippedAbove ||
    edgeTooltipPlacement.coversPointer ||
    edgeTooltipPlacement.left < 0 ||
    edgeTooltipPlacement.top < 0 ||
    edgeTooltipPlacement.right > edgeTooltipPlacement.viewportWidth ||
    edgeTooltipPlacement.bottom > edgeTooltipPlacement.viewportHeight
  ) {
    throw new Error(
      `Query edge tooltip did not flip/clamp: ${JSON.stringify(edgeTooltipPlacement)}`,
    );
  }
  await webview.mouse.move(0, 0);
  await webview.waitForTimeout(120);
  const queryOrderkeyCheckbox = queryOrderkeyItem.getByRole("checkbox");
  if (await queryOrderkeyCheckbox.isChecked()) {
    throw new Error("cleared Query column unexpectedly remained selected");
  }
  await queryOrderkeyName.dispatchEvent("pointerdown", {
    bubbles: true,
    pointerType: "touch",
  });
  await queryOrderkeyName.dispatchEvent("click", { bubbles: true });
  await queryNameTooltip.waitFor({ state: "visible" });
  if (
    (await queryNameTooltip.getAttribute("data-origin")) !== "focus" ||
    await queryOrderkeyCheckbox.isChecked()
  ) {
    throw new Error(
      "touch reveal either missed the Query tooltip or toggled its checkbox",
    );
  }
  await webview.locator(".primary-workspace").dispatchEvent("pointerdown", {
    bubbles: true,
    pointerType: "touch",
  });
  await queryNameTooltip.waitFor({ state: "hidden" });
  await queryOrderkeyName.evaluate((element) => {
    element.style.removeProperty("width");
  });
  await embeddedQueryColumns
    .getByRole("button", { name: "Select all", exact: true })
    .click();
  const queryPartKey = embeddedQueryColumns.getByRole("checkbox", {
    name: /^l_partkey\b/u,
  });
  await queryPartKey.click();
  if (!(await queryOutputDisclosure.innerText()).includes("15 selected")) {
    throw new Error("Query partial projection was not retained");
  }
  await queryPartKey.click();
  if (
    !(await queryOutputDisclosure.innerText()).includes("16 selected") ||
    (await queryOutputDisclosure.innerText()).includes("All columns")
  ) {
    throw new Error("full custom membership was incorrectly canonicalized to all");
  }
  await embeddedQueryColumns
    .getByRole("button", { name: "Select all", exact: true })
    .click();
  if (!(await queryOutputDisclosure.innerText()).includes("All columns (16)")) {
    throw new Error("Query Select all did not reset canonical schema order");
  }
  const moveFirstUp = embeddedQueryColumns.getByRole("button", {
    name: "Move l_orderkey up",
    exact: true,
  });
  const moveLastDown = embeddedQueryColumns.getByRole("button", {
    name: "Move l_comment down",
    exact: true,
  });
  if (!(await moveFirstUp.isDisabled()) || !(await moveLastDown.isDisabled())) {
    throw new Error("Query projection move boundaries were not disabled");
  }
  const moveCommentUp = embeddedQueryColumns.getByRole("button", {
    name: "Move l_comment up",
    exact: true,
  });
  await moveCommentUp.click();
  if (
    await webview.evaluate(() =>
      globalThis.document.activeElement?.getAttribute("aria-label"),
    ) !== "Move l_comment up"
  ) {
    throw new Error("Query projection reorder did not preserve keyboard focus");
  }
  const selectedQueryNames = await embeddedQueryColumns
    .locator(".projection-item.is-selected label > span:first-of-type")
    .allInnerTexts();
  if (
    selectedQueryNames.at(-2) !== "l_comment" ||
    selectedQueryNames.at(-1) !== "l_shipmode"
  ) {
    throw new Error(
      `Query projection did not reorder immediately: ${JSON.stringify(selectedQueryNames)}`,
    );
  }
  const queryDraftScans = await webview.evaluate((start) =>
    globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "runScan"),
  queryOrderMessageStart);
  if (queryDraftScans.length !== 0) {
    throw new Error(
      `Query projection draft edit issued I/O: ${JSON.stringify(queryDraftScans)}`,
    );
  }
  await modeNavigation.getByRole("tab", { name: "Data", exact: true }).click();
  const dataHeadersAfterQueryOrder = await webview
    .getByRole("grid", { name: "Projected row page" })
    .getByRole("columnheader")
    .allInnerTexts();
  if (
    JSON.stringify(dataHeadersAfterQueryOrder) !==
      JSON.stringify(dataHeadersBeforeQueryOrder)
  ) {
    throw new Error("Query projection reorder mutated Data column order");
  }
  await modeNavigation.getByRole("tab", { name: "Query", exact: true }).click();
  const revisitedQueryNames = await embeddedQueryColumns
    .locator(".projection-item.is-selected label > span:first-of-type")
    .allInnerTexts();
  if (JSON.stringify(revisitedQueryNames) !== JSON.stringify(selectedQueryNames)) {
    throw new Error("Query projection order was lost on mode revisit");
  }
  await queryOutputDisclosure.click();
  const orderedRunStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await webview.getByRole("button", { name: "Run scan", exact: true }).click();
  const expectedCustomOrder = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 14,
  ];
  const orderedRun = await webview.evaluate((start) =>
    globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "runScan"),
  orderedRunStart);
  if (
    orderedRun.length !== 1 ||
    orderedRun[0].plan.projection.kind !== "columns" ||
    JSON.stringify(orderedRun[0].plan.projection.columns) !==
      JSON.stringify(expectedCustomOrder)
  ) {
    throw new Error(
      `Query Run lost the full custom projection: ${JSON.stringify(orderedRun)}`,
    );
  }
  await webview.evaluate(({ validation, projection }) => {
    const metadata = JSON.parse(validation.lineitemMetadata);
    const cursor = JSON.parse(validation.customerScan).page.cursor;
    const byId = new Map(metadata.schema.map((column) => [column.id, column]));
    const columns = projection.map((id) => {
      const column = byId.get(id);
      if (column === undefined) {
        throw new Error(`missing schema column ${String(id)}`);
      }
      return { id: column.id, name: column.name, kind: column.kind };
    });
    const values = projection.map((id) =>
      id === 0 ? "4" : id === 15 ? "fourth line" : null,
    );
    globalThis.dispatchEvent(new globalThis.MessageEvent("message", {
      data: {
        kind: "scan",
        revision: 1,
        elapsedMs: 4,
        scan: {
          operation: "scan-v2",
          columns,
          rows: [{
            rowGroup: 1,
            localRow: "1",
            absoluteRow: "3",
            values,
          }],
          page: {
            offsetApplied: "0",
            limit: 20,
            returned: 1,
            continuationAvailable: true,
            hasMoreExact: false,
            cursor,
          },
          scan: { ordered: false, completion: "limit" },
          progress: {
            rowGroupsTotal: 2,
            rowGroupsConsidered: 1,
            scannedRowGroups: 1,
            prunedRowGroups: 0,
            rowsTotal: "4",
            scannedRows: "2",
            prunedRows: "0",
            matchedRows: "1",
          },
        },
      },
    }));
  }, { validation: result, projection: expectedCustomOrder });
  await webview.getByText("1 rows returned", { exact: true }).waitFor();
  const queryResultHeaders = await webview
    .getByRole("grid", { name: "Projected row page" })
    .getByRole("columnheader")
    .allInnerTexts();
  if (
    !queryResultHeaders.at(-2)?.startsWith("l_comment") ||
    !queryResultHeaders.at(-1)?.startsWith("l_shipmode")
  ) {
    throw new Error(
      `Query result table lost projection order: ${JSON.stringify(queryResultHeaders)}`,
    );
  }
  const continuationStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await webview.getByRole("button", { name: "Continue", exact: true }).click();
  const continuationRuns = await webview.evaluate((start) =>
    globalThis.webviewMessages
      .slice(start)
      .filter((message) => message.kind === "runScan"),
  continuationStart);
  if (
    continuationRuns.length !== 1 ||
    continuationRuns[0].plan.projection.kind !== "columns" ||
    JSON.stringify(continuationRuns[0].plan.projection.columns) !==
      JSON.stringify(expectedCustomOrder) ||
    typeof continuationRuns[0].plan.cursor !== "string"
  ) {
    throw new Error(
      `Query continuation lost submitted projection order: ${JSON.stringify(continuationRuns)}`,
    );
  }
  await webview.evaluate(() => {
    globalThis.dispatchEvent(new globalThis.MessageEvent("message", {
      data: { kind: "scanCancelled", revision: 1 },
    }));
  });
  await queryOutputDisclosure.click();
  await embeddedQueryColumns
    .getByRole("button", { name: "Select all", exact: true })
    .click();
  if (!(await queryOutputDisclosure.innerText()).includes("All columns (16)")) {
    throw new Error("Select all did not restore canonical all after continuation");
  }
  await queryOutputDisclosure.click();

  for (const theme of themeCases) {
    const errorCountBeforeTheme = runtimeErrors.length;
    await webview.setViewportSize({ width: 1440, height: 900 });
    await applyTheme(webview, theme);

    await modeNavigation
      .getByRole("tab", { name: "Analyze", exact: true })
      .click();
    const analyzeText = await webview.locator("main").innerText();
    requireText(
      analyzeText,
      [
        "File storage map",
        "column chunks",
        "% of Row Group chunk bytes",
        "pixel segments",
        "inactive in Pixels V1",
      ],
      `${theme.id} Analyze workspace`,
    );
    const summaryProperties = webview.locator(".summary-strip .property");
    const sourceProperty = summaryProperties.filter({
      has: webview.locator("dt").filter({ hasText: /^Source$/u }),
    });
    const formatProperty = summaryProperties.filter({
      has: webview.locator("dt").filter({ hasText: /^Format$/u }),
    });
    const sourceValue = sourceProperty.locator(".exact-value-preview");
    const formatValue = formatProperty.locator(".exact-value-preview");
    if (
      !(await sourceValue.getAttribute("class"))?.includes("is-truncated") ||
      (await sourceValue.getAttribute("tabindex")) !== "0" ||
      (await formatValue.getAttribute("class"))?.includes("is-truncated") ||
      (await formatValue.getAttribute("tabindex")) !== null ||
      await webview.getByLabel(/^Show full /u).count() !== 0
    ) {
      throw new Error(`${theme.id} ExactValue truncation affordance is incorrect`);
    }
    await formatValue.hover();
    await webview.waitForTimeout(120);
    if (await webview.getByRole("tooltip").count() !== 0) {
      throw new Error(`${theme.id} non-truncated Format exposed a full-value tooltip`);
    }
    await sourceValue.hover();
    const sourceTooltip = webview.getByRole("tooltip");
    await sourceTooltip.waitFor({ state: "visible" });
    if (!(await sourceTooltip.innerText()).includes("vscode-vfs://fixture/")) {
      throw new Error(`${theme.id} exact source tooltip lost the full URI`);
    }
    await assertExactValueTooltip(
      webview,
      sourceTooltip,
      false,
      `${theme.id} wide`,
    );
    await sourceTooltip.hover();
    await webview.waitForTimeout(150);
    if (!(await sourceTooltip.isVisible())) {
      throw new Error(`${theme.id} exact source tooltip flickered across its gap`);
    }
    if (theme.bodyClass.includes("high-contrast")) {
      const highContrastPaint = await sourceTooltip.evaluate((element) => ({
        backdrop: globalThis.getComputedStyle(element).backdropFilter,
        border: globalThis.getComputedStyle(element).borderTopColor,
      }));
      if (
        highContrastPaint.backdrop !== "none" ||
        highContrastPaint.border === "rgba(0, 0, 0, 0)"
      ) {
        throw new Error(
          `${theme.id} exact source tooltip lost its solid HC boundary`,
        );
      }
    }
    await webview.mouse.move(0, 0);
    await webview.waitForTimeout(150);
    if (await sourceTooltip.count() !== 0) {
      throw new Error(`${theme.id} exact source hover tooltip did not dismiss`);
    }
    await sourceValue.focus();
    await sourceTooltip.waitFor({ state: "visible" });
    await webview.keyboard.press("Escape");
    if (
      await sourceTooltip.count() !== 0 ||
      !(await sourceValue.evaluate((element) => element.matches(":focus")))
    ) {
      throw new Error(`${theme.id} ExactValue Escape did not dismiss and retain focus`);
    }
    const formatCopy = formatProperty.getByRole("button", {
      name: "Copy Format",
      exact: true,
    });
    await formatCopy.click();
    await formatProperty.getByRole("button", {
      name: "Copied Format",
      exact: true,
    }).waitFor();
    if (await webview.getByRole("tooltip").count() !== 0) {
      throw new Error(`${theme.id} independent Format copy opened a tooltip`);
    }
    await formatProperty.evaluate((element) => {
      element.style.width = "68px";
    });
    await webview.waitForFunction((element) =>
      element.classList.contains("is-truncated"),
    await formatValue.elementHandle());
    await formatValue.focus();
    await webview.getByRole("tooltip").waitFor({ state: "visible" });
    await webview.keyboard.press("Escape");
    await formatProperty.evaluate((element) => {
      element.style.removeProperty("width");
    });
    await webview.waitForFunction((element) =>
      !element.classList.contains("is-truncated"),
    await formatValue.elementHandle());
    const hierarchy = webview.getByRole("navigation", {
      name: "Storage hierarchy",
    });
    await hierarchy
      .getByRole("button", { name: "File", exact: true })
      .click();
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
    if (theme.id === "light-empty-optional-colors") {
      await assertInstalledSurfaceHierarchy(webview, theme.id);
    }
    requireText(
      await schemaRail.innerText(),
      ["Schema", "Row groups", "l_orderkey", "l_comment"],
      `${theme.id} Analyze schema rail`,
    );
    const schemaFilter = schemaRail.getByRole("searchbox", {
      name: "Filter schema",
    });
    await schemaFilter.fill("comment");
    if (
      await schemaRail.getByText("l_comment", { exact: true }).count() !== 1 ||
      await schemaRail.getByText("l_orderkey", { exact: true }).count() !== 0
    ) {
      throw new Error(`${theme.id} Analyze schema filter did not respond`);
    }
    await schemaFilter.fill("");
    requireText(
      await inspectorRail.innerText(),
      [
        "Essentials",
        "More details",
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
    if (theme.id === "light-empty-optional-colors") {
      await webview.waitForTimeout(180);
      await assertStorageMapPaint(webview, theme.id, "normal");
      await webview
        .locator("svg.file-map g[role='button'][aria-pressed='false']")
        .first()
        .hover();
      await webview.waitForTimeout(180);
      await assertStorageMapPaint(webview, theme.id, "hover");
    }
    await rowGroup.click();
    if ((await rowGroup.getAttribute("aria-pressed")) !== "true") {
      throw new Error(`${theme.id} Analyze row group selection did not link`);
    }
    if (theme.id === "light-empty-optional-colors") {
      await webview.waitForTimeout(180);
      await assertStorageMapPaint(webview, theme.id, "selected");
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
      .getByRole("tab", { name: "Data", exact: true })
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
    if (
      await webview.getByRole("complementary").count() !== 0 ||
      await webview.getByText("Active projection", { exact: true }).count() !== 0
    ) {
      throw new Error(
        `${theme.id} Data retained Analyze rails or the duplicate projection list`,
      );
    }
    await webview.locator(".columns-control > summary").click();
    await webview.screenshot({
      path: path.join(
        visualValidationDirectory,
        `${theme.id}-wide-data-columns.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });

    await modeNavigation
      .getByRole("tab", { name: "Query", exact: true })
      .click();
    const outputDisclosure = webview.locator(
      "button[aria-controls='query-projection-panel']",
    );
    await outputDisclosure.click();
    const queryColumns = webview.locator(
      "#query-projection-panel .columns-control",
    );
    if (
      await queryColumns.count() !== 1 ||
      await webview.locator("#query-projection-panel details").count() !== 0 ||
      await webview.getByText("All root columns", { exact: true }).count() !== 0 ||
      await webview.getByText("Choose columns", { exact: true }).count() !== 0
    ) {
      throw new Error("Query rendered a duplicate all/choose projection control");
    }
    const projectionEditStart = await webview.evaluate(
      () => globalThis.webviewMessages.length,
    );
    const queryComment = queryColumns.getByRole("checkbox", {
      name: /^l_comment\b/u,
    });
    await queryComment.click();
    if (!(await outputDisclosure.innerText()).includes("15 selected")) {
      throw new Error("Query partial Columns selection was not summarized");
    }
    await queryComment.click();
    if (!(await outputDisclosure.innerText()).includes("All columns (16)")) {
      throw new Error("Query Select all state did not canonicalize to all columns");
    }
    if (
      await webview.evaluate((start) =>
        globalThis.webviewMessages
          .slice(start)
          .some((message) => message.kind === "runScan"),
      projectionEditStart)
    ) {
      throw new Error("Query Columns editing issued a speculative scan");
    }
    await outputDisclosure.click();
    const queryEditStart = await webview.evaluate(
      () => globalThis.webviewMessages.length,
    );
    await webview
      .getByRole("button", { name: /Where All rows/u })
      .click();
    await webview
      .getByRole("button", { name: "Add condition", exact: true })
      .click();
    const predicateColumn = webview.getByLabel("Predicate column", {
      exact: true,
    });
    const predicateColumnLabel = predicateColumn.locator("..")
      .filter({ has: predicateColumn });
    await predicateColumnLabel.evaluate((element) => {
      element.style.width = "86px";
    });
    await webview.waitForFunction((element) =>
      element.classList.contains("is-truncated"),
    await predicateColumnLabel.elementHandle());
    await webview.setViewportSize({ width: 330, height: 727 });
    await predicateColumn.hover();
    const predicateTooltip = webview.getByRole("tooltip");
    await predicateTooltip.waitFor({ state: "visible" });
    if (!(await predicateTooltip.innerText()).includes("l_orderkey · LONG")) {
      throw new Error("narrow Where column did not reveal its full selected label");
    }
    const narrowPredicateGeometry = await predicateTooltip.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        viewportWidth: globalThis.document.documentElement.clientWidth,
        viewportHeight: globalThis.document.documentElement.clientHeight,
      };
    });
    if (
      narrowPredicateGeometry.left < 0 ||
      narrowPredicateGeometry.top < 0 ||
      narrowPredicateGeometry.right > narrowPredicateGeometry.viewportWidth ||
      narrowPredicateGeometry.bottom > narrowPredicateGeometry.viewportHeight
    ) {
      throw new Error(
        `narrow Where tooltip escaped the viewport: ${JSON.stringify(narrowPredicateGeometry)}`,
      );
    }
    await webview.mouse.move(0, 0);
    await webview.waitForTimeout(120);
    await predicateColumn.focus();
    await predicateTooltip.waitFor({ state: "visible" });
    if (
      (await predicateTooltip.getAttribute("data-origin")) !== "focus" ||
      (await predicateColumn.getAttribute("aria-describedby")) !==
        (await predicateTooltip.getAttribute("id"))
    ) {
      throw new Error("Where native select lost its focus-anchored description");
    }
    await webview.keyboard.press("Escape");
    if (
      !(await predicateColumn.evaluate((element) => element.matches(":focus"))) ||
      await predicateTooltip.count() !== 0 ||
      await predicateColumn.getAttribute("aria-describedby") !== null
    ) {
      throw new Error(
        "Where tooltip Escape did not dismiss cleanly or retain native select focus",
      );
    }
    await predicateColumn.selectOption("1");
    if (
      await predicateColumn.inputValue() !== "1" ||
      !(await predicateColumnLabel.innerText()).includes("l_partkey · LONG")
    ) {
      throw new Error("Where column wrapper replaced native select semantics");
    }
    await predicateColumn.selectOption("0");
    await webview.setViewportSize({ width: 1440, height: 900 });
    await predicateColumnLabel.evaluate((element) => {
      element.style.removeProperty("width");
    });
    if (
      await webview.evaluate((start) =>
        globalThis.webviewMessages
          .slice(start)
          .some((message) => message.kind === "runScan"),
      queryEditStart)
    ) {
      throw new Error("Query draft editing issued a speculative scan");
    }
    await webview
      .getByRole("button", { name: "Remove condition", exact: true })
      .click();
    await webview
      .getByRole("button", { name: /Where All rows/u })
      .click();
    await webview
      .getByRole("button", { name: /Order by Natural file order/u })
      .click();
    await webview
      .getByRole("button", { name: "Add order key", exact: true })
      .click();
    const orderColumn = webview.getByLabel("Order key 1 column", {
      exact: true,
    });
    const orderColumnLabel = orderColumn.locator("..")
      .filter({ has: orderColumn });
    await orderColumnLabel.evaluate((element) => {
      element.style.width = "86px";
    });
    await webview.waitForFunction((element) =>
      element.classList.contains("is-truncated"),
    await orderColumnLabel.elementHandle());
    await orderColumn.hover();
    const orderColumnTooltip = webview.getByRole("tooltip");
    await orderColumnTooltip.waitFor({ state: "visible" });
    if (!(await orderColumnTooltip.innerText()).includes("l_orderkey · LONG")) {
      throw new Error("Order by column did not reveal its full selected label");
    }
    await webview.mouse.move(0, 0);
    await webview.waitForTimeout(120);
    await webview
      .getByRole("button", { name: "Remove order key 1", exact: true })
      .click();
    await webview
      .getByRole("button", { name: /Order by Natural file order/u })
      .click();
    const queryRequestStart = await webview.evaluate(
      () => globalThis.webviewMessages.length,
    );
    await webview.getByRole("button", { name: "Run scan", exact: true }).click();
    const scanRequests = await webview.evaluate((start) => {
      return globalThis.webviewMessages
        .slice(start)
        .filter((message) => message.kind === "runScan");
    }, queryRequestStart);
    if (
      scanRequests.length !== 1 ||
      scanRequests[0].plan.projection.kind !== "all" ||
      scanRequests[0].plan.offset !== "0" ||
      scanRequests[0].plan.limit !== 20 ||
      scanRequests[0].plan.orderBy.length !== 0
    ) {
      throw new Error(
        `Query did not submit the canonical default scan: ${JSON.stringify(scanRequests)}`,
      );
    }
    await webview.evaluate(() => {
      const emit = (data) => {
        globalThis.dispatchEvent(
          new globalThis.MessageEvent("message", { data }),
        );
      };
      emit({
        kind: "scanProgress",
        revision: 2,
        elapsedMs: 750,
        progress: {
          phase: "scanning",
          rowGroupsTotal: 2,
          rowGroupsConsidered: 1,
          scannedRowGroups: 1,
          prunedRowGroups: 0,
          currentRowGroup: 0,
          retainedCandidates: 1,
          rowsTotal: "4",
          scannedRows: "2",
          prunedRows: "0",
          matchedRows: "1",
        },
      });
      emit({
        kind: "scan",
        revision: 2,
        elapsedMs: 900,
        scan: {
          operation: "scan-v2",
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
          page: {
            offsetApplied: "0",
            limit: 20,
            returned: 1,
            continuationAvailable: false,
            hasMoreExact: true,
            cursor: null,
          },
          scan: { ordered: false, completion: "complete" },
          progress: {
            rowGroupsTotal: 2,
            rowGroupsConsidered: 2,
            scannedRowGroups: 1,
            prunedRowGroups: 1,
            rowsTotal: "4",
            scannedRows: "2",
            prunedRows: "2",
            matchedRows: "1",
          },
        },
      });
    });
    await webview
      .getByText("1 rows returned", { exact: true })
      .waitFor();
    await webview
      .getByRole("button", { name: "Run scan", exact: true })
      .waitFor();
    const queryText = await webview.locator("main").innerText();
    requireText(
      queryText,
      [
        "Scan file",
        "Output columns",
        "All columns",
        "Run scan",
        "1 rows returned",
        "fourth line",
        "Scan complete",
      ],
      `${theme.id} Query workspace`,
    );
    if (await webview.getByRole("complementary").count() !== 0) {
      throw new Error(`${theme.id} Query did not receive the full canvas`);
    }
    if (
      await webview
        .getByRole("img", {
          name: /Row Groups scanned.*pruned.*remaining/u,
        })
        .count() !== 1
    ) {
      throw new Error(
        `${theme.id} Query progress lacks its source-backed chart equivalent`,
      );
    }
    if (
      await webview.getByRole("navigation", { name: "Storage hierarchy" }).count() !== 0 ||
      await webview.getByRole("navigation", { name: "Data location" }).count() !== 0
    ) {
      throw new Error(`${theme.id} Query rendered a mode-inappropriate breadcrumb`);
    }
    const whereDisclosure = webview.locator(
      "button[aria-controls='query-where-panel']",
    );
    if ((await whereDisclosure.getAttribute("aria-expanded")) !== "true") {
      await whereDisclosure.click();
    }
    await webview
      .getByRole("button", { name: "Add condition", exact: true })
      .click();
    await webview
      .locator(".predicate-leaf")
      .getByRole("button", { name: "Add condition", exact: true })
      .click();
    await webview
      .locator(".predicate-logic")
      .getByRole("button", { name: "OR", exact: true })
      .click();
    await webview
      .locator(".predicate-leaf .predicate-not-toggle")
      .nth(1)
      .click();
    const predicateLeaves = webview.locator(".predicate-leaf");
    await predicateLeaves
      .first()
      .getByRole("combobox", { name: "Predicate operator" })
      .selectOption("isNull");
    if (
      await predicateLeaves.first().getByRole("textbox", {
        name: "Typed value",
      }).count() !== 0 ||
      !(await predicateLeaves.first().innerText()).includes("No value required")
    ) {
      throw new Error("unary null predicate did not replace its value input compactly");
    }
    await predicateLeaves
      .nth(1)
      .getByRole("textbox", { name: "Typed value" })
      .fill("1");
    if (
      await webview.locator(".predicate-group").count() !== 1 ||
      await webview.locator(".predicate-leaf").count() !== 2 ||
      !(await whereDisclosure.innerText()).includes("OR · 2 conditions")
    ) {
      throw new Error(`${theme.id} compact composite predicate did not render`);
    }
    if (
      await webview
        .locator(".predicate-group > .predicate-group-header")
        .getByRole("button", { name: "NOT", exact: true })
        .count() !== 1
    ) {
      throw new Error(`${theme.id} root Boolean group cannot be negated`);
    }
    if (theme.id !== "light-empty-optional-colors") {
      await assertThemeColors(webview, theme);
    }
    await assertNoPageOverflow(webview, `${theme.id} wide Query workspace`);
    await webview.screenshot({
      path: path.join(
        visualValidationDirectory,
        `${theme.id}-wide-query.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
    await webview
      .locator(".predicate-leaf")
      .nth(1)
      .getByRole("button", { name: "Remove condition", exact: true })
      .click();
    await webview
      .getByRole("button", { name: "Remove condition", exact: true })
      .click();
    await whereDisclosure.click();

    for (const validationWidth of [980, 800]) {
      await webview.setViewportSize({
        width: validationWidth,
        height: 900,
      });
      await modeNavigation
        .getByRole("tab", { name: "Analyze", exact: true })
        .click();
      if (await webview.getByRole("complementary").count() !== 0) {
        throw new Error(
          `${theme.id} ${String(validationWidth)}px Analyze retained squeezed rails`,
        );
      }
      const mediumContextOpener = webview.getByRole("button", {
        name: "Open context rail",
        exact: true,
      });
      await mediumContextOpener.click();
      const mediumContextDialog = webview.getByRole("dialog", {
        name: "File context",
      });
      if (
        !(await mediumContextDialog.getAttribute("class"))?.includes("is-open")
      ) {
        throw new Error(
          `${theme.id} ${String(validationWidth)}px Context did not open as a drawer`,
        );
      }
      await webview.keyboard.press("Escape");
      await assertNoPageOverflow(
        webview,
        `${theme.id} ${String(validationWidth)}px Analyze workspace`,
      );
    }

    await webview.setViewportSize({ width: 640, height: 900 });
    await webview.evaluate(() => {
      globalThis.scrollTo(0, 0);
    });
    await modeNavigation
      .getByRole("tab", { name: "Data", exact: true })
      .click();
    await assertNoPageOverflow(webview, `${theme.id} narrow Data workspace`);
    if (
      await webview.getByRole("complementary").count() !== 0 ||
      await webview
        .getByRole("button", { name: "Open context rail", exact: true })
        .count() !== 0
    ) {
      throw new Error(`${theme.id} narrow Data retained Analyze chrome`);
    }
    await webview.screenshot({
      path: path.join(
        visualValidationDirectory,
        `${theme.id}-narrow-data.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });

    await modeNavigation
      .getByRole("tab", { name: "Analyze", exact: true })
      .click();
    const contextOpener = webview.getByRole("button", {
      name: "Open context rail",
      exact: true,
    });
    await contextOpener.click();
    const contextDialog = webview.getByRole("dialog", {
      name: "File context",
    });
    const contextPanel = webview.locator('aside[aria-label="File context"]');
    if (!(await contextDialog.getAttribute("class"))?.includes("is-open")) {
      throw new Error(`${theme.id} context drawer did not open as a dialog`);
    }
    await webview.keyboard.press("Escape");
    if (
      (await contextPanel.getAttribute("aria-hidden")) !== "true" ||
      !(await contextOpener.evaluate((element) => element.matches(":focus")))
    ) {
      throw new Error(
        `${theme.id} context drawer did not close and restore focus`,
      );
    }
    await dataTab.click();

    await webview.setViewportSize({ width: 330, height: 700 });
    await webview.evaluate(() => {
      globalThis.scrollTo(0, 0);
    });
    await assertNoPageOverflow(webview, `${theme.id} compact Data workspace`);
    if (
      !(await orientationControl.isVisible()) ||
      await webview.getByText("Focused column", { exact: true }).count() !== 0
    ) {
      throw new Error(
        `${theme.id} compact Data controls are missing or expose Focused column`,
      );
    }
    if (await webview.getByRole("complementary").count() !== 0) {
      throw new Error(
        `${theme.id} compact Data mode rendered a persistent side rail`,
      );
    }
    const compactRow = webview
      .getByRole("grid", { name: "Projected row page" })
      .locator("tbody tr")
      .first();
    await compactRow.click();
    if (await webview.getByRole("complementary").count() !== 0) {
      throw new Error(
        `${theme.id} compact row selection forced the inspector drawer open`,
      );
    }
    await webview.screenshot({
      path: path.join(
        visualValidationDirectory,
        `${theme.id}-compact-data.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
    await modeNavigation
      .getByRole("tab", { name: "Analyze", exact: true })
      .click();
    const compactSourceProperty = webview
      .locator(".summary-strip .property")
      .filter({
        has: webview.locator("dt").filter({ hasText: /^Source$/u }),
      });
    const compactSourceValue = compactSourceProperty.locator(
      ".exact-value-preview",
    );
    if (!(await compactSourceValue.getAttribute("class"))?.includes("is-truncated")) {
      throw new Error(`${theme.id} compact Source did not detect truncation`);
    }
    await compactSourceValue.focus();
    const compactTooltip = webview.getByRole("tooltip");
    await compactTooltip.waitFor({ state: "visible" });
    const compactTooltipLayer = Number.parseInt(
      await compactTooltip.evaluate(
        (element) => globalThis.getComputedStyle(element).zIndex,
      ),
      10,
    );
    await assertExactValueTooltip(
      webview,
      compactTooltip,
      true,
      `${theme.id} compact`,
    );
    await webview.keyboard.press("Escape");
    if (await compactTooltip.count() !== 0) {
      throw new Error(`${theme.id} compact ExactValue did not dismiss on Escape`);
    }
    const compactContextOpener = webview.getByRole("button", {
      name: "Open context rail",
      exact: true,
    });
    await compactContextOpener.click();
    const compactContextDialog = webview.getByRole("dialog", {
      name: "File context",
    });
    const compactLayers = await compactContextDialog.evaluate((element) => {
      const scrim = globalThis.document.querySelector(".drawer-scrim");
      const chrome = globalThis.document.querySelector(".workspace-chrome");
      if (scrim === null || chrome === null) {
        throw new Error("compact modal stacking targets are missing");
      }
      return {
        drawer: Number.parseInt(globalThis.getComputedStyle(element).zIndex, 10),
        scrim: Number.parseInt(globalThis.getComputedStyle(scrim).zIndex, 10),
        chrome: Number.parseInt(globalThis.getComputedStyle(chrome).zIndex, 10),
      };
    });
    if (
      !Number.isFinite(compactTooltipLayer) ||
      compactLayers.drawer <= compactTooltipLayer ||
      compactTooltipLayer <= compactLayers.chrome ||
      compactLayers.scrim <= compactLayers.chrome ||
      compactLayers.drawer <= compactLayers.scrim
    ) {
      throw new Error(
        `${theme.id} compact modal/tooltip layers are invalid: ${JSON.stringify({
          ...compactLayers,
          tooltip: compactTooltipLayer,
        })}`,
      );
    }
    await webview.keyboard.press("Escape");
    await compactSourceProperty.getByRole("button", {
      name: "Copy Source",
      exact: true,
    }).click();
    await compactSourceProperty.getByRole("button", {
      name: "Copied Source",
      exact: true,
    }).waitFor();
    if (runtimeErrors.length !== errorCountBeforeTheme) {
      throw new Error(
        `${theme.id} Webview emitted runtime errors: ${runtimeErrors
          .slice(errorCountBeforeTheme)
          .join(" | ")}`,
      );
    }
  }

  await webview.setViewportSize({ width: 1440, height: 900 });
  await webview.evaluate((validation) => {
    const types = [
      "BOOLEAN", "BYTE", "SHORT", "INT", "LONG", "FLOAT", "DOUBLE",
      "STRING", "BINARY", "TIMESTAMP", "ARRAY", "MAP", "STRUCT",
      "VARBINARY", "DECIMAL", "DATE", "VARCHAR", "CHAR", "TIME", "VECTOR",
    ].map((name, kind) => ({ kind, name }));
    const emit = (data) => {
      globalThis.dispatchEvent(new globalThis.MessageEvent("message", { data }));
    };
    const metadataMessage = {
      kind: "metadata",
      revision: 3,
      source: {
        uri: "vscode-vfs://fixture/generated/multi-pixel-long.pxl",
        size: validation.multiPixelSize,
        revision: `${validation.multiPixelSize}:multi-pixel`,
      },
      capabilities: {
        abi: 4,
        page: "generic-v1",
        rows: "rows-v1",
        filter: "filter-v1",
        scan: "scan-v2",
        rowGroup: "layout-v1",
        maxRows: 500,
        defaultRows: 100,
        defaultScanRows: 20,
        maxScanRows: 500,
        maxProjectionColumns: 128,
        maxExpressionNodes: 64,
        maxOrderKeys: 8,
        maxOrderedWindowRows: 4096,
        types,
        encodings: ["NONE", "RUNLENGTH", "DICTIONARY"],
        compression: {
          metadata: ["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"],
          payload: "inactive",
          reason: "postscript-v1-unused",
        },
        nested: "portable-v1",
      },
      metadata: JSON.parse(validation.multiPixelMetadata),
    };
    const rowGroupMessage = {
      kind: "rowGroup",
      revision: 3,
      rowGroup: JSON.parse(validation.multiPixelRowGroup),
    };
    globalThis.analyzeSelectionReplay = {
      metadata: metadataMessage,
      rowGroup: rowGroupMessage,
    };
    emit(metadataMessage);
    emit(rowGroupMessage);
  }, result);
  await modeNavigation
    .getByRole("tab", { name: "Analyze", exact: true })
    .click();
  await webview.evaluate(() => {
    globalThis.scrollTo(0, 0);
  });
  const multiPixelHierarchy = webview.getByRole("navigation", {
    name: "Storage hierarchy",
  });
  const multiPixelRowGroup = webview.getByRole("button", {
    name: "Row group 0, 10 rows, 352 data bytes",
    exact: true,
  });
  await multiPixelRowGroup.click();
  await webview.evaluate(async () => {
    const replay = globalThis.analyzeSelectionReplay;
    const emit = (data) => {
      globalThis.dispatchEvent(new globalThis.MessageEvent("message", { data }));
    };
    emit({ kind: "loading", revision: 4, stage: "metadata" });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
    emit({ ...replay.metadata, revision: 4 });
    emit({ ...replay.rowGroup, revision: 4 });
  });
  await webview.waitForTimeout(50);
  requireText(
    await multiPixelHierarchy.innerText(),
    ["File", "Row group 0"],
    "delayed layout preserved immediate Row Group selection",
  );
  requireText(
    await webview.getByRole("complementary", {
      name: "Selection inspector",
    }).innerText(),
    ["Row group 0", "Rows", "10"],
    "delayed layout preserved the Row Group inspector",
  );

  await webview.locator(".chunk-matrix button").first().click();
  await webview.evaluate(() => {
    const replay = globalThis.analyzeSelectionReplay;
    const emit = (data) => {
      globalThis.dispatchEvent(new globalThis.MessageEvent("message", { data }));
    };
    emit({ ...replay.metadata, revision: 3 });
    emit({ ...replay.rowGroup, revision: 3 });
    emit({ ...replay.metadata, revision: 5 });
    emit({ ...replay.rowGroup, revision: 5 });
  });
  requireText(
    await multiPixelHierarchy.innerText(),
    ["File", "Row group 0", "id chunk"],
    "stale/current replay preserved the Chunk selection",
  );

  await webview.locator(".pixel-list button").first().click();
  await webview.evaluate(() => {
    const replay = globalThis.analyzeSelectionReplay;
    const emit = (data) => {
      globalThis.dispatchEvent(new globalThis.MessageEvent("message", { data }));
    };
    emit({ ...replay.metadata, revision: 6 });
    emit({ ...replay.rowGroup, revision: 6 });
  });
  requireText(
    await multiPixelHierarchy.innerText(),
    ["File", "Row group 0", "id chunk", "Pixel segment 0"],
    "current replay preserved the Pixel selection",
  );
  await modeNavigation.getByRole("tab", { name: "Data", exact: true }).click();
  await modeNavigation.getByRole("tab", { name: "Analyze", exact: true }).click();
  requireText(
    await multiPixelHierarchy.innerText(),
    ["File", "Row group 0", "id chunk", "Pixel segment 0"],
    "Analyze mode revisit restored the Pixel selection",
  );

  await webview.evaluate(() => {
    const replay = globalThis.analyzeSelectionReplay;
    const emit = (data) => {
      globalThis.dispatchEvent(new globalThis.MessageEvent("message", { data }));
    };
    emit({ kind: "loading", revision: 7, stage: "source" });
    emit({ ...replay.metadata, revision: 7 });
    emit({ ...replay.rowGroup, revision: 7 });
  });
  await webview.waitForFunction(() =>
    globalThis.document.querySelector(
      'nav[aria-label="Storage hierarchy"]',
    )?.textContent?.trim() === "File",
  );
  if ((await multiPixelHierarchy.innerText()).trim() !== "File") {
    throw new Error("accepted refresh did not reset Analyze selection to File");
  }
  const pixelTicks = webview.locator(".pixel-map g[role='button']");
  if (
    await pixelTicks.count() !== 3 ||
    await webview.getByText(/^Pixel segment [012]$/u).count() !== 3 ||
    !(await webview.locator(".pixel-list").innerText()).includes("chunk offset 64")
  ) {
    throw new Error("multi-pixel Analyze map lost ticks or textual equivalents");
  }
  if (
    JSON.stringify(await pixelTicks.evaluateAll((ticks) =>
      ticks.map((tick) => tick.getAttribute("tabindex")),
    )) !== JSON.stringify(["0", "-1", "-1"])
  ) {
    throw new Error("multi-pixel map did not expose one initial roving tab stop");
  }
  await pixelTicks.first().focus();
  await pixelTicks.first().press("ArrowRight");
  if (
    (await pixelTicks.nth(1).getAttribute("aria-pressed")) !== "true" ||
    (await pixelTicks.nth(1).getAttribute("tabindex")) !== "0"
  ) {
    throw new Error("multi-pixel keyboard selection did not link to segment 1");
  }
  const selectedHierarchy = webview.getByRole("navigation", {
    name: "Storage hierarchy",
  });
  requireText(
    await selectedHierarchy.innerText(),
    ["File", "Row group 0", "id chunk", "Pixel segment 1"],
    "selected multi-pixel storage breadcrumb",
  );
  const wideFontSize = await pixelTicks.nth(1).locator("text").evaluate(
    (element) => globalThis.getComputedStyle(element).fontSize,
  );
  await webview.evaluate(() => {
    globalThis.scrollTo(0, 0);
  });
  for (const theme of [themeCases[1], themeCases[0]]) {
    await applyTheme(webview, theme);
    const fill = await webview.locator(".file-map rect").first().evaluate(
      (element) => globalThis.getComputedStyle(element).fill,
    );
    if (theme.id === "light" && fill === "rgb(0, 0, 0)") {
      throw new Error("light Analyze storage map retained a near-black fill");
    }
    await webview.screenshot({
      path: path.join(
        visualValidationDirectory,
        `${theme.id}-wide-analyze-multi-pixel.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
  }
  await applyTheme(webview, themeCases[2]);
  for (const width of [1440, 980, 800, 640, 330]) {
    const geometry = await assertAnalyzeStickyChrome(
      webview,
      width,
      "high-contrast Analyze",
    );
    if (
      geometry.backdropFilter !== "none" ||
      geometry.borderColor === "rgba(0, 0, 0, 0)"
    ) {
      throw new Error(
        `high-contrast ${String(width)}px sticky chrome lost its solid boundary: ${JSON.stringify(geometry)}`,
      );
    }
  }
  const reducedTransparencySession = await webview.context().newCDPSession(webview);
  await reducedTransparencySession.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-transparency", value: "reduce" },
    ],
  });
  await applyTheme(webview, themeCases[0]);
  for (const width of [1440, 980, 800, 640, 330]) {
    const geometry = await assertAnalyzeStickyChrome(
      webview,
      width,
      "reduced-transparency Analyze",
    );
    if (
      geometry.backdropFilter !== "none" ||
      geometry.borderColor === "rgba(0, 0, 0, 0)"
    ) {
      throw new Error(
        `reduced-transparency ${String(width)}px sticky chrome remained translucent: ${JSON.stringify(geometry)}`,
      );
    }
  }
  await reducedTransparencySession.send("Emulation.setEmulatedMedia", {
    features: [],
  });
  await reducedTransparencySession.detach();
  await webview.setViewportSize({ width: 330, height: 700 });
  if (await pixelTicks.count() !== 3) {
    throw new Error("narrow multi-pixel map dropped source-backed ticks");
  }
  const narrowFontSize = await pixelTicks.nth(1).locator("text").evaluate(
    (element) => globalThis.getComputedStyle(element).fontSize,
  );
  if (wideFontSize !== narrowFontSize) {
    throw new Error(
      `storage map typography resized with width: ${wideFontSize} -> ${narrowFontSize}`,
    );
  }
  await assertNoPageOverflow(webview, "330px multi-pixel Analyze workspace");

  await webview.setViewportSize({ width: 1440, height: 900 });
  await applyTheme(webview, themeCases[0]);
  const customerReplacementRequestStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await webview.evaluate((validation) => {
    const emit = (data) => {
      globalThis.dispatchEvent(new globalThis.MessageEvent("message", { data }));
    };
    const types = [
      "BOOLEAN", "BYTE", "SHORT", "INT", "LONG", "FLOAT", "DOUBLE",
      "STRING", "BINARY", "TIMESTAMP", "ARRAY", "MAP", "STRUCT",
      "VARBINARY", "DECIMAL", "DATE", "VARCHAR", "CHAR", "TIME", "VECTOR",
    ].map((name, kind) => ({ kind, name }));
    emit({
      kind: "metadata",
      revision: 20,
      source: {
        uri: "vscode-vfs://examples/customer.pxl",
        size: validation.customerSize,
        revision: `${validation.customerSize}:customer-release`,
      },
      capabilities: {
        abi: 4,
        page: "generic-v1",
        rows: "rows-v1",
        filter: "filter-v1",
        scan: "scan-v2",
        rowGroup: "layout-v1",
        maxRows: 500,
        defaultRows: 100,
        defaultScanRows: 20,
        maxScanRows: 500,
        maxProjectionColumns: 128,
        maxExpressionNodes: 64,
        maxOrderKeys: 8,
        maxOrderedWindowRows: 4096,
        types,
        encodings: ["NONE", "RUNLENGTH", "DICTIONARY"],
        compression: {
          metadata: ["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"],
          payload: "inactive",
          reason: "postscript-v1-unused",
        },
        nested: "portable-v1",
      },
      metadata: JSON.parse(validation.customerMetadata),
    });
    emit({
      kind: "rowGroup",
      revision: 20,
      rowGroup: JSON.parse(validation.customerRowGroup),
    });
  }, result);
  await modeNavigation.getByRole("tab", { name: "Data", exact: true }).click();
  await webview.waitForTimeout(50);
  const customerReplacementReads = await webview.evaluate((start) =>
    globalThis.webviewMessages.slice(start).filter(
      (message) => message.kind === "selectRows" || message.kind === "select",
    ), customerReplacementRequestStart);
  if (
    customerReplacementReads.length !== 1 ||
    customerReplacementReads[0].kind !== "selectRows" ||
    JSON.stringify(customerReplacementReads[0].columns) !==
      JSON.stringify([0, 1, 2, 3, 4, 5]) ||
    customerReplacementReads[0].rowGroup !== 0 ||
    customerReplacementReads[0].rowOffset !== "0" ||
    customerReplacementReads[0].rowCount !== 25
  ) {
    throw new Error(
      `lineitem-to-customer replacement did not reset one configured Data request: ${JSON.stringify(customerReplacementReads)}`,
    );
  }
  await webview.evaluate((validation) => {
    globalThis.dispatchEvent(new globalThis.MessageEvent("message", {
      data: {
        kind: "rows",
        revision: 20,
        rows: JSON.parse(validation.customerRows),
      },
    }));
  }, result);
  await modeNavigation.getByRole("tab", { name: "Analyze", exact: true }).click();
  await webview.getByRole("button", { name: /^Row group 0,/u }).click();
  await webview.locator(".chunk-matrix button").first().click();
  await webview.locator(".pixel-list button").first().click();
  const releaseAnalyzeText = await webview.locator("main").innerText();
  requireText(
    releaseAnalyzeText,
    ["customer.pxl", "Row group 0", "c_custkey", "Pixel segment 0"],
    "release Analyze screenshot",
  );
  if (await webview.locator(".pixel-list button").count() < 5) {
    throw new Error("release Analyze screenshot has fewer than five Pixels");
  }
  await webview.evaluate(async () => {
    await globalThis.document.fonts.ready;
    await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
    await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
  });
  await webview.screenshot({
    path: path.join(visualValidationDirectory, "release-analyze.png"),
    animations: "disabled",
  });

  await modeNavigation.getByRole("tab", { name: "Data", exact: true }).click();
  await webview.evaluate(() => globalThis.scrollTo(0, 0));
  const releaseDataText = await webview.locator("main").innerText();
  requireText(
    releaseDataText,
    ["Customer#1001", "AUTOMOBILE", "-2470.50"],
    "release Data screenshot",
  );
  if (await webview.getByRole("grid", { name: "Projected row page" }).count() !== 1) {
    throw new Error("release Data screenshot has no customer result grid");
  }
  await webview.screenshot({
    path: path.join(visualValidationDirectory, "release-data.png"),
    animations: "disabled",
  });

  const releaseQueryRequestStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await modeNavigation.getByRole("tab", { name: "Query", exact: true }).click();
  await webview.evaluate(() => globalThis.scrollTo(0, 0));
  await webview.waitForFunction(
    (start) => globalThis.webviewMessages
      .slice(start)
      .some((message) => message.kind === "runScan"),
    releaseQueryRequestStart,
  );
  await webview.getByRole("button", { name: "Cancel", exact: true }).waitFor();
  await webview.evaluate((validation) => {
    globalThis.dispatchEvent(new globalThis.MessageEvent("message", {
      data: {
        kind: "scan",
        revision: 20,
        elapsedMs: 18,
        scan: JSON.parse(validation.customerScan),
      },
    }));
  }, result);
  await webview.getByText("20 rows returned", { exact: true }).waitFor();
  const releaseQueryText = await webview.locator("main").innerText();
  requireText(
    releaseQueryText,
    ["Scan file", "20 rows returned", "Customer#1001", "Scanned in natural file order"],
    "release Query screenshot",
  );
  if (await webview.getByRole("alert").count() !== 0) {
    throw new Error("release Query screenshot drifted into an error state");
  }
  await webview.screenshot({
    path: path.join(visualValidationDirectory, "release-query.png"),
    animations: "disabled",
  });
  const legacyRequestStart = await webview.evaluate(
    () => globalThis.webviewMessages.length,
  );
  await webview.evaluate((validation) => {
    const types = [
      "BOOLEAN", "BYTE", "SHORT", "INT", "LONG", "FLOAT", "DOUBLE",
      "STRING", "BINARY", "TIMESTAMP", "ARRAY", "MAP", "STRUCT",
      "VARBINARY", "DECIMAL", "DATE", "VARCHAR", "CHAR", "TIME", "VECTOR",
    ].map((name, kind) => ({ kind, name }));
    globalThis.dispatchEvent(new globalThis.MessageEvent("message", {
      data: {
        kind: "metadata",
        revision: 21,
        source: {
          uri: "vscode-vfs://examples/customer.pxl",
          size: validation.customerSize,
          revision: `${validation.customerSize}:legacy-filter`,
        },
        capabilities: {
          abi: 4,
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
        metadata: JSON.parse(validation.customerMetadata),
      },
    }));
  }, result);
  await webview.getByRole("heading", { name: "Typed file filter" }).waitFor();
  await webview.getByLabel("Typed value").fill("1001");
  await webview.getByRole("button", { name: "Run filter" }).click();
  const legacyRequests = await webview.evaluate((start) =>
    globalThis.webviewMessages.slice(start).filter(
      (message) => message.kind === "runFilter",
    ), legacyRequestStart);
  if (
    legacyRequests.length !== 1 ||
    legacyRequests[0].predicate.column !== 0 ||
    legacyRequests[0].predicate.operator !== "eq" ||
    legacyRequests[0].predicate.literal !== "1001" ||
    JSON.stringify(legacyRequests[0].columns) !==
      JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7])
  ) {
    throw new Error(
      `filter-v1 capability fallback posted the wrong request: ${JSON.stringify(legacyRequests)}`,
    );
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
