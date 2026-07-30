import {
  StrictMode,
} from "react";
import {
  createRoot,
} from "react-dom/client";

import {
  App,
} from "./App.js";
import {
  createBridge,
  decodeHostMessage,
} from "./app/bridge.js";
import type {
  AppAction,
} from "./app/model.js";

const rootElement = document.querySelector<HTMLElement>("#app");
if (rootElement === null) {
  throw new Error("Pixels Inspector app root is missing");
}

const bridge = createBridge();
let readyPosted = false;
const subscribe = (
  dispatch: (action: AppAction) => void,
): (() => void) => {
  const listener = (event: MessageEvent<unknown>): void => {
    try {
      const message = decodeHostMessage(event.data);
      if (message !== undefined) {
        dispatch({ type: "host", message });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The extension sent an invalid Webview message";
      dispatch({
        type: "host",
        message: {
          kind: "error",
          revision: 0,
          error: {
            code: "INVALID_MESSAGE",
            message,
            recoverable: false,
          },
        },
      });
    }
  };
  globalThis.addEventListener("message", listener);
  if (!readyPosted) {
    readyPosted = true;
    bridge.postMessage({ kind: "ready" });
  }
  return () => {
    globalThis.removeEventListener("message", listener);
  };
};

createRoot(rootElement).render(
  <StrictMode>
    <App bridge={bridge} subscribe={subscribe} />
  </StrictMode>,
);
