# AF-208 · 来访者真人度 R2 交付记录

- 任务：AF-208「来访者真人度 R2：口语事件计划、话轮形态审计与生成侧重试」
- 前序：AF-207（R0/R1，PR #65 已合并，合并提交 `ea1bbfab`）
- 分支：`task/AF-208-visitor-realism-r2`
- 基线：`ea1bbfaba59fd6d84bbd735240d8a61cfdbc505f`
- 日期：2026-11-20
- 协作：主控实现 + 最终闸门；本单未再派 MiniMax
- 结论：R2 生成侧能力已落地，定向 23 项、全量 4018 项通过；engine-core 零 diff。R3—R5（场景矩阵扩展、临床规则细化、度量与 AI 双盲验收）不在本单范围。

## 1. 这单解决什么

R1 已经能让 prompt 说出「这一轮该用什么话轮形态、允许多少不流利」，但仍是**建议**：模型可以不听，而且没有任何生成侧检查。结果是历史批次里仍然出现整段铺开、该问回却没问、该短却长篇，读起来像“会写心理词的聊天机器人”，不是咨询室里坐着的人。

R2 把这条链补成三段闭环：

1. **生成前**：给出这一轮**具体可用**的口语事件候选与上限，不是抽象地“口语一点”。
2. **生成后**：确定性审计文本，只拦明确可判的硬违约，不猜语义。
3. **违约时**：`active` 模式下同一候选最多重说一次；仍违约就接受可读文本，不用兜底句毁掉一轮正常咨询。

## 2. 实施方案

### 2.1 口语事件计划

新增 `src/shared/realism/realism-event-plan.ts`：

- 六类事件：`filler` / `pause` / `repair` / `trailoff` / `repetition` / `elongation`。
- 按 7 类角色给**具体候选词**，不是通用词表：
  - 克制型：只给停顿、半截话；
  - 情绪型：`嗯`、`不对，我是说`、`——`；
  - 理智化：`那个`、`应该是`；
  - 被动攻击：`呵`、`不是，我是说`；
  - 焦虑型：`那个……那个`；
  - 戒备回避：只给停顿、半截话；
  - 失组织：`呃`、`就……就`、`——`。
- 风险轮或 `maxEvents <= 0` 返回空计划：安全信息优先清楚，不靠不流利撑真人感。
- 同输入确定性输出；计划只给候选与上限，**不强制发生**。
- prompt 事件行由 `buildRealismEventPromptLine()` 统一生成，`active` 才注入。

### 2.2 话轮形态审计

新增 `src/shared/realism/visitor-realism-audit.ts`：

- 六类事件计数有优先级：`repair > trailoff > repetition > elongation > pause > filler`；一个文本位置只归一类。
- 合法叠词白名单：看看/想想/说说/试试/聊聊/走走/坐坐/慢慢/常常/刚刚/妈妈/爸爸/谢谢/再见/一点点/一些些/好好/多多/少少/轻轻/静静/深深。
- 严格改口只认「不对，我是说 / 我是说 / 应该是 / 换个说法 / 不是…而是」，不把「是不是」和普通否定算成 repair。
- 硬违约集合：`too_long`、`missing_question_back`、`missing_repair`、`over_quota`。
- 阈值：
  - `short_answer_then_silence`：超过 2 句、超过 4 个逗号分句或超过 100 字；
  - `fragment_then_stop`：超过 100 字；
  - `text_short`：超过 3 句或 140 字；
  - 全局：超过 3 句或 260 字。
- `question_back` 必须有问号；`correct_self_mid_sentence` 必须有严格 repair；配额按合计与单类双重检查。
- 风险轮跳过形态/配额强判。

**关键取舍：硬违约只留“能明确判”的，其余降为软信号。**

- `guarded_deflection` 的「有没有挡回」是**软信号** `missing_deflection`：只记录、不重试。原因：话轮形态是可选建议，不是逐字合同；历史离线审计里“半句必须不完整”“戒备必须挡回”曾把 98%～100% 的正常台词判成违约，机械逼迫会直接造出假口语。
- 审计日志同时输出 `violations=` 与 `signals=`；软信号用于观察 prompt 引导是否生效，不参与重试。
- 这样任务要求的五类问题都“能识别”，但只有四类硬违约会触发重说。

### 2.3 共享运行态

新增 `src/engine-adapters/rendering/visitor-realism-runtime.ts`：

- `resolveVisitorRealismRuntime(spec)` 统一从 spec 解析场景、角色、状态、风险、mode，产出同一份 profile 与 eventPlan。
- prompt 层和生成层看到同一份计划，避免“注入一套、审计另一套”。
- 默认场景仍是 `{ mode: 'in_person' }`；线上必须显式登记。

### 2.4 生成侧重试

修改 `src/engine-adapters/rendering/llm-render.adapter.ts`：

- 聚合路径：安全 guard 放行后调用 `settleRealism()`；只有 `active` 模式在明确违约时重试一次。
- 重试方式：把「本轮重说要求」追加到 system message，由模型重新生成；不改写原台词、不随机注入文本、不拼接模板句。
- 重试后仍违约：接受可读文本并记 `retry-accept`，不降级成「我先缓一下」这类兜底句。
- 重试后若 guard 命中 block：安全优先，走 `degrade`。
- usage 合并两次调用；`fallbackUsed=true`。
- `audit` 只审计不重试；`off` 完全不审计。
- 流式路径只在收尾审计一次，绝不重试、不撤回已出声文本。
- **安全 block 后的 `regenerate()` 也接回 `settleRealism()`**：block 重生成不再是绕过 R2 的后门；重生成与真人度重试都使用降温后的参数。
- 日志只打 mode/scene/role/state/shape/违约类型/软信号/事件计数，不打印台词原文。

