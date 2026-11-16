# 影子模式统计面板 · 时间窗口扩展 任务单

> **路径**：`docs/worklog/completed/phase2/deliberation-stats-time-window-2026-11-08.md`
> **状态**：✅ 已交付
> **交付记录**：[`engine-deliberation-stats-time-window-implementation-2026-11-08.md`](engine-deliberation-stats-time-window-implementation-2026-11-08.md)
> **创建日期**：2026-11-08
> **交付日期**：2026-11-08
> **关联 WP**：切灰度前置（影子模式数据统计面板）
> **前置文档**：先读 `docs/worklog/README.md` 和 `docs/README.md`

---

## 一、背景与目标

### 1.1 背景

现在影子模式数据统计面板（`GET /admin/api/deliberation/stats`）返回的是**全局累计值**——从影子模式开启到现在的所有数据累加。

切灰度前我们要看的是**最近一段时间的趋势**（比如最近 7 天的 P95、成功率、过期率），不是累计值。累计值跑了两周已经很大了，看不出最近的趋势。

### 1.2 目标

给统计面板加时间窗口维度：
- 后端按天分 key，支持按时间范围查询
- 前端加时间选择器：最近 7 天 / 最近 30 天 / 自定义

---

## 二、开工前核实清单（后端开工前先做）

逐条 grep / 读代码核实，不要照任务单写的假设直接实现：

| # | 要核实什么 | 怎么核实 |
|---|---|---|
| 1 | 现在统计计数器的 key 是什么？ | 读 `src/engine-adapters/deliberation/deliberation-stats.ts` 的 `DELIBERATION_STATS_KEY_PREFIX` 和 `buildDeliberationStatsKey()` |
| 2 | 现在 Lua 脚本怎么累加的？ | 读 `deliberation-stats.ts` 的 `DELIBERATION_STATS_LUA_SCRIPT` |
| 3 | 现在写入侧在哪里调用的？ | 读 `llm-deliberation.service.ts` 的 `writeTrace()` 里的统计累加 |
| 4 | 现在读取侧接口返回什么字段？ | 读 `admin-debug.controller.ts` 的 `deliberation/stats` 端点 + `buildDeliberationStatsResponse()` |
| 5 | 现在 Redis 的 key 命名范式是什么？有没有长度前缀？ | 对照 `RedisBdiStateRepository` 和 `buildDeliberationTraceKey()` 的范式 |

---

## 三、设计方案

### 3.1 key 命名方案

**日 key**：`deliberation_stats:global:2026-11-08`
- 格式：`deliberation_stats:global:YYYY-MM-DD`
- 每天一个 key，存当天的统计计数器
- TTL：保留 90 天（足够看最近 3 个月的数据）

**全局累计 key**：`deliberation_stats:global`
- 保留，兼容现有接口（不传 days 参数时返回全局累计值）

### 3.2 写入侧改动

**每次累加统计时，同时写两个 key：**
1. 全局累计 key：`deliberation_stats:global`
2. 当日日 key：`deliberation_stats:global:2026-11-08`

**怎么实现？**
- 方案 A：两次独立 `eval()`，各写各的 key（简单，但多一次 RTT）
- 方案 B：一次 Lua 脚本，同时累加两个 key（原子，一次 RTT）

**推荐方案 B**：用一次 Lua 脚本完成两次累加，原子性更好，一次 RTT。

### 3.3 读取侧改动

**接口加 `days` 参数：**
- `GET /admin/api/deliberation/stats?days=7` → 返回最近 7 天的聚合统计
- `GET /admin/api/deliberation/stats`（不传 days）→ 返回全局累计值（兼容现有行为）

**后端怎么聚合？**
- 读 N 个日 key（比如最近 7 天 = 读 7 个日 key）
- 把所有计数器字段累加起来
- 取大字段（max_duration_ms / max_delta_diff_abs）取最大值
- 延迟直方图（latency_bucket）累加各桶的计数

**聚合逻辑：**
- 计数器字段（total_turns / success_turns / failure_turns 等）：累加
- 取大字段（max_duration_ms / max_delta_diff_abs）：取最大值
- 延迟直方图（latency_b7 / latency_b8 等）：各桶计数累加
- 分布字段（failureByErrorCode / capByDimension / clinicalByRule）：按 key 累加

