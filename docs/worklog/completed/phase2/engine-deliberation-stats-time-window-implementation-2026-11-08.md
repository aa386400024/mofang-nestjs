# 影子模式统计面板 · 时间窗口扩展 交付记录

> 状态: ✅ 已交付
> 任务单: [`deliberation-stats-time-window-2026-11-08.md`](deliberation-stats-time-window-2026-11-08.md)
> 日期: 2026-11-08
> 红线: ✅ **engine-core 零改动** —— `git diff --stat HEAD -- src/engine-core` = **空**（纯适配层 + shared/ 实现）
> 边界断言: ✅ `boundary.spec.ts` 全绿（零改动即零影响）
> 承接: [影子模式数据统计面板 · 后端接口](engine-deliberation-stats-panel-implementation-2026-11-07.md)（2026-11-07）
> ⚠️ **影子模式不变** —— 审议结果照旧**不写** BDI 快照；本单只改统计的**存储形状**与**查询口径**
> ⚠️ **日 key 从 2026-11-08 才开始有** —— 之前两周的累计只在全局 key 里；"最近 7 天"在头几天**天然不满 7 天**
> ⚠️ **累计值与窗口值语义完全不同、不可比** —— 响应里带 `window` 口径对象说明这批数是哪段时间的

---

## 1. 实际改了哪些文件

### 1.1 生产代码：1 增 4 改

| 文件 | 改了什么 |
|---|---|
| `src/shared/time/shanghai-date.ts` | **新增**（106 行 · 本单新增的共享日历口径）: ① `shanghaiDateKey(date)` → `YYYY-MM-DD`（固定 UTC+8，`Intl` en-CA）; ② `shanghaiDayStartUtc(now, daysBack)` → 上海 00:00 对应的 UTC 时刻; ③ `isShanghaiDateKey(value)` → 形状对**且日期存在**（往返校验，`2026-02-30` 判非法）; ④ `shanghaiDayStartUtcOfKey(dayKey)` → 日期键 → 日界; ⑤ `shanghaiDateKeyRange(from, to)` → 闭区间日期键列表（按上海日界步进，跨年不漏天）; ⑥ 导出 `SHANGHAI_OFFSET_MS` / `DAY_MS`. **纯函数 · 零 @nestjs / 零 IO / 零 env** |
| `src/engine-adapters/deliberation/deliberation-stats.ts` | **改**（+322 / -23）: ① 新增 `buildDeliberationStatsDailyKey(day)`（`deliberation_stats:global:YYYY-MM-DD`）+ `DELIBERATION_STATS_DAILY_TTL_SECONDS`（90 天）+ `DELIBERATION_STATS_MAX_WINDOW_DAYS`（90）; ② Lua 脚本改成**一次原子累加两个 key**（全局 + 当日日 key，日 key 顺带 `EXPIRE`）; ③ 新增 `resolveDeliberationStatsDay(timestamp, fallback)`（按**记录时间戳**归天，坏时间戳不抛）; ④ 新增 `buildDeliberationStatsDateKeys(days, now)` / `buildDeliberationStatsDateKeysBetween(from, to)` / `buildDeliberationStatsDayKeys(keys)`; ⑤ 新增纯函数 `aggregateDeliberationStatsHashes(hashes)`（计数器求和 / 取大字段取最大 / 浮点 6 位归一）; ⑥ 新增 `parseDeliberationStatsWindow(query)`（参数解析，非法抛错）; ⑦ `DeliberationStatsResponse` 加 `window` 字段 + 新类型 `DeliberationStatsWindow`; ⑧ 文件头补本单说明块 |
| `src/admin-debug/admin-debug.controller.ts` | **改**（+89 / -3）: ① `GET /admin/api/deliberation/stats` 加 `?days=` / `?from=&to=` 三个 query 参数; ② **不传参数**走原路径（读全局 key，行为逐字不变）; ③ 带窗口参数 → 读 N 个日 key 聚合（**pipeline 一次往返**）; ④ 新增 `parseStatsWindow()`（非法参数 → `BizException(BizCode.InvalidParameter)` → 400）; ⑤ 新增 `readDeliberationStatsHashes()`（pipeline 批量读，`exec()` 返回 null 视为读失败并抛错）; ⑥ 文件头补本单说明块 |
| `src/admin-debug/cost-view.ts` | **改**（+6 / -39）: 日期工具**上移**到 `shared/time/shanghai-date.ts`，本模块改为 **re-export**（`export { shanghaiDateKey, shanghaiDayStartUtc }`）—— **调用方零改动**，导入路径仍然可用 |
| `src/admin-debug/insights-view.ts` | **改**（+2 / -1）: import 改指 `../shared/time/shanghai-date.js`（同一份口径） |
| `src/admin-debug/admin-insights.controller.ts` | **改**（+1 / -1）: import 改指 `../shared/time/shanghai-date.js`（同上） |

