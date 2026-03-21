# 上线部署说明

这份文档以“先上线试跑”为目标，默认推荐方案是：

- 应用部署到 `Vercel`
- 鉴权和数据库使用 `Supabase`
- 文章运行时直接读取 GitHub 文章源仓库

## 1. 为什么推荐这个组合

当前项目不是纯静态站，因为它包含：

- 动态股票 API
- 服务端数据库查询
- 实时行情与 K 线接口

所以它已经不适合 GitHub Pages 这类纯静态托管。

当前最顺手的上线方式是：

- `Vercel` 跑 Next.js 应用
- `Supabase` 提供远端 Postgres 和 Auth
- GitHub 仓库提供文章源

## 2. 运行关系

生产环境里的真实关系是：

- 用户访问 `Vercel` 上的 Next.js 站点
- 浏览器端登录走 `Supabase Auth`
- 服务端 API 通过 `CONTENT_SYNC_DATABASE_URL_PROD` 连接远端 Postgres
- 文章页通过 `ARTICLE_SOURCE=github` 从 GitHub 仓库读取文章 Markdown

Docker 在生产环境不是必须的。

Docker 目前主要用于本地开发时，通过 `supabase start` 拉起本地数据库容器。

## 3. 必填环境变量

至少要配置这些：

### 浏览器端

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 服务端数据库

- `CONTENT_SYNC_TARGET=prod`
- `CONTENT_SYNC_DATABASE_URL_PROD`
- `CONTENT_SYNC_DB_SSL=true`

### GitHub 文章源

- `ARTICLE_SOURCE=github`
- `ARTICLE_GITHUB_OWNER`
- `ARTICLE_GITHUB_REPO`
- `ARTICLE_GITHUB_BRANCH=main`
- `ARTICLE_GITHUB_ARTICLES_PATH=.`

### 建议补充

- `ARTICLE_GITHUB_TOKEN`
  - 推荐加，避免匿名访问 GitHub Raw / API 时触发限流

### 当前工具链仍会检查

- `SUPABASE_SERVICE_ROLE_KEY`

它主要用于生产检查、同步和后续运维，不建议暴露给浏览器。

## 4. 推荐平台：Vercel

### 部署方式

1. 把仓库连接到 Vercel
2. Framework Preset 选 `Next.js`
3. Build Command 使用默认值或 `npm run build`
4. Install Command 使用 `npm ci` 或默认值
5. Output 走 Next 默认，不要选静态导出

### 不要做的事

- 不要把它当 GitHub Pages 项目部署
- 不要设置 `NEXT_OUTPUT_EXPORT=1`
- 不要使用 `npm run build:static` 作为主站构建命令

## 5. Supabase 侧需要确认的事

上线前至少确认：

- 远端项目已创建
- 远端数据库已应用迁移
- `profiles`、`reading_states`、`annotations` 等表存在
- 股票相关表已存在
- RLS 规则已正确下发

建议在正式库执行：

```bash
npm run check:env -- --target=prod
npm run check:migrations -- --db-url="$CONTENT_SYNC_DATABASE_URL_PROD"
npm run verify:rls -- --db-url="$CONTENT_SYNC_DATABASE_URL_PROD"
```

## 6. GitHub 文章源需要确认的事

当前站点已经不再依赖本地 `content/articles`。

上线前需要确认：

- GitHub 文章源仓库可以访问
- 仓库里有完整文章 Markdown
- 路径与环境变量一致
- 若仓库私有或流量可能较高，必须配置 `ARTICLE_GITHUB_TOKEN`

## 7. 上线前检查清单

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- 远端环境变量已配置
- 远端 Supabase 迁移已完成
- GitHub 文章源仓库可读
- 股票 API 能连到远端数据库

## 8. 试上线后的首轮验收

上线后优先检查这几项：

- 首页是否正常打开
- `/articles` 是否能加载文章列表
- 任意文章详情页是否能打开
- `/stocks` 是否能返回股票目录
- 实时行情和 K 线是否可用
- `/settings` 是否能正确读取 Supabase 配置

## 9. 当前结论

按现在的代码状态，项目已经适合进入“第一轮试上线”：

- 本地大体积文章内容已移除
- 运行态改为 GitHub 文章源
- 生产构建已通过
- GitHub Pages 流程已改成 CI 校验，不再误导为静态站部署

下一步最合理的是直接配置一套 `prod` 环境变量，然后把仓库接到 Vercel 试跑。
