"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ArticleListItem } from "@/lib/articles";
import {
  ARTICLE_STATE_CHANGED_EVENT,
  readEffectiveStatuses,
  type ArticleUserStatus
} from "@/lib/client/article-user-state";
import { getSupabaseBrowserClient } from "@/lib/client/supabase-browser";
import { useScrollHandoff } from "@/components/articles/use-scroll-handoff";

type ArticlesListClientProps = {
  articles: ArticleListItem[];
};

type SortKey = "date" | "title";
type SortOrder = "asc" | "desc";
type StatusFilter = "all" | "unread" | "read" | "favorite";
type QualityFilter = "missing-summary" | "missing-tags" | "missing-industry" | "missing-cover" | "auto-title";
type TagGroup = { title: string; tags: string[] };

const PAGE_SIZE = 20;
const TAG_GROUP_PREVIEW_COUNT = 4;

const QUALITY_FILTERS: Array<{ key: QualityFilter; label: string }> = [
  { key: "missing-summary", label: "缺简介" },
  { key: "missing-tags", label: "无标签" },
  { key: "missing-industry", label: "无行业" },
  { key: "missing-cover", label: "无封面" },
  { key: "auto-title", label: "自动标题" }
];

export function ArticlesListClient({ articles }: ArticlesListClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [statusMap, setStatusMap] = useState<Record<string, ArticleUserStatus>>({});
  const [expandedTagGroups, setExpandedTagGroups] = useState<Record<string, boolean>>({});
  const sidebarRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const rightRef = useRef<HTMLElement | null>(null);
  const scrollHandoffRefs = useMemo(() => [sidebarRef, mainRef, rightRef], []);

  useScrollHandoff(scrollHandoffRefs);

  useEffect(() => {
    let cancelled = false;
    const slugs = articles.map((item) => item.slug);

    const sync = async () => {
      const map = await readEffectiveStatuses(slugs);
      if (cancelled) return;
      setStatusMap(map);
    };
    void sync();

    const onStorage = () => {
      void sync();
    };
    const onStatusChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ slug?: string; status?: ArticleUserStatus }>).detail;
      if (!detail?.slug || !detail.status) {
        void sync();
        return;
      }
      setStatusMap((prev) => ({
        ...prev,
        [detail.slug as string]: detail.status as ArticleUserStatus
      }));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(ARTICLE_STATE_CHANGED_EVENT, onStatusChanged as EventListener);

    const supabase = getSupabaseBrowserClient();
    const authSubscription = supabase?.auth.onAuthStateChange(() => {
      void sync();
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ARTICLE_STATE_CHANGED_EVENT, onStatusChanged as EventListener);
      authSubscription?.data.subscription.unsubscribe();
    };
  }, [articles]);

  const status = (searchParams.get("status") as StatusFilter) || "all";
  const sort = (searchParams.get("sort") as SortKey) || "date";
  const order = (searchParams.get("order") as SortOrder) || "desc";
  const query = (searchParams.get("q") || "").trim();
  const selectedTags = readTagParams(searchParams);
  const selectedIndustry = (searchParams.get("industry") || "").trim();
  const selectedStock = (searchParams.get("stock") || "").trim();
  const selectedSeries = (searchParams.get("series") || "").trim();
  const selectedQuality = readQualityParams(searchParams);
  const page = Math.max(Number.parseInt(searchParams.get("page") || "1", 10) || 1, 1);

  const getEffectiveStatus = useCallback(
    (article: ArticleListItem): ArticleUserStatus => statusMap[article.slug] ?? article.status,
    [statusMap]
  );
  const indexedArticles = useMemo(
    () =>
      articles.map((item) => ({
        ...item,
        searchPool: [
          item.title,
          item.summary,
          item.series,
          item.category,
          ...item.tags,
          ...item.industries,
          ...item.stocks
        ]
          .join(" ")
          .toLowerCase()
      })),
    [articles]
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    const target = [...indexedArticles]
      .filter((item) => (status === "all" ? true : getEffectiveStatus(item) === status))
      .filter((item) => (selectedTags.length ? selectedTags.every((tag) => item.tags.includes(tag)) : true))
      .filter((item) => (selectedIndustry ? item.industries.includes(selectedIndustry) : true))
      .filter((item) => (selectedStock ? item.stocks.includes(selectedStock) : true))
      .filter((item) => (selectedSeries ? item.series === selectedSeries : true))
      .filter((item) =>
        selectedQuality.length ? selectedQuality.every((key) => matchesQualityFilter(key, item)) : true
      )
      .filter((item) => {
        if (!normalizedQuery) return true;
        return item.searchPool.includes(normalizedQuery);
      });

    target.sort((a, b) => {
      const factor = order === "desc" ? -1 : 1;
      if (sort === "title") {
        return a.title.localeCompare(b.title, "zh-CN") * factor;
      }
      return a.date.localeCompare(b.date) * factor;
    });

    return target;
  }, [
    indexedArticles,
    status,
    selectedTags,
    selectedIndustry,
    selectedStock,
    selectedSeries,
    selectedQuality,
    query,
    sort,
    order,
    getEffectiveStatus
  ]);

  const totalPages = filtered.length ? Math.ceil(filtered.length / PAGE_SIZE) : 0;
  const currentPage = totalPages === 0 ? 0 : Math.min(page, totalPages);
  const list =
    currentPage === 0 ? [] : filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const counters = useMemo(() => {
    const all = indexedArticles.length;
    const unread = indexedArticles.filter((item) => getEffectiveStatus(item) === "unread").length;
    const read = indexedArticles.filter((item) => getEffectiveStatus(item) === "read").length;
    const favorite = indexedArticles.filter((item) => getEffectiveStatus(item) === "favorite").length;
    return { all, unread, read, favorite };
  }, [indexedArticles, getEffectiveStatus]);

  const seriesCounter = useMemo(() => toCounter(indexedArticles.map((item) => item.series)), [indexedArticles]);

  const tags = useMemo(() => unique(indexedArticles.flatMap((item) => item.tags)), [indexedArticles]);
  const groupedTags = useMemo(() => groupTags(tags), [tags]);
  const industries = useMemo(() => unique(indexedArticles.flatMap((item) => item.industries)), [indexedArticles]);
  const stocks = useMemo(() => unique(indexedArticles.flatMap((item) => item.stocks)), [indexedArticles]);
  const qualityFilterOptions = useMemo(
    () =>
      QUALITY_FILTERS.map((item) => ({
        ...item,
        count: indexedArticles.filter((article) => matchesQualityFilter(item.key, article)).length
      })),
    [indexedArticles]
  );

  const selectedFilters = [
    selectedTags.length ? `标签:${selectedTags.join("、")}` : "",
    selectedIndustry ? `行业:${selectedIndustry}` : "",
    selectedStock ? `个股:${selectedStock}` : "",
    selectedSeries ? `专题:${selectedSeries}` : "",
    selectedQuality.length
      ? `治理:${selectedQuality.map((item) => QUALITY_FILTERS.find((entry) => entry.key === item)?.label || item).join("、")}`
      : "",
    query ? `搜索:${query}` : ""
  ].filter(Boolean);
  const hasAnyFilter =
    status !== "all" ||
    sort !== "date" ||
    order !== "desc" ||
    Boolean(
      query ||
        selectedTags.length ||
        selectedIndustry ||
        selectedStock ||
        selectedSeries ||
        selectedQuality.length
    );

  const statusNote =
    counters.all === 0
      ? "当前没有文章，请先导入 Markdown 文章。"
      : filtered.length === 0
        ? "当前筛选条件下没有匹配文章。"
        : `已载入 ${counters.all} 篇，当前筛选 ${filtered.length} 篇${selectedFilters.length ? `（${selectedFilters.join("，")}）` : ""}，第 ${currentPage}/${totalPages} 页。`;

  const setParams = (mutator: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    mutator(next);

    const target = next.toString() ? `${pathname}?${next.toString()}` : pathname;
    router.replace(target, { scroll: false });
  };

  const setFilterAndResetPage = (mutator: (next: URLSearchParams) => void) => {
    setParams((next) => {
      mutator(next);
      next.delete("page");
    });
  };

  const toggleTagFilter = (tag: string) => {
    setFilterAndResetPage((next) => {
      const current = readTagParams(next);
      const normalized = current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
      writeTagParams(next, normalized);
    });
  };

  const toggleIndustryFilter = (industry: string) => {
    setFilterAndResetPage((next) => {
      if (selectedIndustry === industry) {
        next.delete("industry");
      } else {
        next.set("industry", industry);
      }
    });
  };

  const toggleStockFilter = (stock: string) => {
    setFilterAndResetPage((next) => {
      if (selectedStock === stock) {
        next.delete("stock");
      } else {
        next.set("stock", stock);
      }
    });
  };

  const toggleQualityFilter = (value: QualityFilter) => {
    setFilterAndResetPage((next) => {
      const current = readQualityParams(next);
      const normalized = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
      writeQualityParams(next, normalized);
    });
  };

  const toggleTagGroup = (title: string) => {
    setExpandedTagGroups((prev) => ({
      ...prev,
      [title]: !prev[title]
    }));
  };

  const clearAllFilters = () => {
    setParams((next) => {
      next.delete("status");
      next.delete("sort");
      next.delete("order");
      next.delete("q");
      next.delete("tag");
      next.delete("industry");
      next.delete("stock");
      next.delete("series");
      next.delete("category");
      next.delete("qa");
      next.delete("page");
    });
  };

  return (
    <>
      <section className="article-overview article-list-overview">
        <div>
          <h1>专题文章库</h1>
          <p>
            共 <span>{counters.all}</span> 篇文章
          </p>
        </div>
      </section>

      <div className="article-status-tabs" data-pill-group>
        <button
          type="button"
          className={`status-pill ${status === "all" ? "active" : ""}`}
          onClick={() => setFilterAndResetPage((next) => next.delete("status"))}
        >
          全部 <span>{counters.all}</span>
        </button>
        <button
          type="button"
          className={`status-pill ${status === "unread" ? "active" : ""}`}
          onClick={() => setFilterAndResetPage((next) => next.set("status", "unread"))}
        >
          待阅 <span>{counters.unread}</span>
        </button>
        <button
          type="button"
          className={`status-pill ${status === "read" ? "active" : ""}`}
          onClick={() => setFilterAndResetPage((next) => next.set("status", "read"))}
        >
          已读 <span>{counters.read}</span>
        </button>
        <button
          type="button"
          className={`status-pill ${status === "favorite" ? "active" : ""}`}
          onClick={() => setFilterAndResetPage((next) => next.set("status", "favorite"))}
        >
          收藏 <span>{counters.favorite}</span>
        </button>
      </div>

      <p className="article-account-note">
        已登录：待阅/已读会保存到账号并跨设备同步；未登录期间的数据可在设置中导入。
      </p>

      <p className="article-status-note">{statusNote}</p>

      <div className="article-layout">
        <aside ref={sidebarRef} className="article-sidebar panel article-sidebar-plain">
          <section className="side-group">
            <h2>
              <IconSort /> 排序
            </h2>
            <div className="sort-actions" data-pill-group>
              <button
                type="button"
                className={`status-pill ${sort === "date" ? "active" : ""}`}
                onClick={() =>
                  setFilterAndResetPage((next) => {
                    if (sort === "date") return;
                    next.set("sort", "date");
                  })
                }
              >
                按日期
              </button>
              <button
                type="button"
                className={`status-pill ${sort === "title" ? "active" : ""}`}
                onClick={() => setFilterAndResetPage((next) => next.set("sort", "title"))}
              >
                按标题
              </button>
              <button
                type="button"
                className={`arrow-btn ${order === "desc" ? "active" : ""}`}
                aria-label="按降序排列"
                onClick={() => setFilterAndResetPage((next) => next.delete("order"))}
              >
                ↓
              </button>
              <button
                type="button"
                className={`arrow-btn ${order === "asc" ? "active" : ""}`}
                aria-label="按升序排列"
                onClick={() => setFilterAndResetPage((next) => next.set("order", "asc"))}
              >
                ↑
              </button>
            </div>
          </section>

          <section className="side-group">
            <h2>
              <IconBook /> 专题
            </h2>
            <ul className="empty-list side-filter-list">
              <li>
                <button
                  type="button"
                  className={`side-list-btn ${selectedSeries ? "" : "active"}`}
                  onClick={() => setFilterAndResetPage((next) => next.delete("series"))}
                >
                  <span>全部专题</span>
                  <span className="count-badge">{counters.all}</span>
                </button>
              </li>
              {Object.entries(seriesCounter)
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => (
                  <li key={name}>
                    <button
                      type="button"
                      className={`side-list-btn ${selectedSeries === name ? "active" : ""}`}
                      onClick={() =>
                        setFilterAndResetPage((next) => {
                          if (selectedSeries === name) {
                            next.delete("series");
                          } else {
                            next.set("series", name);
                          }
                        })
                      }
                    >
                      <span>{name}</span>
                      <span className="count-badge">{count}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>

        </aside>

        <section ref={mainRef} className="article-main">
          <div className="article-card-list">
            {list.length === 0 ? (
              <article className="article-card empty">
                <div>
                  <h2>暂无匹配文章</h2>
                  <p>请调整筛选条件，或继续导入新的 Markdown 文章。</p>
                </div>
                <div className="thumb-placeholder">Empty</div>
              </article>
            ) : (
              list.map((article) => (
                <article key={article.slug} className="article-card">
                  <div className="article-card-main">
                    <h2 className="article-card-title">
                      <Link
                        className="article-title-link"
                        href={`/articles/${article.seriesSlug}/${article.slug}`}
                        prefetch={false}
                      >
                        {article.title}
                      </Link>
                    </h2>
                    <p className="article-card-summary">{article.summary || "暂无摘要"}</p>

                    <div className="article-meta-inline">
                      <span className="meta-inline-item">
                        <IconCalendar /> {article.date}
                      </span>
                      <span className="meta-inline-item">
                        <IconBook /> {article.series}
                      </span>
                      {article.placeholderStatus !== "none" ? (
                        <span className="meta-inline-item">
                          <IconLink /> {placeholderLabel(article.placeholderStatus)}
                        </span>
                      ) : null}
                    </div>

                    {article.tags.length ? (
                      <div className="chip-line">
                        <span className="line-icon">
                          <IconTag />
                        </span>
                        {article.tags.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={`filter-chip tone-chip tag-chip tone-${chipTone(`tag:${item}`)} ${selectedTags.includes(item) ? "active" : ""}`}
                            onClick={() => toggleTagFilter(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {article.industries.length ? (
                      <div className="chip-line">
                        <span className="line-icon">
                          <IconBuilding />
                        </span>
                        {article.industries.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={`filter-chip tone-chip tone-${chipTone(`industry:${item}`)} ${selectedIndustry === item ? "active" : ""}`}
                            onClick={() => toggleIndustryFilter(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {article.stocks.length ? (
                      <div className="chip-line">
                        <span className="line-icon">
                          <IconList />
                        </span>
                        {article.stocks.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={`filter-chip tone-chip tone-${chipTone(`stock:${item}`)} ${selectedStock === item ? "active" : ""}`}
                            onClick={() => toggleStockFilter(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="chip-line">
                      <span className="status-dot">状态：{statusLabel(getEffectiveStatus(article))}</span>
                    </div>
                  </div>

                  {article.cover ? (
                    <img
                      className="thumb-image"
                      src={article.cover}
                      alt={`${article.title} 封面`}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="thumb-placeholder">封面待补充</div>
                  )}
                </article>
              ))
            )}
          </div>

          <div className="pagination-row">
            <button
              type="button"
              className="page-btn"
              disabled={currentPage <= 1}
              onClick={() =>
                setParams((next) => {
                  const nextPage = Math.max(currentPage - 1, 1);
                  if (nextPage <= 1) {
                    next.delete("page");
                  } else {
                    next.set("page", String(nextPage));
                  }
                })
              }
            >
              上一页
            </button>
            <span>
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="page-btn"
              disabled={currentPage === 0 || currentPage >= totalPages}
              onClick={() =>
                setParams((next) => {
                  next.set("page", String(currentPage + 1));
                })
              }
            >
              下一页
            </button>
          </div>
        </section>

        <aside ref={rightRef} className="article-right panel article-right-plain">
          <section className="side-group article-filter-actions article-filter-actions-side">
            <button
              type="button"
              className="status-pill article-clear-all-btn"
              disabled={!hasAnyFilter}
              onClick={clearAllFilters}
            >
              清空全部筛选
            </button>
          </section>

          <section className="side-group">
            <h2>
              <IconGauge /> 内容治理
            </h2>
            <div className="empty-chip-wrap filter-chip-grid">
              <button
                type="button"
                className={`filter-chip neutral-chip ${selectedQuality.length ? "" : "active"}`}
                onClick={() => setFilterAndResetPage((next) => writeQualityParams(next, []))}
              >
                全部文章
              </button>
              {qualityFilterOptions.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`filter-chip neutral-chip ${selectedQuality.includes(item.key) ? "active" : ""}`}
                  onClick={() => toggleQualityFilter(item.key)}
                >
                  {item.label} {item.count}
                </button>
              ))}
            </div>
          </section>

          <section className="side-group">
            <h2>
              <IconTag /> 标签
            </h2>
            <div className="empty-chip-wrap tag-section-wrap">
              <button
                type="button"
                className={`filter-chip neutral-chip ${selectedTags.length ? "" : "active"}`}
                onClick={() => setFilterAndResetPage((next) => writeTagParams(next, []))}
              >
                全部标签
              </button>
              {tags.length === 0 ? (
                <span className="empty-chip">暂无标签</span>
              ) : (
                groupedTags.map((group) => {
                  const expanded = Boolean(expandedTagGroups[group.title]);
                  const visibleTags = getVisibleTags(group, selectedTags, expanded);
                  const hiddenCount = Math.max(group.tags.length - visibleTags.length, 0);

                  return (
                    <div key={group.title} className="tag-group-block">
                      <div className="tag-group-head">
                        <div className="tag-group-labels">
                          <p className="tag-group-title">{group.title}</p>
                          <span className="tag-group-count">{group.tags.length}</span>
                        </div>
                        {group.tags.length > TAG_GROUP_PREVIEW_COUNT ? (
                          <button
                            type="button"
                            className="tag-group-toggle"
                            onClick={() => toggleTagGroup(group.title)}
                          >
                            {expanded ? "收起" : `展开余下 ${hiddenCount}`}
                          </button>
                        ) : null}
                      </div>
                      <div className="tag-group-chips">
                        {visibleTags.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={`filter-chip tone-chip tag-chip tone-${chipTone(`tag:${item}`)} ${selectedTags.includes(item) ? "active" : ""}`}
                            onClick={() => toggleTagFilter(item)}
                            title={item}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="side-group">
            <h2>
              <IconBuilding /> 行业
            </h2>
            <div className="empty-chip-wrap">
              <button
                type="button"
                className={`filter-chip neutral-chip ${selectedIndustry ? "" : "active"}`}
                onClick={() => setFilterAndResetPage((next) => next.delete("industry"))}
              >
                全部行业
              </button>
              {industries.length === 0 ? (
                <span className="empty-chip">暂无行业</span>
              ) : (
                industries.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`filter-chip tone-chip tone-${chipTone(`industry-filter:${item}`)} ${selectedIndustry === item ? "active" : ""}`}
                    onClick={() => toggleIndustryFilter(item)}
                  >
                    {item}
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="side-group">
            <h2>
              <IconList /> 个股
            </h2>
            <div className="empty-chip-wrap">
              <button
                type="button"
                className={`filter-chip neutral-chip ${selectedStock ? "" : "active"}`}
                onClick={() => setFilterAndResetPage((next) => next.delete("stock"))}
              >
                全部个股
              </button>
              {stocks.length === 0 ? (
                <span className="empty-chip">暂无个股</span>
              ) : (
                stocks.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`filter-chip tone-chip tone-${chipTone(`stock:${item}`)} ${selectedStock === item ? "active" : ""}`}
                    onClick={() => toggleStockFilter(item)}
                  >
                    {item}
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>

      <button type="button" className="sandbox-float">
        <IconLayers /> 组合沙箱
      </button>
    </>
  );
}

function toCounter(items: string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = item || "未分类";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function readTagParams(params: { getAll(name: string): string[]; get(name: string): string | null }): string[] {
  const multi = params.getAll("tag");
  const fallback = params.get("tag");
  const raw = multi.length ? multi : fallback ? [fallback] : [];

  return unique(
    raw
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function readQualityParams(params: { getAll(name: string): string[]; get(name: string): string | null }): QualityFilter[] {
  const multi = params.getAll("qa");
  const fallback = params.get("qa");
  const raw = multi.length ? multi : fallback ? [fallback] : [];
  const values = unique(
    raw
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter(Boolean)
  );

  return values.filter((item): item is QualityFilter =>
    QUALITY_FILTERS.some((entry) => entry.key === (item as QualityFilter))
  );
}

function writeTagParams(params: URLSearchParams, tags: string[]) {
  params.delete("tag");
  const normalized = unique(tags.map((item) => item.trim()).filter(Boolean)).sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );
  for (const tag of normalized) {
    params.append("tag", tag);
  }
}

function writeQualityParams(params: URLSearchParams, values: QualityFilter[]) {
  params.delete("qa");
  const normalized = unique(values.map((item) => item.trim()).filter(Boolean)) as QualityFilter[];
  for (const value of normalized) {
    params.append("qa", value);
  }
}

function matchesQualityFilter(filter: QualityFilter, article: ArticleListItem): boolean {
  if (filter === "missing-summary") {
    const normalized = article.summary.trim();
    return normalized === "" || normalized === "暂无摘要";
  }
  if (filter === "missing-tags") {
    return article.tags.length === 0;
  }
  if (filter === "missing-industry") {
    return article.industries.length === 0;
  }
  if (filter === "missing-cover") {
    return article.cover.trim() === "";
  }
  if (filter === "auto-title") {
    return /\(自动生成\)|（自动生成）/.test(article.title);
  }
  return false;
}

function groupTags(tags: string[]): Array<{ title: string; tags: string[] }> {
  const titleMap: Record<string, string[]> = {
    教育成长: [],
    关系心理: [],
    投资经济: [],
    武道训练: [],
    社会议题: [],
    其他: []
  };

  for (const tag of tags) {
    titleMap[resolveTagGroup(tag)].push(tag);
  }

  return Object.entries(titleMap)
    .map(([title, items]) => ({
      title,
      tags: items.sort((a, b) => a.localeCompare(b, "zh-CN"))
    }))
    .filter((group) => group.tags.length > 0);
}

function getVisibleTags(group: TagGroup, selectedTags: string[], expanded: boolean): string[] {
  if (expanded || group.tags.length <= TAG_GROUP_PREVIEW_COUNT) {
    return group.tags;
  }

  const selectedSet = new Set(selectedTags.filter((tag) => group.tags.includes(tag)));
  const previewSet = new Set(group.tags.slice(0, TAG_GROUP_PREVIEW_COUNT));
  const visibleSet = new Set([...previewSet, ...selectedSet]);

  return group.tags.filter((tag) => visibleSet.has(tag));
}

function resolveTagGroup(tag: string): string {
  const value = tag.trim();
  if (containsAny(value, ["教育", "学习", "高考", "留学", "英语", "亲子"])) return "教育成长";
  if (containsAny(value, ["关系", "心理", "婚姻", "亲密"])) return "关系心理";
  if (containsAny(value, ["投资", "股票", "估值", "行业", "宏观", "风险", "财富"])) return "投资经济";
  if (containsAny(value, ["武道", "训练", "格斗", "赛事"])) return "武道训练";
  if (containsAny(value, ["社会", "法律", "哲学"])) return "社会议题";
  return "其他";
}

function containsAny(source: string, parts: string[]): boolean {
  return parts.some((part) => source.includes(part));
}

function statusLabel(status: ArticleListItem["status"]): string {
  if (status === "read") return "已读";
  if (status === "favorite") return "收藏";
  return "待阅";
}

function placeholderLabel(status: ArticleListItem["placeholderStatus"]): string {
  if (status === "external") return "外部链接";
  if (status === "missing_local") return "待补录";
  return "";
}

function chipTone(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash % 12) + 1;
}

function IconSort() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <path d="M7 3v14" />
      <path d="M4 6l3-3 3 3" />
      <path d="M13 17V3" />
      <path d="M10 14l3 3 3-3" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <path d="M3 4.5a2 2 0 0 1 2-2h5v14H5a2 2 0 0 0-2 2z" />
      <path d="M17 4.5a2 2 0 0 0-2-2h-5v14h5a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <path d="M2.5 6.5h5l1.6 2h8.4v6.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
      <path d="M2.5 6.5v-.5a2 2 0 0 1 2-2h3l1.2 1.5" />
    </svg>
  );
}

function IconGauge() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <path d="M3.5 13.8a6.5 6.5 0 1 1 13 0" />
      <path d="M10 10.2 13.4 7.6" />
      <circle cx="10" cy="10.2" r="1" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <path d="M10.5 2.5H4.5v6l6.6 6.6a1.5 1.5 0 0 0 2.1 0l3-3a1.5 1.5 0 0 0 0-2.1z" />
      <circle cx="7" cy="6" r="1" />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <path d="M4 17V3h8v14" />
      <path d="M2 17h16" />
      <path d="M7 6h1M10 6h1M7 9h1M10 9h1M7 12h1M10 12h1" />
    </svg>
  );
}

function IconList() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <path d="M5 5.5h11" />
      <path d="M5 10h11" />
      <path d="M5 14.5h11" />
      <circle cx="3" cy="5.5" r="0.8" />
      <circle cx="3" cy="10" r="0.8" />
      <circle cx="3" cy="14.5" r="0.8" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <path d="M8 12 6.4 13.6a2.7 2.7 0 1 1-3.8-3.8l2.4-2.4a2.7 2.7 0 0 1 3.8 0" />
      <path d="m12 8 1.6-1.6a2.7 2.7 0 1 1 3.8 3.8L15 12.6a2.7 2.7 0 0 1-3.8 0" />
      <path d="M7 10h6" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 7.5h14" />
      <path d="M7 2.8v2.4M13 2.8v2.4" />
    </svg>
  );
}

function IconLayers() {
  return (
    <svg viewBox="0 0 20 20" className="mini-icon" aria-hidden="true">
      <path d="M10 3.2 3.4 6.8 10 10.4l6.6-3.6z" />
      <path d="M3.4 10.2 10 13.8l6.6-3.6" />
      <path d="M3.4 13.6 10 17.2l6.6-3.6" />
    </svg>
  );
}
