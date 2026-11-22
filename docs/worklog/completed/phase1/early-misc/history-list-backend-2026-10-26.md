# 练习历史列表接口补充 · 后端任务单（2026-10-26）

> 配套前端：成长 tab「练习历史」二级页。本期只接 **vpt 全真语音 + 单次训练**（同落 `training_sessions` 表）；
> 长程个案 / 微练习 / 题库练习本期仅前端灰置占位，后端不动。
>
> **本单范围**：只给「我的会话列表」补聚合字段（报告状态 / 总分 / 类型 / 中断派生），
> **不新建表、不改会话闭环、不改报告详情端点、不做长程**。
>
> **红线沿用**：不伪造分数（报告未出 / 失败一律 `overallScore=null`，绝不补 0）；只返当前 `userId` 自己的记录，
> 跨用户不可见；报告是 BullMQ 异步生成，列表只读不触发生成。

---

## 0. 现状基线（已有，勿重造）

| 能力 | 现有落点 | 现状 |
|---|---|---|
| 我的会话列表 | `GET /counselor/training-sessions`（`training-session.controller.ts:79` → `training-session.service.list`） | 🟡 只查 `training_sessions` 单表，**未 join 报告**，列表项无报告状态 / 总分 / 类型 |
| 列表项 DTO | `dto/training-session.dto.ts` `TrainingSessionListItemDto` | 现有：`id / scenarioId / status / difficulty / personaName / personaComplaint / turnCount / startedAt / endedAt / createdAt` |
| 报告详情 | `GET /counselor/supervision/report/:sessionId`（`supervision.service.getSessionReport`） | ✅ 已对 vpt / 单次同构返回，前端复用，**本单不改** |
| 报告表 | `agent/supervisor` `supervision_reports`，`status` 仅 `completed` / `parse_error` 两态 | ⚠️ **没有 `pending` 行**：入队到写库之间报告行不存在，"生成中"要靠派生 |
| vpt 标识 | `config/vpt.config.ts` `VPT_SCENARIO_ID = 'vpt_voice'`，落在 `scenario_id` 列 | ✅ 靠 `scenarioId` 区分 vpt / 单次，表内无独立 type 列 |
| 会话状态机 | `TrainingSessionStatus`：`idle / listening / thinking / speaking / finished` | ⚠️ **无 abandoned 态**，中断会话停在进行态，需派生（见任务 1） |

**核心结论**：列表接口骨架、分页、归属过滤、报告详情都已具备，本单 = 给列表项补 4 个派生 / 聚合字段 + 一个类型过滤，一次请求到位，避免前端 N+1 逐条拉报告。

---

## 任务 1 · 列表项补聚合字段（核心）

改 `TrainingSessionListItemDto`，在现有字段后**追加**（不改、不删现有字段）：

```jsonc
{
  // ── 现有字段保留 ──
  "id": "uuid",
  "scenarioId": "vpt_voice | 其它场景 id",
  "status": "idle|listening|thinking|speaking|finished",
  "difficulty": "L1|L2|L3",
  "personaName": "晚晴",
  "personaComplaint": "截断 60 字…",
  "turnCount": 12,
  "startedAt": "ISO8601 | null",
  "endedAt": "ISO8601 | null",
  "createdAt": "ISO8601",

  // ── 本单新增 ──
  "sessionType": "vpt_voice | training_session",   // 派生，见规则 A
  "reportStatus": "completed | pending | parse_error | none", // 派生，见规则 B
  "overallScore": 82,                                // 仅 completed 给整数，其余 null
  "reportReady": true,                               // = reportStatus === 'completed'
  "interrupted": false                               // 派生，见规则 C
}
```

### 规则 A · `sessionType` 派生（不新增 DB 列）

- `scenarioId === VPT_SCENARIO_ID('vpt_voice')` → `'vpt_voice'`
- 其余全部（含 `full_session` 专项技能、各全流程场景）→ `'training_session'`；本期不细分。

### 规则 B · `reportStatus` 派生（关键：报告表无 pending 行）

先按 `sessionId` 批量取该会话的 `supervision_reports` 行（见任务 2 批量查询），再判定：

| 条件 | reportStatus | overallScore |
|---|---|---|
| 有报告行且 `status='completed'` | `completed` | 报告 `overallScore`（0-100 整数） |
| 有报告行且 `status='parse_error'` | `parse_error` | `null` |
| 无报告行 且 `status='finished'` | `pending`（已结束，异步生成中） | `null` |
| 无报告行 且 非 finished（开过头没收尾，见规则 C） | `none` | `null` |
| 纯 idle 空会话（见任务 3 过滤，一般不出现在列表） | `none` | `null` |

`reportReady = reportStatus === 'completed'`。
**任何非 completed 情况 `overallScore` 必须为 `null`，禁止补 0 / 占位分。**

### 规则 C · `interrupted` 派生（本期不落 abandoned 列）

```
interrupted = (status !== 'finished')
              && (startedAt != null || turnCount > 0)
```

即"开过头（有开始时间或说过话）但没正常走到 finished"判为已中断。纯 `idle` 且 `startedAt==null && turnCount==0` 的空会话不算中断（见任务 3）。

### 可选增强（非阻塞）