> **为什么动 `cost-view.ts`**: 审议统计的**写侧**在 `engine-adapters/`（比 admin-debug 更靠下）。让适配层反过来 import admin-debug 是**反向依赖**（下层依赖上层），迟早成环。两边各写一份日期口径 = **两张会漂的日历**（仓库既有纪律："两处各算一遍 = 两张会漂的定价表"）。抽到 `shared/` 是唯一能同时喂饱上层的干净位置 —— 见 §2 D1。

### 1.2 测试：2 增 1 改

| 文件 | 改了什么 |
|---|---|
| `test/shared/shanghai-date.spec.ts` | **新增**（76 行 · 7 例）: 日期键的 UTC+8 口径 / 日界 = 前一天 16:00Z / 往返一致 / 形状对≠日期存在 / 闭区间不多不少 / 跨年连续 / 固定偏移常量 |
| `test/admin-debug/deliberation-stats-redis.integration.spec.ts` | **新增**（138 行 · 4 例 · **真 Redis**）: 脚本语法 + 两 key 同时累加 + 日 key TTL 生效而全局 key 无 TTL / 取大字段不被小值覆盖 / `HINCRBYFLOAT` 浮点形态 / **ioredis 的 keyPrefix 对 EVAL 的 key 也生效**（读写命中同一物理 key）。**没设 `TEST_REDIS_URL` 就整份跳过**（CI 不连 Redis） |
| `test/admin-debug/deliberation-stats.spec.ts` | **改**（+418 / -86）: 写入侧 13 例（原 8 例保留 + 新增 5 例日 key）; 读取侧 9 例; **窗口聚合 8 例**（多日聚合 / 比率自洽 / 浮点无小数尾巴 / 日期键构造 / 区间构造 / 参数解析 ×3）; 端点接线 10 例（不传参数走累计 / `days=7` / 窗口查询不混全局累计 / `from/to` / 非法参数 400 / 读失败不兜底 / 路径 / guard / 读的就是计数器 key）; 写入侧接线 2 例 |
| `test/admin-debug/wp31-cost-board.spec.ts` | **改**（+2 / -1）: import 改指 `shared/time/shanghai-date.js`（日期工具搬家后的跟随改动） |

### 1.3 配置：零改动

本单**不新增任何 env 键** —— 统计计数器恒开（它不是开关，是观察面）；日 key 的 TTL 与窗口上限都是**代码常量**（`DELIBERATION_STATS_DAILY_TTL_SECONDS` / `DELIBERATION_STATS_MAX_WINDOW_DAYS`），不来自 env（放进 env 就会多出"配置了但没人消费"的盲区键 —— WP48 的教训）。

### 1.4 文档：3 改

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/deliberation-stats-time-window-2026-11-08.md` | 状态行改 ✅ + 指向交付记录; 追加「§九 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/completed/phase2/engine-deliberation-stats-time-window-implementation-2026-11-08.md` | **新增**（本文件） |
| `docs/worklog/README.md` | Phase2 已开工列表加一条（影子模式统计面板 · 时间窗口扩展）; §4 目录结构补本单 |

