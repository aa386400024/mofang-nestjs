# GateDecisions · 闸门 trace 查询接口（最终版，大厂标准）

> 阶段：Phase2.5 灰度验证期 → 直接按最终成品形态做，不做降级版
> 类型：后端功能（admin 端点 + 数据持久化）
> 优先级：P1
> 前置：WP-C（触发式审议闸门）✅
> 状态：✅ 已交付 → [`交付记录`](./phase2.5-gate-decisions-trace-api-implementation-2026-11-09.md)

---

## 1. 背景与目标

WP-C 已经做完了，闸门决策记录已经写到 Redis 里了。但 admin 后台还没有查询接口，前端 GateDecisions.vue 现在用的是 mock 数据，看不到真实的闸门决策记录。

灰度验证期最需要的就是能看到"什么时候触发了审议、触发原因是什么、审议结论是什么"，用来验证引擎行为是否符合预期。

**目标：直接按最终成品形态做——MySQL 持久化 + Redis 热缓存 + 全维度筛选分页 + 预聚合统计，一步到位。**

---

## 2. 现状盘点（已 grep 核实）

### 2.1 已有数据结构

`src/engine-adapters/deliberation-gate/deliberation-gate.trace.ts`：

```ts
export const GATE_TRACE_KEY_PREFIX = 'deliberation:gate:trace';
export const GATE_TRACE_TTL_SECONDS = 604_800;   // 7 天

export function buildGateTraceKey(sessionId, turnIndex, mode): string {
  return `${GATE_TRACE_KEY_PREFIX}:${sessionId.length}:${sessionId}:${turnIndex}:${mode}`;
}

interface GateTraceRecord {
  sessionId: string;
  turnIndex: number;
  mode: 'shadow' | 'effect';
  decision: 'run' | 'skip';
  reason: GateReason;
  deltaSummary: ...;
  thresholdUsed: { alliance, resistance, calm };
  elapsedMs: number;
  recordedAt: number;   // 毫秒
}
```

`GateReason` 枚举（12 值）：
```
crisis_skip / first_turn_baseline / key_event / cooldown / quota_exceeded /
circuit_open / unknown_event_type / alliance_delta_high / resistance_delta_high /
calm_turn / rule_confident / gate_error
```

### 2.2 现有问题

1. **只存 Redis，7 天 TTL + LRU 可能提前淘汰**——复盘的时候数据没了
2. **没有全局列表/分页**——Redis 里是每轮一个 key，要列全部只能 SCAN 全库扫
3. **sessionId 双口径**——前端传的会话 id 和 trace 里的引擎侧 sessionId 不是同一个
4. **前端 mock 字段对不上**——`thresholdUsed` 是对象不是 number，`.toFixed(3)` 会崩

---

## 3. 最终方案（一步到位）

### 3.1 数据层：MySQL 持久化 + Redis 热缓存

**新建一张表 `gate_decisions`**，闸门决策写入时双写：
- Redis：热读，7 天 TTL（现有逻辑不变）
- MySQL：持久化，真相源，用于全局查询和长期复盘

**表结构：**

```sql
CREATE TABLE gate_decisions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL COMMENT '引擎侧 session id',
  db_session_id BIGINT NULL COMMENT 'training_sessions.id（映射后）',
  turn_index INT NOT NULL COMMENT '轮次',
  mode VARCHAR(16) NOT NULL COMMENT 'shadow | effect',
  decision VARCHAR(16) NOT NULL COMMENT 'run | skip',
  reason VARCHAR(64) NOT NULL COMMENT '枚举值',
  threshold_used JSON NOT NULL COMMENT '{ alliance, resistance, calm }',
  delta_summary JSON NULL COMMENT 'delta 摘要',
  elapsed_ms INT NOT NULL COMMENT '闸门判定耗时（毫秒）',
  recorded_at DATETIME(3) NOT NULL COMMENT '发生时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_recorded_at (recorded_at),
  INDEX idx_session_turn (session_id, turn_index),
  INDEX idx_db_session (db_session_id),
  INDEX idx_mode_reason (mode, reason)
) COMMENT '闸门决策记录';
```

