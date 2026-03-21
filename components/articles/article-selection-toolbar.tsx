"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { addManagedArticleAnnotation } from "@/lib/client/article-annotations-store";

type ArticleSelectionToolbarProps = {
  articleSlug: string;
  articleTitle: string;
  contentRootId: string;
};

type ToolbarState = {
  text: string;
  left: number;
  top: number;
  placeBelow: boolean;
};

export function ArticleSelectionToolbar({
  articleSlug,
  articleTitle,
  contentRootId
}: ArticleSelectionToolbarProps) {
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [toastText, setToastText] = useState("");
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToastText(message);
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => {
      setToastText("");
      toastTimer.current = null;
    }, 1600);
  }, []);

  const clearSelectionAndHide = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
  }, []);

  const updateFromSelection = useCallback(() => {
    const root = document.getElementById(contentRootId);
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setToolbar(null);
      return;
    }

    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) {
      setToolbar(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const containerElement =
      container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
    if (!containerElement || !root.contains(containerElement)) {
      setToolbar(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setToolbar(null);
      return;
    }

    const viewportPadding = 16;
    const center = rect.left + rect.width / 2;
    const left = Math.min(Math.max(center, viewportPadding), window.innerWidth - viewportPadding);
    const placeBelow = rect.top < 120;
    const top = placeBelow ? rect.bottom + 12 : rect.top - 12;

    setToolbar({
      text: text.slice(0, 600),
      left,
      top,
      placeBelow
    });
  }, [contentRootId]);

  useEffect(() => {
    const update = () => updateFromSelection();
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearSelectionAndHide();
      }
    };

    document.addEventListener("selectionchange", update);
    document.addEventListener("mouseup", update);
    document.addEventListener("keyup", update);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("mouseup", update);
      document.removeEventListener("keyup", update);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [clearSelectionAndHide, updateFromSelection]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, []);

  const withPreservedSelection = (action: () => Promise<void> | void) => async () => {
    if (!toolbar?.text) return;
    await action();
  };

  const onAnnotate = withPreservedSelection(() => {
    if (!toolbar?.text) return;
    const note = window.prompt("添加批注（可选）", "");
    if (note === null) return;
    void addManagedArticleAnnotation(articleSlug, {
      quote: toolbar.text,
      note: note.trim(),
      kind: "annotation"
    });
    showToast("已添加批注");
    clearSelectionAndHide();
  });

  const onQuote = withPreservedSelection(() => {
    if (!toolbar?.text) return;
    void addManagedArticleAnnotation(articleSlug, {
      quote: toolbar.text,
      kind: "quote"
    });
    showToast("已加入金句");
    clearSelectionAndHide();
  });

  const onCopy = withPreservedSelection(async () => {
    if (!toolbar?.text) return;
    const copied = await copyText(toolbar.text);
    showToast(copied ? "已复制选中文本" : "复制失败，请手动复制");
    if (copied) clearSelectionAndHide();
  });

  const onShare = withPreservedSelection(async () => {
    if (!toolbar?.text) return;
    const pageUrl = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: articleTitle,
          text: toolbar.text,
          url: pageUrl
        });
        showToast("已打开分享面板");
        clearSelectionAndHide();
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    const fallbackText = `《${articleTitle}》\n${toolbar.text}\n${pageUrl}`;
    const copied = await copyText(fallbackText);
    showToast(copied ? "已复制分享内容" : "分享失败，请手动复制");
    if (copied) clearSelectionAndHide();
  });

  const onSearch = withPreservedSelection(() => {
    if (!toolbar?.text) return;
    const target = `https://www.bing.com/search?q=${encodeURIComponent(toolbar.text)}`;
    window.open(target, "_blank", "noopener,noreferrer");
    clearSelectionAndHide();
  });

  if (!toolbar) {
    return <div className={`toast ${toastText ? "show" : ""}`}>{toastText}</div>;
  }

  return (
    <>
      <div
        className={`selection-toolbar ${toolbar.placeBelow ? "below" : ""}`}
        style={{ left: `${toolbar.left}px`, top: `${toolbar.top}px` }}
      >
        <div className="selection-toolbar-row">
          <ToolbarButton label="批注" onClick={onAnnotate}>
            <IconNote />
          </ToolbarButton>
          <ToolbarButton label="金句" onClick={onQuote}>
            <IconQuote />
          </ToolbarButton>
          <ToolbarButton label="复制" onClick={onCopy}>
            <IconCopy />
          </ToolbarButton>
          <ToolbarButton label="分享" onClick={onShare}>
            <IconShare />
          </ToolbarButton>
          <ToolbarButton label="搜索" onClick={onSearch}>
            <IconSearch />
          </ToolbarButton>
        </div>
      </div>

      <div className={`toast ${toastText ? "show" : ""}`}>{toastText}</div>
    </>
  );
}

type ToolbarButtonProps = {
  label: string;
  onClick: () => void | Promise<void>;
  children: ReactNode;
};

function ToolbarButton({ label, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="selection-action-btn"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        void onClick();
      }}
    >
      <span className="selection-action-icon" aria-hidden="true">
        {children}
      </span>
      <span className="selection-action-label">{label}</span>
    </button>
  );
}

async function copyText(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

function IconNote() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V5A1.5 1.5 0 0 1 4 3.5z" />
      <path d="M6.5 7h7M6.5 10h5" />
    </svg>
  );
}

function IconQuote() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M8 5.5c-2 .9-3.1 2.5-3.3 4.8.8-.5 1.5-.7 2.2-.7A2.6 2.6 0 0 1 9.5 12 2.8 2.8 0 0 1 6.7 15 3.3 3.3 0 0 1 3.5 11.5c0-2.7 1.5-4.9 4.5-6.5zM16.5 5.5c-2 .9-3.1 2.5-3.3 4.8.8-.5 1.5-.7 2.2-.7a2.6 2.6 0 0 1 2.6 2.4 2.8 2.8 0 0 1-2.8 3 3.3 3.3 0 0 1-3.2-3.5c0-2.7 1.5-4.9 4.5-6.5z" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7" y="6" width="10" height="11" rx="2" />
      <path d="M5 13H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 2h8A1.5 1.5 0 0 1 13.5 3.5V5" />
    </svg>
  );
}

function IconShare() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="10.5" r="2.2" />
      <circle cx="14.8" cy="5" r="2.2" />
      <circle cx="14.8" cy="15.8" r="2.2" />
      <path d="m6.9 9.5 5.8-3.2M6.9 11.5l5.8 3" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.6" cy="8.6" r="4.8" />
      <path d="m12.2 12.2 4.3 4.3" />
    </svg>
  );
}
