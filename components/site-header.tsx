"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  readUserProfile,
  USER_PROFILE_STORAGE_KEY,
  USER_PROFILE_UPDATED_EVENT
} from "@/lib/client/user-profile-store";
import type { SearchSuggestion, SearchSuggestionResponse } from "@/lib/site-search-types";

type SiteHeaderProps = {
  active?: "home" | "articles" | "analysis" | "assistant" | "alerts" | "dashboard" | "screener" | "settings";
};

type ThemeMode = "light" | "dark";
const THEME_STORAGE_KEY = "site-theme";
const EMPTY_SEARCH_RESPONSE: SearchSuggestionResponse = {
  query: "",
  articles: [],
  stocks: [],
  tags: [],
  bestMatch: null
};

export function SiteHeader({ active = "home" }: SiteHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<SearchSuggestionResponse>(EMPTY_SEARCH_RESPONSE);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const flatSuggestions = useMemo(
    () => [...searchSuggestions.stocks, ...searchSuggestions.articles, ...searchSuggestions.tags],
    [searchSuggestions]
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const resolved: ThemeMode =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(resolved);
    applyTheme(resolved);
  }, []);

  useEffect(() => {
    if (pathname !== "/articles") {
      setSearchKeyword("");
      return;
    }
    const currentQuery = new URLSearchParams(window.location.search);
    setSearchKeyword((currentQuery.get("q") || "").trim());
  }, [pathname]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!searchWrapRef.current?.contains(target)) {
        setSearchOpen(false);
        setActiveSuggestionIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const refreshAvatar = () => {
      const profile = readUserProfile();
      setAvatarDataUrl(profile?.avatarDataUrl || "");
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === USER_PROFILE_STORAGE_KEY) {
        refreshAvatar();
      }
    };

    refreshAvatar();
    window.addEventListener(USER_PROFILE_UPDATED_EVENT, refreshAvatar as EventListener);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(USER_PROFILE_UPDATED_EVENT, refreshAvatar as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const keyword = searchKeyword.trim();
    if (!keyword) {
      setSearchSuggestions(EMPTY_SEARCH_RESPONSE);
      setSearchLoading(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(keyword)}`, {
          signal: controller.signal,
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(`suggestions failed: ${response.status}`);
        }

        const payload = (await response.json()) as SearchSuggestionResponse;
        if (controller.signal.aborted) return;
        setSearchSuggestions(payload);
        setSearchOpen(true);
        setActiveSuggestionIndex((prev) =>
          payload.articles.length || payload.stocks.length || payload.tags.length ? Math.min(prev, flatLength(payload) - 1) : -1
        );
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setSearchSuggestions(EMPTY_SEARCH_RESPONSE);
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoading(false);
        }
      }
    }, 140);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchKeyword]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: ThemeMode = prev === "light" ? "dark" : "light";
      applyTheme(next);
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  };

  const navigateToSuggestion = (suggestion: SearchSuggestion) => {
    setSearchOpen(false);
    setActiveSuggestionIndex(-1);
    router.push(suggestion.href);
  };

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keyword = searchKeyword.trim();
    if (!keyword) return;

    if (activeSuggestionIndex >= 0 && flatSuggestions[activeSuggestionIndex]) {
      navigateToSuggestion(flatSuggestions[activeSuggestionIndex]);
      return;
    }

    let bestMatch = searchSuggestions.bestMatch;
    if (!bestMatch) {
      try {
        const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(keyword)}`, {
          cache: "no-store"
        });
        if (response.ok) {
          const payload = (await response.json()) as SearchSuggestionResponse;
          bestMatch = payload.bestMatch;
        }
      } catch {
        // Ignore lookup failures and fall back to article search.
      }
    }

    if (bestMatch?.matchMode === "exact") {
      navigateToSuggestion(bestMatch);
      return;
    }

    const next = new URLSearchParams();
    next.set("q", keyword);
    const target = `/articles?${next.toString()}`;
    setSearchOpen(false);
    setActiveSuggestionIndex(-1);
    router.push(target);
  };

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand-link" aria-label="清一山长 首页">
          <span className="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M3 17 9 11l4 4 7-8" />
              <path d="M15 7h5v5" />
            </svg>
          </span>
          <span className="brand-text">QingInvest</span>
        </Link>

        <nav className="site-nav" aria-label="主导航">
          <Link href="/analysis" className={`nav-item-link ${active === "analysis" ? "active" : ""}`}>
            <span className="nav-item-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M3 14.5 7.2 10l2.8 2.8 6.2-7" />
                <path d="M12.8 5.8h3.4v3.4" />
              </svg>
            </span>
            <span>市场</span>
          </Link>
          <Link href="/dashboard" className={`nav-item-link ${active === "dashboard" ? "active" : ""}`}>
            <span className="nav-item-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="6.5" />
                <path d="M3.8 10h12.4M10 3.5c1.8 1.8 2.8 4 2.8 6.5s-1 4.7-2.8 6.5M10 3.5C8.2 5.3 7.2 7.5 7.2 10s1 4.7 2.8 6.5" />
              </svg>
            </span>
            <span>宏观</span>
          </Link>
          <Link href="/stocks" className={`nav-item-link ${active === "screener" ? "active" : ""}`}>
            <span className="nav-item-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M3.2 4.5h13.6L12 10v5.2l-4 2V10z" />
              </svg>
            </span>
            <span>选股</span>
          </Link>
          <Link href="/articles" className={`nav-item-link ${active === "articles" ? "active" : ""}`}>
            <span className="nav-item-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M3 4.5a2 2 0 0 1 2-2h5v14H5a2 2 0 0 0-2 2z" />
                <path d="M17 4.5a2 2 0 0 0-2-2h-5v14h5a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span>文章</span>
          </Link>
          <Link href="/assistant" className={`nav-item-link ${active === "assistant" ? "active" : ""}`}>
            <span className="nav-item-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M4.2 5.2h11.6a1.6 1.6 0 0 1 1.6 1.6v5a1.6 1.6 0 0 1-1.6 1.6H9l-3.8 2.5v-2.5H4.2a1.6 1.6 0 0 1-1.6-1.6v-5a1.6 1.6 0 0 1 1.6-1.6z" />
                <path d="m9.2 8.2.8-1.8.8 1.8 1.9.2-1.4 1.2.4 1.8-1.7-1-1.7 1 .4-1.8L7.3 8.4z" />
              </svg>
            </span>
            <span>AI问答</span>
          </Link>
        </nav>

        <div className="header-actions">
          <div className="header-search-wrap" ref={searchWrapRef}>
            <form className={`header-search ${searchOpen ? "is-open" : ""}`} aria-label="站内搜索" onSubmit={submitSearch}>
              <input
                placeholder="搜索文章、股票、标签..."
                value={searchKeyword}
                onChange={(event) => {
                  setSearchKeyword(event.target.value);
                  setActiveSuggestionIndex(-1);
                }}
                onFocus={() => {
                  if (searchKeyword.trim()) {
                    setSearchOpen(true);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                    setActiveSuggestionIndex(-1);
                    return;
                  }

                  if (!flatSuggestions.length) return;

                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSearchOpen(true);
                    setActiveSuggestionIndex((prev) => (prev + 1) % flatSuggestions.length);
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSearchOpen(true);
                    setActiveSuggestionIndex((prev) =>
                      prev <= 0 ? flatSuggestions.length - 1 : prev - 1
                    );
                  }
                }}
                aria-autocomplete="list"
              />
              <button type="submit" className="header-search-submit" aria-label="搜索">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="9" cy="9" r="5.2" />
                  <path d="m13 13 4 4" />
                </svg>
              </button>
            </form>

            {searchOpen && searchKeyword.trim() ? (
              <div className="header-search-dropdown" id="site-search-dropdown" role="listbox">
                {searchLoading && flatSuggestions.length === 0 ? (
                  <div className="header-search-empty">正在检索文章、股票与标签...</div>
                ) : flatSuggestions.length === 0 ? (
                  <div className="header-search-empty">暂时没有匹配结果，回车可直接搜索相关文章。</div>
                ) : (
                  <>
                    <SearchSuggestionSection
                      label="股票"
                      items={searchSuggestions.stocks}
                      startIndex={0}
                      activeIndex={activeSuggestionIndex}
                      onSelect={navigateToSuggestion}
                      query={searchKeyword}
                    />
                    <SearchSuggestionSection
                      label="文章"
                      items={searchSuggestions.articles}
                      startIndex={searchSuggestions.stocks.length}
                      activeIndex={activeSuggestionIndex}
                      onSelect={navigateToSuggestion}
                      query={searchKeyword}
                    />
                    <SearchSuggestionSection
                      label="标签"
                      items={searchSuggestions.tags}
                      startIndex={searchSuggestions.stocks.length + searchSuggestions.articles.length}
                      activeIndex={activeSuggestionIndex}
                      onSelect={navigateToSuggestion}
                      query={searchKeyword}
                    />
                    <button
                      type="button"
                      className="header-search-footer"
                      onClick={() => {
                        const keyword = searchKeyword.trim();
                        if (!keyword) return;
                        setSearchOpen(false);
                        setActiveSuggestionIndex(-1);
                        router.push(`/articles?q=${encodeURIComponent(keyword)}`);
                      }}
                    >
                      查看“{searchKeyword.trim()}”的全部文章搜索结果
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <button type="button" className="header-tool-btn">
            <span className="tool-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <rect x="3" y="4" width="14" height="13" rx="2" />
                <path d="M3 7.5h14" />
                <path d="M7 2.8v2.4M13 2.8v2.4" />
              </svg>
            </span>
            时光机
          </button>
          <button
            type="button"
            className={`header-icon-btn theme-toggle ${theme === "dark" ? "active" : ""}`}
            aria-label={theme === "dark" ? "切换到白昼模式" : "切换到夜幕模式"}
            title={theme === "dark" ? "当前：夜幕（点击切到白昼）" : "当前：白昼（点击切到夜幕）"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M13.8 2.8a7 7 0 1 0 3.4 12.8A7.6 7.6 0 1 1 13.8 2.8z" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="3.2" />
                <path d="M10 2.3v2M10 15.7v2M2.3 10h2M15.7 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4" />
              </svg>
            )}
          </button>
          <Link
            href="/settings"
            className={`header-icon-btn account-btn ${active === "settings" ? "active" : ""} ${avatarDataUrl ? "has-avatar" : ""}`}
            aria-label="用户中心"
            title="用户中心"
          >
            {avatarDataUrl ? (
              <img src={avatarDataUrl} alt="用户头像" className="header-account-avatar" />
            ) : (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="7.3" r="3.2" />
                <path d="M4.5 16.5c1.2-2.4 3.1-3.5 5.5-3.5s4.3 1.1 5.5 3.5" />
              </svg>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
}

type SearchSuggestionSectionProps = {
  label: string;
  items: SearchSuggestion[];
  startIndex: number;
  activeIndex: number;
  onSelect: (suggestion: SearchSuggestion) => void;
  query: string;
};

function SearchSuggestionSection({
  label,
  items,
  startIndex,
  activeIndex,
  onSelect,
  query
}: SearchSuggestionSectionProps) {
  if (items.length === 0) return null;

  return (
    <section className="header-search-section" aria-label={label}>
      <div className="header-search-section-title">{label}</div>
      <div className="header-search-section-list">
        {items.map((item, index) => {
          const globalIndex = startIndex + index;
          const compactArticle = item.kind === "article";
          return (
            <button
              key={item.id}
              type="button"
              className={`header-search-item ${compactArticle ? "compact-article" : ""} ${activeIndex === globalIndex ? "active" : ""}`}
              onClick={() => onSelect(item)}
              role="option"
              aria-selected={activeIndex === globalIndex}
            >
              <span className={`header-search-item-badge kind-${item.kind}`}>{item.badge || label}</span>
              <span className="header-search-item-copy">
                <span className="header-search-item-title-row">
                  <strong>{renderHighlightedText(item.title, query)}</strong>
                  {!compactArticle ? <span>{renderHighlightedText(item.subtitle, query)}</span> : null}
                </span>
                {!compactArticle ? (
                  <span className="header-search-item-preview">{renderHighlightedText(item.preview, query)}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function flatLength(payload: SearchSuggestionResponse) {
  return payload.articles.length + payload.stocks.length + payload.tags.length;
}

function renderHighlightedText(text: string, query: string): ReactNode {
  const keyword = query.trim();
  if (!keyword) return text;

  const normalizedText = text.toLocaleLowerCase();
  const normalizedKeyword = keyword.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = normalizedText.indexOf(normalizedKeyword, cursor);
    if (matchIndex === -1) {
      parts.push(text.slice(cursor));
      break;
    }

    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }

    const matched = text.slice(matchIndex, matchIndex + keyword.length);
    parts.push(
      <mark key={`${matchIndex}-${matched}`} className="header-search-highlight">
        {matched}
      </mark>
    );
    cursor = matchIndex + keyword.length;
  }

  return parts.length === 1 ? parts[0] : parts;
}
