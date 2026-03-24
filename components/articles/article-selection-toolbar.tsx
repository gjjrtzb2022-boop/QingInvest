"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { addManagedArticleAnnotation } from "@/lib/client/article-annotations-store";
import {
  readUserProfile,
  USER_PROFILE_STORAGE_KEY,
  USER_PROFILE_UPDATED_EVENT
} from "@/lib/client/user-profile-store";

type ArticleSelectionToolbarProps = {
  articleSlug: string;
  articleTitle: string;
  articleSeries?: string;
  contentRootId: string;
};

type ToolbarState = {
  text: string;
  left: number;
  top: number;
  placeBelow: boolean;
};

type ShareStyle =
  | "calendar-minimal"
  | "midnight-note"
  | "vertical-editorial"
  | "sea-cover"
  | "framed-paper";

type ShareFont =
  | "elegant-serif"
  | "modern-sans"
  | "classic-song"
  | "scholar-fangsong"
  | "print-hei";

type ShareConfig = {
  quote: string;
  title: string;
  series: string;
  sourceUrl: string;
  fileName: string;
  style: ShareStyle;
  font: ShareFont;
  username: string;
};

type ShareAsset = {
  blob: Blob;
  url: string;
};

const SHARE_STYLE_OPTIONS: Array<{ key: ShareStyle; label: string }> = [
  { key: "calendar-minimal", label: "日历留白" },
  { key: "midnight-note", label: "夜色摘录" },
  { key: "vertical-editorial", label: "竖排刊页" },
  { key: "sea-cover", label: "海面封页" },
  { key: "framed-paper", label: "边框纸页" }
];

const SHARE_FONT_OPTIONS: Array<{ key: ShareFont; label: string }> = [
  { key: "elegant-serif", label: "雅致衬线" },
  { key: "modern-sans", label: "现代黑体" },
  { key: "classic-song", label: "经典宋体" },
  { key: "scholar-fangsong", label: "文气仿宋" },
  { key: "print-hei", label: "印刷黑体" }
];

const ARTICLE_AUTHOR_NAME = "清一山长";

export function ArticleSelectionToolbar({
  articleSlug,
  articleTitle,
  articleSeries = "",
  contentRootId
}: ArticleSelectionToolbarProps) {
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [toastText, setToastText] = useState("");
  const [shareConfig, setShareConfig] = useState<ShareConfig | null>(null);
  const [shareAsset, setShareAsset] = useState<ShareAsset | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [username, setUsername] = useState("");
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
    const refreshProfile = () => {
      const profile = readUserProfile();
      setUsername(profile?.username.trim() || "");
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === USER_PROFILE_STORAGE_KEY) {
        refreshProfile();
      }
    };

    refreshProfile();
    window.addEventListener(USER_PROFILE_UPDATED_EVENT, refreshProfile as EventListener);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(USER_PROFILE_UPDATED_EVENT, refreshProfile as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

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
      series: articleSeries.trim() || articleTitle,
      sourceUrl: window.location.href,
      fileName: buildShareImageName(articleTitle),
      style: shareConfig?.style || "calendar-minimal",
      font: shareConfig?.font || "elegant-serif",
      username
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

  const onChangeShareFont = useCallback(
    (font: ShareFont) => {
      setShareConfig((current) => (current ? { ...current, font } : current));
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
                  title={item.label}
                >
                  <strong>{item.label}</strong>
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

            <div className="quote-share-footer-tools">
              <span className="quote-share-footer-label">字体</span>
              <div className="quote-share-font-switch" role="tablist" aria-label="分享字体选择">
                {SHARE_FONT_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={shareConfig?.font === item.key}
                    className={`quote-share-font-chip ${shareConfig?.font === item.key ? "active" : ""}`}
                    onClick={() => onChangeShareFont(item.key)}
                    title={item.label}
                  >
                    <strong>{item.label}</strong>
                  </button>
                ))}
              </div>
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
  const height = 1560;
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
    series: input.series,
    sourceUrl: input.sourceUrl,
    style: input.style,
    font: input.font,
    username: input.username
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
    series: string;
    sourceUrl: string;
    style: ShareStyle;
    font: ShareFont;
    username: string;
  }
) {
  const { width, height, quote, title, series, sourceUrl, style, font, username } = input;
  const safeTitle = title.trim() || "未命名文章";
  const safeSeries = series.trim() || safeTitle;

  if (style === "midnight-note") {
    renderMidnightNoteCard(context, { width, height, quote, title: safeTitle, sourceUrl, username, font });
    return;
  }

  if (style === "vertical-editorial") {
    renderVerticalEditorialCard(context, {
      width,
      height,
      quote,
      title: safeTitle,
      series: safeSeries,
      sourceUrl,
      username,
      font
    });
    return;
  }

  if (style === "sea-cover") {
    renderSeaCoverCard(context, { width, height, quote, title: safeTitle, sourceUrl, username, font });
    return;
  }

  if (style === "framed-paper") {
    renderFramedPaperCard(context, { width, height, quote, title: safeTitle, sourceUrl, username, font });
    return;
  }

  renderCalendarMinimalCard(context, { width, height, quote, title: safeTitle, sourceUrl, username, font });
}