### 3.4 前端改动

**加时间选择器：**
- 选项：最近 7 天 / 最近 30 天 / 自定义（日期范围）
- 默认显示最近 7 天
- 切换时间范围时，重新请求接口

---

## 四、交付物

### 4.1 后端交付物

| # | 交付物 | 说明 |
|---|---|---|
| 1 | 日 key 写入 | 每次累加统计时，同时写全局 key 和当日日 key |
| 2 | 日 key TTL | 日 key 保留 90 天，过期自动清理 |
| 3 | 接口加 days 参数 | 支持按时间范围查询 |
| 4 | 聚合逻辑 | 读 N 个日 key，聚合返回 |
| 5 | 兼容现有行为 | 不传 days 参数时，返回全局累计值 |
| 6 | 单测 | 覆盖写入侧、读取侧、聚合逻辑 |

### 4.2 前端交付物（前端 AI 做）

| # | 交付物 | 说明 |
|---|---|---|
| 1 | 时间选择器 | 最近 7 天 / 最近 30 天 / 自定义 |
| 2 | 默认显示最近 7 天 | 切换时间范围时重新请求 |

---

## 五、边界与注意点

### 5.1 写入侧

- **日 key 的日期怎么算？** 用服务器本地时间（中国时区 UTC+8），因为运营看的是中国时间。开工前先确认服务器时区是不是中国时区。
- **跨天边界怎么算？** 一场会话跑了跨天（从 23:50 跑到 00:10），统计算哪天的？建议按**结束时间**算那天的日 key（因为统计是在 `writeTrace()` 里写的，结束时才写）。
- **两次累加要不要原子？** 推荐用一次 Lua 脚本同时累加两个 key，原子性更好。
- **日 key 的 TTL 设多少？** 90 天足够看最近 3 个月的数据。

### 5.2 读取侧

- **聚合逻辑怎么写？** 计数器字段累加，取大字段取最大值，延迟直方图各桶累加。
- **空 key 怎么处理？** 某一天没有数据（日 key 不存在），跳过就行，不报错。
- **历史数据边界（重要）：** 之前的累计值都在全局 key 里，日 key 是从今天才开始有的。那查询"最近 7 天"时，前几天没有日 key，只有全局 key。**处理方式：** 日 key 从今天开始才有，之前的历史数据（之前的累计）只能通过全局累计值看。查询"最近 N 天"时，只能看到今天及之后的日 key 数据，之前的天数日 key 不存在就跳过。
- **性能怎么样？** 读 30 个日 key，30 次 Redis 往返，可以用 pipeline 批量读优化（一次往返读多个 key）。
- **Lua 脚本注意：** 之前的 Lua 脚本没有真 Redis 验证（仓库没有真 Redis 测试基础设施），这次改脚本要注意脚本语法正确性，部署前在 dev 环境跑一轮真 Redis 验证。

### 5.3 兼容性

- **不传 days 参数时**：返回全局累计值，兼容现有行为。
- **前端还没改时**：后端接口已经支持 days 参数，但前端不传，所以不影响现有功能。

### 5.4 engine-core 红线

- engine-core 零改动
- 纯适配层实现

---

## 六、闸门（每个 WP 都要）

```powershell
npx eslint "src/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit  # → 0 error
npx vitest run                    # → 全绿
git diff --stat HEAD -- src/engine-core   # → 空
```

---

## 七、交付后回写

完成后回写：
1. 更新本任务单状态为 ✅
2. 写交付记录到 `docs/worklog/completed/phase2/`
3. 更新 `docs/worklog/README.md`

---

## 八、偏差说明

后端如果发现更合理更专业的方案，可以按照后端来，但要在交付记录里写明偏差和理由。

---

_本任务单创建于 2026-11-08。_

---

## 九、交付后补记（2026-11-08 · 后端偏差表）

> 完整理由见交付记录 [`engine-deliberation-stats-time-window-implementation-2026-11-08.md`](engine-deliberation-stats-time-window-implementation-2026-11-08.md) §2。

