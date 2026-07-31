import {
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ReactNode,
} from "react";

const narrowQuery = "(max-width: 1179px)";
const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(
    () => globalThis.matchMedia(narrowQuery).matches,
  );
  useEffect(() => {
    const media = globalThis.matchMedia(narrowQuery);
    const update = (): void => {
      setNarrow(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  return narrow;
}

export function ResponsivePanel({
  open,
  side,
  label,
  className,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly side: "context" | "inspector";
  readonly label: string;
  readonly className: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const narrow = useNarrowLayout();
  const panelRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!narrow || !open) {
      return;
    }
    restoreFocusRef.current =
      globalThis.document.activeElement instanceof HTMLElement
        ? globalThis.document.activeElement
        : null;
    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(focusableSelector);
    focusable?.[0]?.focus();
    const previousOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = "hidden";
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || panel === null) {
        return;
      }
      const candidates = [...panel.querySelectorAll<HTMLElement>(
        focusableSelector,
      )].filter((element) => element.offsetParent !== null);
      if (candidates.length === 0) {
        event.preventDefault();
        return;
      }
      const first = candidates[0];
      const last = candidates.at(-1);
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        globalThis.document.activeElement === last
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    globalThis.document.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.document.removeEventListener("keydown", onKeyDown);
      globalThis.document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [narrow, open]);

  return (
    <>
      {narrow && open ? (
        <button
          type="button"
          className={`drawer-scrim ${side}-scrim`}
          aria-label={`Close ${label.toLocaleLowerCase()}`}
          onClick={onClose}
        />
      ) : null}
      <aside
        ref={panelRef}
        className={`${className} ${open ? "is-open" : ""}`}
        aria-label={label}
        role={narrow ? "dialog" : "complementary"}
        aria-modal={narrow ? open : undefined}
        aria-hidden={narrow && !open ? true : undefined}
        inert={narrow && !open ? true : undefined}
      >
        {children}
      </aside>
    </>
  );
}