function renderCalendarMinimalCard(
  context: CanvasRenderingContext2D,
  input: {
    width: number;
    height: number;
    quote: string;
    title: string;
    sourceUrl: string;
    username: string;
    font: ShareFont;
  }
) {
  const { width, height, quote, title, sourceUrl, font } = input;
  const dateParts = getCalendarParts();
  const typography = getShareTypography(font);

  const backdrop = context.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, "#f7f4ee");
  backdrop.addColorStop(0.52, "#f4efe6");
  backdrop.addColorStop(1, "#efe8dc");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);
  drawPaperTexture(context, 0, 0, width, height, 0.08);
  drawSoftVignette(context, width, height, "rgba(120, 102, 72, 0.08)");
  drawFineFrame(context, 38, 38, width - 76, height - 76, "rgba(118, 98, 68, 0.22)", 1.2);
  drawFineFrame(context, 58, 58, width - 116, height - 116, "rgba(174, 152, 120, 0.18)", 1);
  drawLiftedPanel(context, 92, 560, width - 184, 582, 38, {
    fillTop: "rgba(255, 252, 246, 0.94)",
    fillBottom: "rgba(247, 240, 229, 0.94)",
    border: "rgba(171, 145, 101, 0.24)",
    shadow: "rgba(100, 78, 49, 0.14)"
  });

  context.textAlign = "center";
  context.fillStyle = "#2b1a11";
  context.font = `700 220px ${typography.displaySans}`;
  context.fillText(dateParts.day, width / 2, 300);

  context.font = `700 62px ${typography.displaySans}`;
  context.fillText(`${dateParts.monthUpper} ${dateParts.year}`, width / 2, 420);

  context.fillStyle = "#4f4238";
  context.font = `500 34px ${typography.sans}`;
  context.fillText(dateParts.weekday, width / 2, 498);

  context.fillStyle = "rgba(175, 146, 102, 0.16)";
  context.beginPath();
  context.arc(width / 2, 360, 220, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(88, 79, 72, 0.22)";
  context.fillRect(width / 2 - 58, 598, 116, 2);
  drawQuoteMarks(context, width / 2, 650, {
    color: "rgba(163, 132, 86, 0.28)",
    font: `700 102px ${typography.displaySerif}`,
    align: "center"
  });

  const quoteLayout = fitQuoteLayout(
    context,
    quote,
    760,
    [
      { size: 62, lineHeight: 104, maxLines: 6 },
      { size: 56, lineHeight: 96, maxLines: 7 },
      { size: 50, lineHeight: 88, maxLines: 8 }
    ],
    typography.bodySerif,
    typography.quoteWeight
  );

  context.fillStyle = "#2b1a11";
  context.font = quoteLayout.font;
  const quoteBlockHeight = quoteLayout.lines.length * quoteLayout.lineHeight;
  const quoteStartY = Math.max(738, 770 + (400 - quoteBlockHeight) / 2);
  let cursorY = quoteStartY;
  for (const line of quoteLayout.lines) {
    context.fillText(line, width / 2, cursorY);
    cursorY += quoteLayout.lineHeight;
  }

  context.fillStyle = "#463a31";
  context.font = `500 46px ${typography.bodySerif}`;
  context.fillText(`《${shortenTitle(title, 14)}》`, width / 2, height - 226);

  context.font = `400 28px ${typography.sans}`;
  context.fillText(formatShareStamp(sourceUrl), width / 2, height - 182);

  context.fillStyle = "rgba(97, 90, 84, 0.75)";
  context.font = `400 24px ${typography.sans}`;
  context.fillText("QingInvest", width / 2, height - 112);
  context.textAlign = "left";
}

