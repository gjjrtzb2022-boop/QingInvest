# 清一山长投资研究平台

当前仓库已经不是单纯的静态前端，而是一个以 `Next.js` 为核心的全栈项目：

- 页面与 API 在同一个应用内
- 文章内容来自本地 `Markdown` 或 GitHub 文章源仓库
- 用户设置、阅读状态、批注、文章结构化数据、股票目录/财报/公告进入 `Postgres / Supabase`
- 本地开发数据库通常由 `Supabase CLI + Docker` 提供

## 当前模块

- `/` 首页
- `/articles` 文章库与详情页
- `/stocks` 选股器、实时行情、K 线、财报与公告
- `/settings` 用户中心、本地数据、Supabase 登录同步
- `/analysis` `/dashboard` `/assistant` `/alerts` 预留或半成品模块

## 本地开发

```bash
cd /Users/jianyuanchen/Desktop/Stock_Test
npm install
npm run dev
```

默认访问：

- `http://localhost:3000`

如果 `3000` 被占用，Next 会自动切到下一个可用端口。

## 数据来源与存储

### 文章

- 运行态文章源：GitHub 仓库
- 本地 `content/articles` 仅保留为空目录占位，不再作为运行时读取源
- 封面源：`content/covers`
- 更新日志：`content/changelog.ts`

### 用户数据

- 未登录：浏览器 `localStorage`
- 已登录：Supabase 表
  - `profiles`
  - `user_preferences`
  - `user_sync_meta`
  - `reading_states`
  - `annotations`

### 股票数据

- 结构化长期数据：Postgres / Supabase
  - `stock_securities`
  - `stock_financial_reports`
  - `stock_announcements`
  - `stock_announcement_files`
- 实时行情与 K 线：运行时从第三方接口抓取
  - `Sina`
  - `Eastmoney`
  - `Tencent`
  - `Akshare`

## 本地数据库 / Supabase / Docker 的关系

- 仓库中的 `supabase/migrations` 只保存数据库结构，不保存真实数据。
- 本地开发默认数据库地址是 `postgresql://postgres:postgres@127.0.0.1:54322/postgres`。
- 这个 `54322` 端口通常来自 `supabase start` 启动的本地 Supabase 环境。
- Supabase CLI 本身会借助 Docker 拉起本地 Postgres 等容器。
- 项目应用本身当前不是 Docker 化运行，而是直接通过 `npm run dev` 启动 Next.js。
- 生产环境可以把 `CONTENT_SYNC_DATABASE_URL_PROD`、`NEXT_PUBLIC_SUPABASE_URL` 等环境变量切到远端 Supabase。

## 常用命令

### 文章

```bash
npm run import:article
npm run import:raw
npm run validate:articles
npm run build:articles
npm run sync:content -- --target=dev --mode=incremental
```

### 股票

```bash
npm run sync:stocks -- --target=dev --scope=full --mode=incremental
```

### 验证

```bash
npm run check:env -- --target=dev
npm run check:migrations -- --db-url=postgresql://postgres:postgres@127.0.0.1:54322/postgres
npm run verify:rls -- --db-url=postgresql://postgres:postgres@127.0.0.1:54322/postgres
npm run lint
npm run typecheck
npm run build
```

构建说明：

- `npm run build`：当前默认的服务端部署构建，适合现在带动态股票 API 的站点
- `npm run build:static`：仅保留给纯静态导出场景，当前不适合股票模块上线

## 目录说明

- `app/`：页面和 API 路由
- `components/`：UI 组件
- `lib/`：业务逻辑层
- `content/`：线上内容源与少量本地静态内容
- `tools/`：导入、同步、发布脚本
- `supabase/`：数据库迁移
- `raw/`：导入原文、同步报告、缓存、参考截图
- `workspace_assets/`：爬虫、参考资料、历史归档
- `docs/`：架构、运行手册、阶段文档

## 重点文档

- 架构说明：[ARCHITECTURE.md](/Users/jianyuanchen/Desktop/Stock_Test/docs/ARCHITECTURE.md)
- 目录整理说明：[PROJECT_STRUCTURE.md](/Users/jianyuanchen/Desktop/Stock_Test/docs/PROJECT_STRUCTURE.md)
- 运行手册：[RUNBOOK.md](/Users/jianyuanchen/Desktop/Stock_Test/docs/RUNBOOK.md)
- 上线部署说明：[DEPLOYMENT_GUIDE.md](/Users/jianyuanchen/Desktop/Stock_Test/docs/DEPLOYMENT_GUIDE.md)
- GitHub 文章源说明：[文章-GitHub-中转接入说明.md](/Users/jianyuanchen/Desktop/Stock_Test/docs/文章-GitHub-中转接入说明.md)
