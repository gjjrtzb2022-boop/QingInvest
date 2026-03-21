"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readEffectiveStatuses,
  normalizeArticleStatus,
  setManagedStatus,
  type ArticleUserStatus
} from "@/lib/client/article-user-state";

type ArticleStateToggleProps = {
  articleSlug: string;
  defaultState: ArticleUserStatus;
  variant?: "default" | "detail";
};

export function ArticleStateToggle({ articleSlug, defaultState, variant = "default" }: ArticleStateToggleProps) {
  const normalizedDefault = useMemo(() => normalizeArticleStatus(defaultState), [defaultState]);
  const [state, setState] = useState<ArticleUserStatus>(normalizedDefault);

  useEffect(() => {
    let cancelled = false;

    void readEffectiveStatuses([articleSlug]).then((map) => {
      if (cancelled) return;
      const stored = map[articleSlug];
      if (stored) {
        setState(stored);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [articleSlug]);

  const setAndPersist = (next: ArticleUserStatus) => {
    setState(next);
    void setManagedStatus(articleSlug, next);
  };

  if (variant === "detail") {
    return (
      <div className="article-state-row">
        <div className="article-state-group">
          <button
            type="button"
            className={`article-state-btn ${state === "unread" ? "active" : ""}`}
            onClick={() => setAndPersist("unread")}
          >
            <span aria-hidden="true">◷</span>
            待阅
          </button>
          <button
            type="button"
            className={`article-state-btn ${state === "read" ? "active" : ""}`}
            onClick={() => setAndPersist("read")}
          >
            <span aria-hidden="true">✓</span>
            已读
          </button>
        </div>
        <button
          type="button"
          className={`article-favorite-btn ${state === "favorite" ? "active" : ""}`}
          onClick={() => setAndPersist("favorite")}
        >
          <span aria-hidden="true">☆</span>
          收藏
        </button>
      </div>
    );
  }

  return (
    <div className="chip-placeholder-row">
      <button
        type="button"
        className={`status-pill ${state === "unread" ? "active" : ""}`}
        onClick={() => setAndPersist("unread")}
      >
        待阅
      </button>
      <button
        type="button"
        className={`status-pill ${state === "read" ? "active" : ""}`}
        onClick={() => setAndPersist("read")}
      >
        已读
      </button>
      <button
        type="button"
        className={`status-pill ${state === "favorite" ? "active" : ""}`}
        onClick={() => setAndPersist("favorite")}
      >
        收藏
      </button>
    </div>
  );
}