function renderMidnightNoteCard(
  context: CanvasRenderingContext2D,
  input: {
    width: number;
    height: number;
    quote: string;
    title: string;
    sourceUrl: string;
    username: string;
    font: ShareFont;
  }
) {
  const { width, height, quote, title, username, font } = input;
  const headerName = username.trim();
  const typography = getShareTypography(font);

  const bg = context.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#191c24");
  bg.addColorStop(0.55, "#12151c");
  bg.addColorStop(1, "#0e1016");
  context.fillStyle = bg;
  context.fillRect(0, 0, width, height);
  drawSoftVignette(context, width, height, "rgba(0, 0, 0, 0.34)");
  drawPaperTexture(context, 0, 0, width, height, 0.035, "#f0dfbd");

  const glow = context.createRadialGradient(width * 0.18, 150, 20, width * 0.18, 150, 240);
  glow.addColorStop(0, "rgba(237, 201, 139, 0.22)");
  glow.addColorStop(1, "rgba(237, 201, 139, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, 420);
  drawLiftedPanel(context, 62, 92, width - 124, height - 184, 34, {
    fillTop: "rgba(29, 33, 43, 0.5)",
    fillBottom: "rgba(14, 16, 23, 0.28)",
    border: "rgba(226, 198, 152, 0.18)",
    shadow: "rgba(0, 0, 0, 0.34)"
  });

  drawAvatarSeal(context, 120, 138, 48, "#f2e2c1", "#5a4a38", "清", "#f7ead3");

  if (headerName) {
    context.fillStyle = "#f0dfbd";
    context.font = `700 56px ${typography.bodySerif}`;
    context.fillText(shortenTitle(headerName, 8), 198, 152);
  }
  context.fillStyle = "#d7c7a8";
  context.font = `500 30px ${typography.sans}`;
  context.fillText(`摘录于 ${formatDateCn()}`, 198, headerName ? 214 : 176);
  drawQuoteMarks(context, 108, 364, {
    color: "rgba(242, 226, 193, 0.16)",
    font: `700 124px ${typography.displaySerif}`,
    align: "left"
  });

  const quoteLayout = fitQuoteLayout(
    context,
    quote,
    780,
    [
      { size: 66, lineHeight: 118, maxLines: 5 },
      { size: 60, lineHeight: 108, maxLines: 6 },
      { size: 54, lineHeight: 96, maxLines: 7 }
    ],
    typography.bodySerif,
    typography.quoteWeight
  );

  context.fillStyle = "#f0dfbd";
  context.font = quoteLayout.font;
  let cursorY = 560;
  for (const line of quoteLayout.lines) {
    context.fillText(line, 92, cursorY);
    cursorY += quoteLayout.lineHeight;
  }

  context.fillStyle = "#d2c1a4";
  context.font = `500 34px ${typography.sans}`;
  const sourceLines = clampLines(
    context,
    wrapCanvasText(context, `/ ${shortenTitle(title, 28)}`, 780, context.font),
    2,
    780,
    context.font
  );
  for (const [index, line] of sourceLines.entries()) {
    context.fillText(line, 92, cursorY + 34 + index * 46);
  }

  context.fillStyle = "rgba(208, 193, 164, 0.28)";
  context.fillRect(92, height - 288, width - 184, 1.5);
  drawFineFrame(context, 68, 74, width - 136, height - 148, "rgba(214, 194, 158, 0.18)", 1.1);
  context.fillStyle = "#d2c1a4";
  context.font = `500 26px ${typography.sans}`;
  context.fillText("QingInvest", 92, height - 190);
}

function renderVerticalEditorialCard(
  context: CanvasRenderingContext2D,
  input: {
    width: number;
    height: number;
    quote: string;
    title: string;
    series: string;
    sourceUrl: string;
    username: string;
    font: ShareFont;
  }
) {
  const { width, height, quote, series, username, font } = input;
  const typography = getShareTypography(font);
  const titleColumns = [buildVerticalMainSeries(series)];
  const authorColumns = [buildVerticalAuthorLabel(username)];
  const rightInfoColumns = [buildVerticalSourceLabel(username), formatDateCnChineseVertical()];

  const bg = context.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#171a21");
  bg.addColorStop(0.48, "#11141b");
  bg.addColorStop(1, "#0c0f14");
  context.fillStyle = bg;
  context.fillRect(0, 0, width, height);
  drawSoftVignette(context, width, height, "rgba(0, 0, 0, 0.38)");
  drawPaperTexture(context, 0, 0, width, height, 0.03, "#e4d1ab");

  const topGlow = context.createLinearGradient(0, 92, width, 92);
  topGlow.addColorStop(0, "rgba(238, 214, 170, 0)");
  topGlow.addColorStop(0.5, "rgba(238, 214, 170, 0.12)");
  topGlow.addColorStop(1, "rgba(238, 214, 170, 0)");
  context.fillStyle = topGlow;
  context.fillRect(84, 82, width - 168, 28);

  drawDistressedBar(context, 84, 92, width - 168, "#d8cbab");
  drawDistressedBar(context, 84, height - 120, width - 168, "#d8cbab");
  drawFineFrame(context, 60, 60, width - 120, height - 120, "rgba(214, 193, 154, 0.14)", 1);
  drawLiftedPanel(context, 78, 760, width - 156, 470, 26, {
    fillTop: "rgba(33, 37, 47, 0.74)",
    fillBottom: "rgba(17, 19, 26, 0.72)",
    border: "rgba(221, 199, 156, 0.16)",
    shadow: "rgba(0, 0, 0, 0.24)"
  });

  drawVerticalText(context, titleColumns, 110, 214, {
    color: "#efe0bb",
    font: `700 74px ${typography.displaySerif}`,
    lineGap: 18,
    columnGap: 0
  });

  drawVerticalText(context, authorColumns, 240, 214, {
    color: "#dbcba8",
    font: `600 34px ${typography.sans}`,
    lineGap: 16,
    columnGap: 0
  });

  context.strokeStyle = "rgba(207, 193, 163, 0.28)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(width - 162, 220);
  context.lineTo(width - 162, 718);
  context.moveTo(width - 254, 220);
  context.lineTo(width - 254, 718);
  context.stroke();

  drawVerticalText(context, rightInfoColumns, width - 236, 248, {
    color: "#b7aa90",
    font: `500 28px ${typography.bodySerif}`,
    lineGap: 16,
    columnGap: 44
  });

  const quoteLayout = fitQuoteLayout(
    context,
    quote,
    760,
    [
      { size: 62, lineHeight: 104, maxLines: 6 },
      { size: 56, lineHeight: 94, maxLines: 7 },
      { size: 50, lineHeight: 86, maxLines: 8 }
    ],
    typography.bodySerif,
    typography.quoteWeight
  );

  context.fillStyle = "#efe0bb";
  context.font = quoteLayout.font;
  let cursorY = 870;
  for (const line of quoteLayout.lines) {
    context.fillText(line, 94, cursorY);
    cursorY += quoteLayout.lineHeight;
  }

  context.fillStyle = "#d7c7a8";
  context.font = `500 30px ${typography.sans}`;
  const sourceText = `/ ${shortenTitle(series, 26)}`;
  const sourceLines = clampLines(
    context,
    wrapCanvasText(context, sourceText, 760, context.font),
    2,
    760,
    context.font
  );
  for (const [index, line] of sourceLines.entries()) {
    context.fillText(line, 94, cursorY + 24 + index * 42);
  }

  context.fillStyle = "rgba(213, 199, 168, 0.28)";
  context.fillRect(94, height - 302, width - 188, 1.5);

  context.fillStyle = "#d7c7a8";
  context.font = `500 26px ${typography.sans}`;
  context.fillText("QingInvest", 94, height - 188);
}

function renderSeaCoverCard(
  context: CanvasRenderingContext2D,
  input: {
    width: number;
    height: number;
    quote: string;
    title: string;
    sourceUrl: string;
    username: string;
    font: ShareFont;
  }
) {
  const { width, height, quote, title, username, font } = input;
  const typography = getShareTypography(font);

  drawSeaBackground(context, 0, 0, width, 730);
  const paper = context.createLinearGradient(0, 730, 0, height);
  paper.addColorStop(0, "#fbfaf7");
  paper.addColorStop(1, "#f1ede4");
  context.fillStyle = paper;
  context.fillRect(0, 730, width, height - 730);
  drawPaperTexture(context, 0, 730, width, height - 730, 0.075);
  drawSoftVignette(context, width, height, "rgba(91, 110, 133, 0.07)");
  drawLiftedPanel(context, 64, 774, width - 128, 620, 34, {
    fillTop: "rgba(255, 255, 255, 0.92)",
    fillBottom: "rgba(245, 240, 231, 0.95)",
    border: "rgba(118, 132, 152, 0.16)",
    shadow: "rgba(70, 86, 111, 0.16)"
  });

  drawVerticalText(context, ["文摘"], 90, 112, {
    color: "#ffffff",
    font: `700 52px ${typography.displaySerif}`,
    lineGap: 16,
    columnGap: 0
  });

  if (username.trim()) {
    context.textAlign = "right";
    context.fillStyle = "rgba(255,255,255,0.96)";
    context.font = `600 22px ${typography.sans}`;
    context.fillText(shortenTitle(username.trim(), 12), width - 88, 132);
    context.textAlign = "left";
  }

  const quoteLayout = fitQuoteLayout(
    context,
    quote,
    760,
    [
      { size: 62, lineHeight: 106, maxLines: 5 },
      { size: 56, lineHeight: 96, maxLines: 6 },
      { size: 50, lineHeight: 88, maxLines: 7 }
    ],
    typography.bodySerif,
    typography.quoteWeight
  );

  context.fillStyle = "#1d2230";
  context.font = quoteLayout.font;
  drawQuoteMarks(context, 100, 868, {
    color: "rgba(83, 102, 133, 0.14)",
    font: `700 108px ${typography.displaySerif}`,
    align: "left"
  });
  let cursorY = 934;
  for (const line of quoteLayout.lines) {
    context.fillText(line, 88, cursorY);
    cursorY += quoteLayout.lineHeight;
  }

  context.fillStyle = "#4a4f5c";
  context.font = `500 28px ${typography.sans}`;
  const sourceLines = clampLines(
    context,
    wrapCanvasText(context, `/ ${shortenTitle(title, 28)}`, 780, context.font),
    2,
    780,
    context.font
  );
  for (const [index, line] of sourceLines.entries()) {
    context.fillText(line, 88, cursorY + 24 + index * 40);
  }

  context.fillStyle = "rgba(92, 96, 108, 0.28)";
  context.fillRect(88, height - 302, width - 176, 1.5);
  drawFineFrame(context, 58, 762, width - 116, height - 820, "rgba(78, 90, 110, 0.13)", 1);

  context.fillStyle = "#303644";
  context.font = `600 26px ${typography.sans}`;
  const footerLead = username.trim()
    ? `${shortenTitle(username.trim(), 10)} · 摘录于 ${formatDateCn()}`
    : `摘录于 ${formatDateCn()}`;
  context.fillText(footerLead, 88, height - 188);
  context.fillStyle = "#696d79";
  context.font = `500 22px ${typography.sans}`;
  context.fillText("QingInvest", 88, height - 136);
}

function renderFramedPaperCard(
  context: CanvasRenderingContext2D,
  input: {
    width: number;
    height: number;
    quote: string;
    title: string;
    sourceUrl: string;
    username: string;
    font: ShareFont;
  }
) {
  const { width, height, quote, title, sourceUrl, username, font } = input;
  const headerName = username.trim();
  const typography = getShareTypography(font);

  const bg = context.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#f6f1e8");
  bg.addColorStop(0.5, "#f1ebdf");
  bg.addColorStop(1, "#ebe3d4");
  context.fillStyle = bg;
  context.fillRect(0, 0, width, height);
  drawPaperTexture(context, 0, 0, width, height, 0.09);
  drawSoftVignette(context, width, height, "rgba(124, 101, 66, 0.07)");

  context.strokeStyle = "#d3cec4";
  context.lineWidth = 4;
  context.strokeRect(42, 110, width - 84, height - 220);
  context.lineWidth = 2;
  context.strokeRect(54, 122, width - 108, height - 244);

  const paperFill = context.createLinearGradient(0, 122, 0, height - 122);
  paperFill.addColorStop(0, "#fcfbf8");
  paperFill.addColorStop(1, "#f6f0e7");
  context.fillStyle = paperFill;
  context.fillRect(54, 122, width - 108, height - 244);
  drawPaperTexture(context, 54, 122, width - 108, height - 244, 0.075);
  drawFineFrame(context, 72, 140, width - 144, height - 280, "rgba(129, 110, 81, 0.1)", 1);
  drawLiftedPanel(context, 78, 162, width - 156, height - 324, 30, {
    fillTop: "rgba(255, 252, 246, 0.48)",
    fillBottom: "rgba(247, 240, 229, 0.24)",
    border: "rgba(133, 112, 79, 0.08)",
    shadow: "rgba(89, 72, 43, 0.12)"
  });

  drawAvatarSeal(context, 120, 250, 48, "#3d3933", "#efe6d6", "清", "#ffffff");

  if (headerName) {
    context.fillStyle = "#5c5349";
    context.font = `700 54px ${typography.bodySerif}`;
    context.fillText(shortenTitle(headerName, 8), 198, 262);
  }
  context.fillStyle = "#80776d";
  context.font = `400 28px ${typography.sans}`;
  context.fillText(`摘录于 ${formatDateCn()}`, 198, headerName ? 324 : 286);

  context.strokeStyle = "rgba(115, 106, 94, 0.14)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(54, 430);
  context.lineTo(width - 54, 430);
  context.moveTo(54, 1140);
  context.lineTo(width - 54, 1140);
  context.stroke();

  const quoteLayout = fitQuoteLayout(
    context,
    quote,
    730,
    [
      { size: 60, lineHeight: 110, maxLines: 5 },
      { size: 54, lineHeight: 100, maxLines: 6 },
      { size: 48, lineHeight: 88, maxLines: 7 }
    ],
    typography.bodySerif,
    typography.quoteWeight
  );

  context.fillStyle = "#2a1f18";
  context.font = quoteLayout.font;
  let cursorY = 610;
  for (const line of quoteLayout.lines) {
    context.fillText(line, 88, cursorY);
    cursorY += quoteLayout.lineHeight;
  }

  context.fillStyle = "#5f564d";
  context.font = `500 30px ${typography.sans}`;
  const sourceText = `${shortenTitle(title, 28)}
${compactUrl(sourceUrl)}`;
  const sourceLines = clampLines(
    context,
    wrapCanvasText(context, sourceText, 760, context.font),
    3,
    760,
    context.font
  );
  for (const [index, line] of sourceLines.entries()) {
    context.fillText(line, 88, 930 + index * 42);
  }

  context.fillStyle = "#7b7268";
  context.font = `400 24px ${typography.sans}`;
  context.fillText("QingInvest", 88, 1328);
}

function getShareTypography(font: ShareFont) {
  if (font === "print-hei") {
    return {
      displaySans: '"Arial Narrow", "Avenir Next Condensed", "Helvetica Neue", sans-serif',
      displaySerif: '"STHeiti", "Heiti SC", "PingFang SC", sans-serif',
      bodySerif: '"STHeiti", "Heiti SC", "PingFang SC", sans-serif',
      sans: '"STHeiti", "Heiti SC", "PingFang SC", sans-serif',
      quoteWeight: 760
    };
  }

  if (font === "modern-sans") {
    return {
      displaySans: '"Avenir Next", "Helvetica Neue", "Arial", sans-serif',
      displaySerif: '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif',
      bodySerif: '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif',
      sans: '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif',
      quoteWeight: 700
    };
  }

  if (font === "classic-song") {
    return {
      displaySans: '"Times New Roman", "Songti SC", serif',
      displaySerif: '"Songti SC", "STSong", "Noto Serif SC", serif',
      bodySerif: '"Songti SC", "STSong", "Noto Serif SC", serif',
      sans: '"Songti SC", "STSong", "Noto Serif SC", serif',
      quoteWeight: 520
    };
  }

  if (font === "scholar-fangsong") {
    return {
      displaySans: '"Times New Roman", "STFangsong", "FangSong", serif',
      displaySerif: '"STFangsong", "FangSong", "Songti SC", serif',
      bodySerif: '"STFangsong", "FangSong", "Songti SC", serif',
      sans: '"STFangsong", "FangSong", "Songti SC", serif',
      quoteWeight: 560
    };
  }

  return {
    displaySans: '"Baskerville", "Times New Roman", serif',
    displaySerif: '"Kaiti SC", "STKaiti", "Baskerville", serif',
    bodySerif: '"Kaiti SC", "STKaiti", "Songti SC", serif',
    sans: '"PingFang SC", "Noto Sans SC", sans-serif',
    quoteWeight: 600
  };
}

function fitQuoteLayout(
  context: CanvasRenderingContext2D,
  quote: string,
  maxWidth: number,
  options?: Array<{ size: number; lineHeight: number; maxLines: number }>,
  fontFamily?: string,
  fontWeight = 600
) {
  const family = fontFamily || '"PingFang SC", "Noto Serif SC", serif';
  const presets =
    options ||
    [
      { size: 58, lineHeight: 78, maxLines: 7 },
      { size: 54, lineHeight: 74, maxLines: 8 },
      { size: 50, lineHeight: 70, maxLines: 9 },
      { size: 46, lineHeight: 66, maxLines: 10 },
      { size: 42, lineHeight: 62, maxLines: 11 }
    ];

  for (const option of presets) {
    const font = `${fontWeight} ${option.size}px ${family}`;
    const lines = wrapCanvasText(context, quote, maxWidth, font);
    if (lines.length <= option.maxLines) {
      return {
        font,
        lineHeight: option.lineHeight,
        lines
      };
    }
  }

  const fallbackFont = `${fontWeight} 42px ${family}`;
  const fallbackLines = wrapCanvasText(context, quote, maxWidth, fallbackFont);
  return {
    font: fallbackFont,
    lineHeight: 62,
    lines: clampLines(context, fallbackLines, 11, maxWidth, fallbackFont)
  };
}

function getCalendarParts() {
  const date = new Date();
  return {
    day: `${date.getDate()}`.padStart(2, "0"),
    monthUpper: date.toLocaleDateString("en-US", { month: "long" }).toUpperCase(),
    year: `${date.getFullYear()}`,
    weekday: date.toLocaleDateString("zh-CN", { weekday: "long" })
  };
}

function formatDateCn(vertical = false) {
  const date = new Date();
  const yyyy = `${date.getFullYear()}`;
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return vertical ? `${yyyy}年${mm}月${dd}日` : `${yyyy}/${mm}/${dd}`;
}

function formatDateCnChineseVertical() {
  const date = new Date();
  return `${toChineseDigits(date.getFullYear())}年·${toChineseDigits(date.getMonth() + 1)}月·${toChineseDigits(date.getDate())}日`;
}

function toChineseDigits(value: number) {
  const map = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  return `${value}`
    .split("")
    .map((char) => map[Number(char)] || char)
    .join("");
}

function shortenTitle(title: string, maxChars: number) {
  if (title.length <= maxChars) return title;
  return `${title.slice(0, maxChars)}…`;
}

function buildVerticalMainSeries(series: string) {
  const normalized = series.trim().replace(/[《》【】「」『』]/g, "");
  const chineseOnly = normalized.replace(/[^\u4e00-\u9fff]/g, "");
  const compact = (chineseOnly || normalized.replace(/[\s/·•,:：，。、“”‘’\-]/g, "")).trim();
  return (compact || "文章摘录").slice(0, 8);
}

function buildVerticalAuthorLabel(username: string) {
  void username;
  return ARTICLE_AUTHOR_NAME;
}

function buildVerticalSourceLabel(username: string) {
  const normalized = username.trim().replace(/\s+/g, "");
  return normalized ? `${shortenTitle(normalized, 8)}·摘录于` : "摘录于";
}

function drawVerticalText(
  context: CanvasRenderingContext2D,
  columns: string[],
  startX: number,
  startY: number,
  options: { color: string; font: string; lineGap: number; columnGap: number }
) {
  context.fillStyle = options.color;
  context.font = options.font;
  for (const [columnIndex, column] of columns.entries()) {
    let y = startY;
    const x = startX + columnIndex * options.columnGap;
    for (const char of column) {
      context.fillText(char, x, y);
      y += getFontSize(options.font) + options.lineGap;
    }
  }
}

function getFontSize(font: string) {
  const match = font.match(/(\d+)px/);
  return match ? Number(match[1]) : 24;
}

function drawAvatarSeal(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  bg: string,
  fg: string,
  label: string,
  labelColor: string
) {
  const gradient = context.createRadialGradient(centerX - 10, centerY - 12, 8, centerX, centerY, radius);
  gradient.addColorStop(0, bg);
  gradient.addColorStop(1, fg);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = labelColor;
  context.font = '700 42px "Songti SC", "Noto Serif SC", serif';
  context.textAlign = "center";
  context.fillText(label, centerX, centerY + 14);
  context.textAlign = "left";
}

function drawDistressedBar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  color: string
) {
  context.fillStyle = color;
  context.fillRect(x, y, width, 12);
  context.fillStyle = "rgba(27, 29, 36, 0.18)";
  for (let index = 0; index < 32; index += 1) {
    const rx = x + ((index * 97) % width);
    const rw = 8 + ((index * 13) % 26);
    context.fillRect(rx, y + (index % 3), rw, 4 + (index % 4));
  }
}

