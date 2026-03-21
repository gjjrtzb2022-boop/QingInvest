"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import type { HomeMarketView, HomeOrnamentsPayload, HomeSentimentView } from "@/lib/home-ornaments-types";

const HOVER_DELAY_MS = 760;
const ICON_SIZE = 138;
const CARD_WIDTH = 308;
const CARD_GAP = 16;
const GROUP_WIDTH = ICON_SIZE + CARD_GAP + CARD_WIDTH;
const POLL_INTERVAL_MS = 90_000;

export function HeroMarketOrnaments() {
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(0);
  const [payload, setPayload] = useState<HomeOrnamentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/home/ornaments", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "ornament-fetch-failed");
      }
      setPayload(data as HomeOrnamentsPayload);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "ornament-fetch-failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const safeLoad = async () => {
      if (!active) return;
      await load();
    };

    void safeLoad();

    const timer = window.setInterval(() => {
      void safeLoad();
    }, POLL_INTERVAL_MS);

    const handleFocusRefresh = () => {
      if (document.visibilityState === "visible") {
        void safeLoad();
      }
    };

    window.addEventListener("focus", handleFocusRefresh);
    document.addEventListener("visibilitychange", handleFocusRefresh);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocusRefresh);
      document.removeEventListener("visibilitychange", handleFocusRefresh);
    };
  }, [load]);

  const marketViews = payload?.marketViews || [];
  const sentimentViews = payload?.sentimentViews || [];
  const activeMarket = marketViews[leftIndex] || null;
  const activeSentiment = sentimentViews[rightIndex] || null;

  return (
    <>
      <HeroOrnament
        side="left"
        kind="market"
        title={activeMarket?.label || "市场广度"}
        onCycle={() => {
          if (marketViews.length > 0) {
            setLeftIndex((prev) => (prev + 1) % marketViews.length);
          }
        }}
        card={
          <MarketInfoCard
            activeKey={activeMarket?.key || "loading"}
            views={marketViews}
            view={activeMarket}
            loading={loading}
            error={error}
            onSelect={(key) => {
              const next = marketViews.findIndex((item) => item.key === key);
              if (next >= 0) setLeftIndex(next);
            }}
          />
        }
      />
      <HeroOrnament
        side="right"
        kind="sentiment"
        title={activeSentiment?.label || "情绪面板"}
        onCycle={() => {
          if (sentimentViews.length > 0) {
            setRightIndex((prev) => (prev + 1) % sentimentViews.length);
          }
        }}
        card={
          <SentimentInfoCard
            activeKey={activeSentiment?.key || "loading"}
            views={sentimentViews}
            view={activeSentiment}
            loading={loading}
            error={error}
            onSelect={(key) => {
              const next = sentimentViews.findIndex((item) => item.key === key);
              if (next >= 0) setRightIndex(next);
            }}
          />
        }
      />
    </>
  );
}

