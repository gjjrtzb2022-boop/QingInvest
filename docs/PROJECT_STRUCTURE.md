# 项目目录整理说明

## 当前根目录分层

- `app/`
  - Next.js 页面与 API 路由
- `components/`
  - 组件层
- `lib/`
  - 业务逻辑层
- `content/`
  - 运行中的静态内容源
- `tools/`
  - 导入、同步、校验、发布脚本
- `supabase/`
  - 迁移脚本与数据库结构
- `docs/`
  - 说明文档与阶段记录
- `raw/`
  - 导入原文、缓存、同步报告、参考截图
- `workspace_assets/`
  - 爬虫、参考资料、历史归档
- `.github/workflows/`
  - CI 校验流程，不再承担 GitHub Pages 静态部署

## 本次整理后的关键变化

- 旧离线备份已从运行目录移出：
  - `content/_offline_backup_20260301-190849`
  - 已迁到 `workspace_assets/archive/content-backups/_offline_backup_20260301-190849`
- 本地文章正文已清空：
  - `content/articles` 现在仅保留占位目录
  - 运行态文章统一从 GitHub 文章源读取
- `raw/` 根目录中的股票对照截图已归类到：
  - `raw/reference-screenshots/stocks`
- `.DS_Store`、`__pycache__`、`*.pyc` 已清理
- `.gitignore` 已补充生成物、缓存和归档目录规则

## 运行主链路

上线真正依赖的目录只有这些：

- `app/`
- `components/`
- `lib/`
- `content/`
- `public/`
- `tools/`
- `supabase/`
- `package.json`
- `next.config.ts`
- `tsconfig.json`

## 非运行主链路

这些目录仍然重要，但不属于网站线上运行必需：

- `raw/`
- `workspace_assets/`
- `docs/`
- `dist/`

## 以后新增文件的放置规则

- 新页面放 `app/`
- 新组件放 `components/`
- 新业务逻辑放 `lib/`
- 新内容源放 `content/`
- 新同步脚本放 `tools/`
- 新数据库结构放 `supabase/migrations/`
- 新说明文档放 `docs/`
- 新爬虫、参考资料、归档备份放 `workspace_assets/`

## 现在仍然保留但不建议继续混放的东西

- `dist/`
  - 生成产物目录，保留本地使用即可
- `raw/sync-reports/`
  - 用于审计和排查，不要和业务源码混用
- `workspace_assets/crawlers/`
  - 保留爬虫工程，但不要把它当网站运行目录
