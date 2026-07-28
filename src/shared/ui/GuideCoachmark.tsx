import { Move } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

type PlacementSide = "top" | "right" | "bottom" | "left";

type TargetRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  borderRadius: string;
};

type SafeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type GuidePosition = {
  x: number;
  y: number;
  side: PlacementSide;
  availableHeight: number;
};

type GuideCoachmarkProps = {
  active: boolean;
  target?: string;
  targetPadding?: number;
  initialPlacement?: PlacementSide;
  className?: string;
  role?: "dialog" | "region";
  labelledBy: string;
  describedBy: string;
  focusKey?: string | number;
  focusOnOpen?: boolean;
  deferFallbackMs?: number;
  revealAfterStableMs?: number;
  children: (positionControl: ReactNode) => ReactNode;
};

const viewportGap = 16;
const targetGap = 14;
const highlightOuterSpread = 4;
const layoutSettlementDelays = [0, 50, 150, 300, 600, 1000];
const automaticPlacements: PlacementSide[] = ["bottom", "top", "right", "left"];
const placementModes: ReadonlyArray<{ side?: PlacementSide; announcement: string }> = [
  { announcement: "Tutorial em posição automática." },
  { side: "right", announcement: "Tutorial movido para a direita." },
  { side: "left", announcement: "Tutorial movido para a esquerda." },
  { side: "bottom", announcement: "Tutorial movido para baixo." },
  { side: "top", announcement: "Tutorial movido para cima." },
];

function readPageZoom() {
  const zoom = Number.parseFloat(
    window.getComputedStyle(document.body).zoom ||
      document.body.style.getPropertyValue("zoom") ||
      window.getComputedStyle(document.documentElement).getPropertyValue("--app-zoom"),
  );
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function readSafeInsets(): SafeInsets {
  const titlebar = document.querySelector<HTMLElement>(".window-titlebar");
  const titlebarBottom = titlebar?.getBoundingClientRect().bottom ?? 0;
  return {
    top: Math.max(viewportGap, titlebarBottom + viewportGap),
    right: viewportGap,
    bottom: viewportGap,
    left: viewportGap,
  };
}

function visibleRect(element: Element, padding = 0, pageZoom = 1): TargetRect | undefined {
  const rect = element.getBoundingClientRect();
  const titlebar = document.querySelector<HTMLElement>(".window-titlebar");
  const visibleTop = titlebar
    ? Math.max(rect.top - padding, titlebar.getBoundingClientRect().bottom + highlightOuterSpread * pageZoom)
    : rect.top - padding;
  const visibleBottom = rect.bottom + padding;
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.right <= 0 ||
    rect.left >= window.innerWidth ||
    visibleBottom <= visibleTop ||
    visibleBottom <= 0 ||
    visibleTop >= window.innerHeight
  ) {
    return undefined;
  }
  const borderRadius = window.getComputedStyle(element).borderRadius;
  return {
    top: visibleTop,
    right: rect.right + padding,
    bottom: visibleBottom,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: visibleBottom - visibleTop,
    borderRadius: borderRadius === "0px" ? "var(--radius-lg)" : borderRadius,
  };
}

function sameRect(current: TargetRect | undefined, next: TargetRect | undefined) {
  if (!current || !next) return current === next;
  return (
    Math.abs(current.top - next.top) < 0.5 &&
    Math.abs(current.right - next.right) < 0.5 &&
    Math.abs(current.bottom - next.bottom) < 0.5 &&
    Math.abs(current.left - next.left) < 0.5 &&
    Math.abs(current.width - next.width) < 0.5 &&
    Math.abs(current.height - next.height) < 0.5 &&
    current.borderRadius === next.borderRadius
  );
}

