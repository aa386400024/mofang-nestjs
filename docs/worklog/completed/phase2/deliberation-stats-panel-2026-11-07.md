# 影子模式数据统计面板 · 后端接口

> 状态: ✅ 已交付
> 交付记录: [`engine-deliberation-stats-panel-implementation-2026-11-07.md`](engine-deliberation-stats-panel-implementation-2026-11-07.md)
> 先读 `docs/worklog/README.md` 和 `docs/README.md` 确认后端当前阶段与模块边界。

## 一、为什么做这个（问题与目标）

### 背景

切灰度前置四道安全网都做完了（delta cap / 过期判定 / cap 配置统一 / 临床合理性观测版）。影子模式跑了快两周，现在 trace 数据散在 Redis 里，没有聚合接口。

切灰度决策需要回答几个问题：
- 成功率多少？失败的主要原因是什么？
- P95 耗时多少？会不会太慢？
- deltaDiff 均值多少？LLM 和规则算子的分歧大不大？
- 过期率多少？快照版本对比拦了多少轮？
- 被砍的维度有多少？哪些维度最常出界？
- 临床 flagged 率多少？三条规则各命中多少？

### 目标

后端出一个统计接口，返回上面这些关键指标，供切灰度前查看。

---

## 二、开工前核实清单（7 条，开工前逐条自己 grep 确认）

| # | 核实项 | 确认方式 |
|---|---|---|
| 1 | trace 存在 Redis 里，key 是 `deliberation_trace:{tenantId}:{sessionId}:{turnIndex}` | ✅ 已确认（`llm-deliberation.service.ts:836`） |
| 2 | trace 的字段有：ok / durationMs / stale / retryCount / tokenUsage / deltaDiff / capEntries / clinicalFlags / operatorTags | ✅ 已确认（`DeliberationTraceRecord` 接口） |
| 3 | admin-debug.controller.ts 是调试器 API，class 级挂了 `AdminRoleGuard` | ✅ 已确认 |
| 4 | 现在没有统计接口 | ✅ 已确认（grep 0 匹配） |
| 5 | Redis 的使用范式：`this.redis.set(key, value, 'EX', ttl)` | ✅ 已确认 |
| 6 | 审议服务已经注入了 Redis（`writeTrace` 在用） | ✅ 已确认 |
| 7 | admin-debug.module.ts 已经导入了哪些 provider | 需要自己 grep 确认 |

---

## 三、技术方案

### 核心思路

**不扫全量 trace**（慢且用 KEYS 阻塞），维护一个 **Redis hash 统计计数器**——每轮审议跑完，同步累加。统计接口直接读 hash，O(1)。

### 为什么用计数器而不是扫 trace

1. **性能**：扫 1000 条 trace 要读 1000 次 Redis，计数器是 O(1)
2. **不阻塞**：KEYS 命令在生产环境是阻塞的，SCAN 也要分批
3. **简单**：统计接口直接读 hash，不用写聚合逻辑

---

## 四、写入侧（详细设计）

### 4.1 统计计数器结构

**Redis hash key**：`deliberation_stats:global`

**字段**：
```
total_turns          = 总轮次
success_turns         = 成功轮次（ok: true）
failure_turns         = 失败轮次（ok: false）
total_duration_ms     = 总耗时（用于算平均）
max_duration_ms       = 最大耗时
stale_turns           = 过期轮次（stale: true）
total_retry_count     = 总重试次数
total_prompt_tokens   = 总 prompt tokens
total_completion_tokens = 总 completion tokens
sum_delta_diff_abs    = deltaDiff 绝对值之和（用于算均值）
max_delta_diff_abs     = deltaDiff 最大绝对值
cap_<dimension>       = 被砍维度计数（每维一个 key）
clinical_<rule>       = 临床 flagged 计数（每条规则一个 key）
```

### 4.2 在哪里更新计数器

**位置**：`writeTrace` 函数内部。

**理由**：
- 所有成功 / 失败轮次都会走 `writeTrace`
- 在这里更新，不用在每个调用点重复写
- 与 trace 写入同一次 Redis 操作，一致性最好

### 4.3 更新逻辑

**流程**：
1. 写 trace（现有逻辑）
2. 累加统计计数器（新增）

**成功轮次（ok: true）**：
- `total_turns += 1`
- `success_turns += 1`
- `total_duration_ms += durationMs`
- `max_duration_ms = Math.max(max, durationMs)`
- `stale_turns += stale ? 1 : 0`
- `total_retry_count += retryCount`
- `total_prompt_tokens += tokenUsage.promptTokens`（如果有）
- `total_completion_tokens += tokenUsage.completionTokens`（如果有）
- `sum_delta_diff_abs += |deltaDiff 所有维度的绝对值之和|`
- `max_delta_diff_abs = Math.max(max, 最大维度绝对值)`
- `capEntries.forEach(e => cap_<e.dimension> += 1)`
- `clinicalFlags.forEach(f => clinical_<f.rule> += 1)`

