# Supabase 阶段 1 启动说明

## 1. 目标

- 完成后端基础设施骨架：环境变量、同步命令入口、校验命令入口。
- 当前阶段不写数据库，只建立统一执行路径和审计报告输出。

## 2. 前置约束（已冻结）

- 内容同步输入范围仅为：`content/articles/**/*.md`。
- 不做“全仓库文件”扫描。
- 图片仅按 Markdown 引用关系参与后续同步。

## 3. 环境变量

1) 复制示例：

```bash
cp .env.example .env.local
```

2) 按 Supabase 项目填入：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`

## 4. 本地执行命令

```bash
# 校验文章基础元数据
npm run validate:articles

# 内容同步骨架（阶段 1：不写库）
npm run sync:content -- --target=dev --mode=incremental --dry-run

# 同步前一致性校验（front matter + 本地图片引用）
npm run verify:content-sync -- --target=dev
```

## 5. 报告产物

- 输出目录：`raw/sync-reports`
- 关键文件：
  - `sync-content-<batch-id>.json`
  - `verify-content-sync-<batch-id>.json`
  - `latest-sync-content.json`
  - `latest-verify-content-sync.json`

## 6. CI 接入建议（下一步）

```bash
npm run validate:articles
npm run sync:content -- --target=prod --mode=incremental --ci
npm run verify:content-sync -- --target=prod --ci
npm run build
```

说明：`--ci` 模式下校验失败会阻断发布流程。