### 1.5 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- `src/engine-adapters/deliberation/llm-deliberation.service.ts` —— **零改动**（写侧调用点不变，见 §2 D7）
- `src/shared/infra/redis/redis.service.ts` —— **零改动**（**不为引擎加专用方法** —— 那是层次倒置，见上一单 §2.3）
- `src/admin-debug/admin-debug.module.ts` —— **零改动**（`RedisModule` 是 `@Global()`，`RedisService` 全局可注入）
- `src/admin-debug/guards/admin-role.guard.ts` / `wp26-admin-role-guard.spec.ts` 的端点清单 —— **零改动**（端点**路径**没变，只是加了 query 参数；guard 仍挂在 class 级）
- 无 migration / 无 entity / 无新表 / 无新列
- `admin-dashboard/` —— 零改动（前端另一个 AI 的活; 本单只出后端接口）
- **不改任何审议结果** —— 审议 delta 一个字不动

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 D1（任务单 §5.1 与前提不成立）: 按天口径**不用服务器本地时区**，固定 UTC+8

- **任务单 §5.1** 写: "用服务器本地时间（中国时区 UTC+8）……开工前先确认服务器时区是不是中国时区"。
- **核实结果**: 服务器时区**不可靠** —— 本地开发机是 UTC+8，生产容器常是 UTC；同一批数据在 dev 与 prod 会**落进不同的天**，两边看板不可比。用 UTC 更糟：北京时间 08:00 前的轮次会被切到前一天。
- **本单改法**: 固定 **UTC+8（Asia/Shanghai）**，与 WP31 成本看板**同一套**口径 —— 中国无 DST，边界确定，与运行环境无关。
- **连带动作**: 把 `cost-view.ts` 里原有的 `shanghaiDateKey` / `shanghaiDayStartUtc` **上移**到 `src/shared/time/shanghai-date.ts`。不改这里的话，适配层要么反向 import admin-debug（迟早成环），要么复制一份（两张会漂的日历）。
- **旧调用方零改动**: `cost-view.ts` 保留 **re-export**，`dashboard / insights-view / admin-insights.controller / wp31 测试` 的 import 路径与行为都不变。

### 2.2 D2（任务单后端只要求 `days`，但前端要"自定义"）: 额外提供 `?from=&to=` 自定义区间

- **任务单 §3.4** 要求前端加"最近 7 天 / 最近 30 天 / **自定义**（日期范围）"，但 §4.1 后端交付物只列了 `days`。
- **本单改法**: 加 `?from=YYYY-MM-DD&to=YYYY-MM-DD`（**闭区间**，上海日界），与 `days` **互斥**（同时传 → 400）。
- **为什么必须补**: 没有区间端点，前端的"自定义"选项就没有数据源 —— 前端 AI 会被迫自己算日期再拼 `days`，或者干脆做不了。

### 2.3 D3: `days` 超 90 天**截断**，`from/to` 跨度超 90 天**报错**

- 日 key TTL 是 90 天 → 超过 90 天的窗口**必然不完整**。
- `days` 截断（不报错），与同仓 `cost/trend?days=` 同款口径 —— 实际生效值写进 `window.days`，看板能如实显示"你要的 180 天只有 90 天有数据"。
- `from/to` 跨度超限**报错**：区间要**枚举 key 列表**，跨度必须有界（无界区间 = 无界内存与无界 Redis 读）。

### 2.4 D4: 非法参数**报错**，绝不静默兜底成全局累计

