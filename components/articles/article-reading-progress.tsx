"use client";

import { useEffect, useRef } from "react";

const READ_CURSOR_OFFSET = 112;

type ArticleReadingProgressProps = {
  articleRootId: string;
  completeAtId?: string;
};

export function ArticleReadingProgress({ articleRootId, completeAtId }: ArticleReadingProgressProps) {
  const fillRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let frame = 0;

    const updateProgress = () => {
      frame = 0;
      const root = document.getElementById(articleRootId);
      const fill = fillRef.current;
      if (!root || !fill) return;

      const rect = root.getBoundingClientRect();
      const start = window.scrollY + rect.top;
      const cursor = window.scrollY + READ_CURSOR_OFFSET;
      const completeTarget = completeAtId ? document.getElementById(completeAtId) : null;
      const completeAt = completeTarget
        ? window.scrollY + completeTarget.getBoundingClientRect().top
        : start + rect.height;
      const progress = cursor >= completeAt ? 1 : Math.min(1, Math.max(0, (cursor - start) / Math.max(completeAt - start, 1)));

      fill.style.transform = `scaleX(${progress.toFixed(4)})`;
    };

    const queueUpdate = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(updateProgress);
    };

    queueUpdate();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
    };
  }, [articleRootId, completeAtId]);

  return (
    <div className="article-reading-progress" aria-hidden="true">
      <span ref={fillRef} />
    </div>
  );
}
