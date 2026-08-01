import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  createPortal,
} from "react-dom";

interface TooltipPlacement {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
}

type TooltipOrigin = "focus" | "pointer";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * Reveals a full value only when its authored preview is genuinely clipped.
 * A render prop keeps native controls native while allowing their selected
 * label to use the same measured preview and tooltip surface.
 */
export function TruncatedText({
  value,
  children,
  className = "",
  previewClassName = "",
  popoverClassName = "",
  tooltipContent,
  renderControl,
}: {
  readonly value: string;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly previewClassName?: string;
  readonly popoverClassName?: string;
  readonly tooltipContent?: ReactNode;
  readonly renderControl?: (describedBy: string | undefined) => ReactNode;
}): ReactNode {
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<TooltipOrigin>("focus");
  const [placement, setPlacement] = useState<TooltipPlacement>();
  const tooltipId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const preview = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const lastPointerType = useRef<string | undefined>(undefined);
  const pointerInTooltip = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const cancelClose = useCallback((): void => {
    if (closeTimer.current !== undefined) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  }, []);
  const close = useCallback((): void => {
    cancelClose();
    pointerInTooltip.current = false;
    setOpen(false);
  }, [cancelClose]);
  const scheduleClose = useCallback((): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined;
      setOpen(false);
    }, 100);
  }, [cancelClose]);

  useLayoutEffect(() => {
    const element = preview.current;
    if (element === null) {
      return;
    }
    const measure = (): void => {
      const next = element.scrollWidth > element.clientWidth + 1;
      setTruncated(next);
      if (!next) {
        pointerInTooltip.current = false;
        setOpen(false);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [children, value]);

  const updatePlacement = useCallback((): void => {
    const anchor = preview.current;
    const tooltipElement = tooltip.current;
    if (anchor === null || tooltipElement === null) {
      return;
    }
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const compact = viewportWidth <= 480;
    const inset = compact ? 8 : 12;
    const gap = compact ? 10 : 12;
    const bounds = tooltipElement.getBoundingClientRect();
    const width = Math.min(bounds.width, viewportWidth - inset * 2);
    const height = Math.min(bounds.height, viewportHeight - inset * 2);
    let left: number;
    let top: number;

    if (origin === "pointer") {
      const point = pointer.current;
      left = point.x + gap;
      if (left + width > viewportWidth - inset) {
        left = point.x - gap - width;
      }
      top = point.y + gap;
      if (top + height > viewportHeight - inset) {
        top = point.y - gap - height;
      }
    } else {
      const anchorBounds = anchor.getBoundingClientRect();
      left = anchorBounds.left;
      top = anchorBounds.bottom + gap;
      if (top + height > viewportHeight - inset) {
        top = anchorBounds.top - gap - height;
      }
    }

    setPlacement({
      left: clamp(left, inset, viewportWidth - inset - width),
      top: clamp(top, inset, viewportHeight - inset - height),
      maxHeight: viewportHeight - inset * 2,
    });
  }, [origin]);

  useLayoutEffect(() => {
    if (!open || !truncated) {
      setPlacement(undefined);
      return;
    }
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, truncated, updatePlacement]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const dismiss = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        !root.current?.contains(target) &&
        !tooltip.current?.contains(target)
      ) {
        close();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [close, open]);

  useEffect(() => {
    return () => {
      cancelClose();
    };
  }, [cancelClose]);

  const showFromPointer = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    const target = event.target;
    if (
      event.pointerType === "touch" ||
      !truncated ||
      (target instanceof Node && tooltip.current?.contains(target))
    ) {
      return;
    }
    pointer.current = { x: event.clientX, y: event.clientY };
    cancelClose();
    setOrigin("pointer");
    setOpen(true);
    if (open && origin === "pointer") {
      updatePlacement();
    }
  };

  const tooltipNode = open && truncated ? (
    <span
      ref={tooltip}
      id={tooltipId}
      role="tooltip"
      className={`truncated-text-popover${
        popoverClassName.length === 0 ? "" : ` ${popoverClassName}`
      }`}
      data-origin={origin}
      data-positioned={placement === undefined ? "false" : "true"}
      style={placement === undefined ? undefined : {
        left: placement.left,
        top: placement.top,
        maxHeight: placement.maxHeight,
      } satisfies CSSProperties}
      onPointerEnter={() => {
        pointerInTooltip.current = true;
        cancelClose();
      }}
      onPointerLeave={() => {
        pointerInTooltip.current = false;
        scheduleClose();
      }}
    >
      {tooltipContent ?? value}
    </span>
  ) : null;

  return (
    <>
      <span
        ref={root}
        className={`truncated-text${truncated ? " is-truncated" : ""}${
          className.length === 0 ? "" : ` ${className}`
        }`}
        onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
          if (event.key === "Escape" && open) {
            // Preserve the native select's Escape behavior while dismissing
            // this supplemental tooltip.
            if (renderControl === undefined) {
              event.preventDefault();
            }
            close();
          }
        }}
        onFocusCapture={() => {
          if (truncated) {
            cancelClose();
            setOrigin("focus");
            setOpen(true);
          }
        }}
        onBlur={(event: FocusEvent<HTMLSpanElement>) => {
          if (
            !event.currentTarget.contains(event.relatedTarget) &&
            !pointerInTooltip.current
          ) {
            scheduleClose();
          }
        }}
        onPointerEnter={showFromPointer}
        onPointerMove={showFromPointer}
        onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
          lastPointerType.current = event.pointerType;
        }}
        onPointerLeave={() => {
          scheduleClose();
        }}
        onClick={(event: MouseEvent<HTMLSpanElement>) => {
          const openedFromTouch = lastPointerType.current === "touch";
          lastPointerType.current = undefined;
          if (
            renderControl === undefined &&
            truncated &&
            (openedFromTouch || matchMedia("(hover: none)").matches)
          ) {
            // TruncatedText can sit inside a label. A tap used to reveal the
            // full text must not also toggle that label's native control.
            event.preventDefault();
            event.stopPropagation();
            cancelClose();
            setOrigin("focus");
            setOpen((current) => !current);
          }
        }}
      >
        <span
          ref={preview}
          className={`truncated-text-preview${truncated ? " is-truncated" : ""}${
            previewClassName.length === 0 ? "" : ` ${previewClassName}`
          }`}
          tabIndex={renderControl === undefined && truncated ? 0 : undefined}
          aria-hidden={renderControl === undefined ? undefined : true}
          aria-describedby={
            renderControl === undefined && open ? tooltipId : undefined
          }
        >
          {children ?? value}
        </span>
        {renderControl?.(open && truncated ? tooltipId : undefined)}
      </span>
      {tooltipNode === null ? null : createPortal(tooltipNode, document.body)}
    </>
  );
}