function drawPaperTexture(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  opacity: number,
  tone = "#6f5b3f"
) {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();

  for (let index = 0; index < 240; index += 1) {
    const px = x + ((index * 67) % width);
    const py = y + ((index * 131) % height);
    const radius = 0.4 + ((index * 17) % 20) / 20;
    context.fillStyle = withAlpha(tone, opacity * (0.2 + (index % 5) * 0.12));
    context.beginPath();
    context.arc(px, py, radius, 0, Math.PI * 2);
    context.fill();
  }

  for (let row = 0; row < 22; row += 1) {
    const yy = y + (height / 22) * row;
    context.strokeStyle = withAlpha(tone, opacity * 0.26);
    context.lineWidth = 0.6;
    context.beginPath();
    context.moveTo(x, yy);
    context.lineTo(x + width, yy + ((row % 3) - 1) * 2);
    context.stroke();
  }

  context.restore();
}

function drawLiftedPanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  options: {
    fillTop: string;
    fillBottom: string;
    border: string;
    shadow: string;
  }
) {
  context.save();
  context.shadowColor = options.shadow;
  context.shadowBlur = 34;
  context.shadowOffsetY = 14;
  context.fillStyle = options.fillBottom;
  drawRoundedRectPath(context, x, y, width, height, radius);
  context.fill();
  context.restore();

  const fill = context.createLinearGradient(0, y, 0, y + height);
  fill.addColorStop(0, options.fillTop);
  fill.addColorStop(1, options.fillBottom);
  context.fillStyle = fill;
  drawRoundedRectPath(context, x, y, width, height, radius);
  context.fill();

  context.strokeStyle = options.border;
  context.lineWidth = 1.1;
  drawRoundedRectPath(context, x, y, width, height, radius);
  context.stroke();
}