**失败轮次（ok: false）**：
- `total_turns += 1`
- `failure_turns += 1`
- `total_duration_ms += durationMs`
- 其他字段不累加（失败轮次没有 deltaDiff / capEntries / clinicalFlags）

### 4.4 TTL

统计计数器**永久保留**，不设 TTL。

理由：影子模式累计数据，切灰度后才没用。切灰度后可以手动清。

---

## 五、读取侧（详细设计）

### 5.1 接口

**端点**：`GET /admin/api/deliberation/stats`

**位置**：`admin-debug.controller.ts`（调试器 API，class 级已有 `AdminRoleGuard`）

**返回**：
```typescript
interface DeliberationStatsResponse {
  /** 总轮次 */
  totalTurns: number;
  /** 成功率（0-1） */
  successRate: number;
  /** 平均耗时（ms） */
  avgDurationMs: number;
  /** 最大耗时（ms） */
  maxDurationMs: number;
  /** 过期率（0-1） */
  staleRate: number;
  /** 平均重试次数 */
  avgRetryCount: number;
  /** 平均 prompt tokens */
  avgPromptTokens: number;
  /** 平均 completion tokens */
  avgCompletionTokens: number;
  /** deltaDiff 平均绝对值 */
  avgDeltaDiffAbs: number;
  /** deltaDiff 最大绝对值 */
  maxDeltaDiffAbs: number;
  /** 被砍维度分布（dimension -> count） */
  capByDimension: Record<string, number>;
  /** 临床 flagged 分布（rule -> count） */
  clinicalByRule: Record<string, number>;
}
```

### 5.2 聚合逻辑

纯函数，放在 `insights-view.ts` 或新建一个 `deliberation-stats-view.ts`。

**职责**：把 Redis hash 的原始字段，聚合成上面的响应形状。

---

## 六、隐私与安全

1. **统计接口只出聚合数字**——不含心理内容
2. **鉴权**：class 级已有 `AdminRoleGuard`，非 admin → 403
3. **日志只出定位信息**——不打对话原文

---

## 七、反双胞胎（刻意不做的事）

1. **不扫全量 trace**——用计数器，O(1)
2. **不做时间窗口统计**——本期只做累计，后面需要再加
3. **不做重置接口**——后面需要再加
4. **不做 tenant 隔离**——admin 看全局数据，现在只有一个开发 tenant
5. **不做前端面板**——后端先出接口，前端另一个 AI 的活
6. **不改内核**——纯适配层实现，engine-core 零改动
7. **不缓存**——Redis hash 本身就是 O(1)，不用再加一层缓存

---

## 八、闸门（验收标准）

| # | 闸门 | 要求 |
|---|---|---|
| 1 | ESLint | 0 problem |
| 2 | TypeScript | 0 error |
| 3 | 单测 | 全量跑通，不新增失败 |
| 4 | engine-core | 零改动 |
| 5 | 写入侧 | 成功轮次跑一次，计数器各字段累加正确 |
| 6 | 写入侧 | 失败轮次跑一次，total_turns / failure_turns 累加，其他字段不累加 |
| 7 | 读取侧 | 接口返回的字段形状与 §5.1 一致 |
| 8 | 读取侧 | 成功率 = success_turns / total_turns，计算正确 |
| 9 | 读取侧 | 平均耗时 = total_duration_ms / total_turns，计算正确 |
| 10 | 边界 | 空数据（计数器全是 0）时，接口不崩，返回 0 而不是 NaN |

---

## 九、交付物清单

1. **写入侧**：`writeTrace` 内部加统计计数器累加逻辑
2. **读取侧**：`GET /admin/api/deliberation/stats` 端点
3. **聚合纯函数**：`deliberation-stats-view.ts`（或放在 insights-view.ts 里）
4. **单测**：`test/admin-debug/deliberation-stats.spec.ts`

### 交付后回写文档（与之前 WP 同款）

| 文件 | 改什么 |
|---|---|
| `docs/worklog/pending/deliberation-stats-panel-2026-11-07.md` | 状态行改 ✅ + 指向交付记录，然后移到 `completed/phase2/` |
| `docs/worklog/README.md` | Phase2 已开工列表加一条 |

---

## 十、commit message 草稿

```
feat(deliberation): 影子模式数据统计面板后端接口

维护 Redis hash 计数器, 每轮审议同步累加.
接口 GET /admin/api/deliberation/stats 返回关键指标.
切灰度决策用, 不用扫全量 trace.
engine-core 零改动.
```

---

## 十一、注意点

1. **后端如果发现更合理更专业的方案，可以按照后端来**——不用死守任务单。但要在交付记录里写明偏差和理由。
2. **开工前先按 §二的 7 条核实清单自己 grep 一遍**——别只凭清单就信了。
3. **统计计数器的 key 命名要与仓库既有范式一致**——参考 `DELIBERATION_TRACE_KEY_PREFIX` 的命名风格。

---

## 十二、交付后补记（2026-11-07）

