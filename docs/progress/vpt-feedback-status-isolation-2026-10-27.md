# 判断2 补充修复 · vpt 流派反馈不参与整体报告状态派生（2026-10-27）

> 关联：`empty-session-report-lifecycle-backend-2026-10-27.md` 任务 C/D。
> 本单是评审「判断2：派生加『4 流派反馈成功 → completed』」后发现的 **vpt 适用范围漏洞**，
> 只补场景隔离，不改单次训练已正确的行为。

## 一、问题

判断2 新增的两档（`schoolFeedback.completed → completed`、`schoolFeedback.parse_error → parse_error`）
对**所有 sessionType 无差别生效**。但两类会话的「报告正身」不同：

| 场景 | 报告正身 | counselor CBT feedback 的角色 |
|---|---|---|
| `training_session` 单次训练 | **无** agent 主报告链路 | feedback 就是报告本体（第4/5档必需） |
| `vpt_voice` 全真语音 | agent 主报告 `supervision_reports`（六维/亮点/标注） | **附加**：只供技术统计 + 多流派展示，不是正身 |

派生纯函数 `resolveSessionReportState`（`domain/session-core/session-core.types.ts:653-669`）
目前不知道场景，于是 vpt 也会被第4/5档带跑。

## 二、触发窗口（竞态）

vpt `endSession` 同时触发两路异步：
1. `triggerSupervisor` → agent 主报告，写 `supervision_reports`（= `mainReport`）；
2. 桥 `doClose` enqueue CBT feedback，`sessionType=VPT_VOICE`，写 `supervision_feedback`
   （`vpt-session-bridge.service.ts:374-380`）。

主报告异步未到（`mainReport=null`）、而 CBT feedback **先**落库时：

- **CBT 成功** → 命中第5档提前判 `completed`：
  - 列表卡片显示「完成 + CBT 分」；
  - 详情 `status=completed`，但 `dimensions=null / annotations=[]`（内容只从主报告取，
    `supervision.service.ts:610-613`），自相矛盾；
  - 主报告到达后分数从 CBT 分跳到主报告分。
- **CBT 失败** → 命中第4档把 vpt 整体误判成 `parse_error`（主报告其实可能成功）。

### 证据位置
- 第4/5档：`session-core.types.ts` `resolveSessionReportState`（653-669）。
- 详情喂 feedback：`supervision.service.ts:583` `loadFeedbackBySchool`（按 `sessionType=vpt_voice` 命中）。
- 列表喂 feedback：`training-session.service.ts:208` → `loadFeedbackStatesBySessionId`
  （`:317-319` 查询**未按 sessionType 过滤**，vpt 的 CBT 行也被计入）。

## 三、修复方案（推荐 A）

### A. 派生按场景隔离（干净，推荐）

给 `SessionReportStateInput` 增加一个场景位（二选一）：
- `hasMainReportChannel: boolean`（vpt=true / training_session=false），或直接传 `sessionType`。

在 `resolveSessionReportState` 里：
- **`training_session`（无主报告链路）**：保留第4/5档，feedback 即报告本体，行为不变；
- **`vpt_voice`（有主报告链路）**：`mainReport=null` 时**跳过第4/5档**，保持 `pending` 等主报告；
  CBT feedback 成功/失败都不改变整体 `status`，也不取 CBT 分当 `overallScore`。

优先级仍为：主报告 completed → 主报告 parse_error → 空局 no_content →
（仅 training_session）feedback 档 → pending/陈旧兜底。

### B. 最小改动（次选）

vpt 装配层（详情 `loadFeedbackBySchool`、列表 `loadFeedbackStatesBySessionId`）
不把 CBT feedback 喂给派生的 `schoolFeedback` 状态位；但技术统计/多流派展示的数据仍单独读，不丢弃。

## 四、不能误删（重要）

vpt 的 CBT feedback **仍要正常读取**，只去掉它对**整体 reportStatus / overallScore** 的决定权：
- 技术统计（techStats）来源就是这次 CBT LLM 调用（见 `vpt-session-bridge.service.ts:364-371` 注释）；
- `feedbackBySchool` 多流派展示照常返回。
不要整条不读，否则 vpt 技术统计会变 null。

## 五、单测（锁回归）

| 场景 | mainReport | schoolFeedback | 期望 status |
|---|---|---|---|
| vpt | null | completed | **pending**（不得 completed） |
| vpt | null | parse_error | **pending**（不得 parse_error） |
| vpt | completed | 任意 | completed（第1档不变，取主报告分） |
| training_session | null | completed | completed（现有行为不变） |
| training_session | null | parse_error | parse_error + retryable（不变） |
| 任一 | finished + 素材不足 | — | no_content（不变） |

## 六、验收

- vpt 在主报告异步窗口不再提前显示完成 / 误报失败 / 分数跳变；
- 单次训练 completed、parse_error、手动重试行为与本轮改动前完全一致；
- vpt 技术统计与多流派反馈展示不受影响；`tsc` 0 错，新增用例全绿。
