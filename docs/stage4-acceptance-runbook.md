# 阶段 4 验收手册（发布分层 + 同步性能 + 安全可观测）

## 1) 本阶段目标

- 完成 dev/prod 环境分层的发布前置检查（环境、迁移、RLS、内容同步、构建）。
- 将阅读状态与批注同步改为“前端即时响应 + 后台批量同步”。
- 增加基础可观测能力：同步成功率/失败率/耗时，便于上线后排障。

---

## 2) 你现在要执行的验收命令（顺序不变）

```bash
cd /Users/jianyuanchen/Desktop/Stock_Test

# A. 环境检查（dev）
npm run check:env -- --target=dev

# B. 迁移与回滚演练
npm run check:migrations -- --db-url=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# C. RLS 安全隔离验证
npm run verify:rls -- --db-url=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# D. 内容链路校验
npm run verify:content-sync -- --target=dev --ci
npm run sync:content -- --target=dev --mode=incremental --dry-run --ci

# E. 代码质量与构建
npm run lint
npm run typecheck
npm run build
```

通过标准：上述命令全部 exit code = 0。

---

## 3) dev/prod 分层策略（当前实现）

- `.env.dev.example`：本地开发模板。
- `.env.prod.example`：生产模板（建议仅在 CI Secrets 注入）。
- `check:env` 会按 target 检查关键变量：
  - dev：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`CONTENT_SYNC_DATABASE_URL_DEV`
  - prod：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`CONTENT_SYNC_DATABASE_URL_PROD`、`SUPABASE_SERVICE_ROLE_KEY`

---

## 4) 同步性能优化（当前实现）

### 阅读状态

- 状态切换先写 `localStorage`，UI 即时生效。
- 后台以短延迟批量 upsert 到 `reading_states`，减少频繁单条写库。

### 批注

- 新增批注先本地落盘并立即展示。
- 后台批量写入/删除云端批注（按队列聚合），并在成功后广播刷新事件。

---

## 5) 安全与可观测（当前实现）

### 安全

- `verify:rls` 会在临时数据库中：
  - 应用全部 migration；
  - 注入 A/B 两个测试用户；
  - 验证“只能访问自己私有数据，公共内容可读”。

### 可观测

- 前端记录同步指标（状态/批注）：
  - 次数
  - 失败数
  - 平均耗时
- 用户设置页“阅读状态同步”区域可直接查看最近 24h 健康摘要。

---

## 6) CI 已接入的门禁

`/Users/jianyuanchen/Desktop/Stock_Test/.github/workflows/deploy-pages.yml`

当前顺序：
1. `check:env --target=dev`
2. `check:migrations`
3. `verify:rls`
4. `validate:articles`
5. `verify:content-sync --ci`
6. `sync:content --dry-run --ci`
7. `typecheck`
8. `lint`
9. `build:articles`
10. `build`

---

## 7) 验收建议（手动体验）

1. 登录邮箱 OTP 后，快速连续切换 20 次“待阅/已读/收藏”，确认界面无卡顿。  
2. 连续添加/删除多条批注，确认本地立即可见；刷新页面后数据一致。  
3. 在设置页确认“同步健康（24h）”数据会变化。  
4. 登出后重复阅读/批注操作，确认不会阻断页面交互（仅云端跳过）。  
