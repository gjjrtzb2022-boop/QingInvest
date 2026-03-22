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
    const blob = await createQuoteShareCard({
      title: articleTitle,
      quote: toolbar.text,
      sourceUrl: pageUrl
    });

    if (!blob) {
      showToast("分享图生成失败，请稍后再试");
      return;
    }

    const file = new File([blob], buildShareImageName(articleTitle), {
      type: "image/png"
    });

    if (navigator.share && canShareFiles(file)) {
      try {
        await navigator.share({
          title: articleTitle,
          text: `《${articleTitle}》金句分享`,
          files: [file]
        });
        showToast("已打开图片分享面板");
        clearSelectionAndHide();
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    downloadBlob(blob, buildShareImageName(articleTitle));
    showToast("已生成分享图并下载");
    clearSelectionAndHide();
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

function canShareFiles(file: File) {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") {
    return false;
  }

  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function buildShareImageName(title: string) {
  const safeTitle = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48);
  return `${safeTitle || "qinginvest-quote"}.png`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

async function createQuoteShareCard(input: {
  title: string;
  quote: string;
  sourceUrl: string;
}): Promise<Blob | null> {
  const quote = input.quote.replace(/\s+/g, " ").trim().slice(0, 280);
  if (!quote) return null;

  const width = 1200;
  const height = 1500;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#f7f4ee");
  background.addColorStop(0.55, "#f4f0e8");
  background.addColorStop(1, "#efe9df");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(102, 85, 62, 0.08)";
  context.fillRect(88, 88, width - 176, 2);
  context.fillRect(88, height - 90, width - 176, 2);

  context.strokeStyle = "rgba(96, 80, 58, 0.15)";
  context.lineWidth = 2;
  roundRect(context, 72, 72, width - 144, height - 144, 30);
  context.stroke();

  context.fillStyle = "#2f2b24";
  context.font = '600 42px "Times New Roman", "Songti SC", serif';
  context.fillText("QingInvest", 110, 154);

  context.fillStyle = "#8d7d67";
  context.font = '500 26px "PingFang SC", "Noto Sans SC", sans-serif';
  context.textAlign = "right";
  context.fillText("金句分享", width - 110, 154);
  context.textAlign = "left";

  context.fillStyle = "rgba(116, 97, 70, 0.18)";
  context.font = '700 220px "Georgia", "Times New Roman", serif';
  context.fillText("“", 116, 370);

  const quoteLines = wrapCanvasText(context, quote, width - 280, '600 62px "PingFang SC", "Noto Serif SC", serif');
  let cursorY = 410;
  context.fillStyle = "#26221d";
  context.font = '600 62px "PingFang SC", "Noto Serif SC", serif';
  for (const line of quoteLines) {
    context.fillText(line, 140, cursorY);
    cursorY += 96;
  }

  cursorY += 40;
  context.fillStyle = "#7d6f5b";
  context.font = '500 28px "PingFang SC", "Noto Sans SC", sans-serif';
  context.fillText("选自", 140, cursorY);

  cursorY += 54;
  const titleLines = wrapCanvasText(context, `《${input.title}》`, width - 280, '600 34px "PingFang SC", "Noto Sans SC", sans-serif');
  context.fillStyle = "#3a342b";
  context.font = '600 34px "PingFang SC", "Noto Sans SC", sans-serif';
  for (const line of titleLines.slice(0, 2)) {
    context.fillText(line, 140, cursorY);
    cursorY += 52;
  }

  const footerY = height - 250;
  context.fillStyle = "#6d6253";
  context.fillRect(140, footerY, 110, 3);
  context.fillRect(width - 250, footerY, 110, 3);

  context.fillStyle = "#2c2822";
  context.font = '600 30px "PingFang SC", "Noto Sans SC", sans-serif';
  context.fillText("清一山长投资研究平台", 140, footerY + 74);

  context.fillStyle = "#8a7b66";
  context.font = '500 24px "PingFang SC", "Noto Sans SC", sans-serif';
  context.fillText("保持克制，保持清醒，保持长期主义。", 140, footerY + 122);

  context.textAlign = "right";
  context.fillStyle = "#91826c";
  context.font = '500 22px "SF Mono", "Menlo", monospace';
  context.fillText(compactUrl(input.sourceUrl), width - 140, height - 156);
  context.textAlign = "left";

  return await new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 1);
  });
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string
) {
  context.font = font;
  const lines: string[] = [];
  const paragraphs = text.split(/\n+/).map((item) => item.trim()).filter(Boolean);

  for (const paragraph of paragraphs) {
    let current = "";
    for (const char of paragraph) {
      const next = current + char;
      if (context.measureText(next).width <= maxWidth) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = char;
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}

function compactUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`.slice(0, 56);
  } catch {
    return value.slice(0, 56);
  }
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
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
