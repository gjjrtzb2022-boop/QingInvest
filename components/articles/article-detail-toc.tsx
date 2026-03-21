"use client";

import { useEffect, useMemo, useState } from "react";
import type { ArticleHeading } from "@/lib/articles";

const BODY_SECTION_ID = "articleBodySection";
const RELATED_SECTION_ID = "relatedContentSection";
const ACTIVE_OFFSET = 118;

type ArticleDetailTocProps = {
  headings: ArticleHeading[];
};

type TocItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

export function ArticleDetailToc({ headings }: ArticleDetailTocProps) {
  const items = useMemo<TocItem[]>(
    () => [
      { id: BODY_SECTION_ID, text: "正文内容", level: 2 },
      ...headings.map((item) => ({ id: item.id, text: item.text, level: item.level })),
      { id: RELATED_SECTION_ID, text: "相关阅读", level: 2 }
    ],
    [headings]
  );

  const [activeId, setActiveId] = useState(BODY_SECTION_ID);

  useEffect(() => {
    if (items.length === 0) return;

    let frame = 0;

    const updateActiveId = () => {
      frame = 0;

      const existing = items.filter((item) => document.getElementById(item.id));
      if (existing.length === 0) return;

      let current = existing[0].id;
      for (const item of existing) {
        const element = document.getElementById(item.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top - ACTIVE_OFFSET <= 0) {
          current = item.id;
          continue;
        }
        break;
      }

      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = existing[existing.length - 1].id;
      }

      setActiveId((prev) => (prev === current ? prev : current));
    };

    const queueUpdate = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(updateActiveId);
    };

    queueUpdate();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);
    window.addEventListener("hashchange", queueUpdate);

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
      window.removeEventListener("hashchange", queueUpdate);
    };
  }, [items]);

  return (
    <ul className="article-right-toc">
      {items.map((item, index) => {
        const isActive = item.id === activeId;
        return (
          <li key={`${item.id}-${index}`} className={`${isActive ? "active" : ""} level-${item.level}`}>
            <a href={`#${item.id}`} aria-current={isActive ? "location" : undefined}>
              {item.text}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
