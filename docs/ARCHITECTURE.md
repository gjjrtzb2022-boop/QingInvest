# 系统架构说明（2026-03-21）

这份文档讲的是项目当前真实架构，不是未来理想图。重点回答四个问题：

- 网站现在由哪些层组成
- 数据从哪里来、最后存到哪里
- `Next.js`、`Supabase`、本地 `Postgres`、Docker 之间是什么关系
- 目录和模块各自承担什么职责

## 1. 一句话定义当前项目

当前项目是一个以 `Next.js App Router` 为核心的全栈网站：

- 前端页面和后端 API 在同一个仓库里
- 文章内容以 `Markdown` 为主源，可本地读取，也可切换为 GitHub 文章源
- 用户资料、阅读状态、批注、文章结构化数据、股票结构化数据进入 `Postgres / Supabase`
- 股票实时行情和 K 线在运行时抓取，不完全依赖数据库

也就是说，它不是“纯静态站”，也不是“前后端完全拆开的双仓项目”，而是单仓的全栈应用。

## 2. 逻辑分层

### 页面层

- `app/`

负责页面路由和 API 路由。

典型页面：

- `/` 首页
- `/articles` 文章库
- `/articles/[seriesSlug]/[articleSlug]` 文章详情
- `/stocks` 选股器
- `/settings` 用户中心

典型 API：

- `app/api/search/suggest/route.ts`
- `app/api/stocks/catalog/route.ts`
- `app/api/stocks/detail/route.ts`
- `app/api/stocks/realtime/route.ts`
- `app/api/stocks/kline/route.ts`

### 组件层

- `components/`

负责 UI 结构和交互，例如：

- 顶部导航、主题切换、全站搜索
- 文章三栏布局、阅读状态、批注
- 选股器工作台、K 线面板
- 用户设置页

### 业务逻辑层

- `lib/`

负责真正的数据组织与规则：

- `lib/articles.ts`
  - 文章读取、索引、Front Matter 归一化、系列导航、相关文章
- `lib/site-search.ts`
  - 股票、文章、标签统一搜索
- `lib/server/db.ts`
  - 服务端数据库连接池
- `lib/server/stock-catalog.ts`
  - 股票目录、筛选基础数据、数据库查询
- `lib/server/stock-detail.ts`
  - 单只股票详情、财报时间线、公告
- `lib/stocks-live.ts`
  - 实时行情抓取与多源 fallback
- `lib/stocks-kline.ts`
  - K 线抓取
- `lib/client/*`
  - 浏览器端本地状态和 Supabase 同步桥接

### 内容层

- `content/`

负责网站直接消费的内容源：

- `content/articles`
- `content/covers`
- `content/images`
- `content/changelog.ts`
- `content/stocks-mentions.json`

### 工具链层

- `tools/`

负责把外部数据搬进系统：

- 导入文章
- 重建文章索引
- 同步内容到数据库
- 发布 GitHub 文章源
- 同步股票证券池、财报、公告
- 校验环境、校验迁移、校验 RLS

### 数据库层

- `supabase/migrations/`

这里只保存数据库结构脚本，不保存真实数据。

真实数据在本地或远端的 `Postgres` / `Supabase Postgres` 实例里。

## 3. 数据到底存在哪里

这是最关键的一部分。

### A. 文章正文

当前运行策略已经切换为 GitHub 主源：

- 网站运行时直接从 GitHub 文章源仓库读取
- 本地 `content/articles` 不再保存大体积文章内容，只保留空目录占位

控制开关仍然存在：

- `ARTICLE_SOURCE=local`
- `ARTICLE_SOURCE=github`

但当前默认和推荐值都是：

- `ARTICLE_SOURCE=github`

### B. 文章结构化关系

存数据库：

- `articles`
- `series`
- `tags`
- `industries`
- `stocks`
- `article_tags`
- `article_industries`
- `article_stocks`
- `article_related`

这些表由：

- `tools/sync-content.mjs`

从 `content/articles` 同步进去。

### C. 用户数据

未登录时，先存浏览器本地：

- 头像
- 用户名
- 时区
- 阅读状态
- 批注 / 金句

涉及文件：

- `lib/client/user-profile-store.ts`
- `lib/client/article-user-state.ts`
- `lib/client/article-annotations-store.ts`

登录后，云端同步到 Supabase：

- `profiles`
- `user_preferences`
- `user_sync_meta`
- `reading_states`
- `annotations`

### D. 股票结构化数据

长期保存到数据库：

- `stock_securities`
- `stock_financial_reports`
- `stock_announcements`
- `stock_announcement_files`
- `stock_sync_runs`

这些数据由：

- `tools/sync-stocks.mjs`

抓取并写入数据库。

### E. 股票实时行情与 K 线

这部分不是全部落库。

当前策略是：

- 股票基础池、财报、公告：进数据库
- 实时行情：运行时抓取
- K 线：运行时抓取，带缓存

实时行情来源：

- `Sina`
- `Eastmoney`
- `Tencent`
- `Akshare`

K 线来源：

