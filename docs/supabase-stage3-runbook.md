# Supabase 阶段 3 执行手册（内容入库同步）

## 1. 目标

- 将 `content/articles/**/*.md` 同步到 PostgreSQL 运行时查询库。
- 同步标签/行业/个股映射、相关阅读映射，并记录 `sync_logs` 审计。

## 2. 同步范围（已冻结）

- 仅扫描 `content/articles/**/*.md`。
- 不扫描仓库其它文件。
- 图片目前仅统计引用数量，不执行上传（上传在下一阶段接入 Storage）。

## 3. 预演（推荐先跑）

```bash
cd /Users/jianyuanchen/Desktop/Stock_Test
npm run sync:content -- --target=dev --mode=incremental --dry-run
```

## 4. 实际同步（dev）

```bash
cd /Users/jianyuanchen/Desktop/Stock_Test
npm run sync:content -- --target=dev --mode=incremental
```

## 5. 全量对齐模式（谨慎）

```bash
npm run sync:content -- --target=dev --mode=full
```

说明：
- `full` 模式会将数据库中不在本次 Markdown 清单内的文章标记为 `is_published=false`。

## 6. CI 模式

```bash
npm run sync:content -- --target=prod --mode=incremental --ci
```

说明：
- CI 模式下出现解析错误会直接失败并阻断发布。

## 7. 报告与审计

- 文件报告：`raw/sync-reports/sync-content-<batch-id>.json`
- 最新报告：`raw/sync-reports/latest-sync-content.json`
- 数据库审计：`public.sync_logs`

## 8. 关键环境变量

- `CONTENT_SYNC_DATABASE_URL_DEV`
- `CONTENT_SYNC_DATABASE_URL_PROD`
- `CONTENT_SYNC_DB_SSL`

如需临时覆盖可直接传参：

```bash
npm run sync:content -- --target=prod --db-url=postgresql://...
```
