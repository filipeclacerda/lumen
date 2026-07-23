import {
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
  type Placement,
  type ReferenceType,
} from "@floating-ui/react-dom";
import { Move } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

type TargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: string;
};

type GuideCoachmarkProps = {
  active: boolean;
  target?: string;
  className?: string;
  role?: "dialog" | "region";
  labelledBy: string;
  describedBy: string;
  focusKey?: string | number;
  focusOnOpen?: boolean;
  children: (positionControl: ReactNode) => ReactNode;
};

const placements: Placement[] = ["right-start", "left-start", "bottom-start", "top-start"];

function readPageZoom() {
  const zoom = Number.parseFloat(
    window.getComputedStyle(document.body).zoom ||
      document.body.style.getPropertyValue("zoom") ||
      window.getComputedStyle(document.documentElement).getPropertyValue("--app-zoom"),
  );
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function visibleRect(element: Element, pageZoom: number): TargetRect | undefined {
  const rect = element.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.right <= 0 ||
    rect.left >= window.innerWidth ||
    rect.bottom <= 0 ||
    rect.top >= window.innerHeight
  ) {
    return undefined;
  }
  const borderRadius = window.getComputedStyle(element).borderRadius;
  return {
    top: rect.top / pageZoom,
    left: rect.left / pageZoom,
    width: rect.width / pageZoom,
    height: rect.height / pageZoom,
    borderRadius: borderRadius === "0px" ? "var(--radius-lg)" : borderRadius,
  };
}

function overlapArea(a: DOMRect, b: DOMRect) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