- `durationSeconds: number | null`：`endedAt - startedAt` 的秒数，前端卡片展示时长用；后端算好下发比前端猜时间戳稳。不做也可由前端用 `startedAt/endedAt` 自算。

---

## 任务 2 · 批量取报告，禁止 N+1

`SupervisionReportRepository`（`agent/supervisor/domain/repositories/supervision-report.repository.ts`）现有只有 `findBySessionId(tenantId, sessionId)` 单个查询。列表一页 20 条若循环调用 = 20 次查询，必须批量：

- **新增** `findBySessionIds(tenantId: string, sessionIds: string[]): Promise<Map<string, SupervisionReportRow>>`
  - 一次 `where sessionId IN (...) AND tenantId=?`（`supervision_reports` 表无软删列，不加 `deletedAt` 条件），按 sessionId 建 Map 返回；同一 session 多行取最新一份（沿用 `findBySessionId` 的"最新"口径）。
  - TypeORM 实现补 `data/supervision-report.repository.typeorm.ts`；内存实现补 `data/supervision-report.repository.memory.ts`（返回空 Map 即可，单测可 mock）。
- `training-session.service.list`：先分页查会话行 → 收集本页 id → 一次批量取报告 Map → `toListItem` 时按 id 查表填聚合字段。
- **禁止** 在 `list` 里对每行 `await findBySessionId`。

---

## 任务 3 · 列表查询补类型过滤 + 空会话处理

### 3.1 QueryDto 加 `sessionType`（前端分段切换用）

`TrainingSessionListQueryDto` 追加可选 `sessionType`，取值仅 `'vpt_voice' | 'training_session'`（用 `@IsEnum` 或自定义校验收窄这两个字面值，沿用仓库现有 DTO 风格，不必新建全局 enum）：

```ts
sessionType?: 'vpt_voice' | 'training_session';
```

映射到现有 `scenarioId` 过滤（表内无独立 type 列）：

- `sessionType='vpt_voice'` → 等价 `scenarioId = VPT_SCENARIO_ID`
- `sessionType='training_session'` → 等价 `scenarioId != VPT_SCENARIO_ID`（注意排除 vpt）

原有 `scenarioId` / `status` / `page` / `pageSize` 参数保留不变，可与 `sessionType` 叠加。

### 3.2 纯空会话不进列表（建议默认）

默认过滤掉 `status='idle' && startedAt==null && turnCount==0` 的空建单行（建了没开过的残留），避免历史里出现无意义空卡。若要保留，至少保证它 `reportStatus='none' / overallScore=null / interrupted=false`，前端灰显不报错。

### 3.3 分页 / 排序沿用

`createdAt DESC`、`page`（从 1）、`pageSize`（1-100，默认 20）全部沿用，不改。

---

## 明确不做（本期边界）

- ❌ 不加 `abandoned` 列 / 不改 5 态状态机（中断用 `interrupted` 派生够了，"继续上次会话"后置）。
- ❌ 不接长程个案（`long_term_cases` / `long_term_case_sessions`）、微练习（`practice_attempts`）、题库（`training_exercise_attempts`）的历史列表。
- ❌ 不改 `GET /counselor/supervision/report/:sessionId` 报告详情（前端 vpt / 单次共用）。
- ❌ 不做报告重新生成 / 重发、不做用户删除记录、不做跨用户分享。
- ❌ 不在列表里返回完整 transcript / 六维明细（列表只要总分+状态，明细走报告详情）。

---

## 验收（成功 + 边界场景）

| 场景 | 输入 | 期望输出 |
|---|---|---|
| 完成且报告就绪 | finished + completed 报告 | `reportStatus=completed`，`overallScore` 有整数，`reportReady=true`，`interrupted=false` |
| 完成但报告生成中 | finished + 无报告行 | `reportStatus=pending`，`overallScore=null`，`reportReady=false`，`interrupted=false` |
| 中断会话 | listening/thinking/speaking 且 startedAt 或 turnCount 非空 | `interrupted=true`，`reportStatus=none`，`overallScore=null`，`reportReady=false` |
| 报告失败 | parse_error 占位行 | `reportStatus=parse_error`，`overallScore=null`（**不显示 0 分**） |
| 类型过滤 | `?sessionType=vpt_voice` | 只返 vpt 行；`?sessionType=training_session` 排除 vpt |
| 归属 | 他人 userId 的会话 | 不出现在当前用户列表 |
| 查询次数 | 一页 20 条 | 报告表只发 1 次批量查询（无 N+1） |
| 排序分页 | 翻页 | `createdAt DESC`，page/pageSize 生效 |

### 已知边界（本期接受，不专门处理）

- `finish` 入队失败（`enqueue_failed`）的 finished 会话，列表会先显示 `pending`；前端进报告页轮询到上限后手动重试即可，本期不单独标记"入队失败"。
- 报告异步延迟期间，下拉 / 重新进列表会从 `pending` 自然变 `completed`，前端靠重新拉列表刷新，不要求后端推送。

---

## 前端自备（不在本单）

成长页两占位 tile 合并为「练习历史」入口；历史二级页（全真语音 / 单次训练分段点亮，长程 / 微练习 / 题库灰置）；卡片四态（就绪看报告 / 生成中 / 失败可重试 / 已中断灰态）；报告页参数化复用给单次训练；单次训练结束改跳报告页；删除旧 mock `supervision_list_page`。
