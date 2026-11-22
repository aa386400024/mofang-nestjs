# AF-187 · 自动对练场景建模与输出完整性闸门

- 任务：AF-187（`phase2.5-orchestration-closed-loop`）
- 类型：fix
- 基线：`4ca4dbe5c772bccc9bf1a3c73ad0dbc4a0e49866`（AF-186 / PR #58 合并点）
- 分支：`task/AF-187-encounter-scene-output-integrity`
- 日期：2026-11-20
- 结论：技术结论 `passed`；任务状态 `rejected`（租约过期），交付入账由 AF-188 承接（AI 代理口径，非临床达标）。

## 1. 问题来源

用户导出两场自动对练逐字稿，暴露的不是单点文案问题，而是四层缺陷叠加：

| 层 | 现象 | 根因 |
| --- | --- | --- |
| 场景 | 默认像线上打字聊天，缺少面对面咨询室的在场感 | 场景没有落成会话级配置；来访者提示词只写“像真实的人聊天”，咨询师开场硬编码“咨询室场景”，媒介词随模型自由发挥 |
| 输出 | 来访者复述整段 prompt；咨询师以 `We need respond in Chinese...` 开头；出现韩文/英文/`passation`；`mild`、`staying safe`、`NAC?` | 落历史前没有输出完整性闸门，坏文本进逐字稿后继续污染下一轮上下文 |
| 风险 | 危机收束连续多轮重复“移开药和刀、联系家人、不要独处、安全计划”整套模板 | 按单轮缺项判断，没有会话级覆盖账本 |
| 收尾 | 两场均 `completed + crisis_practice_max + crisisEnded=false`，但第二场已完成热线、开门、收危险物 | 终态只有布尔值，没有可读的危机结论 |

用户口径：**两种场景都要支持，默认必须是面对面咨询室；线上风格只能由系统按场景开启；其他场景要预留；其余大小问题一并修。**

## 2. 实现主线

### 2.1 场景一级配置（`src/shared/encounter/encounter-scene.ts`）

- 内置 `in_person`（默认）与 `online` 两种模式；`online` 再分 `video` / `voice` / `text` 三个子通道。
- 场景由注册表驱动：新增模式只在注册表加条目并扩类型，调用链不变。
- 同一份场景契约同时供两侧使用：
  - 来访者块约束媒介词、在场感、可用的节奏表达；
  - 咨询师块约束“看得见/听得到/只能读文字”的能力边界；
  - 首轮开场提示按场景生成，不再硬编码咨询室。
- `in_person` 明确禁止“看到屏幕/收到消息/关掉麦克风”等线上媒介词；`online` 按子通道只放开对应媒介词，`text` 通道禁止出现“画面、镜头、语音”等越界描述。
- 无场景调用路径（legacy debug、旧测试）不注入任何场景块，旧 prompt 逐字不变。
- 来访者“说话方式”文案也按场景切换：面对面写“像在咨询室里面对面说话”，线上写“像在远程咨询里说话”，避免线上场先被面对面文案带偏。
- `detectEncounterDrift()` 作为软检测：面对面出现线上媒介词即降级重试，线上出现“同一个房间/面对面”等错位描述同样拦截。

### 2.2 输出完整性闸门（`src/shared/text/output-integrity.ts`）

在**写入逐字稿之前**统一判定，命中非法则先重试一次，仍非法则用安全短句兜底并标 `degraded`，坏文本绝不进 `history`：

- 合法台词里夹带**已闭合** `<think>` 推理块时，只剥离推理块、正文照常落库，不整段替换；
- 剥离模型自带的 reasoning 块；
- 先忽略协议标记（`[sigh]`、`[[STATE:...]]`）再判外语，避免误伤合法舞台指令；
- 检测 prompt 复述标记（“硬规则”“这一轮怎么说”“上一轮咨询师说”“你心里坚信”等）；
- 检测无标签推理开头（`We need ...` / `The user ...` / `I should ...`）；
- 检测角色标签泄漏（`来访者：`、`咨询师：`、`Assistant:` 等整段带标签输出）；
- 检测韩文/日文/西里尔/阿拉伯文字，以及异常拉丁词（≥4 字母，白名单含 CBT/PHQ/GAD/SUDS 等量表缩写）；
- 检测全大写疑问缩写（`NAC?`）；
- 检测场景漂移。

闸门覆盖两条入口：
1. runner 落历史前（来访者与咨询师两侧）；
2. 来访者候选重生成路径（`llm-render.adapter`）与咨询师生成路径（`counselor-agent.service`）——非法候选直接 block 或提预算重试，避免坏输出被选中。

空来访者回复（如阻断轮）原样返回，不再被兜底改写成“出声”。

### 2.3 风险收束会话级账本（`practice-runner.service.ts` + `session-structure-audit.ts`）

- 新增 `riskGroupsCoveredByHistory(history, crisisFirstTurn)`：只统计危机披露**之后**的咨询师台词（披露轮本身的咨询师前台词也排除），避免把披露前的安全计划算成本次覆盖。
- `completeRiskClosingText(text, coveredBefore)`：只补历史未覆盖的组，整场至少补一次、且不重复粘贴同一套模板。
- 原有“每轮重贴”的测试断言同步改为“整场至少补一次且只补一次”。

### 2.4 危机收尾可读结论

- 新增 `crisisOutcome`：`none / safety_plan_completed / escalated / incomplete`。
- 终态同时保留旧 `crisisEnded` 语义，兼容旧查询与前端。
- `crisisOutcome` 落库并随 `session_end` 事件下发，单场详情与列表直接返回三列。

### 2.5 请求与持久化链路