- `days=abc` / `days=0` / `days=-3` / `from` 无 `to` / `from > to` / 日期形状不对 / `2026-02-30` → **400**（`BizCode.InvalidParameter`）。
- **为什么**: 静默退回全局累计的话，看板会把"累计值"当"最近 7 天"显示 —— 那是**数值不可比的误导**。仓库既有纪律："看板宁可报错，也不能装作一切正常"（上一单读失败不兜底成 0 是同一条纪律的另一半）。

### 2.5 D5: 响应里加 `window` 口径对象（mode / days / from / to / daysCovered）

- **口径要写在数据里，不能只靠看文档的人记得**（仓库纪律）。
- 三件事必须让看板自己知道：① 这批数是**累计**还是**窗口**；② 窗口是哪几天；③ **这 7 天里只有几天真的有数据**（日 key 从 2026-11-08 才有 → 头几天不满窗）。
- `daysCovered` = 窗口内**有日 key 的天数**。看板可以据此显示"最近 7 天（3 天有数据）"，而不是假装满窗。

### 2.6 D6（采纳任务单方案 B）: 一次 Lua 脚本同时累加两个 key

- 全局 key `deliberation_stats:global`（无 TTL，永久）+ 当日日 key `deliberation_stats:global:YYYY-MM-DD`（TTL 90 天）。
- **原子 + 一次 RTT**：两个 key 要么一起加，要么都不加 —— 不会出现"全局加了、日 key 没加"的半拉状态（那会让窗口值与累计值**永久对不上**）。
- 沿用上一单的 `HINCRBYFLOAT`（同一个脚本要同时累加整数计数与浮点累计）。
- **取大字段**（`max_duration_ms` / `max_delta_diff_abs`）在**两个 key 上各自取大** —— 脚本里对每个 key 独立做读-改-写比较（Redis 侧脚本内是原子的，不存在并发覆盖）。

### 2.7 D7: 写侧 `llm-deliberation.service.ts` **零改动** —— "按结束时间归天"天然满足

- 任务单 §5.1 要求"跨天会话按**结束时间**算那天的日 key"。
- **核实**: 统计是在 `writeTrace()` 里写的，而 `record.timestamp` 是**审议结束时刻**（`new Date().toISOString()`，成功/失败两条路径都在**跑完之后**取）→ 归天天然按结束时间，无需额外传参。
- 所以本单只在 `applyDeliberationStats()` **内部**用 `resolveDeliberationStatsDay(record.timestamp)` 算出日 key，**service 侧一行不动**。

### 2.8 D8: 日 key **不做 hash tag**（附 cluster 备注）

- 任务单 §3.1 指定的形状是 `deliberation_stats:global:YYYY-MM-DD`（**不带** `{...}`）—— 运营能用 `KEYS deliberation_stats:global:*` 直接捞出全部日 key。
- **代价（已知残留风险）**: Redis Cluster 下，一个脚本的两个 key 落在不同 slot 会报 `CROSSSLOT`。**当前部署是单实例**（京东云 Redis + db 0-15，非 cluster），所以成立。
- **将来若上 cluster**: 把两个 key 改成同一 hash tag（如 `deliberation_stats:{global}` 与 `deliberation_stats:{global}:YYYY-MM-DD`）即可 —— 但**那会破坏"运营直接 KEYS 捞日 key"的直觉**，需要同时接受 `KEYS` 扫不到子键的新口径。**现在不动**，登记在 §6。

### 2.9 D9: 多日聚合的浮点求和**统一归一到 6 位小数**

- `0.1 + 0.2 = 0.30000000000000004` —— 多日求和会攒出小数尾巴，导致"窗口值"与"单日值"对不上（看板同一天两种口径差 1e-15 也会被当成 bug 查半天）。
- 聚合时统一 `toFixed(6)` 归一，**与单日直接累加的结果一致**（有专门用例守着）。

### 2.10 D10: 读侧 **pipeline 批量读**，且 `exec()` 返回 `null` 视为读失败

