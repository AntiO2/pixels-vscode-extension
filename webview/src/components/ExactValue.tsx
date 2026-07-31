import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  Icon,
} from "./Icon.js";

interface PopoverPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
}

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
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [placement, setPlacement] = useState<PopoverPlacement>();
  const popoverId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const preview = useRef<HTMLSpanElement>(null);
  const popover = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pointerInPopover = useRef(false);

  const cancelClose = (): void => {
    if (closeTimer.current !== undefined) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };
  const close = (): void => {
    cancelClose();
    setOpen(false);
  };
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined;
      setOpen(false);
    }, 100);
  };

  useLayoutEffect(() => {
    const element = preview.current;
    if (element === null) {
      return;
    }
    const measure = (): void => {
      const next = element.scrollWidth > element.clientWidth + 1;
      setTruncated(next);
      if (!next) {
        setOpen(false);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [children, label, value]);

  useLayoutEffect(() => {
    if (!open || !truncated) {
      setPlacement(undefined);
      return;
    }
    const updatePlacement = (): void => {
      const anchor = preview.current;
      const popoverElement = popover.current;
      if (anchor === null || popoverElement === null) {
        return;
      }
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const compact = viewportWidth <= 480;
      const inset = compact ? 8 : 12;
      const gap = compact ? 8 : 4;
      const width = Math.max(0, Math.min(480, viewportWidth - inset * 2));
      const anchorBox = anchor.getBoundingClientRect();
      const measuredHeight = Math.min(
        popoverElement.scrollHeight,
        viewportHeight - inset * 2,
      );
      const left = compact
        ? inset
        : Math.min(
            Math.max(anchorBox.left, inset),
            viewportWidth - inset - width,
          );
      const below = viewportHeight - anchorBox.bottom - gap - inset;
      const above = anchorBox.top - gap - inset;
      const top = measuredHeight > below && above > below
        ? Math.max(inset, anchorBox.top - gap - measuredHeight)
        : Math.min(
            anchorBox.bottom + gap,
            viewportHeight - inset - measuredHeight,
          );
      setPlacement({
        left,
        top: Math.max(inset, top),
        width,
        maxHeight: viewportHeight - inset * 2,
      });
    };
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, truncated]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const dismiss = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && !root.current?.contains(target)) {
        close();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      cancelClose();
      if (copiedTimer.current !== undefined) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
      preview.current?.focus();
    }
  };
  const show = (): void => {
    if (truncated) {
      cancelClose();
      setOpen(true);
    }
  };
  return (
    <span
      ref={root}
      className={`exact-value ${className}`}
      onKeyDown={onKeyDown}
      onBlur={(event: FocusEvent<HTMLSpanElement>) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !pointerInPopover.current
        ) {
          scheduleClose();
        }
      }}
    >
      <span
        ref={preview}
        className={`exact-value-preview${truncated ? " is-truncated" : ""}`}
        tabIndex={truncated ? 0 : undefined}
        aria-describedby={open ? popoverId : undefined}
        onFocus={show}
        onPointerEnter={show}
        onPointerLeave={scheduleClose}
        onClick={() => {
          if (truncated && matchMedia("(hover: none)").matches) {
            setOpen((current) => !current);
          }
        }}
      >
        {children ?? value}
      </span>
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
      {open && truncated ? (
        <span
          ref={popover}
          id={popoverId}
          role="tooltip"
          className="exact-value-popover"
          data-positioned={placement === undefined ? "false" : "true"}
          style={placement === undefined ? undefined : {
            left: placement.left,
            top: placement.top,
            width: placement.width,
            maxHeight: placement.maxHeight,
          } satisfies CSSProperties}
          onPointerEnter={() => {
            pointerInPopover.current = true;
            cancelClose();
          }}
          onPointerLeave={() => {
            pointerInPopover.current = false;
            scheduleClose();
          }}
        >
          <code>{value}</code>
        </span>
      ) : null}
    </span>
  );
}