| # | 任务单原文 | 后端改法 | 为什么 |
|---|---|---|---|
| D1 | §5.1「用服务器本地时间（中国时区 UTC+8），开工前先确认服务器时区」 | **固定 UTC+8（Asia/Shanghai）**，并把日期工具从 `admin-debug/cost-view.ts` 上移到 `src/shared/time/shanghai-date.ts`（旧路径保留 re-export，调用方零改动） | 服务器时区不可靠（容器常是 UTC）→ 同一批数据在 dev 与 prod 落进不同的天，两边看板不可比；适配层反向 import admin-debug 是**反向依赖**，迟早成环；两边各写一份 = 两张会漂的日历 |
| D2 | §3.4 前端要「自定义（日期范围）」，但 §4.1 后端只列了 `days` | **额外加 `?from=&to=`**（闭区间，与 `days` 互斥） | 没有区间端点，前端的「自定义」选项就没有数据源 |
| D3 | §5.2「读 30 个日 key，30 次往返」 | **pipeline 一次往返**（采纳）；另加窗口上限 `days` 截断到 90（= 日 key TTL）/ `from-to` 跨度超 90 天报错 | 跨度必须有界（区间要枚举 key 列表）；超 90 天的窗口必然不完整 |
| D4 | §5.2「空 key 跳过，不报错」 | 空日 key **跳过**（符合）；但**非法参数报错 400**（`days=abc` / `days=0` / from 无 to / from > to / 形状不对） | 静默退回全局累计 → 看板把累计值当「最近 7 天」显示，数值不可比的误导。仓库纪律：看板宁可报错也不能装作一切正常 |
| D5 | §5.1「之前的累计只能通过全局累计值看」 | 响应**新增 `window` 口径对象**（`mode` / `days` / `from` / `to` / **`daysCovered`**） | 日 key 从 2026-11-08 才有 → 头几天窗口天然不满 7 天，`daysCovered` 让看板如实显示「7 天里只有 N 天有数据」；累计与窗口不可比，模式必须写在数据里 |
| D6 | §3.2 方案 B「一次 Lua 脚本同时累加两个 key」 | ✅ **采纳**（全局 + 当日日 key，一次原子 + 一次 RTT；日 key 顺带 EXPIRE 90 天） | 两个 key 半加状态会让窗口值与累计值永久对不上 |
| D7 | §5.1「按结束时间算那天的日 key」 | ✅ **天然满足**（统计写在 `writeTrace()`，而 `record.timestamp` 就是审议结束时刻）→ 写侧 `llm-deliberation.service.ts` **零改动** | 不需要额外传参，也不动审议主流程 |
| D8 | §3.1 key 形状 `deliberation_stats:global:YYYY-MM-DD` | ✅ 按任务单（**不带** hash tag） | 运营能用 `KEYS deliberation_stats:global:*` 直接捞日 key。**代价**: Redis Cluster 下两个 key 跨 slot 会报 CROSSSLOT —— 当前是单实例部署，成立；将来上 cluster 需改同一 hash tag（登记在交付记录 §6 R2） |
| D9 | §3.3 聚合口径（计数器累加 / 取大取最大 / 桶累加） | ✅ 按任务单；另**浮点求和统一归一到 6 位小数** | 多日求和攒出小数尾巴 → 窗口值与单日值对不上（同一天两种口径差 1e-15 也会被当 bug 查半天） |
| D10 | §5.2「部署前在 dev 环境跑一轮真 Redis 验证」 | ✅ **本单已经跑了**（dev Redis 7.0.15 / db 15 / 随机 key 前缀 / 跑完自动删）：**4 / 4 通过**，含「ioredis 的 keyPrefix 对 EVAL 的 key 也生效」这条（读写命中同一物理 key —— 本仓 `REDIS_KEY_PREFIX` 默认 `mofang`，不成立的话整个统计面板在多环境里就是坏的） | 不用留到部署前；验证脚本已固化在 `test/admin-debug/deliberation-stats-redis.integration.spec.ts`，任何人可重跑 |

### 本单**没做**的（留给前端 AI / 后续单）

- **前端时间选择器**（最近 7 天 / 最近 30 天 / 自定义 + 默认 7 天）—— 任务单 §4.2 归前端；后端接口已就绪，不传参数时行为与改造前逐字一致，不影响现有功能。
- **历史日 key 回填** —— 之前两周的累计只在全局 key 里，trace 表没有可还原的时间索引，**无法回填**（既定口径，不是缺陷）。