- 30 个日 key = 30 次往返 → pipeline **一次往返**（任务单 §5.2 建议，已采纳）。
- ⚠️ ioredis 的 `pipeline.exec()` 在 pipeline 被中断时返回 **null** —— 那不是"没有数据"，是"没读成"。按上一单纪律：**直接抛错，不兜底成 0**（兜底成 0 会让看板显示"最近 7 天零失败零耗时"，那是误导）。

---

## 3. 任务单 §二 核实清单 · 逐条结论

| # | 任务单问什么 | 核实结论 |
|---|---|---|
| 1 | 统计计数器的 key 是什么 | `DELIBERATION_STATS_KEY_PREFIX = 'deliberation_stats'` + `buildDeliberationStatsKey() → 'deliberation_stats:global'`。**没有** tenant 段（全局一份，现在只有一个开发 tenant） |
| 2 | 现在 Lua 脚本怎么累加的 | 上一单脚本：**一个 key**（全局）+ `HINCRBYFLOAT` 累加 + `HGET`/比较/`HSET` 取大。本单改成**两个 key 一次脚本**（全局 + 当日日 key，日 key 顺带 `EXPIRE`） |
| 3 | 写入侧在哪里调用 | `llm-deliberation.service.ts` 的 `writeTrace()` 内 → `applyDeliberationStats(this.redis, record)`，**独立 try/catch**（统计写失败只打 warn，不炸审议）。**本单零改动**（见 §2 D7） |
| 4 | 读取侧接口返回什么字段 | `GET /admin/api/deliberation/stats` → `buildDeliberationStatsResponse(hash)`，18 个统计字段 + 本单新增 `window` 口径对象。读的就是**计数器那个 key**（不是 trace） |
| 5 | Redis key 命名范式 | 对照 `buildDeliberationTraceKey()`（`deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}`，**带长度前缀防撞键**）与 `RedisBdiStateRepository`（CAS 走 `getClient().eval()`）。**统计 key 不需要长度前缀** —— 它不含用户标识，不存在"分隔符歧义"空间。日 key 后缀是**定长日期形状**（`YYYY-MM-DD`），也不会歧义 |

---

## 4. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "{src,test,bin}/**/*.ts"` | ✅ **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **全绿**：**131 passed / 1 skipped（132 files）· 2259 passed / 4 skipped（2263 tests）**，59.52s |
| `git diff --stat HEAD -- src/engine-core` | ✅ **空**（engine-core 零改动） |
| `boundary.spec.ts`（11 条边界断言） | ✅ 全绿（内核零改动 → 零影响） |
| **真 Redis 集成验证**（本单真跑了，见 §5） | ✅ **4 / 4 通过**（Redis 7.0.15，db 15） |

> 4 例 skipped = 真 Redis 集成用例（不设 `TEST_REDIS_URL` 时整份跳过）—— 单独跑那一轮**全过**，见 §5。

---

## 5. 真 Redis 验证（本单**已经跑了**，不用等部署前）

任务单 §5.2 要求"部署前在 dev 环境跑一轮真 Redis 验证"。本单在开发机上就跑了：

- **环境**: dev Redis `117.72.30.78:6379` · **db 15** · Redis **7.0.15**
- **命令**: `$env:TEST_REDIS_URL = "redis://:<pwd>@<host>:6379/15"; npx vitest run test/admin-debug/deliberation-stats-redis.integration.spec.ts`
- **结果**: **4 / 4 通过**（3.94s），验过 5 件事:
  1. **脚本语法正确**（Redis 侧编译通过 —— 语法错直接报错）
  2. **两个 key 同时累加**（全局 + 当日日 key 数值一致）
  3. **取大字段不被小值覆盖**（后一轮 100 < 前一轮 1200 → 仍是 1200；计数器照常累加）
  4. **日 key TTL = 90 天**，**全局 key 无 TTL**（`TTL = -1`）
  5. **ioredis 的 `keyPrefix` 对 EVAL 的 KEYS 也生效** → 写入侧（EVAL）与读取侧（HGETALL）命中**同一个物理 key**
     （实测 ioredis v5：`EVAL` 在命令表里带 `movablekeys` 标志 → `getKeyIndexes` 会算出 key 位置并拼前缀；
      本仓 `REDIS_KEY_PREFIX` 默认 `mofang` / dev 为 `mofang:dev:` —— **这条如果不成立，整个统计面板在多环境里就是坏的**，所以单测里钉死）
