"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addManagedArticleAnnotation,
  ARTICLE_ANNOTATIONS_CHANGED_EVENT,
  readManagedArticleAnnotations,
  removeManagedArticleAnnotation,
  type ArticleAnnotation
} from "@/lib/client/article-annotations-store";

type ArticleAnnotationsProps = {
  articleSlug: string;
  contentRootId: string;
  variant?: "default" | "compact";
};

export function ArticleAnnotations({ articleSlug, contentRootId, variant = "default" }: ArticleAnnotationsProps) {
  const [annotations, setAnnotations] = useState<ArticleAnnotation[]>([]);
  const [selectedText, setSelectedText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [activeTab, setActiveTab] = useState<"mine" | "others">("mine");
  const storageKey = `article-annotations:${articleSlug}`;

  const syncAnnotations = useCallback(() => {
    void readManagedArticleAnnotations(articleSlug).then((items) => {
      setAnnotations(items);
    });
  }, [articleSlug]);

  useEffect(() => {
    syncAnnotations();

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      syncAnnotations();
    };

    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ slug?: string }>).detail;
      if (detail?.slug && detail.slug !== articleSlug) return;
      syncAnnotations();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(ARTICLE_ANNOTATIONS_CHANGED_EVENT, onChanged as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ARTICLE_ANNOTATIONS_CHANGED_EVENT, onChanged as EventListener);
    };
  }, [articleSlug, storageKey, syncAnnotations]);

  useEffect(() => {
    if (variant === "compact") return;

    const onMouseUp = () => {
      const root = document.getElementById(contentRootId);
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (!root || !selection || !text) {
        setSelectedText("");
        return;
      }

      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      if (!range) {
        setSelectedText("");
        return;
      }

      const commonNode = range.commonAncestorContainer;
      const inside = root.contains(commonNode.nodeType === Node.ELEMENT_NODE ? commonNode : commonNode.parentNode);
      if (!inside) {
        setSelectedText("");
        return;
      }

      setSelectedText(text.slice(0, 240));
    };

    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [contentRootId, variant]);

  const addAnnotation = () => {
    if (!selectedText) return;
    void addManagedArticleAnnotation(articleSlug, {
      quote: selectedText,
      note: noteText,
      kind: "annotation"
    }).then(() => {
      setSelectedText("");
      setNoteText("");
      window.getSelection()?.removeAllRanges();
      syncAnnotations();
    });
  };

  const removeAnnotation = (item: ArticleAnnotation) => {
    void removeManagedArticleAnnotation(articleSlug, item).then(() => {
      syncAnnotations();
    });
  };

  const jumpToAnnotation = useCallback(
    (quote: string) => {
      jumpToQuote(contentRootId, quote);
    },
    [contentRootId]
  );

  if (variant === "compact") {
    return (
      <div className="compact-annotations">
        <div className="annotation-tabs">
          <button
            type="button"
            className={`annotation-tab-btn ${activeTab === "mine" ? "active" : ""}`}
            onClick={() => setActiveTab("mine")}
          >
            我的
          </button>
          <button
            type="button"
            className={`annotation-tab-btn ${activeTab === "others" ? "active" : ""}`}
            onClick={() => setActiveTab("others")}
          >
            他人
          </button>
        </div>

        {activeTab === "others" ? (
          <p className="compact-annotation-empty">暂无他人批注</p>
        ) : annotations.length === 0 ? (
          <p className="compact-annotation-empty">暂无批注，选中文本开始添加</p>
        ) : (
          <ul className="annotation-list compact">
            {annotations.slice(0, 6).map((item) => (
              <li
                className="annotation-item compact clickable"
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => jumpToAnnotation(item.quote)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    jumpToAnnotation(item.quote);
                  }
                }}
              >
                <p className="annotation-quote">“{item.quote}”</p>
                {item.note ? <p className="annotation-note">{item.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="page-note">选中正文后可使用悬浮操作条，也可在这里继续添加批注（登录后自动同步到账号）。</p>

      <div className="chip-placeholder-row" style={{ marginTop: 8 }}>
        <span className="chip-placeholder">选中文本：{selectedText || "未选择"}</span>
      </div>

      <textarea
        style={{ width: "100%", minHeight: 72, marginTop: 10 }}
        placeholder="输入批注（可选）"
        value={noteText}
        onChange={(event) => setNoteText(event.target.value)}
      />

      <div className="chip-placeholder-row">
        <button type="button" className="article-read-btn" disabled={!selectedText} onClick={addAnnotation}>
          添加批注
        </button>
      </div>

      <ul className="annotation-list" style={{ marginTop: 12 }}>
        {annotations.length === 0 ? (
          <li className="annotation-item">
            <p className="annotation-note">暂无批注</p>
          </li>
        ) : (
          annotations.map((item) => (
            <li className="annotation-item" key={item.id}>
              <div
                className="annotation-card-trigger"
                role="button"
                tabIndex={0}
                onClick={() => jumpToAnnotation(item.quote)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    jumpToAnnotation(item.quote);
                  }
                }}
              >
                <div className="chip-placeholder-row" style={{ marginTop: 0, marginBottom: 6 }}>
                  <span className="meta-pill">{item.kind === "quote" ? "金句" : "批注"}</span>
                </div>
                <p className="annotation-quote">“{item.quote}”</p>
                {item.note ? <p className="annotation-note">{item.note}</p> : null}
              </div>
              <div className="chip-placeholder-row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="article-read-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeAnnotation(item);
                  }}
                >
                  删除
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function jumpToQuote(contentRootId: string, quote: string) {
  const root = document.getElementById(contentRootId);
  const normalizedQuote = normalizeWhitespace(quote);
  if (!root || !normalizedQuote) return;

  const candidates = Array.from(root.querySelectorAll("p, li, blockquote, h2, h3, h4, figcaption, td, pre"));
  const bestTarget = candidates.find((element) => {
    const text = normalizeWhitespace(element.textContent || "");
    return text.includes(normalizedQuote) || normalizedQuote.includes(text);
  });

  const fallbackTarget =
    bestTarget ||
    candidates.find((element) => {
      const text = normalizeWhitespace(element.textContent || "");
      const prefix = normalizedQuote.slice(0, Math.min(18, normalizedQuote.length));
      return prefix.length >= 6 && text.includes(prefix);
    });

  const target = fallbackTarget || root;
  target.scrollIntoView({ behavior: "smooth", block: "center" });

  if (target instanceof HTMLElement) {
    target.classList.remove("article-jump-highlight");
    window.requestAnimationFrame(() => {
      target.classList.add("article-jump-highlight");
      window.setTimeout(() => {
        target.classList.remove("article-jump-highlight");
      }, 2200);
    });
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