export function GuideCoachmark({
  active,
  target,
  className = "",
  role = "dialog",
  labelledBy,
  describedBy,
  focusKey,
  focusOnOpen = false,
  children,
}: GuideCoachmarkProps) {
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [targetRect, setTargetRect] = useState<TargetRect>();
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [narrowViewport, setNarrowViewport] = useState(
    () => window.matchMedia("(max-width: 650px)").matches || window.innerWidth * readPageZoom() <= 650,
  );
  const [placementIndex, setPlacementIndex] = useState(0);
  const [autoDocked, setAutoDocked] = useState(false);
  const [positionAnnouncement, setPositionAnnouncement] = useState("");
  const [pageZoom, setPageZoom] = useState(readPageZoom);
  const arrowRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const scrolledTarget = useRef<string | undefined>(undefined);

  const measureTarget = useCallback((element?: Element | null) => {
    const nextZoom = readPageZoom();
    setPageZoom((current) => (current === nextZoom ? current : nextZoom));
    setTargetRect(element ? visibleRect(element, nextZoom) : undefined);
  }, []);

  const whileElementsMounted = useCallback(
    (reference: ReferenceType, floating: HTMLElement, update: () => void) => {
      const sync = () => {
        update();
        if (reference instanceof Element) measureTarget(reference);
      };
      sync();
      return autoUpdate(reference, floating, sync, {
        ancestorScroll: true,
        ancestorResize: true,
        elementResize: typeof ResizeObserver !== "undefined",
        layoutShift: typeof IntersectionObserver !== "undefined",
      });
    },
    [measureTarget],
  );

  const preferredPlacement = placements[Math.min(placementIndex, placements.length - 1)];
  const { refs, middlewareData, placement, isPositioned, x, y } = useFloating({
    placement: preferredPlacement,
    strategy: "fixed",
    whileElementsMounted,
    middleware: [
      offset(14),
      flip({ padding: 16, fallbackStrategy: "bestFit" }),
      shift({ padding: 16 }),
      size({
        padding: 16,
        apply({ availableHeight, elements }) {
          elements.floating.style.setProperty(
            "--guide-available-height",
            `${Math.max(180, availableHeight / pageZoom)}px`,
          );
        },
      }),
      arrow({ element: arrowRef }),
    ],
  });

  useLayoutEffect(() => {
    setPortalHost(document.getElementById("tutorial-host"));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 650px)");
    const update = () => setNarrowViewport(media.matches || window.innerWidth * readPageZoom() <= 650);
    update();
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  useLayoutEffect(() => {
    if (!active || !target) {
      setTargetElement(null);
      measureTarget(null);
      return;
    }

    let currentTarget: HTMLElement | null = null;
    const findTarget = () => {
      const nextTarget = document.querySelector<HTMLElement>(target);
      if (nextTarget === currentTarget) return;
      currentTarget = nextTarget;
      setTargetElement(nextTarget);
      measureTarget(nextTarget);
      if (nextTarget && scrolledTarget.current !== target) {
        scrolledTarget.current = target;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        nextTarget.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      }
    };

    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("animationend", findTarget, true);
    findTarget();
    return () => {
      observer.disconnect();
      document.removeEventListener("animationend", findTarget, true);
    };
  }, [active, measureTarget, target]);

  useLayoutEffect(() => {
    refs.setReference(targetElement);
  }, [refs, targetElement]);

  useEffect(() => {
    setPlacementIndex(0);
    setAutoDocked(false);
    setPositionAnnouncement("");
  }, [target]);

  const manuallyDocked = placementIndex >= placements.length;
  const docked = narrowViewport || Boolean(target && (manuallyDocked || autoDocked || !targetElement));

  useLayoutEffect(() => {
    if (!active || !targetElement || docked || !isPositioned || x == null || y == null) return;
    const frame = window.requestAnimationFrame(() => {
      const floating = cardRef.current?.getBoundingClientRect();
      const reference = targetElement.getBoundingClientRect();
      if (!floating) return;
      const outsideViewport =
        floating.left < 8 ||
        floating.top < 8 ||
        floating.right > window.innerWidth - 8 ||
        floating.bottom > window.innerHeight - 8;
      if (outsideViewport || overlapArea(floating, reference) > 1) setAutoDocked(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, docked, isPositioned, placement, targetElement, x, y]);

  useEffect(() => {
    if (!active || !focusOnOpen) return;
    cardRef.current?.focus({ preventScroll: true });
  }, [active, focusKey, focusOnOpen]);

  if (!active) return null;

  const setFloatingRef = (element: HTMLElement | null) => {
    cardRef.current = element;
    refs.setFloating(element);
  };

  const move = () => {
    setAutoDocked(false);
    setPlacementIndex((current) => {
      const next = current >= placements.length ? 0 : current + 1;
      setPositionAnnouncement(
        next >= placements.length ? "Tutorial fixado na página." : "Tutorial movido para outra posição segura.",
      );
      return next;
    });
  };

  const positionControl =
    target && !narrowViewport ? (
      <>
        <button
          className="icon-button quick-start-guide__move"
          type="button"
          aria-label={docked ? "Tentar flutuar tutorial" : "Mover tutorial"}
          title={docked ? "Tentar flutuar tutorial" : "Mover tutorial"}
          onClick={move}
        >
          <Move size={16} />
        </button>
        <span className="quick-start-guide__announcement" aria-live="polite">
          {positionAnnouncement}
        </span>
      </>
    ) : null;

  const side = placement.split("-")[0] as "top" | "right" | "bottom" | "left";
  const staticSide = { top: "bottom", right: "left", bottom: "top", left: "right" }[side];
  const arrowStyle: CSSProperties = {
    left: middlewareData.arrow?.x == null ? undefined : middlewareData.arrow.x / pageZoom,
    top: middlewareData.arrow?.y == null ? undefined : middlewareData.arrow.y / pageZoom,
    [staticSide]: `${-5 / pageZoom}px`,
  };
  const floatingStyle: CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    transform: `translate(${(x ?? 0) / pageZoom}px, ${(y ?? 0) / pageZoom}px)`,
    visibility: isPositioned ? "visible" : "hidden",
  };
  const card = (
    <section
      ref={setFloatingRef}
      className={`quick-start-guide${className ? ` ${className}` : ""}${docked ? " is-docked" : ""}${
        !target && !docked ? " is-corner" : ""
      }`}
      style={docked || !target ? undefined : floatingStyle}
      role={role}
      aria-modal={role === "dialog" ? "false" : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={focusOnOpen ? -1 : undefined}
    >
      {children(positionControl)}
      {!docked && targetElement && (
        <div ref={arrowRef} className="quick-start-guide__arrow" style={arrowStyle} aria-hidden="true" />
      )}
    </section>
  );

  return (
    <>
      {targetRect &&
        createPortal(
          <div
            className="quick-start-guide__highlight"
            aria-hidden="true"
            style={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height,
              borderRadius: targetRect.borderRadius,
            }}
          />,
          document.body,
        )}
      {createPortal(card, docked && portalHost ? portalHost : document.body)}
    </>
  );
}
