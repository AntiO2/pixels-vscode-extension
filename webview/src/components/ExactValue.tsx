import type {
  ReactNode,
} from "react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Icon,
} from "./Icon.js";
import {
  TruncatedText,
} from "./TruncatedText.js";

export function ExactValue({
  label,
  value,
  children,
  className = "",
}: {
  readonly label: string;
  readonly value: string;
  readonly children?: ReactNode;
  readonly className?: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== undefined) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  return (
    <span
      className={`exact-value ${className}`}
    >
      <TruncatedText
        value={value}
        className="exact-value-truncated"
        previewClassName="exact-value-preview"
        popoverClassName="exact-value-popover"
        tooltipContent={<code>{value}</code>}
      >
        {children ?? value}
      </TruncatedText>
      <button
        type="button"
        className="exact-value-copy"
        aria-label={`${copied ? "Copied" : "Copy"} ${label}`}
        title={`${copied ? "Copied" : "Copy"} ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            if (copiedTimer.current !== undefined) {
              clearTimeout(copiedTimer.current);
            }
            copiedTimer.current = setTimeout(() => {
              copiedTimer.current = undefined;
              setCopied(false);
            }, 1_500);
          });
        }}
      >
        <Icon name="copy" />
      </button>
      {copied ? (
        <span className="exact-value-copy-status" role="status">
          Copied
        </span>
      ) : null}
    </span>
  );
}
