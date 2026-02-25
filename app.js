const els = {
  toast: document.querySelector("#toast"),
  commandPaletteHint: document.querySelector("#commandPaletteHint"),
  articleSearchInput: document.querySelector("#articleSearchInput"),
  comingSoonItems: document.querySelectorAll("[data-coming-soon]"),
  statusTabs: document.querySelector("#statusTabs"),
  sortTabs: document.querySelector("#sortTabs"),
  sortOrderBtn: document.querySelector("#sortOrderBtn"),
  articleCards: document.querySelector("#articleCards"),
  articleTotalCount: document.querySelector("#articleTotalCount"),
  statusCountAll: document.querySelector("#statusCountAll"),
  statusCountUnread: document.querySelector("#statusCountUnread"),
  statusCountRead: document.querySelector("#statusCountRead"),
  statusCountFavorite: document.querySelector("#statusCountFavorite"),
  articleStatusNote: document.querySelector("#articleStatusNote"),
  seriesList: document.querySelector("#seriesList"),
  otherList: document.querySelector("#otherList"),
  tagsCloud: document.querySelector("#tagsCloud"),
  industriesCloud: document.querySelector("#industriesCloud"),
  stocksCloud: document.querySelector("#stocksCloud"),
  paginationText: document.querySelector("#paginationText"),
  articleDetail: document.querySelector("#articleDetail"),
  detailTitle: document.querySelector("#detailTitle"),
  detailDate: document.querySelector("#detailDate"),
  detailSeries: document.querySelector("#detailSeries"),
  detailStatus: document.querySelector("#detailStatus"),
  detailTags: document.querySelector("#detailTags"),
  detailIndustries: document.querySelector("#detailIndustries"),
  detailStocks: document.querySelector("#detailStocks"),
  detailCover: document.querySelector("#detailCover"),
  detailContent: document.querySelector("#detailContent")
};

const listState = {
  articles: [],
  status: "all",
  sortKey: "date",
  sortOrder: "desc",
  query: ""
};

init();

function init() {
  bindComingSoon();
  bindCommandPaletteHint();

  if (els.articleCards) {
    initArticleListPage();
  }

  if (els.articleDetail) {
    initArticleDetailPage();
  }
}

function bindComingSoon() {
  els.comingSoonItems.forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      showToast(item.dataset.comingSoon || "该功能暂未开放");
    });
  });
}

function bindCommandPaletteHint() {
  if (!els.commandPaletteHint) return;

  const onActivate = () => {
    if (els.articleSearchInput) {
      els.articleSearchInput.focus();
      return;
    }

    if (els.articleDetail) {
      window.location.href = "articles.html";
      return;
    }

    showToast("搜索功能将在后续接入");
  };

  els.commandPaletteHint.addEventListener("click", onActivate);

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      onActivate();
    }
  });
}

async function initArticleListPage() {
  bindListFilters();

  try {
    const articles = await loadArticleIndex();
    listState.articles = articles;
    renderArticleListPage();
  } catch (error) {
    console.error(error);
    if (els.articleStatusNote) {
      els.articleStatusNote.textContent = error.message;
      els.articleStatusNote.classList.add("error");
    }
    if (els.articleCards) {
      els.articleCards.innerHTML = `
        <article class="article-card empty">
          <div>
            <h2>加载失败</h2>
            <p>未能读取文章索引。请确认你是通过本地 HTTP 服务访问（不是直接双击 HTML 打开）。</p>
            <p>建议命令：cd /Users/jianyuanchen/Desktop/Stock_Test && node tools/build-articles.mjs && python3 -m http.server 5173</p>
          </div>
          <div class="thumb-placeholder">Error</div>
        </article>
      `;
    }
    showToast("文章索引加载失败");
  }
}