- 单场/批量接口新增 `encounterMode` / `encounterChannel`；缺省 `in_person`，`online` 缺省 `video`，非法值明确报错。
- 批量任务 `AutoPracticeJobData.encounter` 原样透传到 worker 与 runner。
- 管理后台增加场景选择器（面对面 / 线上 + 视频 / 语音 / 文字）、批量场景控件、场次行场景标签、危机结束原因中文标签。
- 导出的 JSON 补齐 `encounterMode / encounterChannel / encounterLabel / exitReasonLabel / crisisOutcome / crisisOutcomeLabel`，避免再出现“`crisisEnded=false` + 危机结束原因”读感矛盾；场次行同时展示中文危机结论。
- 迁移 `1714900000048-AddEncounterAndCrisisOutcome`：`ap_practice_sessions` 新增 `encounter_mode`（NOT NULL DEFAULT `in_person`）、`encounter_channel`（NULL）、`crisis_outcome`（NULL），存量回填 `in_person`；已注册 `bin/ormconfig.ts` 并执行成功。

## 3. 改动文件

新增：

- `src/shared/encounter/encounter-scene.ts`
- `src/shared/text/output-integrity.ts`
- `src/migration/1714900000048-AddEncounterAndCrisisOutcome.ts`
- `test/auto-practice/af187-encounter-output-integrity.spec.ts`（22 个回归用例）

修改（后端）：

- `src/engine-adapters/rendering/turn-render-orchestrator.ts`
- `src/engine-adapters/rendering/render-risk.ts`
- `src/engine-adapters/rendering/spec-assembler.ts`
- `src/engine-adapters/rendering/llm-render.adapter.ts`
- `src/engine-adapters/wiring/engine-turn.service.ts`
- `src/auto-practice/practice-runner.service.ts`
- `src/auto-practice/counselor-agent.service.ts`
- `src/auto-practice/counselor/builder/counselor-prompt-builder.ts`
- `src/auto-practice/counselor/dto/counselor-types.ts`
- `src/auto-practice/metrics/session-structure-audit.ts`
- `src/auto-practice/auto-practice.controller.ts`
- `src/auto-practice/practice-queue.service.ts`
- `src/auto-practice/entities/practice-session.entity.ts`
- `src/auto-practice/ports/turn-engine.port.ts`
- `src/auto-practice/adapters/debug-turn-engine.adapter.ts`
- `src/auto-practice/auto-practice.events.ts`
- `src/admin-debug/debug-session.service.ts`
- `src/admin-debug/debug-session-store.ts`
- `bin/ormconfig.ts`
- `test/auto-practice/practice-runner-decide-turn.spec.ts`

修改（前端）：

- `admin-dashboard/src/api/client.ts`
- `admin-dashboard/src/api/types.ts`
- `admin-dashboard/src/views/AutoPractice.vue`

`src/engine-core/` 零 diff。

## 4. 回归语料

两个导出文件中的坏样本全部转成固定断言：

- 来访者整段复述 prompt；
- `We need respond in Chinese...` 推理泄漏；
- 韩文/英文混排与 `passation`；
- `mild` / `staying safe` / `NAC?`；
- 面对面输出出现“收到你的消息”等线上媒介词；
- 线上文字通道输出“能看到画面”；
- 协议标记 `[sigh]` / `[[STATE:...]]` 不被误判为外语；
- 危机前历史不得充抵本次安全计划覆盖。

## 5. 闸门数字（真实输出）

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | exit 0，0 error / 0 warning（含 `scripts/**` 配置） |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm test -- test/auto-practice/af187-encounter-output-integrity.spec.ts` | exit 0，22 tests passed |
| `pnpm test` | exit 0，223 files passed + 1 skipped；3949 tests passed + 4 skipped |
| `admin-dashboard pnpm type-check` | exit 0（`vue-tsc --build` 无输出） |
| `git diff --stat HEAD -- src/engine-core` | 空 |
| 迁移执行 | `AddEncounterAndCrisisOutcome1714900000048 has been executed successfully` |

首次全量测试出现 8 个失败（闸门误伤协议标记/空回复、风险去重旧断言、调试标题用例并行超时），修复后复跑全绿；调试标题用例单跑绿，全量首轮偶发超时，复跑已绿。

## 6. 与任务单的偏差

| 项 | 任务单 | 实际 | 理由 |
| --- | --- | --- | --- |
| 场景模式 | 默认面对面，线上三通道 | 一致；线上缺省子通道固定 `video` | 用户未单独拍板默认子通道；`video` 最贴近真实远程咨询，先固定并在场景注册表集中管理 |
| 第三场景 | 预留 | 注册表含类型扩展位，未开放 `home_visit` 等条目 | 没有真实使用方就不先造场景，避免空分支 |
| 前端验证 | 未要求 | 只跑 `vue-tsc`，未跑 `build-only`，未在浏览器点选 | 前端不在本任务主链路；真实点选留待灰度验收 |
| 流式输出 | 未要求实时拦截 | 只在落历史前与候选重生成路径拦截 | 已吐出的流式 token 无法撤回；展示侧过滤另立需求 |

## 7. 未完成 / 遗留

- 迁移命令本身成功，但本地 `.env` 直连因 `DB_DATABASE` / `DB_USERNAME` 读空未能做列级 SQL 复验；如需复验应以 `bin/ormconfig.ts` 的配置加载方式查询。
- `crisisOutcome` 目前落库、进事件、前端类型可选，未在列表/详情增加独立展示列。
- 线上默认子通道、第三场景开放、流式展示侧过滤，均未在本任务拍板。

## 8. 结论边界

本任务只证明：场景由系统显式控制、坏输出不进逐字稿、风险收束不机械重复、危机收尾有可读结论，并有回归用例与全量闸门。**不构成临床达标、真人督导或双标结论**，AI 结果仍只作 `ai_proxy_candidate`。