- `Eastmoney`
- `Tencent`

## 4. Next.js、Supabase、本地 Postgres、Docker 之间的关系

这一部分最容易混。

### 4.1 Next.js 负责什么

`Next.js` 是应用本体，负责：

- 页面渲染
- 服务端数据预取
- API 路由
- 浏览器端交互

也就是说，用户访问的网站就是这个 Next 应用。

### 4.2 Supabase 负责什么

Supabase 在这个项目里承担两类角色：

- 云端鉴权与用户会话
- 托管 Postgres 数据库

浏览器端登录与用户同步，走的是：

- `lib/client/supabase-browser.ts`
- `app/auth/callback/page.tsx`
- `lib/client/content-sync-bridge.ts`

### 4.3 本地 Postgres 负责什么

开发时，项目默认把数据库指到：

- `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

这个地址不是仓库里的文件，而是一个本地运行中的数据库服务。

项目里的这些代码都会去连它：

- `lib/server/db.ts`
- `tools/sync-content.mjs`
- `tools/sync-stocks.mjs`
- `tools/check-migrations.mjs`
- `tools/verify-rls.mjs`

### 4.4 Docker 在这里到底扮演什么角色

当前仓库里没有应用自己的 `Dockerfile`，也没有网站运行所需的 `docker-compose.yml`。

所以：

- 网站应用本身现在不是通过 Docker 跑起来的
- 网站本体还是用 `npm run dev` / `next build` / `next start`

Docker 目前主要间接服务于本地 Supabase 开发环境：

- 当你执行 `supabase start` 时
- Supabase CLI 会借助 Docker 拉起本地 Postgres 和相关容器

也就是说：

- `Next.js`：应用层
- `Supabase`：云服务 / 本地开发数据库栈
- `Docker`：本地 Supabase 栈的运行底座

### 4.5 开发态与生产态的关系

开发态常见路径：

1. `npm run dev` 启动 Next.js
2. `supabase start` 用 Docker 拉起本地数据库
3. 应用通过 `CONTENT_SYNC_DATABASE_URL_DEV` 连接 `127.0.0.1:54322`

生产态常见路径：

1. Next.js 部署到服务器或平台
2. 数据库改连远端 Supabase / Postgres
3. 浏览器端继续通过 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 做鉴权

## 5. 文章链路

当前文章链路分两条。

### 5.1 内容生产链路

1. 原始内容来自：
   - `raw/*.txt`
   - `workspace_assets/crawlers/...`
2. 内容整理后发布到 GitHub 文章源仓库
3. 网站运行时直接读取 GitHub 文章源
4. 如需结构化同步，再写入数据库：
   - `tools/sync-content.mjs`

### 5.2 网站读取链路

1. 页面调用 `lib/articles.ts`
2. `lib/articles.ts` 判断 `ARTICLE_SOURCE`
3. 当前线上/本地默认都走 `github`
4. 按仓库配置读取远端文章源

## 6. 股票链路

### 6.1 入库链路

1. `tools/sync-stocks.mjs` 抓取股票证券池
2. 同步财报、快报、预告
3. 同步公告及附件
4. 写入数据库表

### 6.2 网站读取链路

1. `/stocks` 页面首屏由服务端预加载一批股票目录
2. 浏览器再调用 `/api/stocks/realtime`
3. 前端每秒轮询实时行情
4. 打开单只股票详情时调用 `/api/stocks/detail`
5. K 线面板调用 `/api/stocks/kline`

## 7. 当前目录职责

### 线上运行核心

- `app/`
- `components/`
- `lib/`
- `content/`
- `public/`
- `tools/`
- `supabase/`

### 开发 / 审计 / 资料

- `raw/`
- `docs/`
- `workspace_assets/`
- `dist/`

### 已归档内容

- `workspace_assets/archive/content-backups/_offline_backup_20260301-190849`

这个备份已经从 `content/` 运行目录移出，避免和线上内容源混放。

## 8. 当前最重要的环境变量

### 数据库 / Supabase

- `CONTENT_SYNC_TARGET`
- `CONTENT_SYNC_DATABASE_URL_DEV`
- `CONTENT_SYNC_DATABASE_URL_PROD`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### 文章源

- `ARTICLE_SOURCE`
- `ARTICLE_GITHUB_OWNER`
- `ARTICLE_GITHUB_REPO`
- `ARTICLE_GITHUB_BRANCH`
- `ARTICLE_GITHUB_ARTICLES_PATH`
- `ARTICLE_GITHUB_TOKEN`

## 9. 当前架构的结论

现在的系统已经具备完整雏形：

- 页面层已经成型
- API 层已经成型
- 数据库结构已经成型
- 文章双源机制已经成型
- 股票结构化数据与实时数据链路已经成型

目前还不是问题的是“有没有架构”，而是“哪些目录继续收边、哪些模块继续深化”。从这个阶段开始，最重要的是持续保持边界清晰：

- 内容源放 `content`
- 结构化持久数据放数据库
- 运行时实时数据只在 API 层抓取
- 备份和参考资料不要再放回运行主链路
