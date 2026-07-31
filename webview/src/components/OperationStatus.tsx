import type {
  ReactNode,
} from "react";

import {
  Icon,
} from "./Icon.js";

export function ErrorStatus({
  code,
  message,
  recoverable,
  onRetry,
}: {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly onRetry: () => void;
}): ReactNode {
  return (
    <div className="status-banner error" role="alert">
      <Icon name="warning" />
      <div>
        <strong>{code}</strong>
        <span>{message}</span>
      </div>
      {recoverable ? (
        <button
          type="button"
          className="action-button"
          onClick={onRetry}
        >
          <Icon name="refresh" />
          <span>Retry</span>
        </button>
      ) : null}
    </div>
  );
}

export function LoadingStatus({
  stage,
}: {
  readonly stage: string;
}): ReactNode {
  return (
    <div className="status-banner loading" role="status" aria-live="polite">
      <span className="activity-indicator" aria-hidden="true" />
      <span>Loading {stage}…</span>
    </div>
  );
}
