# 空会话与报告生命周期边界 · 后端任务单（2026-10-27）

> 配套前端：`xin_su_app/docs/progress/empty-session-report-lifecycle-frontend-2026-10-27.md`。
> 上一单：`history-list-backend-2026-10-26.md`（列表聚合字段，已上线）。
>
> **本单要解决的 bug**：一场 vpt / 单次训练**没产生有效对话内容**就结束时，
> 后端无条件派发督导 job → 空素材抛永久失败 → 不落任何报告行 → 列表把它误判成
> `pending`（永久"生成中"），详情要等 15 分钟陈旧兜底才翻态。用户看到的是
> "报告一直生成中"，永远等不到。
>
> **拍板结论（2026-10-27 已定，勿再改）**：
> - **D1** 极少素材并入 `no_content`，**不**单立 `weak` 态。
> - **D2** 最小可分析量 = **有效轮数 ≥ 2 且 累计有效字数 ≥ 30**（进 config，可调），低于即空局。
> - **D3** 本期把"真没说"与"设备没录上（麦克风/ASR）"合并为 `no_content`，**不做**麦克风诊断；采集信号字段预留。
> - **D4** 空局记录**保留**在列表（灰置不可点），**本期不做**删除记录。
> - **D5** 瞬时失败必须落 `parse_error` 终态 + 支持手动重试。
> - **D6** 陈旧 `pending` 兜底阈值 15min → **5min**，仅作最后兜底，不当主判定。

---

## 0. 现状基线（已读代码确认，勿重造）

| 环节 | 落点 | 现状问题 |
|---|---|---|
| vpt 结束 | `vpt-session-bridge.service.ts` `doClose`（~331） | **无条件 enqueue** 督导 job，不检查素材量 |
| 单次结束 | `training-session.service.ts` `finish`（~408） | 同上，无条件 enqueue |
| 空素材抛错 | `supervision.service.ts` `generateFeedback`（~346） | `transcript.length===0` → `BadRequestException` |
| 永久失败 | `counselor-supervision.processor.ts` `processJob`（~136） | 永久失败只 `warn` + return，**不落报告行** |
| 列表派生 | `domain/session-view/session-view.types.ts` `resolveSessionListReportAggregate` | finished + 无报告行一律 `pending`，**不看素材量** → 空局永久 pending |
| 详情派生 | `session-core/session-core.types.ts` `resolveSessionReportStatus` | 无报告行要 `endedAt` 超 **15min(900_000ms)** 才翻 `parse_error` |
| 逐字稿结构 | `training_sessions.transcript` = `{id, role: 'counselor'\|'visitor', text, timestamp}[]` | 有效文本按 `text.trim()` 判定 |
| 手动现生成 | `POST /counselor/supervision/feedback`（`supervision.controller.ts:97`） | 单流派现生成，jobId 幂等，可作重试落点 |
| 队列 | `counselorSupervision`，`attempts:3` 指数退避 | 重试用尽后"什么行都不留" |

### ⚠️ 前置确认（后端先回答，不阻塞任务 A–C）

vpt 报告页状态读的是 agent `supervision_reports` 主报告行，而 vpt `doClose` 目前只 enqueue
counselor 流派 feedback。**请后端先确认：vpt 的主报告行到底由哪条链路产出、`doClose` 是否需要
触发它。** 这是独立于空局的结构问题，本单不擅自重构主报告链路，只把空局/失败终态口径补齐。

---

## 任务 A · 空素材判定纯函数（domain，可单测，无 IO）

在 `domain/session-view/`（与 `session-view.types.ts` 同层）新增纯函数，**不读 DB、不依赖 Nest**：