## 3. 改动文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/shared/realism/realism-event-plan.ts` | 新增 | 六类口语事件计划与 prompt 事件行 |
| `src/shared/realism/visitor-realism-audit.ts` | 新增 | 事件计数、硬违约、软信号 |
| `src/engine-adapters/rendering/visitor-realism-runtime.ts` | 新增 | profile/eventPlan 共享运行态 |
| `test/auto-practice/af208-realism-event.spec.ts` | 新增 | 5 项：事件计划确定性、风险轮为空、prompt 端到端 |
| `test/auto-practice/af208-realism-audit.spec.ts` | 新增 | 11 项：计数优先级、严格改口、白名单、硬违约、软信号、风险跳过 |
| `test/engine-adapters/af208-realism-retry.spec.ts` | 新增 | 7 项：active 重试、仍违约接受、off/audit 零额外调用、流式只审计、block 重生成仍审计 |
| `src/shared/realism/visitor-realism-profile.ts` | 修改 | profile 增加 `eventPlan`；active 增加事件层 |
| `src/shared/realism/index.ts` | 修改 | 导出 R2 API |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | 修改 | 改用 runtime；日志增加 eventPlan |
| `src/engine-adapters/rendering/llm-render.adapter.ts` | 修改 | 生成侧审计、最多一次重试、usage 合并、block 重生成接回审计 |

未触碰：`src/engine-core/**`、`admin-dashboard/**`、Flutter 仓库、`.env` / `.env.example`（本单不新增 env 键）。

## 4. 闸门（真实执行）

| 命令 | exit | 结果 |
| --- | --- | --- |
| `pnpm exec vitest run test/auto-practice/af208-realism-event.spec.ts test/auto-practice/af208-realism-audit.spec.ts test/engine-adapters/af208-realism-retry.spec.ts` | 0 | 3 files / 23 tests passed |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm exec eslint --no-cache "{src,test}/**/*.ts"` | 0 | 0 error / 0 warning |
| `pnpm test` | 0 | 229 files passed / 1 skipped；4018 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | — | 空 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 0 | 活跃=0 / 归档=220 / 记录包=220 / 无任务单=14 |

机器状态：Node `v22.23.2`，pnpm `9.15.0`；项目声明 `node >=26`，出现 Unsupported engine 警告，但命令均正常执行。

## 5. 历史导出离线复核

用 R2 审计器对两份用户导出做离线复算。重建口径：用 `bdiSnapshot` 重建 trust/arousal/三类 resistance；角色按缺省 `restrained`；场景按产品默认 `in_person`；`active`；`crisisDetected` 命中按风险轮跳过。

| 文件 | visitor 台词 | 通过 | 硬违约 | 违约率 | 违约原因 | 软信号 `missing_deflection` | 风险轮 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `auto-practice-FzkJ9Z15n10nNUed1hWv_.json` | 52 | 44 | 8 | 15.4% | `too_long` 8、`over_quota` 1 | 4 | 1 |
| `auto-practice-fJI3UtvAl6u1Ss34JViWq.json` | 17 | 15 | 2 | 11.8% | `too_long` 2、`over_quota` 1 | 14 | 3 |

说明：

- 违约数按“有台词失败”计；原因数可大于违约数（同一条台词可同时 `too_long` + `over_quota`）。
- 该复算是**离线近似**：第二份导出没有完整风险信号，角色也只能按缺省推断；比例只能用于判断“主要残留是过长”，不等于生产真实重试率。
- 软信号 `missing_deflection` 高（第二份 14/17）说明 prompt 里 `guarded_deflection` 的挡回引导还不稳定；本单按设计**不重试**，留到 R3 用场景/角色矩阵继续调，不用硬规则逼台词。

## 6. 运行口径

- 默认：`RENDER_REALISM_MODE=off`，生产行为不变。
- 影子批次：`audit`，只算不注入、只记日志、不重试。
- 验收批次：`active`，注入事件层；硬违约最多重试一次。
- 线上场景：显式传 `encounter={ mode:'online', channel:'voice'|'video'|'text' }`；不传就是面对面。
- 回滚：`RENDER_REALISM_MODE=off` 即可；R2 不新增 env 键。

## 7. 残留与下一步

1. **R3—R5 未实施**：场景矩阵扩展、临床规则细化、度量与 AI 双盲验收仍在后续任务；本单不宣称临床有效性验收，只到“临床代理门槛 + 工程闸门”。
2. **无真实模型批次**：本单证据是确定性单测 + 历史导出离线复算，没有跑真实 LLM 批量；真实重试率与读感需在 `active` 验收批次观察。
3. **软信号不闭环**：`missing_deflection` 只记录、不重试；若 R3 要提升挡回遵从率，应改 prompt/场景策略，不应把它升级成硬违约。
4. **repair 口径断代**：`counts.repair` 已是严格改口口径，历史批次 `repair_per_turn` 与新批次不可直接对比；历史快照未回溯。
5. **默认仍 off**：验收批次必须显式把 env 切到 `active`，否则看到的还是旧行为。
6. **人工/临床验收边界**：按用户口径，本阶段不考虑真人督导；AI 双盲与临床代理门槛在 R5 单独立项。

## 8. 一行 commit message

`feat(af208): 来访者真人度 R2 口语事件计划、话轮形态审计与生成侧一次重试`
