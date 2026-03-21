# A 股股票主数据 / 财报 / 公告同步方案（阶段 1）

## 目标

这一阶段先把“股票数据后端”打牢，让网站不再只依赖手写的少量股票名单，而是具备：

- 全量 A 股股票主数据同步能力
- 财报与业绩类数据同步能力（年报、半年报、季报、业绩快报、业绩预告）
- 公告索引同步能力
- 公告正文与 PDF 附件同步能力（按日期窗口可回补）
- 后续前端分页、检索、详情页的数据库基础

## 为什么单独建表

当前项目里已经有一个 `public.stocks` 表，但它主要服务于文章内容标签系统，里面的“个股”很多只是文章里的文本标签，不一定是严格证券代码。

所以这次没有直接复用它，而是新增一套面向真实证券数据的运行时表：

- `public.stock_securities`
- `public.stock_financial_reports`
- `public.stock_announcements`
- `public.stock_announcement_files`
- `public.stock_sync_runs`

这样做的好处是：

- 不会污染文章标签系统
- 证券代码、公告、财报可以保持严格结构化
- 后续可以单独做“文章标签 -> 实际证券”的映射层

## 数据来源

当前实现优先使用东方财富公开接口：

- A 股主数据：Eastmoney `qt/clist/get`
- 财报 / 业绩快报 / 业绩预告：Eastmoney DataCenter
- 公告索引：Eastmoney `np-anotice-stock`
- 公告正文 / PDF：Eastmoney `np-cnotice-stock`

## 同步命令

### 1) 全量主数据

```bash
npm run sync:stocks -- --scope=universe --mode=full
```

作用：

- 拉取全部 A 股证券代码、名称、交易所、板块、行业、快照字段
- 写入 `public.stock_securities`
- 同时输出本地缓存：`raw/stocks-cache/a-share-universe-latest.json`

### 2) 财报 / 业绩类数据

```bash
npm run sync:stocks -- --scope=reports --mode=full
```

默认范围：

- 从 `20100331` 到最新一个已完成季度
- 同步 `yjbb` / `yjkb` / `yjyg`

可选限制：

```bash
npm run sync:stocks -- --scope=reports --mode=incremental --report-limit-periods=2
```

适合先验证最近两期数据是否正常。

### 3) 公告索引 + 正文 + PDF

```bash
npm run sync:stocks -- --scope=announcements --mode=incremental --announcement-start=2026-03-18 --announcement-end=2026-03-20
```

默认行为：

- 先抓公告索引
- 再抓公告正文
- 再抓 PDF / 附件信息

如果只想先抓索引，不抓正文：

```bash
npm run sync:stocks -- --scope=announcements --hydrate-announcements=false
```

如果想限制正文抓取数量：

```bash
npm run sync:stocks -- --scope=announcements --announcement-content-limit=200
```

### 4) 一次跑完整链路

```bash
npm run sync:stocks -- --scope=full --mode=incremental --report-limit-periods=2 --announcement-start=2026-03-20 --announcement-end=2026-03-20
```

## 关于“全部公告”的现实约束

“全部 A 股公告历史全文”数据量非常大，真正做全历史回补时，不适合一口气在前台命令里全量跑完。

更合理的方式是：

- 第一步：先把主数据全量同步好
- 第二步：把财报历史全量回补好
- 第三步：公告按日期窗口分批回补
- 第四步：正文 / PDF 做二次补全

也就是说：

- 财报历史全量：适合一次性批量补
- 公告历史全量：适合“分日 / 分月 / 分批”慢慢补

## 同步报告与缓存

每次执行后会输出：

- 运行报告：`raw/sync-reports/sync-stocks-<batch>.json`
- 最新报告：`raw/sync-reports/latest-sync-stocks.json`
- A 股缓存：`raw/stocks-cache/a-share-universe-latest.json`

## 下一步建议

后端这层落地后，下一步最自然的是三件事：

1. 做 `/api/stocks/catalog`，让前端可以分页搜索全部 A 股
2. 做单股票详情查询，把财报 / 公告接到页面
3. 把当前手写的 `lib/stocks.ts` 逐步替换成数据库分页查询
