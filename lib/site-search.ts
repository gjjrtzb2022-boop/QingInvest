import { getAllArticleListItems, type ArticleListItem } from "@/lib/articles";
import { searchStockCatalog } from "@/lib/server/stock-catalog";
import type { StockItem } from "@/lib/stocks-meta";
import type {
  SearchSuggestion,
  SearchSuggestionMatchMode,
  SearchSuggestionResponse
} from "@/lib/site-search-types";

type Limits = {
  articles?: number;
  stocks?: number;
  tags?: number;
};

type ScoredSuggestion = SearchSuggestion & {
  score: number;
};

const DEFAULT_LIMITS = {
  articles: 5,
  stocks: 5,
  tags: 6
} satisfies Required<Limits>;

export async function getSearchSuggestions(query: string, limits: Limits = {}): Promise<SearchSuggestionResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      query: "",
      articles: [],
      stocks: [],
      tags: [],
      bestMatch: null
    };
  }

  const normalizedQuery = normalizeSearchText(trimmed);
  if (!normalizedQuery) {
    return {
      query: trimmed,
      articles: [],
      stocks: [],
      tags: [],
      bestMatch: null
    };
  }

  const resolvedLimits = { ...DEFAULT_LIMITS, ...limits };
  const articles = await getAllArticleListItems();

  const articleMatches = articles
    .map((article) => scoreArticleSuggestion(article, normalizedQuery))
    .filter((item): item is ScoredSuggestion => Boolean(item))
    .sort(compareSuggestions)
    .slice(0, resolvedLimits.articles);

  const matchedStocks = await searchStockCatalog(trimmed, resolvedLimits.stocks * 3);
  const stockMatches = matchedStocks
    .map((stock) => scoreStockSuggestion(stock, normalizedQuery))
    .filter((item): item is ScoredSuggestion => Boolean(item))
    .sort(compareSuggestions)
    .slice(0, resolvedLimits.stocks);

  const tagMatches = buildTagSuggestions(articles, normalizedQuery)
    .sort(compareSuggestions)
    .slice(0, resolvedLimits.tags);

  const bestMatch =
    [...articleMatches, ...stockMatches, ...tagMatches].sort(compareSuggestions)[0] ?? null;

  return {
    query: trimmed,
    articles: articleMatches.map(stripScore),
    stocks: stockMatches.map(stripScore),
    tags: tagMatches.map(stripScore),
    bestMatch: bestMatch ? stripScore(bestMatch) : null
  };
}

function scoreArticleSuggestion(article: ArticleListItem, query: string): ScoredSuggestion | null {
  const candidates = [
    matchField(query, article.title, 200, 135, 92),
    matchField(query, article.series, 78, 48, 24),
    ...article.tags.map((tag) => matchField(query, tag, 130, 90, 52)),
    ...article.stocks.map((stock) => matchField(query, stock, 138, 94, 56)),
    ...article.industries.map((industry) => matchField(query, industry, 116, 80, 48)),
    matchField(query, article.summary, 42, 26, 14)
  ];

  const best = pickBestMatch(candidates);
  if (!best) return null;

  return {
    id: `article:${article.slug}`,
    kind: "article",
    title: article.title,
    subtitle: `${article.series} · ${article.date}`,
    preview: shortenText(article.summary || "点击查看文章详情与全文预览。", 84),
    href: `/articles/${article.seriesSlug}/${article.slug}`,
    badge: "文章",
    matchMode: best.mode,
    score: best.score
  };
}

function scoreStockSuggestion(stock: StockItem, query: string): ScoredSuggestion | null {
  const candidates = [
    matchField(query, stock.name, 240, 164, 110),
    matchField(query, stock.code, 240, 168, 118),
    ...stock.aliases.map((alias) => matchField(query, alias, 210, 148, 96)),
    matchField(query, stock.industry, 80, 52, 28)
  ];

  const best = pickBestMatch(candidates);
  if (!best) return null;

  const aliasPreview = stock.aliases.length ? `别名：${stock.aliases.slice(0, 3).join(" / ")}` : "点击进入股票详情。";

  return {
    id: `stock:${stock.code}`,
    kind: "stock",
    title: stock.name,
    subtitle: `${stock.code} · ${stock.industry}`,
    preview: `${aliasPreview} · 被提及 ${stock.mentionCount} 次`,
    href: `/stocks?code=${encodeURIComponent(stock.code)}`,
    badge: "股票",
    matchMode: best.mode,
    score: best.score
  };
}

function buildTagSuggestions(articles: ArticleListItem[], query: string): ScoredSuggestion[] {
  const counter = new Map<string, number>();

  for (const article of articles) {
    for (const tag of article.tags) {
      counter.set(tag, (counter.get(tag) || 0) + 1);
    }
  }

  const results: ScoredSuggestion[] = [];

  for (const [tag, count] of counter.entries()) {
    const matched = matchField(query, tag, 220, 152, 98);
    if (!matched) continue;

    results.push({
      id: `tag:${tag}`,
      kind: "tag",
      title: tag,
      subtitle: `标签 · ${count} 篇相关文章`,
      preview: `点击后按标签筛选文章，并查看相关内容聚合。`,
      href: `/articles?tag=${encodeURIComponent(tag)}`,
      badge: "标签",
      matchMode: matched.mode,
      score: matched.score + Math.min(count, 20)
    });
  }

  return results;
}

function matchField(
  query: string,
  source: string,
  exactScore: number,
  prefixScore: number,
  partialScore: number
): { score: number; mode: SearchSuggestionMatchMode } | null {
  const normalizedSource = normalizeSearchText(source);
  if (!query || !normalizedSource) return null;

  if (normalizedSource === query) {
    return { score: exactScore, mode: "exact" };
  }

  if (normalizedSource.startsWith(query)) {
    return { score: prefixScore, mode: "prefix" };
  }

  if (normalizedSource.includes(query)) {
    return { score: partialScore, mode: "partial" };
  }

  return null;
}

function pickBestMatch(
  matches: Array<{ score: number; mode: SearchSuggestionMatchMode } | null>
): { score: number; mode: SearchSuggestionMatchMode } | null {
  return matches
    .filter((item): item is { score: number; mode: SearchSuggestionMatchMode } => Boolean(item))
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function compareSuggestions(a: ScoredSuggestion, b: ScoredSuggestion) {
  if (b.score !== a.score) return b.score - a.score;
  const kindDelta = searchKindPriority(a.kind) - searchKindPriority(b.kind);
  if (kindDelta !== 0) return kindDelta;
  return a.title.localeCompare(b.title, "zh-CN");
}

function stripScore(suggestion: ScoredSuggestion): SearchSuggestion {
  const { score: _score, ...rest } = suggestion;
  return rest;
}

function shortenText(value: string, limit: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(limit - 1, 1))}…`;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[【】（）()《》〈〉[\]{}，。、“”"'‘’·,.!?:：;；\-_/\\|]/g, "");
}

function searchKindPriority(kind: SearchSuggestion["kind"]) {
  if (kind === "stock") return 0;
  if (kind === "article") return 1;
  return 2;
}