function samePosition(current: GuidePosition | undefined, next: GuidePosition | undefined) {
  if (!current || !next) return current === next;
  return (
    current.side === next.side &&
    Math.abs(current.x - next.x) < 0.5 &&
    Math.abs(current.y - next.y) < 0.5 &&
    Math.abs(current.availableHeight - next.availableHeight) < 0.5
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function availableSpace(side: PlacementSide, target: TargetRect, insets: SafeInsets) {
  if (side === "bottom") return Math.max(0, window.innerHeight - insets.bottom - target.bottom - targetGap);
  if (side === "top") return Math.max(0, target.top - targetGap - insets.top);
  if (side === "right") return Math.max(0, window.innerWidth - insets.right - target.right - targetGap);
  return Math.max(0, target.left - targetGap - insets.left);
}

function choosePlacement(
  modeIndex: number,
  initialPlacement: PlacementSide | undefined,
  target: TargetRect,
  insets: SafeInsets,
  cardWidth: number,
  cardHeight: number,
) {
  const manualPlacement = placementModes[modeIndex]?.side;
  if (modeIndex > 0 && manualPlacement) return manualPlacement;

  const preferred = initialPlacement;
  const candidates = preferred
    ? [preferred, ...automaticPlacements.filter((candidate) => candidate !== preferred)]
    : automaticPlacements;
  const fits = candidates.find((side) => {
    const required = side === "top" || side === "bottom" ? cardHeight : cardWidth;
    return availableSpace(side, target, insets) >= required;
  });
  if (fits) return fits;
  return candidates.reduce((best, candidate) =>
    availableSpace(candidate, target, insets) > availableSpace(best, target, insets) ? candidate : best,
  );
}

export function GuideCoachmark({
  active,
  target,
  targetPadding = 0,
  initialPlacement,
  className = "",
  role = "dialog",
  labelledBy,
  describedBy,
  focusKey,
  focusOnOpen = false,
  deferFallbackMs = 0,
  revealAfterStableMs = 0,
  children,
}: GuideCoachmarkProps) {
  const readinessKey = `${String(focusKey ?? "")}::${target ?? ""}`;
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [targetRect, setTargetRect] = useState<TargetRect>();
  const [position, setPosition] = useState<GuidePosition>();
  const [placementModeIndex, setPlacementModeIndex] = useState(0);
  const [positionAnnouncement, setPositionAnnouncement] = useState("");
  const [pageZoom, setPageZoom] = useState(readPageZoom);
  const [fallbackReadyKey, setFallbackReadyKey] = useState<string>();
  const [stableGeometryKey, setStableGeometryKey] = useState<string>();
  const cardRef = useRef<HTMLElement | null>(null);
  const scrolledTarget = useRef<string | undefined>(undefined);
  const geometryKey =
    targetRect && position
      ? [
          readinessKey,
          pageZoom,
          targetRect.top,
          targetRect.right,
          targetRect.bottom,
          targetRect.left,
          targetRect.width,
          targetRect.height,
          position.x,
          position.y,
          position.side,
          position.availableHeight,
        ].join(":")
      : undefined;

  const updatePosition = useCallback(() => {
    const zoom = readPageZoom();
    setPageZoom((current) => (current === zoom ? current : zoom));
    const measuredTarget = targetElement ? visibleRect(targetElement, targetPadding * zoom, zoom) : undefined;
    setTargetRect((current) => (sameRect(current, measuredTarget) ? current : measuredTarget));
    const card = cardRef.current;
    if (!measuredTarget || !card) {
      setPosition((current) => (current ? undefined : current));
      return;
    }

    const insets = readSafeInsets();
    const cardRect = card.getBoundingClientRect();
    const naturalWidth = cardRect.width;
    const naturalHeight = Math.max(cardRect.height, (card.scrollHeight + 2) * zoom);
    const side = choosePlacement(
      placementModeIndex,
      initialPlacement,
      measuredTarget,
      insets,
      naturalWidth,
      naturalHeight,
    );
    const mainSpace = availableSpace(side, measuredTarget, insets);
    const viewportHeight = Math.max(0, window.innerHeight - insets.top - insets.bottom);
    const availableHeight = side === "top" || side === "bottom" ? mainSpace : viewportHeight;
    const renderedHeight = Math.min(naturalHeight, availableHeight);
    const maxX = window.innerWidth - insets.right - naturalWidth;
    const maxY = window.innerHeight - insets.bottom - renderedHeight;
    let x = measuredTarget.left;
    let y = measuredTarget.bottom + targetGap;

    if (side === "top") y = measuredTarget.top - targetGap - renderedHeight;
    if (side === "right") {
      x = measuredTarget.right + targetGap;
      y = measuredTarget.top;
    }
    if (side === "left") {
      x = measuredTarget.left - targetGap - naturalWidth;
      y = measuredTarget.top;
    }

    const nextPosition = {
      x: clamp(x, insets.left, maxX),
      y: clamp(y, insets.top, maxY),
      side,
      availableHeight,
    };
    setPosition((current) => (samePosition(current, nextPosition) ? current : nextPosition));
  }, [initialPlacement, placementModeIndex, targetElement, targetPadding]);

  useLayoutEffect(() => {
    if (!active || !target) {
      setTargetElement(null);
      setTargetRect(undefined);
      setPosition(undefined);
      return;
    }

    setTargetElement(null);
    setTargetRect(undefined);
    setPosition(undefined);
    let currentTarget: HTMLElement | null = null;
    const findTarget = () => {
      const nextTarget = document.querySelector<HTMLElement>(target);
      if (nextTarget === currentTarget) return;
      currentTarget = nextTarget;
      setTargetElement(nextTarget);
      if (nextTarget && scrolledTarget.current !== target) {
        scrolledTarget.current = target;
        nextTarget.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
        const safeTop = readSafeInsets().top;
        const topAdjustment = nextTarget.getBoundingClientRect().top - safeTop - targetPadding * readPageZoom();
        if (Math.abs(topAdjustment) >= 0.5 && document.scrollingElement) {
          document.scrollingElement.scrollTop += topAdjustment;
        }
      }
    };

    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-import-tutorial", "data-quick-guide"],
      childList: true,
      subtree: true,
    });
    document.addEventListener("animationend", findTarget, true);
    findTarget();
    return () => {
      observer.disconnect();
      document.removeEventListener("animationend", findTarget, true);
    };
  }, [active, target, targetPadding]);

  useLayoutEffect(() => {
    if (!active || !targetElement) return;
    let frame = 0;
    const settlementTimers = new Set<number>();
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    };
    const settleLayout = () => {
      for (const delay of layoutSettlementDelays) {
        const timer = window.setTimeout(() => {
          settlementTimers.delete(timer);
          schedule();
        }, delay);
        settlementTimers.add(timer);
      }
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    resizeObserver?.observe(targetElement);
    if (cardRef.current) resizeObserver?.observe(cardRef.current);
    const layoutObserver = new MutationObserver(schedule);
    layoutObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-busy", "class", "style"],
      childList: true,
      subtree: true,
    });
    const zoomObserver = new MutationObserver(schedule);
    zoomObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    zoomObserver.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("scrollend", schedule, true);
    document.addEventListener("transitionend", schedule, true);
    document.addEventListener("animationend", schedule, true);
    window.addEventListener("load", settleLayout);
    window.addEventListener("pageshow", settleLayout);
    void document.fonts?.ready.then(settleLayout);
    settleLayout();
    return () => {
      window.cancelAnimationFrame(frame);
      for (const timer of settlementTimers) window.clearTimeout(timer);
      settlementTimers.clear();
      resizeObserver?.disconnect();
      layoutObserver.disconnect();
      zoomObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("scrollend", schedule, true);
      document.removeEventListener("transitionend", schedule, true);
      document.removeEventListener("animationend", schedule, true);
      window.removeEventListener("load", settleLayout);
      window.removeEventListener("pageshow", settleLayout);
    };
  }, [active, targetElement, updatePosition]);

  useEffect(() => {
    setPlacementModeIndex(0);
    setPositionAnnouncement("");
  }, [target]);

  useEffect(() => {
    if (!active || deferFallbackMs === 0) return;
    const timer = window.setTimeout(() => setFallbackReadyKey(readinessKey), deferFallbackMs);
    return () => window.clearTimeout(timer);
  }, [active, deferFallbackMs, readinessKey]);

  useEffect(() => {
    if (!active || revealAfterStableMs === 0 || !geometryKey) return;
    const timer = window.setTimeout(() => setStableGeometryKey(geometryKey), revealAfterStableMs);
    return () => window.clearTimeout(timer);
  }, [active, geometryKey, revealAfterStableMs]);

  useEffect(() => {
    if (!active || !focusOnOpen) return;
    cardRef.current?.focus({ preventScroll: true });
  }, [active, focusKey, focusOnOpen]);

  if (!active) return null;

  const move = () => {
    setPlacementModeIndex((current) => {
      const next = (current + 1) % placementModes.length;
      setPositionAnnouncement(placementModes[next].announcement);
      return next;
    });
  };

  const positionControl = target ? (
    <>
      <button
        className="icon-button quick-start-guide__move"
        type="button"
        aria-label="Mover tutorial"
        title="Mover tutorial"
        onClick={move}
      >
        <Move size={16} />
      </button>
      <span className="quick-start-guide__announcement" aria-live="polite">
        {positionAnnouncement}
      </span>
    </>
  ) : null;

  const awaitingPosition = !targetElement || !targetRect || !position;
  const fallbackReady = deferFallbackMs === 0 || fallbackReadyKey === readinessKey;
  const layoutReady = revealAfterStableMs === 0 || (geometryKey !== undefined && stableGeometryKey === geometryKey);
  const concealUntilPositioned =
    placementModeIndex > 0 ? awaitingPosition && !fallbackReady : awaitingPosition ? !fallbackReady : !layoutReady;
  const floatingStyle = position
    ? ({
        position: "fixed",
        top: 0,
        left: 0,
        transform: `translate(${position.x / pageZoom}px, ${position.y / pageZoom}px)`,
        "--guide-available-height": `${position.availableHeight / pageZoom}px`,
      } as CSSProperties)
    : undefined;
  const cardWidth = (cardRef.current?.getBoundingClientRect().width ?? 0) / pageZoom;
  const cardHeight = (cardRef.current?.getBoundingClientRect().height ?? 0) / pageZoom;
  const targetCenterX = targetRect ? (targetRect.left + targetRect.right) / 2 : 0;
  const targetCenterY = targetRect ? (targetRect.top + targetRect.bottom) / 2 : 0;
  let arrowStyle: CSSProperties | undefined;
  if (position && targetRect) {
    if (position.side === "top" || position.side === "bottom") {
      const localX = clamp((targetCenterX - position.x) / pageZoom, 12, cardWidth - 12) - 5;
      arrowStyle = {
        left: localX,
        [position.side === "top" ? "bottom" : "top"]: "-5px",
      };
    } else {
      const localY = clamp((targetCenterY - position.y) / pageZoom, 12, cardHeight - 12) - 5;
      arrowStyle = {
        top: localY,
        [position.side === "left" ? "right" : "left"]: "-5px",
      };
    }
  }

  const card = (
    <section
      ref={cardRef}
      className={`quick-start-guide${className ? ` ${className}` : ""}${awaitingPosition ? " is-corner" : ""}`}
      role={role}
      aria-modal={role === "dialog" ? "false" : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={focusOnOpen ? -1 : undefined}
    >
      {children(positionControl)}
    </section>
  );
  const positionedCard = (
    <div
      className={`quick-start-guide-positioner${awaitingPosition ? " is-corner" : ""}`}
      data-placement={position?.side}
      style={
        concealUntilPositioned ? { opacity: 0, pointerEvents: "none" } : awaitingPosition ? undefined : floatingStyle
      }
    >
      {card}
      {!awaitingPosition && arrowStyle && (
        <div className="quick-start-guide__arrow" style={arrowStyle} aria-hidden="true" />
      )}
    </div>
  );

  return (
    <>
      {targetRect &&
        createPortal(
          <div
            className="quick-start-guide__highlight"
            aria-hidden="true"
            style={{
              top: targetRect.top / pageZoom,
              left: targetRect.left / pageZoom,
              width: targetRect.width / pageZoom,
              height: targetRect.height / pageZoom,
              borderRadius: targetRect.borderRadius,
            }}
          />,
          document.body,
        )}
      {createPortal(positionedCard, document.body)}
    </>
  );
}