**写入逻辑：** 在现有 `deliberation-gate.trace.ts` 的写入路径里，加一步 MySQL 落库。Redis 写入逻辑不变。
- 注意：这是 engine-adapters 层，不是 engine-core，红线不破
- sessionId → dbSessionId 的映射：复用现有 `engine-stream-backend.adapter.ts` 的映射机制

### 3.2 查询接口

#### 3.2.1 闸门决策列表

`GET /admin/api/gate/traces`

**筛选参数：**
- `page` / `pageSize`：分页
- `sessionId`：引擎侧 session id（可选）
- `dbSessionId`：training_sessions.id（可选，和 sessionId 二选一）
- `mode`：`shadow | effect`（多选，逗号分隔）
- `reason`：枚举值（多选，逗号分隔）
- `decision`：`run | skip`
- `startDate` / `endDate`：时间范围（Asia/Shanghai）

**返回：**
```ts
interface GateTraceListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: GateTraceRecord[];
}

interface GateTraceRecord {
  id: number;                    // MySQL 自增 id
  sessionId: string;
  dbSessionId: number | null;
  turnIndex: number;
  mode: 'shadow' | 'effect';
  decision: 'run' | 'skip';
  reason: GateReason;
  thresholdUsed: { alliance: number; resistance: number; calm: number };
  deltaSummary: ...;
  elapsedMs: number;
  recordedAt: string;           // ISO 字符串，Asia/Shanghai
}
```

**实现：** 查 MySQL，不扫 Redis。Redis 只做单条热读。

#### 3.2.2 单条详情

`GET /admin/api/gate/traces/:id`

按 MySQL id 查单条。

**注意：** 不跨到审议 trace 取"建议内容"（含心理内容，越隐私红线）。审议耗时这种非心理指标如果需要，单独加字段、单独开关。

#### 3.2.3 按天聚合计数

`GET /admin/api/gate/stats?days=N`

**返回：**
```ts
interface GateStatsResponse {
  dates: string[];              // YYYY-MM-DD
  totalDecisions: number[];     // 每天总决策数
  skipDecisions: number[];      // 每天 skip 的数量
  runDecisions: number[];       // 每天 run 的数量
  byReason: Record<string, number[]>;  // 按 reason 分桶
  byMode: {
    shadow: number[];
    effect: number[];
  };
}
```

**实现：** 写时计数器（Lua 原子累加），key 为 `gate_stats:global:{YYYY-MM-DD}`，TTL 90 天。

---

## 4. 硬约束

- engine-core 纯层零改动（所有改动都在 engine-adapters 和 admin-debug 层）
- 心理内容禁止进日志和 crash report
- 不自动 git commit / push
- 时区统一 Asia/Shanghai
- 复用现有 RedisService / buildGateTraceKey / shanghaiDateKey，不另造
- 学员隔离：走 `buildOwnerFilter` 同样的口径，不能因为只读就绕过
- 鉴权：挂 `AdminBasicAuthMiddleware` + class 级 `AdminRoleGuard`

---

## 5. 验收标准

1. 跑过至少 3 场自动对练后，/admin/gate-decisions 页：
   - 能看到真实的闸门决策记录，不是 mock
   - 支持按时间范围 / mode / reason / 会话筛选
   - 支持分页
   - 每条能看到 decision、reason、thresholdUsed、耗时
2. 按天聚合接口返回正确，趋势图能画出来
3. Redis 和 MySQL 双写一致（抽查 10 条对比）
4. sessionId 双口径都能筛出结果
5. training_sessions 原有数据不受影响（回归验证）

---

## 6. 不在本期范围

- 审议 trace 的详情端点（含心理内容，另开）
- 闸门 trace 的编辑/删除功能
- 前端 GateDecisions.vue 的 UI 重设计（前端由另一个 AI 做，后端只出契约）

---

## 7. 交付记录必须登记的偏差

1. 首轮不写闸门 trace（`first_turn_baseline` 几乎不会自然出现）
2. 同会话同轮最多两条 trace（shadow + effect），统计触发次数要去重
3. `gate_error` 在 Redis 里查不到（catch 分支不写 trace）
4. sessionId 双口径映射规则
5. Redis TTL 7 天，MySQL 持久化——双源口径

---

_创建：2026-11-09（评审后最终版，大厂标准一步到位）_
