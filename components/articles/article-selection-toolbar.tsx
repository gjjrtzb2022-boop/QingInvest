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

type ShareStyle = "ivory" | "editorial" | "ink" | "stone";

type ShareConfig = {
  quote: string;
  title: string;
  sourceUrl: string;
  fileName: string;
  style: ShareStyle;
};

type ShareAsset = {
  blob: Blob;
  url: string;
};

type ShareTheme = {
  backgroundTop: string;
  backgroundBottom: string;
  panel: string;
  panelGlow: string;
  border: string;
  brand: string;
  kicker: string;
  text: string;
  quoteMark: string;
  divider: string;
  sourceText: string;
  stampText: string;
  accent: string;
};

const SHARE_STYLE_OPTIONS: Array<{ key: ShareStyle; label: string; description: string }> = [
  { key: "ivory", label: "暖白纸页", description: "克制、柔和，适合绝大多数段落" },
  { key: "editorial", label: "刊物版式", description: "黑白更分明，像杂志内页" },
  { key: "stone", label: "冷灰档案", description: "偏理性、简洁，留给观点本身" },
  { key: "ink", label: "墨夜沉稳", description: "深色背景，适合更浓一点的气质" }
];

export function ArticleSelectionToolbar({
  articleSlug,
  articleTitle,
  contentRootId
}: ArticleSelectionToolbarProps) {
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [toastText, setToastText] = useState("");
  const [shareConfig, setShareConfig] = useState<ShareConfig | null>(null);
  const [shareAsset, setShareAsset] = useState<ShareAsset | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const generationIdRef = useRef(0);

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

  const revokeShareAsset = useCallback((asset: ShareAsset | null) => {
    if (asset?.url) {
      URL.revokeObjectURL(asset.url);
    }
  }, []);

  const closeSharePreview = useCallback(() => {
    generationIdRef.current += 1;
    setIsGeneratingShare(false);
    setShareConfig(null);
    setShareAsset((current) => {
      revokeShareAsset(current);
      return null;
    });
  }, [revokeShareAsset]);

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
      revokeShareAsset(shareAsset);
    };
  }, [revokeShareAsset, shareAsset]);

  useEffect(() => {
    if (!shareConfig) return;

    let cancelled = false;
    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    setIsGeneratingShare(true);

    const generate = async () => {
      await waitForNextPaint();
      const blob = await createParagraphShareCard(shareConfig);
      if (cancelled || generationId !== generationIdRef.current) return;

      setShareAsset((current) => {
        revokeShareAsset(current);
        if (!blob) return null;
        return {
          blob,
          url: URL.createObjectURL(blob)
        };
      });
      setIsGeneratingShare(false);
    };

    void generate();

    return () => {
      cancelled = true;
    };
  }, [revokeShareAsset, shareConfig]);

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

    const config: ShareConfig = {
      quote: toolbar.text,
      title: articleTitle,
      sourceUrl: window.location.href,
      fileName: buildShareImageName(articleTitle),
      style: shareConfig?.style || "ivory"
    };

    clearSelectionAndHide();
    setShareAsset((current) => {
      revokeShareAsset(current);
      return null;
    });
    setShareConfig(config);
  });

  const onDownloadShareImage = useCallback(() => {
    if (!shareConfig || !shareAsset) return;
    downloadBlob(shareAsset.blob, shareConfig.fileName);
    showToast("已下载分享图");
  }, [shareAsset, shareConfig, showToast]);

  const onNativeShareImage = useCallback(async () => {
    if (!shareConfig || !shareAsset) return;

    const file = new File([shareAsset.blob], shareConfig.fileName, {
      type: "image/png"
    });

    if (navigator.share && canShareFiles(file)) {
      try {
        await navigator.share({
          title: shareConfig.title,
          text: `《${shareConfig.title}》文章段落分享`,
          files: [file]
        });
        showToast("已打开图片分享面板");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    downloadBlob(shareAsset.blob, shareConfig.fileName);
    showToast("当前设备不支持系统图片分享，已直接下载");
  }, [shareAsset, shareConfig, showToast]);

  const onSearch = withPreservedSelection(() => {
    if (!toolbar?.text) return;
    const target = `https://www.bing.com/search?q=${encodeURIComponent(toolbar.text)}`;
    window.open(target, "_blank", "noopener,noreferrer");
    clearSelectionAndHide();
  });

  const onChangeShareStyle = useCallback(
    (style: ShareStyle) => {
      setShareConfig((current) => (current ? { ...current, style } : current));
      setShareAsset((current) => {
        revokeShareAsset(current);
        return null;
      });
    },
    [revokeShareAsset]
  );

  const previewOpen = Boolean(shareConfig);

  return (
    <>
      {toolbar ? (
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
      ) : null}

      {previewOpen ? (
        <div className="quote-share-preview-overlay" role="presentation" onClick={closeSharePreview}>
          <div
            className="quote-share-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="分享图预览"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="quote-share-preview-header">
              <div>
                <p>分享图预览</p>
                <strong>文章段落分享</strong>
              </div>
              <button type="button" className="quote-share-preview-close" onClick={closeSharePreview}>
                关闭
              </button>
            </div>

            <div className="quote-share-style-switch" role="tablist" aria-label="分享风格选择">
              {SHARE_STYLE_OPTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={shareConfig?.style === item.key}
                  className={`quote-share-style-chip ${shareConfig?.style === item.key ? "active" : ""}`}
                  onClick={() => onChangeShareStyle(item.key)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>

            <div className="quote-share-preview-canvas-shell">
              {isGeneratingShare || !shareAsset ? (
                <div className="quote-share-preview-loading" role="status" aria-live="polite">
                  <div className="quote-share-preview-spinner" aria-hidden="true" />
                  <p>正在生成文章段落分享图...</p>
                  <strong>切换风格后会自动刷新预览</strong>
                </div>
              ) : (
                <img src={shareAsset.url} alt="文章段落分享图预览" className="quote-share-preview-image" />
              )}
            </div>

            <div className="quote-share-preview-actions">
              <button type="button" className="quote-share-preview-btn subtle" onClick={closeSharePreview}>
                取消
              </button>
              <button
                type="button"
                className="quote-share-preview-btn subtle"
                onClick={onDownloadShareImage}
                disabled={isGeneratingShare || !shareAsset}
              >
                下载图片
              </button>
              <button
                type="button"
                className="quote-share-preview-btn primary"
                onClick={() => void onNativeShareImage()}
                disabled={isGeneratingShare || !shareAsset}
              >
                继续分享
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

  return `${safeTitle || "qinginvest-paragraph-share"}.png`;
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

async function createParagraphShareCard(input: ShareConfig): Promise<Blob | null> {
  const quote = input.quote.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!quote) return null;

  const width = 960;
  const height = 1140;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  renderShareCard(context, {
    width,
    height,
    quote,
    title: input.title,
    sourceUrl: input.sourceUrl,
    style: input.style
  });

  return await new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 1);
  });
}

function renderShareCard(
  context: CanvasRenderingContext2D,
  input: {
    width: number;
    height: number;
    quote: string;
    title: string;
    sourceUrl: string;
    style: ShareStyle;
  }
) {
  const { width, height, quote, title, sourceUrl, style } = input;
  const theme = buildShareTheme(style);
  const safeTitle = title.trim() || "未命名文章";

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, theme.backgroundTop);
  background.addColorStop(1, theme.backgroundBottom);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = theme.panelGlow;
  roundRect(context, 62, 72, width - 124, height - 144, 38);
  context.fill();

  context.fillStyle = theme.panel;
  roundRect(context, 54, 64, width - 108, height - 128, 34);
  context.fill();

  context.strokeStyle = theme.border;
  context.lineWidth = 1.5;
  roundRect(context, 54, 64, width - 108, height - 128, 34);
  context.stroke();

  context.fillStyle = theme.brand;
  context.font = '700 34px "Iowan Old Style", "Times New Roman", "Songti SC", serif';
  context.fillText("QingInvest", 98, 138);

  context.textAlign = "right";
  context.fillStyle = theme.kicker;
  context.font = '700 18px "PingFang SC", "Noto Sans SC", sans-serif';
  context.fillText("文章段落分享", width - 98, 136);
  context.textAlign = "left";

  context.fillStyle = theme.divider;
  context.fillRect(98, 170, width - 196, 1.5);
  context.fillStyle = theme.accent;
  context.fillRect(98, 170, 138, 3);

  context.fillStyle = theme.quoteMark;
  context.font = '700 124px "Cormorant Garamond", "Times New Roman", serif';
  context.fillText("“", 102, 284);

  const quoteLayout = fitQuoteLayout(context, quote, width - 220);
  const quoteTop = 248;
  let cursorY = quoteTop + quoteLayout.lineHeight;

  context.fillStyle = theme.text;
  context.font = quoteLayout.font;
  for (const line of quoteLayout.lines) {
    context.fillText(line, 122, cursorY);
    cursorY += quoteLayout.lineHeight;
  }

  const quoteBottom = cursorY - quoteLayout.lineHeight + 8;
  const footerTop = Math.max(quoteBottom + 74, height - 206);

  context.fillStyle = theme.divider;
  context.fillRect(98, footerTop, width - 196, 1.5);

  const sourceLabel = `选自《${safeTitle}》`;
  const sourceFont = '600 24px "PingFang SC", "Noto Sans SC", sans-serif';
  const sourceLines = wrapCanvasText(context, sourceLabel, 430, sourceFont);
  const limitedSource = clampLines(context, sourceLines, 2, 430, sourceFont);

  context.fillStyle = theme.sourceText;
  context.font = sourceFont;
  for (const [index, line] of limitedSource.entries()) {
    context.fillText(line, 98, footerTop + 54 + index * 32);
  }

  const stampText = formatShareStamp(sourceUrl);
  context.textAlign = "right";
  context.fillStyle = theme.stampText;
  context.font = '600 20px "PingFang SC", "Noto Sans SC", sans-serif';
  context.fillText(stampText, width - 98, footerTop + 56);

  context.fillStyle = theme.kicker;
  context.font = '600 16px "PingFang SC", "Noto Sans SC", sans-serif';
  context.fillText("qing-invest.vercel.app", width - 98, footerTop + 90);
  context.textAlign = "left";
}

function buildShareTheme(style: ShareStyle): ShareTheme {
  if (style === "editorial") {
    return {
      backgroundTop: "#f8f6f1",
      backgroundBottom: "#ece7dc",
      panel: "rgba(255,255,255,0.9)",
      panelGlow: "rgba(255,255,255,0.45)",
      border: "rgba(28,27,24,0.14)",
      brand: "#171614",
      kicker: "#5d584d",
      text: "#11100f",
      quoteMark: "rgba(17,16,15,0.12)",
      divider: "rgba(17,16,15,0.1)",
      sourceText: "#292724",
      stampText: "#2c2a26",
      accent: "#12110f"
    };
  }

  if (style === "stone") {
    return {
      backgroundTop: "#f2f3f4",
      backgroundBottom: "#e5e7ea",
      panel: "rgba(255,255,255,0.84)",
      panelGlow: "rgba(255,255,255,0.36)",
      border: "rgba(71,76,84,0.12)",
      brand: "#20242a",
      kicker: "#66707d",
      text: "#1d2127",
      quoteMark: "rgba(31,39,49,0.11)",
      divider: "rgba(45,52,61,0.1)",
      sourceText: "#2b3139",
      stampText: "#313740",
      accent: "#5f6c7b"
    };
  }

  if (style === "ink") {
    return {
      backgroundTop: "#12161d",
      backgroundBottom: "#090c11",
      panel: "rgba(19,25,33,0.92)",
      panelGlow: "rgba(9,12,17,0.45)",
      border: "rgba(233,222,206,0.12)",
      brand: "#f3eee6",
      kicker: "#c1b297",
      text: "#f6efe6",
      quoteMark: "rgba(242,231,212,0.09)",
      divider: "rgba(242,231,212,0.12)",
      sourceText: "#efe7dc",
      stampText: "#eadfce",
      accent: "#d4af75"
    };
  }

  return {
    backgroundTop: "#faf7f1",
    backgroundBottom: "#eee7db",
    panel: "rgba(255,255,255,0.78)",
    panelGlow: "rgba(255,255,255,0.44)",
    border: "rgba(116,100,78,0.12)",
    brand: "#302a23",
    kicker: "#8a7a63",
    text: "#26211b",
    quoteMark: "rgba(124,108,85,0.12)",
    divider: "rgba(115,99,76,0.12)",
    sourceText: "#3a342b",
    stampText: "#4b443a",
    accent: "#a88c65"
  };
}

function fitQuoteLayout(context: CanvasRenderingContext2D, quote: string, maxWidth: number) {
  const options = [
    { size: 58, lineHeight: 78, maxLines: 7 },
    { size: 54, lineHeight: 74, maxLines: 8 },
    { size: 50, lineHeight: 70, maxLines: 9 },
    { size: 46, lineHeight: 66, maxLines: 10 },
    { size: 42, lineHeight: 62, maxLines: 11 }
  ];

  for (const option of options) {
    const font = `600 ${option.size}px "PingFang SC", "Noto Serif SC", serif`;
    const lines = wrapCanvasText(context, quote, maxWidth, font);
    if (lines.length <= option.maxLines) {
      return {
        font,
        lineHeight: option.lineHeight,
        lines
      };
    }
  }

  const fallbackFont = '600 42px "PingFang SC", "Noto Serif SC", serif';
  const fallbackLines = wrapCanvasText(context, quote, maxWidth, fallbackFont);
  return {
    font: fallbackFont,
    lineHeight: 62,
    lines: clampLines(context, fallbackLines, 11, maxWidth, fallbackFont)
  };
}

function clampLines(
  context: CanvasRenderingContext2D,
  lines: string[],
  maxLines: number,
  maxWidth: number,
  font: string
) {
  if (lines.length <= maxLines) return lines;
  const next = lines.slice(0, maxLines);
  next[maxLines - 1] = withEllipsis(context, next[maxLines - 1] || "", maxWidth, font);
  return next;
}

function withEllipsis(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string
) {
  context.font = font;
  let current = text;
  while (current && context.measureText(`${current}…`).width > maxWidth) {
    current = current.slice(0, -1);
  }
  return `${current || text.slice(0, 8)}…`;
}

async function waitForNextPaint() {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
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
  const paragraphs = text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

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
    return url.host.replace(/^www\./, "");
  } catch {
    return "qing-invest.vercel.app";
  }
}

function formatShareStamp(value: string) {
  const date = new Date();
  const yyyy = `${date.getFullYear()}`;
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${compactUrl(value)} · ${yyyy}.${mm}.${dd}`;
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