```ts
interface EffectiveMaterial {
  readonly effectiveTurns: number;   // text.trim() 非空的轮数
  readonly effectiveChars: number;   // 非空轮 text.trim() 长度求和
}

// 输入逐字稿（{role,text}[]），算有效量
function measureEffectiveMaterial(transcript: readonly { text: string }[]): EffectiveMaterial;

// 是否低于最小可分析量（空局）
export function isInsufficientMaterial(
  material: EffectiveMaterial,
  opts: { minTurns: number; minChars: number },
): boolean;
```

规则（D1/D2）：
- `effectiveTurns = transcript.filter(t => t.text?.trim().length > 0).length`
- `effectiveChars = Σ 非空轮 `t.text.trim().length`
- 空局 = `effectiveTurns < minTurns(2)` **或** `effectiveChars < minChars(30)`（两者满足其一即不足，避免"2 轮但每轮 3 个字"误判合格）。
- 阈值进 config：`supervision.minEffectiveTurns=2`、`supervision.minEffectiveChars=30`，默认值如上，禁止写死在判定里。
- 纯函数只吃预计算的 `EffectiveMaterial`，DB 取数在 service 层完成。

**单测**（对齐现有 `test/counselor/session-view.spec.ts` 风格）：
- 空数组 → 空局；1 轮 → 空局；2 轮共 20 字 → 空局；2 轮共 ≥30 字 → 合格；空白串轮不计入。

---

## 任务 B · 结束前置拦截（治本，替代 15min 空等）

在 vpt `doClose` 与单次 `finish` **写 `finished` 之前**先算素材量：

1. 从库中读当前 `row.transcript`，用任务 A 算出 `effectiveTurns/effectiveChars`。
2. **空局**：
   - **不调用** `supervisionProcessor.enqueue`（不烧永久失败 job、不刷 warn、不进队列）；
   - 会话仍置 `finished` + 写 `endedAt`（记录保留，D4）；
   - 结束响应（`finish` DTO / close 回包）直接带 `reportStatus='no_content'`，前端据此**不进轮询页**。
3. **素材合格**：维持现有 enqueue 行为，走正常 `pending → completed/parse_error`。

> 空局**不新增 DB 列、不写 migration**：`no_content` 由"finished + 素材不足 + 无报告行"派生（任务 C），
> 结束响应只是实时把结果告诉前端，落库口径仍走派生。

---

## 任务 C · `reportStatus` 派生补 `no_content`（列表 + 详情共用口径）

### C1 枚举合法值扩展

`SESSION_LIST_REPORT_STATUS_VALUES` 与详情 `SessionReportStatus` 增加 `'no_content'`：
- 列表四态 → 五态：`completed | pending | parse_error | no_content | none`。
- 详情 `SessionReportStatus` 同步允许 `no_content`（详情三态扩四态）。

### C2 列表派生 `resolveSessionListReportAggregate`

在现有判定前插入空局分支（需要 service 先把 `effectiveTurns/effectiveChars` 算好传入，纯函数不读 transcript）：

| 条件 | reportStatus | overallScore | reportReady |
|---|---|---|---|
| 报告行 completed | `completed` | 真实分 | true |
| 报告行 parse_error | `parse_error` | null | false |
| **finished + 素材不足（空局）** | **`no_content`** | null | false |
| finished + 素材合格 + 无报告行 | `pending` | null | false |
| 非 finished（开过头没收尾） | `none` | null | false |

### C3 详情派生 `resolveSessionReportStatus` 同步识别空局

- finished + 素材不足 → 直接 `no_content`，**不再走 15min 陈旧兜底**；
- finished + 素材合格 + 无报告行 → 仍 `pending`，超过 5min（任务 E）才 `parse_error`；
- 避免列表说 `no_content`、详情却先 `pending` 的口径打架（与现有"派生集中一处"原则一致）。

---

## 任务 D · 瞬时失败落终态 + 手动重试（D5）

### D1 失败原因码（failureCode）

引入失败码枚举（落报告行/反馈记录的附加字段，可空）：

| failureCode | 含义 | 可重试 |
|---|---|---|
| `upstream_unavailable` | LLM 上游不可用 | ✅ |
| `rate_limited` | 上游限流 429 | ✅（退避后） |
| `parse_failed` | 返回 JSON 解析/schema 校验失败 | ✅ |
| `timeout` | 上游超时 | ✅ |
| `empty_material` | 素材不足（永久） | ❌ 直接 `no_content`，不进此表 |
| `school_missing` | 流派缺种子（永久） | ❌ warn 留空 |

### D2 重试用尽必须落终态

- BullMQ `attempts:3` 用尽后，**不再"什么行都不留"**：落一条 `parse_error`（带 `failureCode`、`endedAt`），让列表/详情立即显示失败，而不是靠墙钟猜。
- 永久失败（`empty_material` / `school_missing`，沿用 `isPermanentSupervisionFailure` 口径）**不重试、不落 parse_error**；空局归 `no_content`。

### D3 手动重试入口

- 复用 `POST /counselor/supervision/feedback`（已幂等 jobId）作为 `parse_error` 的重新生成入口；重试成功覆盖为 `completed`。
- 不新建独立"重跑主报告"端点；若主报告链路后续确认独立，再补。
- 重试仅对 `parse_error`（有素材）开放；`no_content` / `interrupted` 不提供重试。

---

## 任务 E · 陈旧兜底阈值 15min → 5min（D6）

- `supervision.reportPendingTimeoutMs` 默认 `900_000` → **`300_000`（5min）**。
- 该兜底只覆盖"worker 没跑 / 落库失败"等漏网，正常瞬时失败由任务 D2 主动落 `parse_error`，不依赖它。

---

## 任务 F · DTO 字段对齐

- `TrainingSessionListItemDto.reportStatus` 校验允许 `'no_content'`；可选回 `failureCode?: string | null`。
- `SessionReportDto.status` 允许 `'no_content'`；空局时 `dimensions/annotations/...` 全空、`overallScore=null`。
- `finish` 响应 `supervision.status` 增加 `'no_content'` 取值（与现有 `queued/enqueue_failed` 并列）。
- **红线不变**：任何非 `completed`，`overallScore` 必须 `null`，禁止补 0。

---

## 明确不做（本期边界）

- ❌ 不做麦克风/VAD/ASR 设备诊断（"没采集到声音"提示后期再加，仅预留采集信号字段位）。
- ❌ 不立 `weak`（极少素材）独立态，并入 `no_content`。
- ❌ 不做用户删除会话记录、不做记录置顶/搜索。
- ❌ 不重构 vpt 主报告产出链路（见前置确认）。
- ❌ 不接长程个案 / 微练习 / 题库历史。
- ❌ 不新增 `training_sessions` 列、不写 migration（`no_content` 纯派生）。

---

## 验收（成功 + 边界）

| 场景 | 输入 | 期望 |
|---|---|---|
| 空局·用户主动结束 | finished + 有效轮<2 或字数<30 | 不 enqueue；列表/详情 `reportStatus=no_content`，`overallScore=null`，不可重试，不转圈 |
| 空局·timeout 断开 | reason=timeout + 无素材 | `no_content`（不误判 pending） |
| 合格·生成中 | finished + 素材合格 + 无报告行 | `pending`，前端轮询 |
| 合格·瞬时失败用尽 | 上游不可用 ×3 | 主动落 `parse_error` + failureCode，**不等 5min**，可手动重试 |
| 合格·成功 | 报告 completed | `completed` + 真实分 |
| 中断 | 非 finished + 开过头 | `interrupted=true` / `none`，不可进 |
| 手动重试 | parse_error 调 POST feedback | 成功转 completed，jobId 幂等不堆 job |
| 陈旧兜底 | worker 漏跑 + 超 5min | 才判 parse_error（最后兜底） |
| 归属 | 他人会话 | 不可见 |

### 自检
- `npx jest` 新增空素材判定用例全绿；`tsc` 0 错；空局场景队列里**不出现** job。
