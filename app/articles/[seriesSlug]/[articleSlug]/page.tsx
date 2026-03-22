import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ArticleStateToggle } from "@/components/articles/article-state-toggle";
import { ArticleAnnotations } from "@/components/articles/article-annotations";
import { ArticleSelectionToolbar } from "@/components/articles/article-selection-toolbar";
import { ArticleDetailLayout } from "@/components/articles/article-detail-layout";
import { ArticleDetailToc } from "@/components/articles/article-detail-toc";
import { ArticleReadingProgress } from "@/components/articles/article-reading-progress";
import {
  addHeadingIds,
  extractHeadings,
  getAllArticleListItems,
  getArticleByRoute,
  getPrevNextInSeries,
  getRelatedArticles,
  getSeriesArticles,
  renderMarkdownToHtml
} from "@/lib/articles";

export const dynamicParams = false;

type Params = {
  seriesSlug: string;
  articleSlug: string;
};

type ArticleDetailPageProps = {
  params: Promise<Params>;
};

export async function generateStaticParams() {
  const articles = await getAllArticleListItems();
  return articles.map((article) => ({
    seriesSlug: article.seriesSlug,
    articleSlug: article.slug
  }));
}

export default async function ArticleDetailPage({ params }: ArticleDetailPageProps) {
  const resolvedParams = await params;
  const seriesSlug = safeDecode(resolvedParams.seriesSlug);
  const articleSlug = safeDecode(resolvedParams.articleSlug);

  const article = await getArticleByRoute(seriesSlug, articleSlug);
  if (!article) {
    notFound();
  }

  const [seriesArticles, prevNext] = await Promise.all([
    getSeriesArticles(article.seriesSlug),
    getPrevNextInSeries(article)
  ]);
  const isPlaceholder = article.placeholderStatus !== "none";

  const headings = extractHeadings(article.content);
  const html = addHeadingIds(await renderMarkdownToHtml(article.content));

  const allArticles = await getAllArticleListItems();
  const related = getRelatedArticles(article, allArticles, 6);

  return (
    <>
      <SiteHeader active="articles" />

      <main className="article-page article-detail-page">
        <div className="container">
          <ArticleDetailLayout
            left={
              <>
                <button
                  type="button"
                  className="directory-title-card directory-title-toggle"
                  data-toggle-left-sidebar
                  title="收起左侧目录"
                >
                  <IconGrid />
                  <span>文章专题</span>
                  <span className="directory-toggle-arrow" aria-hidden="true">
                    <IconFoldLeft />
                  </span>
                </button>

                <p className="directory-caption">专题</p>
                <div className="directory-series-head">
                  <IconFolder />
                  <span className="directory-series-name">{article.series}</span>
                  <span className="directory-count">({seriesArticles.length})</span>
                </div>

                <ul className="directory-scroll-list">
                  {seriesArticles.map((item) => (
                    <li key={item.slug} className={`directory-item ${item.slug === article.slug ? "active" : ""}`}>
                      <Link href={`/articles/${item.seriesSlug}/${item.slug}`}>
                        <span className="directory-dot" aria-hidden="true" />
                        <span className="directory-item-text">{item.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            }
            main={
              <article id="articleReadingRoot" className="article-detail-main">
                <ArticleReadingProgress articleRootId="articleReadingRoot" completeAtId="relatedContentSection" />
                <div className="article-detail-header">
                  <p className="article-breadcrumb">
                    <Link href="/articles">专题文章</Link>
                    <span>/</span>
                    <span>{article.series}</span>
                  </p>

                  <h1 id="articleTop" className="article-detail-title">
                    {article.title}
                  </h1>

                  <p className="article-detail-lead">{article.summary || "暂无摘要"}</p>
                </div>

                <div className="article-detail-meta">
                  <span>
                    <IconCalendar /> {article.date}
                  </span>
                  <span>
                    <IconBook /> {article.series}
                  </span>
                  {isPlaceholder ? (
                    <span>
                      <IconLink /> {placeholderLabel(article.placeholderStatus)}
                    </span>
                  ) : null}
                  {article.sourceUrl ? (
                    <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                      <IconLink /> 原始链接
                    </a>
                  ) : (
                    <span>
                      <IconLink /> 原始链接待补充
                    </span>
                  )}
                </div>

                <ArticleStateToggle articleSlug={article.slug} defaultState={article.status} variant="detail" />

                <p className="article-sync-tip">
                  已登录：待阅/已读会保存到账号并跨设备同步。未登录期间的数据可在设置中导入。
                </p>

                {article.tags.length || article.industries.length || article.stocks.length ? (
                  <div className="article-topic-block">
                    <TopicRow label="标签" icon={<IconTag />} items={article.tags} />
                    <TopicRow label="行业" icon={<IconIndustry />} items={article.industries} />
                    <TopicRow label="个股" icon={<IconStock />} items={article.stocks} />
                  </div>
                ) : null}

                {isPlaceholder ? (
                  <section className="article-source-card">
                    <p>
                      <strong>条目状态:</strong> {placeholderLabel(article.placeholderStatus)}
                    </p>
                    <p>
                      <strong>说明:</strong> {placeholderNotice(article.placeholderStatus, article.series)}
                    </p>
                    <p>
                      <strong>处理方式:</strong>{" "}
                      {article.sourceUrl ? "可先通过原始链接查看，后续补录后会替换为完整正文。" : "当前仅保留专题占位说明。"}
                    </p>
                  </section>
                ) : null}

                <section className="article-series-panel">
                  <div className="series-panel-title">
                    <IconBook />
                    <span>{article.series}</span>
                  </div>
                  <div className="series-panel-link">
                    {prevNext.next ? (
                      <Link href={`/articles/${prevNext.next.seriesSlug}/${prevNext.next.slug}`}>
                        {truncate(prevNext.next.title, 18)}
                      </Link>
                    ) : (
                      <span>已是该专题最新</span>
                    )}
                  </div>
                </section>

                <section className="article-source-card">
                  <p>
                    <strong>{isPlaceholder ? "条目录入时间" : "发布时间"}:</strong> {article.date} |{" "}
                    <strong>{isPlaceholder ? "原始链接" : "原文链接"}:</strong>{" "}
                    {article.sourceUrl ? (
                      <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                        {article.sourceUrl}
                      </a>
                    ) : (
                      "待补充"
                    )}
                  </p>
                  <p>
                    <strong>{isPlaceholder ? "条目性质" : "点赞数"}:</strong>{" "}
                    {isPlaceholder ? placeholderLabel(article.placeholderStatus) : "暂无 | 人赞同"}
                  </p>
                  <p>
                    <strong>作者信息:</strong>{" "}
                    {isPlaceholder ? "该条目为专题占位信息，版权与原始内容归原作者所有。" : "内容整理自公开原文，版权归原作者所有。"}
                  </p>
                </section>

                <section className="detail-content" id="articleBodySection">
                  <h2>{isPlaceholder ? "条目说明" : "正文内容"}</h2>
                  <div className="article-body" dangerouslySetInnerHTML={{ __html: html }} />
                </section>

                {!isPlaceholder ? (
                  <ArticleSelectionToolbar
                    articleSlug={article.slug}
                    articleTitle={article.title}
                    contentRootId="articleBodySection"
                  />
                ) : null}

                <section id="relatedContentSection" className="detail-content">
                  <h2>相关阅读</h2>
                  {related.length === 0 ? (
                    <p className="page-note">暂无相关内容</p>
                  ) : (
                    <ul className="related-reading-list">
                      {related.map((item) => (
                        <li key={item.slug}>
                          <Link className="inline-link" href={`/articles/${item.seriesSlug}/${item.slug}`}>
                            {item.title}
                          </Link>
                          <span className="count-badge">{item.date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <div
                  className="pagination-row article-detail-pagination"
                  style={{ justifyContent: "space-between", marginTop: 20 }}
                >
                  {prevNext.prev ? (
                    <Link
                      className="page-btn inline-link"
                      href={`/articles/${prevNext.prev.seriesSlug}/${prevNext.prev.slug}`}
                    >
                      ← 上一篇
                    </Link>
                  ) : (
                    <span className="page-note">已是第一篇</span>
                  )}

                  {prevNext.next ? (
                    <Link
                      className="page-btn inline-link"
                      href={`/articles/${prevNext.next.seriesSlug}/${prevNext.next.slug}`}
                    >
                      下一篇 →
                    </Link>
                  ) : (
                    <span className="page-note">已是最后一篇</span>
                  )}
                </div>
              </article>
            }
            right={
              <>
                <section className="article-right-card toc-card">
                  <button
                    type="button"
                    className="toc-toggle-btn"
                    data-toggle-right-sidebar
                    title="收起右侧目录"
                  >
                    <span>
                      <IconMenu /> 目录
                    </span>
                    <span className="toc-toggle-arrow" aria-hidden="true">
                      <IconFoldRight />
                    </span>
                  </button>
                  {headings.length > 0 ? (
                    <ArticleDetailToc headings={headings} />
                  ) : (
                    <p className="page-note">{isPlaceholder ? "该条目暂无正文目录。" : "当前正文暂无可跳转目录。"}</p>
                  )}
                </section>

                {!isPlaceholder ? (
                  <section className="article-right-card annotation-card">
                    <div className="article-right-card-head">
                      <h2>
                        <IconComment /> 文章批注
                      </h2>
                      <span>选中文本添加</span>
                    </div>
                    <ArticleAnnotations articleSlug={article.slug} contentRootId="articleBodySection" variant="compact" />
                  </section>
                ) : null}
              </>
            }
          />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function truncate(value: string, size: number): string {
  if (value.length <= size) return value;
  return `${value.slice(0, size)}...`;
}

function placeholderLabel(status: "none" | "external" | "missing_local"): string {
  if (status === "external") return "外部链接";
  if (status === "missing_local") return "待补录";
  return "正式文章";
}

function placeholderNotice(status: "none" | "external" | "missing_local", series: string): string {
  if (status === "external") {
    return `该条目属于「${series}」专题，目前站内仅保留专题位置与外部原始链接。`;
  }
  if (status === "missing_local") {
    return `该条目属于「${series}」专题，当前本地正文暂缺，后续补抓后会替换为正式文章。`;
  }
  return "";
}

function TopicRow({
  label,
  icon,
  items
}: {
  label: string;
  icon: ReactNode;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="topic-row">
      <span className="topic-label">
        <span className="topic-label-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      <div className="topic-chips">
        {items.map((item) => (
          <span key={`${label}-${item}`} className="topic-chip">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.5 6.5h5l1.6 2h8.4v6.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
      <path d="M2.5 6.5v-.5a2 2 0 0 1 2-2h3l1.2 1.5" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 7.5h14" />
      <path d="M7 2.8v2.4M13 2.8v2.4" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 4.5a2 2 0 0 1 2-2h5v14H5a2 2 0 0 0-2 2z" />
      <path d="M17 4.5a2 2 0 0 0-2-2h-5v14h5a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M8 12.2 5.8 14.4a2.6 2.6 0 1 1-3.7-3.7l2.8-2.8a2.6 2.6 0 0 1 3.7 0" />
      <path d="m12 7.8 2.2-2.2a2.6 2.6 0 1 1 3.7 3.7l-2.8 2.8a2.6 2.6 0 0 1-3.7 0" />
      <path d="m7.4 12.6 5.2-5.2" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 5.5h12" />
      <path d="M4 10h12" />
      <path d="M4 14.5h12" />
    </svg>
  );
}

function IconComment() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V5A1.5 1.5 0 0 1 4 3.5z" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 10.2V4.6A1.6 1.6 0 0 1 4.6 3H10l6.8 6.8a1.6 1.6 0 0 1 0 2.3l-4.6 4.6a1.6 1.6 0 0 1-2.3 0z" />
      <circle cx="6.8" cy="6.8" r="1.1" />
    </svg>
  );
}

function IconIndustry() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.2 16.8h13.6" />
      <path d="M4.2 16.8V9.4h3.2v7.4" />
      <path d="M8.4 16.8V6.6h3.2v10.2" />
      <path d="M12.6 16.8V4.2h3.2v12.6" />
    </svg>
  );
}

function IconStock() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.2 14.8h13.6" />
      <path d="m4.2 12.2 3.5-3.2 2.6 1.9 5-4.7" />
      <path d="M13.8 6.2h1.5v1.5" />
    </svg>
  );
}

function IconFoldLeft() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M11.3 3.2 6.4 8l4.9 4.8" />
    </svg>
  );
}

function IconFoldRight() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.7 3.2 9.6 8l-4.9 4.8" />
    </svg>
  );
}
