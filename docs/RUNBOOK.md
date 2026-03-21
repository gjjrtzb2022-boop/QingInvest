# 项目运行手册

## 1. 启动项目

```bash
cd /Users/jianyuanchen/Desktop/Stock_Test
npm install
npm run dev
```

访问：

- `http://localhost:3000`

如果 `3000` 被占用，Next 会自动切到其他端口。

## 2. 本地数据库 / Supabase

当前项目默认把本地开发数据库指向：

- `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

这个端口通常来自 Supabase CLI 启动的本地开发环境。

### 启本地 Supabase

```bash
supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

说明：

- `supabase start` 底层依赖 Docker。
- 当前项目本身不是 Docker 化运行，只有本地 Supabase 栈会借助 Docker 容器。

## 3. 导入文章

当前运行态默认从 GitHub 文章源读取，`content/articles` 不再保留完整本地文章库。

### 单篇导入

```bash
npm run import:article
```

或：

```bash
node tools/import-article.mjs ./raw/xxx.txt
```

### 批量导入

```bash
npm run import:raw
```

可选参数：

```bash
npm run import:raw -- --dry-run
npm run import:raw -- --archive
npm run import:raw -- --dir=raw/your-folder --recursive
```

## 4. 导入后校验与索引

```bash
npm run validate:articles
npm run build:articles
```

## 5. 同步到数据库

### 内容同步

```bash
npm run sync:content -- --target=dev --mode=incremental
```

### 股票同步

```bash
npm run sync:stocks -- --target=dev --scope=full --mode=incremental
```

## 6. 发布 GitHub 文章源

```bash
node tools/export-article-source.mjs
node tools/publish-article-source.mjs
```

文章源切换由环境变量控制：

- `ARTICLE_SOURCE=local`
- `ARTICLE_SOURCE=github`

当前推荐：

- 开发态：`ARTICLE_SOURCE=github`
- 生产态：`ARTICLE_SOURCE=github`

## 7. 验证命令

```bash
npm run check:env -- --target=dev
npm run check:migrations -- --db-url=postgresql://postgres:postgres@127.0.0.1:54322/postgres
npm run verify:rls -- --db-url=postgresql://postgres:postgres@127.0.0.1:54322/postgres
npm run verify:content-sync -- --target=dev --ci
npm run lint
npm run typecheck
npm run build
```

说明：

- `npm run build` 用于当前正式部署路径。
- `npm run build:static` 只适合完全静态页面；当前股票 API 存在动态路由，不建议用于线上主站。

## 8. 常见定位路径

- 架构说明：`docs/ARCHITECTURE.md`
- 目录结构：`docs/PROJECT_STRUCTURE.md`
- 内容源：`content/articles`
- 股票同步：`tools/sync-stocks.mjs`
- 内容同步：`tools/sync-content.mjs`
- 数据库迁移：`supabase/migrations`