- **隔离性**: 每次跑用**随机 key 前缀**（`itest_<ts>_<uuid8>`）+ **db 15**（与业务 db 0 分开）+ `afterAll` 自动删除 —— 不碰生产数据、不碰 dev 业务库
- **复现命令**（写进集成用例文件头，任何人都能重跑）

---

## 6. 残留风险与后续

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | **日 key 从 2026-11-08 才有** | "最近 7 天"在头几天**不满 7 天**；更早的历史累计**只在全局 key** | 已如实暴露为 `window.daysCovered`；看板须显示"7 天里只有 N 天有数据"。**历史数据无法回填**（trace 表里没有时间戳索引可还原）—— 这是既定口径，不是 bug |
| R2 | **Redis Cluster 下 `CROSSSLOT`** | 若将来上 cluster，一次脚本写两个 key 会报错 → 统计写失败（只打 warn，不炸审议，但窗口值会缺） | 当前**单实例**部署不成立。真上 cluster 时改用同一 hash tag（见 §2 D8），**并同时接受 `KEYS` 捞不到日 key 的新口径** |
| R3 | **今天的数据不完整** | "最近 7 天"含今天 → 当天的数只到此刻 | 口径写在 `window` 里（`to` = 今天）；看板自己决定要不要标注"今日未完结" |
| R4 | **窗口值 ≠ 累计值** | 两者不可比（切灰度决策必须明确看哪个） | `window.mode` 三态显式区分（`all` / `days` / `range`）；不传参数 = `all` = 与改造前逐字一致 |
| R5 | **浮点聚合误差** | 多日求和可能有 1e-15 级偏差 | 已归一到 6 位小数（§2 D9），有专门用例 |
| R6 | **前端未改** | 看板仍显示累计值 | 后端已就绪；前端 AI 按 §7 接线即可。**前端不改不影响现有功能**（不传参数 = 老行为） |

---

## 7. 前端交接（给前端 AI）

- **端点**: `GET /admin/api/deliberation/stats`
  - `?days=7` → 最近 7 天（含今天）
  - `?from=2026-11-01&to=2026-11-08` → 自定义区间（**闭区间**）
  - `` / 不传 → **全局累计值**（与改造前逐字一致）
- **两者互斥**: 同时传 `days` 与 `from/to` → **400**
- **上限**: `days` 超过 90 → 截断到 90（生效值看 `window.days`）; `from/to` 跨度超过 90 天 → **400**
- **新增响应字段 `window`**: `{ mode: 'all' | 'days' | 'range', days, from, to, daysCovered }` —— 看板**必须**用它标明口径，别让"累计"和"最近 7 天"长得一样
- **`daysCovered`**: 窗口内**有数据的天数**。日 key 从 2026-11-08 才有 → 头几天 < 7。**如实显示，别假装满窗**
- **错误**: 非法参数 / Redis 读失败 → **400 / 500**，不返回"看起来正常"的数（前端别把失败当 0 显示）

---

## 8. 交付后回写

| 项 | 状态 |
|---|---|
| 任务单状态行改 ✅ + 指向本记录 | ✅ |
| 任务单 + 交付记录移入 `completed/phase2/` | ✅ |
| `docs/worklog/README.md` 回写 | ✅ |
| engine-core 零改动 | ✅ |
| commit message 草稿 | `feat(deliberation-stats): 统计面板加按天分 key 与最近 N 天窗口查询` |

---

_本交付记录写于 2026-11-08。_