function bindListFilters() {
  if (els.statusTabs) {
    els.statusTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-status]");
      if (!button) return;

      listState.status = button.dataset.status;
      setActiveButton(els.statusTabs, button);
      renderArticleListPage();
    });
  }

  if (els.sortTabs) {
    els.sortTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-sort]");
      if (!button) return;

      listState.sortKey = button.dataset.sort;
      setActiveButton(els.sortTabs, button);
      renderArticleListPage();
    });
  }

  if (els.sortOrderBtn) {
    els.sortOrderBtn.addEventListener("click", () => {
      listState.sortOrder = listState.sortOrder === "desc" ? "asc" : "desc";
      els.sortOrderBtn.dataset.order = listState.sortOrder;
      els.sortOrderBtn.textContent = listState.sortOrder === "desc" ? "↓" : "↑";
      renderArticleListPage();
    });
  }

  if (els.articleSearchInput) {
    els.articleSearchInput.addEventListener("input", (event) => {
      listState.query = event.target.value.trim().toLowerCase();
      renderArticleListPage();
    });
  }
}

function renderArticleListPage() {
  const all = listState.articles;
  const filtered = applyListFilters(all);

  renderCounters(all, filtered);
  renderSeriesAndOther(all);
  renderArticleCards(filtered);
  renderCloudPanels(all);
}

function applyListFilters(articles) {
  let next = [...articles];

  if (listState.status !== "all") {
    next = next.filter((article) => article.status === listState.status);
  }

  if (listState.query) {
    const q = listState.query;
    next = next.filter((article) => {
      const pool = [
        article.title,
        article.summary,
        article.series,
        article.category,
        ...article.tags,
        ...article.industries,
        ...article.stocks
      ]
        .join(" ")
        .toLowerCase();
      return pool.includes(q);
    });
  }

  next.sort((a, b) => {
    const direction = listState.sortOrder === "desc" ? -1 : 1;

    if (listState.sortKey === "title") {
      return a.title.localeCompare(b.title, "zh-CN") * direction;
    }

    return a.date.localeCompare(b.date) * direction;
  });

  return next;
}

function renderCounters(all, filtered) {
  const allCount = all.length;
  const unreadCount = all.filter((article) => article.status === "unread").length;
  const readCount = all.filter((article) => article.status === "read").length;
  const favoriteCount = all.filter((article) => article.status === "favorite").length;

  setText(els.articleTotalCount, String(allCount));
  setText(els.statusCountAll, String(allCount));
  setText(els.statusCountUnread, String(unreadCount));
  setText(els.statusCountRead, String(readCount));
  setText(els.statusCountFavorite, String(favoriteCount));
  setText(els.paginationText, filtered.length ? "1 / 1" : "0 / 0");

  if (!els.articleStatusNote) return;

  if (!allCount) {
    els.articleStatusNote.textContent = "当前没有文章，请先在 content/articles 中新增 .md 并执行构建脚本。";
    return;
  }

  if (!filtered.length) {
    els.articleStatusNote.textContent = "当前筛选条件下没有匹配文章。";
    return;
  }

  els.articleStatusNote.textContent = `已载入 ${allCount} 篇文章，当前显示 ${filtered.length} 篇。`;
}

function renderSeriesAndOther(articles) {
  renderCounterList(els.seriesList, counterFrom(articles, "series"), "暂无系列");
  renderCounterList(els.otherList, counterFrom(articles, "category"), "暂无分类");
}

function renderArticleCards(articles) {
  if (!els.articleCards) return;

  if (!articles.length) {
    els.articleCards.innerHTML = `
      <article class="article-card empty">
        <div>
          <h2>暂无匹配文章</h2>
          <p>请调整筛选条件，或继续补充新的 Markdown 文章。</p>
        </div>
        <div class="thumb-placeholder">Empty</div>
      </article>
    `;
    return;
  }

  els.articleCards.innerHTML = articles
    .map((article) => {
      const title = escapeHtml(article.title);
      const summary = escapeHtml(article.summary || "暂无摘要");
      const date = escapeHtml(article.date || "日期待补充");
      const series = escapeHtml(article.series || "未分类系列");
      const detailUrl = `article.html?slug=${encodeURIComponent(article.slug)}`;

      const tagsHtml = renderInlineChips(article.tags, "chip-tag", "标签待补充");
      const industriesHtml = renderInlineChips(article.industries, "chip-industry", "行业待补充");
      const stocksHtml = renderInlineChips(article.stocks, "chip-stock", "个股待补充");

      const coverHtml = article.cover
        ? `<img class="thumb-image" src="${escapeHtml(article.cover)}" alt="${title} 封面" />`
        : `<div class="thumb-placeholder">封面待补充</div>`;

      return `
        <article class="article-card">
          <div>
            <h2><a class="article-title-link" href="${detailUrl}">${title}</a></h2>
            <p>${summary}</p>
            <div class="meta-row">
              <span class="meta-pill">日期：${date}</span>
              <span class="meta-pill">系列：${series}</span>
              <span class="meta-pill">状态：${escapeHtml(statusLabel(article.status))}</span>
            </div>
            <div class="chip-placeholder-row">${tagsHtml}</div>
            <div class="chip-placeholder-row">${industriesHtml}</div>
            <div class="chip-placeholder-row">${stocksHtml}</div>
            <div class="read-action-row">
              <a class="article-read-btn" href="${detailUrl}">阅读全文</a>
            </div>
          </div>
          ${coverHtml}
        </article>
      `;
    })
    .join("");
}