> 完整的设计决策、接口契约与闸门数字见交付记录：[`engine-deliberation-stats-panel-implementation-2026-11-07.md`](engine-deliberation-stats-panel-implementation-2026-11-07.md)

### 12.1 §二 核实清单的逐条结论

| # | 核实项 | 任务单写的 | 实际 | 结论 |
|---|---|---|---|---|
| 1 | trace key | `deliberation_trace:{tenantId}:{sessionId}:{turnIndex}` | `deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}`（`llm-deliberation.service.ts:836-837`） | ❌ **不准确**（带长度前缀，防撞键）—— 本单不扫 trace，不影响实现 |
| 2 | trace 字段 | ok / durationMs / stale / retryCount / tokenUsage / deltaDiff / capEntries / clinicalFlags / operatorTags | ✅ 全部存在（`DeliberationTraceRecord`，含上一单新加的 `clinicalFlags`） | ✅ 准确 |
| 3 | admin-debug class 级 `AdminRoleGuard` | ✅ | ✅（`admin-debug.controller.ts:138`） | ✅ 准确 |
| 4 | 现在没有统计接口 | ✅ | ✅（grep 0 匹配） | ✅ 准确 |
| 5 | Redis 范式 | `this.redis.set(key, value, 'EX', ttl)` | `set(key, value, ttlSec?)`，`'EX'` 在实现内部（`redis.service.ts:114-116`） | ❌ **不准确** —— 本单统计侧走 `getClient().eval()`，不走 `set` |
| 6 | 审议服务已注入 Redis | ✅ | ✅ | ✅ 准确 |
| 7 | admin-debug.module.ts 的 provider | 需自己 grep | providers = `[TraceRecorder, AdminBasicAuthMiddleware, AdminRoleGuard]`；**RedisModule 是 `@Global()`** → `RedisService` 全局可注入，**module 零改动** | ✅ 已核实 |

### 12.2 偏差摘要（完整版见交付记录 §2）

| # | 任务单怎么写的 | 本单怎么做的 | 为什么 |
|---|---|---|---|
| B1 | §4.3 失败轮次只累 3 项，"其他字段不累加" | 成功/失败走**同一套**规则：`durationMs` / `retryCount` / `tokenUsage` / 延迟桶**所有轮次都记** | 失败记录里 `retryCount` / `tokenUsage` **同样有值** —— 照抄会让平均值的分子分母对不上 |
| B2 | §4.1 字段表里没有错误码维度 | 加 `error_<code>` 分布 → `failureByErrorCode` | §一 问的"失败的主要原因是什么"是**累计器答不了**的 6 个问题之一 |
| B3 | §4.1 字段表里没有延迟分布 | 加**延迟直方图**（13 个桶）→ `p50DurationMs` / `p95DurationMs` | §一 问的"P95 耗时多少"是**累计器答不了**的另一个 |
| B4 | §4.2 "与 trace 写入同一次 Redis 操作，一致性最好" | trace 写（`set`）与统计累加（`eval`）**两次独立往返 + 独立 try/catch** | 共用一个 try 会把故障归错类; 合并进一次 Lua 会让统计失败**连坐** trace（trace 是主产物，失败记录不能丢） |
| B5 | §5.2 聚合纯函数放 `insights-view.ts` 或 `deliberation-stats-view.ts` | 读写两侧放**同一个文件** `src/engine-adapters/deliberation/deliberation-stats.ts` | **存储格式的解读方必须与写入方同源** —— 拆两份就两份真相，迟早漂 |
| B6 | §4.2 累加方式未规定 | 用**一次 Lua 脚本**（`getClient().eval()`）而不是逐条 `hset` / `incrby` | "取大"字段必须读-改-写 —— 并发下会**静默少算**; 仓库已有 EVAL 先例（`redis-bdi-state.repository.ts:133`） |
| B7 | §五 未规定失败时的返回 | Redis 读失败**直接抛错**，不兜底成 0 | 兜底成 0 会让看板显示"零失败零耗时" —— 那是**误导** |
| B8 | §五 未规定返回壳 | 返回**裸对象**（admin-debug 既有惯例） | WP58 的 `{code:0,data}` 是全仓唯一例外 |
| B9 | §九 交付物清单未列测试桩同步 | 9 个审议 spec 的 Redis 桩补 `getClient()` | service 写 trace 时现在会走 `getClient().eval()`；桩不补就每次都走"失败兜底"分支 |
| B10 | §九 交付物清单未列 wp26 | `wp26-admin-role-guard.spec.ts` 端点清单加 `deliberation/stats` | 那条用例是**硬编码端点列表** —— 新端点不登记，"忘了挂 guard"没人发现 |

### 12.3 闸门（实跑）

| 类型 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error / 0 warning** ✅ |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| 全量单测 | `npx vitest run --exclude "**/e2e/**/*.ts"` | **129 文件 / 2208 例全绿** ✅ |
| 边界断言 | `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿** ✅ |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