function drawQuoteMarks(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  options: {
    color: string;
    font: string;
    align: CanvasTextAlign;
  }
) {
  context.save();
  context.fillStyle = options.color;
  context.font = options.font;
  context.textAlign = options.align;
  context.fillText("“”", x, y);
  context.restore();
}

function drawSoftVignette(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string
) {
  const vignette = context.createRadialGradient(width / 2, height / 2, width * 0.18, width / 2, height / 2, width * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, color);
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
}

function drawFineFrame(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  lineWidth: number
) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.strokeRect(x, y, width, height);
  context.restore();
}

function drawRoundedRectPath(
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

function drawSeaBackground(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const sky = context.createLinearGradient(0, y, 0, y + height);
  sky.addColorStop(0, "#8bb7df");
  sky.addColorStop(0.38, "#74a8d9");
  sky.addColorStop(1, "#245f93");
  context.fillStyle = sky;
  context.fillRect(x, y, width, height);

  const sunGlow = context.createRadialGradient(x + width * 0.68, y + 150, 40, x + width * 0.68, y + 150, 220);
  sunGlow.addColorStop(0, "rgba(255, 238, 196, 0.35)");
  sunGlow.addColorStop(1, "rgba(255, 238, 196, 0)");
  context.fillStyle = sunGlow;
  context.fillRect(x, y, width, height);

  context.fillStyle = "rgba(255,255,255,0.26)";
  context.fillRect(x, y + 180, width, 3);

  for (let row = 0; row < 18; row += 1) {
    const yy = y + 220 + row * 26;
    context.strokeStyle = `rgba(255,255,255,${0.05 + row * 0.008})`;
    context.lineWidth = 16 + (row % 3) * 6;
    context.beginPath();
    context.moveTo(x - 30, yy);
    for (let step = 0; step <= 8; step += 1) {
      const px = x + (width / 8) * step;
      const py = yy + Math.sin(step * 0.9 + row * 0.55) * (8 + row * 0.9);
      context.lineTo(px, py);
    }
    context.stroke();
  }
}

function withAlpha(color: string, alpha: number) {
  const normalized = Math.max(0, Math.min(1, alpha));
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const raw = hex.length === 3 ? hex.split("").map((char) => `${char}${char}`).join("") : hex;
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${normalized})`;
  }
  return color;
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