function renderCloudPanels(articles) {
  renderCloud(els.tagsCloud, uniqueFrom(articles, "tags"), "暂无标签", "empty-chip tag");
  renderCloud(els.industriesCloud, uniqueFrom(articles, "industries"), "暂无行业", "empty-chip industry");
  renderCloud(els.stocksCloud, uniqueFrom(articles, "stocks"), "暂无个股", "empty-chip stock");
}

async function initArticleDetailPage() {
  const slug = new URLSearchParams(window.location.search).get("slug");
  if (!slug) {
    renderDetailError("缺少 slug 参数，无法定位文章。");
    return;
  }

  try {
    const index = await loadArticleIndex();
    const article = index.find((item) => item.slug === slug);
    if (!article) {
      renderDetailError(`未找到 slug 为 ${slug} 的文章。`);
      return;
    }

    const response = await fetch(article.path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`无法读取 Markdown: ${response.status}`);
    }

    const markdown = await response.text();
    const parsed = parseFrontMatter(markdown);
    renderArticleDetail(article, parsed.body);
  } catch (error) {
    console.error(error);
    renderDetailError("文章加载失败，请检查 Markdown 文件和索引是否一致。");
    showToast("文章加载失败");
  }
}

function renderArticleDetail(article, bodyMarkdown) {
  setText(els.detailTitle, article.title || "未命名文章");
  setText(els.detailDate, `日期：${article.date || "待补充"}`);
  setText(els.detailSeries, `系列：${article.series || "未分类系列"}`);
  setText(els.detailStatus, `状态：${statusLabel(article.status)}`);

  if (els.detailTags) {
    els.detailTags.innerHTML = renderInlineChips(article.tags, "chip-tag", "标签：暂无");
  }
  if (els.detailIndustries) {
    els.detailIndustries.innerHTML = renderInlineChips(article.industries, "chip-industry", "行业：暂无");
  }
  if (els.detailStocks) {
    els.detailStocks.innerHTML = renderInlineChips(article.stocks, "chip-stock", "个股：暂无");
  }

  if (els.detailCover) {
    els.detailCover.innerHTML = article.cover
      ? `<img class="detail-cover-image" src="${escapeHtml(article.cover)}" alt="${escapeHtml(article.title)} 封面" />`
      : "封面图：暂无";
  }

  if (els.detailContent) {
    els.detailContent.innerHTML = renderMarkdown(bodyMarkdown);
  }

  document.title = `${article.title} - 文章详情`;
}

function renderDetailError(message) {
  setText(els.detailTitle, "文章读取失败");
  setText(els.detailDate, "日期：-");
  setText(els.detailSeries, "系列：-");
  setText(els.detailStatus, "状态：-");

  if (els.detailContent) {
    els.detailContent.innerHTML = `<p>${escapeHtml(message)}</p>`;
  }
}

function renderCounterList(target, counter, emptyText) {
  if (!target) return;

  const entries = Object.entries(counter);
  if (!entries.length) {
    target.innerHTML = `<li>${emptyText}</li>`;
    return;
  }

  target.innerHTML = entries
    .sort((a, b) => b[1] - a[1])
    .map(
      ([name, count]) =>
        `<li class="side-list-item"><span>${escapeHtml(name)}</span><span class="count-badge">${count}</span></li>`
    )
    .join("");
}

