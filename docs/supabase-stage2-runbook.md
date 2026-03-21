# Supabase 阶段 2 执行手册（迁移与验证）

## 1. 目标

- 应用阶段 2 数据库迁移（表结构、索引、RLS、auth 触发器）。
- 完成最小权限验证：公开内容可读、私有数据仅本人可读写。

## 2. 迁移文件

- `/Users/jianyuanchen/Desktop/Stock_Test/supabase/migrations/20260302133000_stage2_core_schema.sql`

## 3. 本地执行（Supabase CLI）

```bash
# 进入项目目录
cd /Users/jianyuanchen/Desktop/Stock_Test

# 启动本地 Supabase（轻量模式，仅起数据库，避免首次拉取全量服务镜像）
supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor

# 应用迁移到本地数据库
supabase db reset
```

说明：
- `db reset` 会从 migration 目录重建本地数据库并执行全部迁移。
- 若只需比对迁移差异，可用 `supabase db diff`。

## 4. 远端执行（dev/prod）

```bash
# 先关联项目（按 target 环境切换 project ref）
supabase link --project-ref <your-project-ref>

# 推送迁移到目标环境
supabase db push
```

## 5. 验证清单（最小）

- 注册新用户后，`profiles`/`user_preferences`/`user_sync_meta` 自动有行记录。
- `articles`、`series`、`tags` 等公开表可匿名 `select`。
- 用户 A 无法读取用户 B 的 `reading_states`、`annotations`、`profiles`。
- `content_path` 非 `content/articles/%` 的文章写入应被拒绝。
- `reading_states.status` 只允许 `unread/read/favorite`。

## 6. 回滚策略

- 结构回滚：新增一条反向 migration（避免直接修改历史 migration）。
- 内容回滚：Git 回滚 Markdown 后，重新执行增量同步。
