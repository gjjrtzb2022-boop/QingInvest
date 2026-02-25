# InsightVest Content Architecture

This project now uses a scalable Markdown-based article workflow.

## Pages

- `index.html`: landing page (hero + core features + metric cards + footer)
- `articles.html`: article list page (reads from generated index JSON)
- `article.html`: single reusable detail template (`article.html?slug=...`)

## Content storage

- Markdown source folder: `content/articles/*.md`
- Generated article index: `content/articles/index.json`
- Build script: `tools/build-articles.mjs`

Each markdown file uses front matter metadata, then full body content.

Example:

```md
---
slug: "qingyishanzhang-2026-001"
title: "文章标题"
date: "2026-02-21"
series: "估值方法"
status: "unread"
tags:
  - 标签A
industries:
  - 行业A
stocks:
  - 股票A(SH:000000)
cover: ""
summary: "摘要"
---

正文...
```

## Build index

After adding or editing markdown files, run:

```bash
cd /Users/jianyuanchen/Desktop/Stock_Test
node tools/build-articles.mjs
```

This regenerates `content/articles/index.json`.

## Local preview

```bash
cd /Users/jianyuanchen/Desktop/Stock_Test
node tools/build-articles.mjs
python3 -m http.server 5173
```

Open:

- `http://localhost:5173/index.html`
- `http://localhost:5173/articles.html`
- `http://localhost:5173/article.html?slug=qingyishanzhang-2026-001`

## GitHub Pages deploy

This repo already includes a deploy workflow:

- `.github/workflows/deploy-pages.yml`

What it does on each push to `main` or `master`:

1. Runs `node tools/build-articles.mjs`
2. Packages static files into `_site/`
3. Deploys to GitHub Pages via Actions

One-time setup in your GitHub repository:

1. Go to `Settings -> Pages`
2. Set `Source` to `GitHub Actions`
3. Push your code to `main` (or `master`)
4. Wait for workflow `Deploy GitHub Pages` to finish

After deployment, your site URL will be:

- `https://<your-username>.github.io/<repo-name>/`

## Current status

- Blog author naming has been switched to "清一山长".
- First article has been migrated to Markdown.
- List page and detail page are both data-driven by markdown/index.