function renderCloud(target, items, emptyText, className) {
  if (!target) return;
  target.innerHTML = items.length
    ? items.map((item) => `<span class="${className}">${escapeHtml(item)}</span>`).join("")
    : `<span class="empty-chip">${emptyText}</span>`;
}

function renderInlineChips(items, className, fallbackText) {
  if (!items || !items.length) {
    return `<span class="chip-placeholder">${escapeHtml(fallbackText)}</span>`;
  }
  return items.map((item) => `<span class="${className}">${escapeHtml(item)}</span>`).join("");
}

function counterFrom(items, key) {
  const counter = {};
  items.forEach((item) => {
    const value = item[key] || "未分类";
    counter[value] = (counter[value] || 0) + 1;
  });
  return counter;
}

function uniqueFrom(items, key) {
  const set = new Set();
  items.forEach((item) => {
    const values = Array.isArray(item[key]) ? item[key] : [];
    values.forEach((value) => {
      if (value) set.add(value);
    });
  });
  return [...set];
}

function setActiveButton(container, activeButton) {
  container.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button === activeButton);
  });
}

async function loadArticleIndex() {
  const candidates = [
    "content/articles/index.json",
    "./content/articles/index.json",
    "/content/articles/index.json"
  ];

  const failures = [];
  for (const path of candidates) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) {
        failures.push(`${path} -> HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      return data.map((item) => ({
        ...item,
        tags: Array.isArray(item.tags) ? item.tags : [],
        industries: Array.isArray(item.industries) ? item.industries : [],
        stocks: Array.isArray(item.stocks) ? item.stocks : []
      }));
    } catch (error) {
      failures.push(`${path} -> ${error.message}`);
    }
  }

  if (window.location.protocol === "file:") {
    throw new Error(
      "检测到你正在用 file:// 打开页面。请改用本地服务访问：http://localhost:5173/articles.html"
    );
  }

  throw new Error(`读取文章索引失败，请先执行 node tools/build-articles.mjs。详情：${failures.join(" | ")}`);
}

function parseFrontMatter(source) {
  if (!source.startsWith("---\n")) {
    return { meta: {}, body: source };
  }

  const end = source.indexOf("\n---\n", 4);
  if (end === -1) {
    return { meta: {}, body: source };
  }

  const frontMatter = source.slice(4, end);
  const body = source.slice(end + 5);

  const meta = {};
  let currentArrayKey = null;

  frontMatter.split("\n").forEach((line) => {
    const arrayItem = line.match(/^\s*-\s+(.*)$/);
    if (arrayItem && currentArrayKey) {
      meta[currentArrayKey].push(stripQuotes(arrayItem[1]));
      return;
    }

    const pair = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!pair) return;

    const key = pair[1];
    const value = pair[2];

    if (!value) {
      meta[key] = [];
      currentArrayKey = key;
      return;
    }

    meta[key] = stripQuotes(value);
    currentArrayKey = null;
  });

  return { meta, body };
}

function stripQuotes(text) {
  const value = String(text).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const out = [];
  let paragraph = [];
  let listOpen = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!listOpen) return;
    out.push("</ul>");
    listOpen = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const h3 = trimmed.match(/^###\s+(.*)$/);
    if (h3) {
      flushParagraph();
      closeList();
      out.push(`<h3>${renderInlineMarkdown(h3[1])}</h3>`);
      continue;
    }

    const h2 = trimmed.match(/^##\s+(.*)$/);
    if (h2) {
      flushParagraph();
      closeList();
      out.push(`<h2>${renderInlineMarkdown(h2[1])}</h2>`);
      continue;
    }

    const h1 = trimmed.match(/^#\s+(.*)$/);
    if (h1) {
      flushParagraph();
      closeList();
      out.push(`<h1>${renderInlineMarkdown(h1[1])}</h1>`);
      continue;
    }

    const listItem = trimmed.match(/^-\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();

  return out.join("\n");
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return html;
}

function statusLabel(status) {
  if (status === "read") return "已读";
  if (status === "favorite") return "收藏";
  return "待阅";
}

function setText(element, text) {
  if (!element) return;
  element.textContent = text;
}

let toastTimer = null;
function showToast(message) {
  if (!els.toast) return;

  els.toast.textContent = message;
  els.toast.classList.add("show");

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 1800);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
