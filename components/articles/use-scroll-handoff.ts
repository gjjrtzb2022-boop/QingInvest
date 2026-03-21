"use client";

import { useEffect, type RefObject } from "react";

type ScrollableRef = RefObject<HTMLElement | null>;

export function useScrollHandoff(refs: ReadonlyArray<ScrollableRef>) {
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    let frame = 0;
    let pendingRootDelta = 0;

    const flushRootScroll = () => {
      frame = 0;

      if (pendingRootDelta === 0) return;

      const root = document.scrollingElement;
      if (!root) {
        pendingRootDelta = 0;
        return;
      }

      root.scrollTop += pendingRootDelta;
      pendingRootDelta = 0;
    };

    for (const ref of refs) {
      const element = ref.current;
      if (!element) continue;

      const onWheel = (event: WheelEvent) => {
        if (event.defaultPrevented) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

        const maxScrollTop = element.scrollHeight - element.clientHeight;
        if (maxScrollTop <= 0) return;

        const scrollingUp = event.deltaY < 0;
        const atTop = element.scrollTop <= 0;
        const atBottom = element.scrollTop >= maxScrollTop - 1;

        if ((scrollingUp && !atTop) || (!scrollingUp && !atBottom)) return;

        const root = document.scrollingElement;
        if (!root) return;
        const rootMaxScrollTop = root.scrollHeight - root.clientHeight;
        const rootCanScroll = scrollingUp ? root.scrollTop > 0 : root.scrollTop < rootMaxScrollTop - 1;
        if (!rootCanScroll) return;

        pendingRootDelta += event.deltaY;
        if (frame === 0) {
          frame = window.requestAnimationFrame(flushRootScroll);
        }
        event.preventDefault();
      };

      element.addEventListener("wheel", onWheel, { passive: false });
      cleanups.push(() => {
        element.removeEventListener("wheel", onWheel);
      });
    }

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [refs]);
}
