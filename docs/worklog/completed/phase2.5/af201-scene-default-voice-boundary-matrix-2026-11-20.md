# AF-201 · 自动对练默认语音与坏咨询师边界矩阵交付

- 任务：AF-201（`phase2.5-orchestration-closed-loop`）
- 类型：fix
- 基线：`7b16f69654c500df1ea9807f0f35ea6a90f312a7`
- 分支：`task/AF-201-scene-default-voice-boundary`
- 日期：2026-11-20
- 前序：AF-200（scope 漏列 `src/auto-practice/auto-practice.controller.ts`，已 `canceled` 并归档；本单按框架重签发）
- 结论：技术交付 `passed`；AF-200 的 `canceled` 历史原样保留，不回写

## 交付内容

### 线上默认语音

- `src/shared/encounter/encounter-scene.ts`：`online.defaultChannel` 由 `video` 改为 `voice`；非法通道回落同步为 `voice`；线上基础开场提示改为“电话那头”；
- `src/auto-practice/auto-practice.controller.ts`：单场/批量请求在 `online` 未给 `encounterChannel` 时回落 `voice`，不再由控制器写死 `video`；
- `admin-dashboard/src/views/AutoPractice.vue`：单场与批量场景选择器默认通道改为 `voice`；历史 `online` 且 `encounterChannel` 为空的会话按语音展示；
- `in_person` 仍是全局默认，legacy 无场景调用不注入任何场景块，行为逐字不变。

### 坏咨询师边界矩阵

新增 `test/auto-practice/af200-scene-boundary-matrix.spec.ts`（矩阵在 AF-200 首次建立，随 AF-201 重签发保留原文件名作为审计链）：

- 覆盖 7 种咨询师模式：`expert / intermediate / novice / chatty / cold / preachy / nonsense`；
- 覆盖 3 种接触方式：`in_person / online voice / online text`；
- 共 21 个确定性组合，断言：
  - 模式 `systemPrompt` 不被场景块覆盖，模式身份签名保留；
  - 来访者场景契约与咨询师模式解耦；
  - 聊家常、胡说八道、冷漠、说教等合法怪话不被输出闸门误杀；
  - 坏咨询师把媒介带偏时，`detectEncounterDrift()` 必须命中；
  - 跨场景台词在 `inspectGeneratedOutput()` 中判 `scene_drift`；
  - 正常场景台词不误报；
  - `online` 缺省为语音，视频必须显式选择。

### 不在本单范围

- 真实模型 24 场批量压测与 AI rubric 评分；
- 已吐出的流式 token 撤回/展示侧过滤；
- 第三场景（家庭走访/电话）正式开放。

## 改动文件

修改：

- `src/shared/encounter/encounter-scene.ts`
- `src/auto-practice/auto-practice.controller.ts`
- `admin-dashboard/src/views/AutoPractice.vue`
- `test/auto-practice/af187-encounter-output-integrity.spec.ts`

新增：

- `test/auto-practice/af200-scene-boundary-matrix.spec.ts`
- `docs/worklog/completed/phase2.5/af201-scene-default-voice-boundary-matrix-2026-11-20.md`

`src/engine-core/` 零 diff。

## gateResults

| 命令 | 退出码 | 数字 | 定性 |
| --- | --- | --- | --- |
| `pnpm exec eslint --no-cache "{src,test,bin}/**/*.ts"` | 0 | 0 error / 0 warning | 无缓存全量通过 |
| `pnpm typecheck` | 0 | 0 error | 通过 |
| `pnpm --dir admin-dashboard type-check` | 0 | 无输出 | `vue-tsc --build` 通过 |
| `pnpm test -- test/auto-practice/af187-encounter-output-integrity.spec.ts test/auto-practice/af200-scene-boundary-matrix.spec.ts` | 0 | 29 tests passed | 22 例场景/完整性 + 7 例边界矩阵 |
| `pnpm test` | 0 | 224 passed + 1 skipped files；3956 passed + 4 skipped tests | 全量通过 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 0 | 活跃=1 归档=212 记录包=213 | PASS |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空 | 纯层零改动 |

## scopeCheck

`in-scope`。本单 scope 已显式包含 `src/shared/encounter/`、`src/auto-practice/auto-practice.controller.ts`、`admin-dashboard/src/`、`test/auto-practice/` 与本任务的交付记录/记录包；编排状态面按框架 V7 口径豁免。

## contractChecks

- `taskId`：AF-201 贯穿任务单、回执、交付记录、状态索引与事件日志；
- `state-write`：登记/提级/领取/取消/归档均经 CLI；
- `index-schema`：任务单 frontmatter 与回执六组齐全；
- `event-chain`：AF-200 的 `canceled` 与归档事件原样保留，不手改 journal/index；
- `engine-boundary`：`src/engine-core` 零 diff。

## backlogItems

- `BL-AF201-01`：真实模型 24 场边界批次（4 模式 × 3 场景 × 2 来访者）未执行，需下一任务单接入 AI rubric。
- `BL-AF201-02`：流式已吐 token 不撤回，展示侧过滤仍待独立任务。
- `BL-AF201-03`：第三场景（家庭走访/电话）只留注册表扩展位，未开放条目。
- `BL-AF201-04`：迁移 `AddEncounterAndCrisisOutcome1714900000048` 的列级 SQL 未人工复验。

## deviationTable

| 项 | 任务单 | 实际 | 理由 |
| --- | --- | --- | --- |
| 任务标识 | AF-200 | AF-201 | AF-200 scope 漏列控制器，按框架重签发，避免原地改 scope |
| 边界矩阵文件 | 新测试 | 文件名保留 `af200-` 前缀 | 矩阵在 AF-200 首次建立；保留前缀作为审计链，测试内容归属 AF-201 |
| 真实模型批次 | 建议 24 场起跑 | 本单只落确定性矩阵 | 真实批次需要 LLM 配额与 rubric 任务单，不在本单伪造 |
| 前端验证 | 默认语音 | 只跑 `vue-tsc` | 未做浏览器点选，留灰度 UI 验收 |

## reviewVerdict

`passed`

线上缺省由“控制器 + 注册表 + 前端”三处统一为语音，视频仅显式选择；坏咨询师模式从“有种子、无验收”变为 21 个确定性组合的固定回归，且不写死模型台词。29 例定向与 3956 例全量通过，lint/typecheck/前端类型检查/worklog strict 均通过，`engine-core` 零 diff。真实模型批次与 AI rubric 仍作为下一任务单的验收面，不冒充本单已完成。
