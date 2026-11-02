# WP19 · 后端 AdminDebugModule + 每轮 BDI 快照留痕落库

> 类型: 后端任务单（行为化，不含 src 实现）
> 前置: WP18（报告闭环打通后做）
> 日期: 2026-10-29
> 红线: 不改 `src/engine-core/**` 纯层；不改 DB schema（用现有表或加 JSONB 字段，不加新表）；不做写操作（只读 API）。

---

## 0. 为什么有这条

WP13（基础可观测）在 backlog 里但没拆细。现在引擎跑通了，调试时面临一个黑盒：角色说了句不对的话，你只能看到 WS 帧流，看不到那一轮的 BDI 快照（trust/valence/arousal）、RenderSpec 发给 LLM 的 prompt、usage token。

WP19 做两件事：
1. **每轮留痕落库**：每轮 turn 结束时，把 BDI 快照、RenderSpec 摘要、LLM usage 写到一个可查的地方（现有 session 表加 JSONB 字段，或复用 turn-analysis 已有存储）。
2. **AdminDebugModule 只读 API**：暴露 `/admin/api/sessions`、`/admin/api/sessions/:id`、`/admin/api/characters`，给 WP20 的 Vue SPA 读。

---

## 1. 做什么

### 1.1 每轮留痕（核心，不是可选项）

每轮 `EngineTurnService.execute()` 结束后，把这一轮的调试快照落库：

```json
{
  "turnIndex": 3,
  "characterSlug": "vpt_intimate_avoidance_l1",
  "bdiSnapshot": {
    "trust": 0.28,
    "valence": -0.45,
    "arousal": 0.62,
    "resistance": 0.42,
    "anxiousSecure": "anxious"
  },
  "renderSpec": {
    "taskKind": "voice_render",
    "promptPreview": "……(截断前 500 字, 不含完整 system prompt)",
    "maxCompletionTokens": 1500,
    "reasoningEffort": "low"
  },
  "llmUsage": {
    "promptTokens": 0,
    "completionTokens": 604,
    "reasoningTokens": 38,
    "ttftMs": 1988,
    "finishReason": "stop"
  },
  "crisis": {
    "detected": false,
    "category": null
  },
  "ts": "2026-10-29T14:30:00.000Z"
}
```

**约束**：
- 存在哪：优先复用现有 turn-analysis 存储（如果已经有），没有就在 session 表加一个 `turn_debug_trace JSONB` 字段（不加新表）。
- prompt 分段存（system/context/instructions），system 截断前 500 字，context/instructions 存完整。
- 不存完整音频、不存完整逐字稿（逐字稿已有存储）。
- dev 环境全量落，prod 环境可通过 env `ENGINE_DEBUG_TRACE_ENABLED` 开关（缺省 dev 开、prod 关）。

### 1.2 AdminDebugModule 只读 API

NestJS 新 module，路由前缀 `/admin/api`：

| 端点 | 返回 |
|---|---|
| `GET /admin/api/sessions?limit=20` | 最近会话列表：sessionId、characterSlug、visitorAlias、startedAt、endedAt、durationSec、status、totalTokens |
| `GET /admin/api/sessions/:id` | 会话详情：session 元信息 + turn_debug_trace 数组（每轮快照）+ 逐字稿 + **报告**（六维评分/annotations/techStats，对齐 WP18） |
| `GET /admin/api/characters` | 角色池列表：slug、codename、baseline 参数（trust/resist/valence/arousal）、状态 |
| `GET /admin/api/health` | `{ status: "ok", engineVoiceEnabled: true, uptimeSec: 123 }` |

**会话详情报告字段（与前端 `src/api/types.ts` 的 SessionReport 对齐）**：
```json
{
  "report": {
    "status": "completed",
    "overallScore": 72,
    "dimensions": { "empathy": 75, "activeListening": 80, "questioning": 65, "boundary": 85, "response": 70, "professionalism": 78 },
    "annotations": [{ "type": "good|warn|error", "category": "共情", "message": "..." }],
    "growthSuggestions": ["..."],
    "techStats": { "commentary": "..." }
  }
}
```

**前端已预留的可视化组件（WP20）**：
- `DimensionsRadar.vue` — 六维评分雷达图（ECharts）
- `BdiTrajectoryChart.vue` — 逐轮 BDI 状态轨迹折线图（trust/valence/arousal/resistance 随轮次变化）
- `InfoTooltip.vue` — 参数 hover 中文解释 tooltip

**约束**：
- 全部只读，没有 POST/PUT/DELETE。
- prod 环境加 basic auth middleware（env `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASS`），dev 裸奔。
- 不直接暴露 TypeORM entity，走 `AdminReadRepository` 接口（未来迁 PG/加缓存只换实现）。
- 不做分页（先 limit=20，够调试用）。

---

## 2. 不做

- ❌ 不做角色编辑 CRUD。
- ❌ 不做用户管理/权限系统。
- ❌ 不做实时大盘/图表。
- ❌ 不存完整 system prompt / 完整音频。
- ❌ 不改 engine-core 纯层（留痕在 wiring/adapter 层做）。
- ❌ 不做 WebSocket 实时推送（调试器拉取就够）。

---

## 3. 验收

| # | 项 |
|---|---|
| 1 | tsc 0 错、eslint 干净 |
| 2 | 跑一场会话后，DB 里 turn_debug_trace 有每轮记录 |
| 3 | `GET /admin/api/sessions/:id` 返回的 trace 数组里，每轮有 bdiSnapshot + llmUsage |
| 4 | `GET /admin/api/health` 返回 engineVoiceEnabled 状态 |
| 5 | prod basic auth 生效（无 401 → 401） |
| 6 | 旧 visitor 链路（ENGINE_VOICE_ENABLED=false）行为零变化 |

---

## 4. commit 文案

```
feat(engine): AdminDebugModule 只读API + 每轮BDI快照留痕落库，为调试器SPA提供数据
```