function HeroOrnament({
  side,
  kind,
  title,
  card,
  onCycle
}: {
  side: "left" | "right";
  kind: "market" | "sentiment";
  title: string;
  card: ReactNode;
  onCycle: () => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const ropeBackRef = useRef<SVGPathElement | null>(null);
  const ropeMainRef = useRef<SVGPathElement | null>(null);
  const ropeHeadRef = useRef<SVGCircleElement | null>(null);
  const ropeTailRef = useRef<SVGCircleElement | null>(null);
  const physicsRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    vAngle: 0,
    targetX: 0,
    targetY: 0,
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    stiffness: 0.025,
    damping: 0.925,
    mass: 1.65
  });

  const hoverTimerRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const hoverLockedRef = useRef(false);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const pivotX = side === "left" ? ICON_SIZE / 2 : GROUP_WIDTH - ICON_SIZE / 2;

  const updateTarget = useCallback(() => {
    const layer = layerRef.current;
    const state = physicsRef.current;
    const width = layer?.offsetWidth || window.innerWidth;
    state.targetX = side === "left" ? 114 : width - 114;
    state.targetY = 64;

    if (!state.isDragging && state.x === 0 && state.y === 0) {
      state.x = state.targetX;
      state.y = state.targetY;
    }
  }, [side]);

  useEffect(() => {
    updateTarget();
    window.addEventListener("resize", updateTarget);

    const idlePhase = side === "left" ? 0 : Math.PI * 0.7;

    const loop = (time: number) => {
      const state = physicsRef.current;

      if (!state.isDragging) {
        const idleTargetX = state.targetX + Math.sin(time * 0.00115 + idlePhase) * 8;
        const idleTargetY = state.targetY + Math.cos(time * 0.00155 + idlePhase * 0.6) * 3;

        const forceX = (idleTargetX - state.x) * state.stiffness;
        const forceY = (idleTargetY - state.y) * state.stiffness;
        const ax = forceX / state.mass;
        const ay = forceY / state.mass;

        state.vx = (state.vx + ax) * state.damping;
        state.vy = (state.vy + ay) * state.damping;
        state.x += state.vx;
        state.y += state.vy;

        const targetAngle = (state.x - idleTargetX) * 0.055 + Math.sin(time * 0.0013 + idlePhase) * 1.8;
        const angleForce = (targetAngle - state.angle) * 0.06;
        state.vAngle = (state.vAngle + angleForce) * 0.9;
        state.angle += state.vAngle;
      } else {
        const targetAngle = (state.x - state.targetX) * 0.03;
        state.angle += (targetAngle - state.angle) * 0.12;
      }

      if (groupRef.current && ropeBackRef.current && ropeMainRef.current) {
        groupRef.current.style.left = `${state.x - pivotX}px`;
        groupRef.current.style.top = `${state.y}px`;
        groupRef.current.style.transform = `rotate(${state.angle}deg)`;

        const startX = state.targetX;
        const startY = 0;
        const endX = state.x;
        const endY = state.y;
        const ropePath = buildRopePath({
          startX,
          startY,
          endX,
          endY,
          velocityX: state.vx,
          velocityY: state.vy
        });

        ropeBackRef.current.setAttribute("d", ropePath);
        ropeMainRef.current.setAttribute("d", ropePath);
        if (ropeHeadRef.current) {
          ropeHeadRef.current.setAttribute("cx", `${startX}`);
          ropeHeadRef.current.setAttribute("cy", `${startY}`);
        }
        if (ropeTailRef.current) {
          ropeTailRef.current.setAttribute("cx", `${endX}`);
          ropeTailRef.current.setAttribute("cy", `${endY}`);
        }
      }

      animationRef.current = window.requestAnimationFrame(loop);
    };

    animationRef.current = window.requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", updateTarget);
      if (animationRef.current !== null) window.cancelAnimationFrame(animationRef.current);
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    };
  }, [pivotX, side, updateTarget]);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (hoverLockedRef.current || physicsRef.current.isDragging) return;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      if (!hoverLockedRef.current && !physicsRef.current.isDragging) {
        setOpen(true);
      }
    }, HOVER_DELAY_MS);
  }, [clearHoverTimer]);

  const handleMouseLeave = useCallback(() => {
    clearHoverTimer();
    hoverLockedRef.current = false;
    setOpen(false);
  }, [clearHoverTimer]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const layerRect = layerRef.current?.getBoundingClientRect();
      const state = physicsRef.current;
      if (!layerRect) return;

      clearHoverTimer();
      setOpen(false);
      setDragging(true);
      state.isDragging = true;
      movedRef.current = false;
      hoverLockedRef.current = true;
      state.vx = 0;
      state.vy = 0;
      state.vAngle = 0;
      state.dragOffsetX = event.clientX - layerRect.left - state.x;
      state.dragOffsetY = event.clientY - layerRect.top - state.y;

      const handleMove = (moveEvent: PointerEvent) => {
        const nextX = moveEvent.clientX - layerRect.left - state.dragOffsetX;
        const nextY = moveEvent.clientY - layerRect.top - state.dragOffsetY;
        if (Math.abs(nextX - state.x) > 3 || Math.abs(nextY - state.y) > 3) {
          movedRef.current = true;
        }
        state.vx = nextX - state.x;
        state.vy = nextY - state.y;
        state.x = nextX;
        state.y = nextY;
      };

      const handleUp = () => {
        state.isDragging = false;
        setDragging(false);
        setOpen(false);
        suppressClickRef.current = movedRef.current;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [clearHoverTimer]
  );

  const handleIconClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onCycle();
  }, [onCycle]);

  return (
    <div ref={layerRef} className={`hero-ornament-layer ${side}`} aria-hidden="true">
      <svg className="hero-ornament-rope" width="100%" height="100%">
        <path ref={ropeBackRef} className="hero-ornament-rope-shadow" />
        <path ref={ropeMainRef} className="hero-ornament-rope-main" />
        <circle ref={ropeHeadRef} className="hero-ornament-rope-head" r="4.8" />
        <circle ref={ropeTailRef} className="hero-ornament-rope-tail" r="4.1" />
      </svg>
      <div
        ref={groupRef}
        className={`hero-ornament-group ${side} ${open ? "is-open" : ""} ${dragging ? "is-dragging" : ""}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <button
          type="button"
          className={`hero-ornament-icon ${kind}`}
          onPointerDown={handlePointerDown}
          onClick={handleIconClick}
          aria-label={title}
        >
          <span className="hero-ornament-badge">{kind === "market" ? "涨" : "势"}</span>
          <span className="hero-ornament-inner-ring" />
          {kind === "market" ? <MarketGlyph /> : <SentimentGlyph />}
        </button>
        <div className={`hero-ornament-card ${open ? "visible" : ""}`}>{card}</div>
      </div>
    </div>
  );
}

function buildRopePath({
  startX,
  startY,
  endX,
  endY,
  velocityX,
  velocityY
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  velocityX: number;
  velocityY: number;
}) {
  const dx = endX - startX;
  const dy = endY - startY;
  const stretch = Math.hypot(dx, dy);
  const sag = Math.min(180, 16 + stretch * 0.14 + Math.abs(dx) * 0.08 + Math.max(0, velocityY) * 2.4);
  const lateral = clamp(dx * 0.22 + velocityX * 7.5, -84, 84);

  const c1x = startX + dx * 0.12 + lateral * 0.18;
  const c1y = startY + dy * 0.2 + sag * 0.18;
  const c2x = startX + dx * 0.84 - lateral * 0.22;
  const c2y = startY + dy * 0.78 + sag;

  return `M ${startX.toFixed(2)} ${startY.toFixed(2)} C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${endX.toFixed(2)} ${endY.toFixed(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function MarketGlyph() {
  return (
    <span className="hero-market-glyph" aria-hidden="true">
      <span className="hero-market-bars">
        <i />
        <i />
        <i />
      </span>
      <svg viewBox="0 0 84 84" className="hero-market-line">
        <path d="M13 57 L27 43 L39 47 L52 33 L68 19" />
        <path d="M59 19 H68 V28" />
      </svg>
    </span>
  );
}

function SentimentGlyph() {
  return (
    <span className="hero-sentiment-glyph" aria-hidden="true">
      <span className="hero-sentiment-arc" />
      <span className="hero-sentiment-needle" />
      <span className="hero-sentiment-hub" />
    </span>
  );
}

function MarketInfoCard({
  activeKey,
  view,
  views,
  loading,
  error,
  onSelect
}: {
  activeKey: string;
  view: HomeMarketView | null;
  views: HomeMarketView[];
  loading: boolean;
  error: string | null;
  onSelect: (key: string) => void;
}) {
  if (loading && !view) {
    return <InfoStateCard text="正在抓取真实市场数据..." />;
  }

  if (error && !view) {
    return <InfoStateCard text={`抓取失败：${error}`} tone="error" />;
  }

  if (!view) {
    return <InfoStateCard text="暂无市场数据。" />;
  }

  return (
    <div className="hero-card-shell market-card-shell">
      <div className="hero-card-line major">
        <span>{view.primary.label}:</span>
        <strong className={toneClassName(view.primary.tone)}>{view.primary.value}</strong>
      </div>
      <div className="hero-card-line major">
        <span>{view.secondary.label}:</span>
        <strong className={toneClassName(view.secondary.tone)}>{view.secondary.value}</strong>
      </div>
      <div className="hero-card-market-tabs">
        {views.map((item) => (
          <button key={item.key} type="button" className={item.key === activeKey ? "active" : ""} onClick={() => onSelect(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="hero-card-indices">
        {view.indices.map((item) => (
          <div key={`${view.key}-${item.name}`} className="hero-card-index-row">
            <span className="name">{item.name}</span>
            <span className="price">{item.price}</span>
            <strong className={toneClassName(item.tone)}>{item.change}</strong>
          </div>
        ))}
      </div>
      <p className="hero-card-note">{view.note}</p>
    </div>
  );
}

function SentimentInfoCard({
  activeKey,
  view,
  views,
  loading,
  error,
  onSelect
}: {
  activeKey: string;
  view: HomeSentimentView | null;
  views: HomeSentimentView[];
  loading: boolean;
  error: string | null;
  onSelect: (key: string) => void;
}) {
  if (loading && !view) {
    return <InfoStateCard text="正在汇总情绪与资讯..." />;
  }

  if (error && !view) {
    return <InfoStateCard text={`抓取失败：${error}`} tone="error" />;
  }

  if (!view) {
    return <InfoStateCard text="暂无情绪数据。" />;
  }

  return (
    <div className="hero-card-shell sentiment-card-shell">
      <div className="hero-card-line major">
        <span>{view.label}:</span>
        <strong>{view.mode === "sentiment" ? `${view.score}（${view.summary}）` : view.summary}</strong>
      </div>
      <div className="hero-card-line major">
        <span>新闻条数:</span>
        <strong>{view.newsCount} 条</strong>
      </div>
      <div className="hero-card-market-tabs sentiment-tabs">
        {views.map((item) => (
          <button key={item.key} type="button" className={item.key === activeKey ? "active" : ""} onClick={() => onSelect(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="hero-sentiment-summary">
        <span className="hero-sentiment-orb" aria-hidden="true" />
        <div>
          <strong>{view.headline}</strong>
          <p>{view.description}</p>
        </div>
      </div>
      {view.components && view.components.length > 0 ? (
        <div className="hero-sentiment-components">
          {view.components.map((item) => (
            <div key={`${view.key}-${item.label}`} className="hero-sentiment-component">
              <span>{item.label}</span>
              <strong className={toneClassName(item.tone)}>{item.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <ul className="hero-sentiment-points">
        {view.highlights.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="hero-card-note">{view.note}</p>
    </div>
  );
}

function InfoStateCard({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "error" }) {
  return (
    <div className={`hero-card-shell hero-card-state ${tone === "error" ? "is-error" : ""}`}>
      <p>{text}</p>
    </div>
  );
}

function toneClassName(tone?: string) {
  if (tone === "up") return "up";
  if (tone === "down") return "down";
  return "neutral";
}
