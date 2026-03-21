"use client";

import { useMemo, useState, type ReactNode } from "react";

type ArticleDetailLayoutProps = {
  left: ReactNode;
  main: ReactNode;
  right: ReactNode;
};

export function ArticleDetailLayout({ left, main, right }: ArticleDetailLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const shellClassName = useMemo(() => {
    return [
      "article-detail-shell",
      leftCollapsed ? "is-left-collapsed" : "",
      rightCollapsed ? "is-right-collapsed" : "",
      leftCollapsed && rightCollapsed ? "is-immersive" : ""
    ]
      .filter(Boolean)
      .join(" ");
  }, [leftCollapsed, rightCollapsed]);

  return (
    <section className="article-detail-layout">
      <div className={shellClassName}>
        <aside
          className={`article-directory-aside ${leftCollapsed ? "collapsed" : ""}`}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (!target.closest("[data-toggle-left-sidebar]")) return;
            event.preventDefault();
            setLeftCollapsed((value) => !value);
          }}
        >
          {left}
        </aside>
        <div className="article-gap-rail left">
          {leftCollapsed ? (
            <button
              type="button"
              className="article-gap-toggle left collapsed"
              onClick={() => setLeftCollapsed(false)}
              aria-label="展开左侧文章专题"
              title="展开左侧文章专题"
            >
              <span className="article-gap-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                  <path d="m5.5 3.5 4.5 4.5-4.5 4.5" />
                </svg>
              </span>
              <span className="article-gap-toggle-text">文章专题</span>
            </button>
          ) : null}
        </div>
        <div className="article-main-stage">
          {main}
        </div>
        <div className="article-gap-rail right">
          {rightCollapsed ? (
            <button
              type="button"
              className="article-gap-toggle right collapsed"
              onClick={() => setRightCollapsed(false)}
              aria-label="展开右侧目录"
              title="展开右侧目录"
            >
              <span className="article-gap-toggle-text">目录</span>
              <span className="article-gap-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                  <path d="M10.5 3.5 6 8l4.5 4.5" />
                </svg>
              </span>
            </button>
          ) : null}
        </div>
        <aside
          className={`article-detail-right ${rightCollapsed ? "collapsed" : ""}`}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (!target.closest("[data-toggle-right-sidebar]")) return;
            event.preventDefault();
            setRightCollapsed((value) => !value);
          }}
        >
          {right}
        </aside>
      </div>
    </section>
  );
}
