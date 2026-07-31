import {
  useRef,
} from "react";
import type {
  Dispatch,
  KeyboardEvent,
  ReactNode,
} from "react";

import type {
  AppAction,
  WorkspaceMode,
} from "../app/model.js";
import {
  Icon,
} from "./Icon.js";
import type {
  IconName,
} from "./Icon.js";

const tabs: readonly (readonly [WorkspaceMode, string, IconName])[] = [
  ["analyze", "Analyze", "analyze"],
  ["data", "Data", "data"],
  ["query", "Query", "query"],
];

export function WorkspaceTabs({
  mode,
  dispatch,
}: {
  readonly mode: WorkspaceMode;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const tabElements = useRef<
    Record<WorkspaceMode, HTMLButtonElement | null>
  >({ analyze: null, data: null, query: null });

  const activate = (nextMode: WorkspaceMode): void => {
    dispatch({ type: "mode", mode: nextMode });
    tabElements.current[nextMode]?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: WorkspaceMode,
  ): void => {
    const current = tabs.findIndex(([candidate]) => candidate === currentMode);
    let next: number;
    if (event.key === "ArrowLeft") {
      next = (current - 1 + tabs.length) % tabs.length;
    } else if (event.key === "ArrowRight") {
      next = (current + 1) % tabs.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextMode = tabs[next]?.[0];
    if (nextMode !== undefined) {
      activate(nextMode);
    }
  };

  return (
    <div className="mode-switch" role="tablist" aria-label="Workspace mode">
      {tabs.map(([value, label, icon]) => (
        <button
          type="button"
          role="tab"
          id={`workspace-tab-${value}`}
          aria-controls="workspace-panel"
          aria-selected={mode === value}
          tabIndex={mode === value ? 0 : -1}
          key={value}
          className={mode === value ? "is-current" : ""}
          ref={(element) => {
            tabElements.current[value] = element;
          }}
          onClick={() => {
            activate(value);
          }}
          onKeyDown={(event) => {
            onKeyDown(event, value);
          }}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
