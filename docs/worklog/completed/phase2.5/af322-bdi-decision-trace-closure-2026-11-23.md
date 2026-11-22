# AF-322 · BDI 决策与留痕闭环

- 交付日期：2026-11-23
- 工作树：`D:\work\Project\backend\mofang-nestjs-af281r`
- 分支：`task/AF-322-bdi-decision-trace`
- 基线：`28d63aab08e14e1ae4e5b58eac3dc6e5d45a5156`
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-322/task-sheet.md`
- 任务状态：`submitted` → 回执摄入后由 CLI 转 `completed` 并归档

## 1. 结论

本单把 8 场 20 轮调试 trace 暴露的三类缺口一次补齐，验收口径是 AI 层确定性测试，不做临床有效性宣称：

1. **决策层**：规则轨现在能按可注入门槛产出 `insight` 与 `discussing_plans`；探索门槛下调改成 `understood / accepted` 双信号，不再用平均值近似；`discussing_plans` 优先于 `insight`，避免后段锁在领悟。
2. **在场状态**：`holding_present` 与 `cold_absent` 从零 delta 改为小幅、方向明确的基础 delta，单回合低于 delta cap，20 轮累积不越界。
3. **跨会话移情**：移情三维按可配置半衰期回落，缺省 90 天、显式 `0` 可禁用；核心信念、短期/记忆信念与欲望不衰减。
4. **生产留痕**：`TurnTrace` 追加移情三维、核心信念激活峰值、意图策略与理由；空值/非有限值确定性降级，既有字段名不动。
5. **运行口径可观测**：admin debug 会话摘要返回 classifier 模式、模型标识、参与轮数与降级轮数；observer 同步维护会话级 Redis 计数，读不到时回零不抛 500。

## 2. 闸门结果（gateResults）

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/engine-core/af322-bdi-residual-closure.spec.ts test/engine-adapters/af322-bdi-residual-closure-adapter.spec.ts test/admin-debug/af322-trace-projection.spec.ts test/engine-core/wp36-session-decay.spec.ts test/engine-adapters/wp42-alliance-config.spec.ts test/config/wp25-env-example-coverage.spec.ts` | 6 文件通过；89 例通过 |
| 追加定向：`wp58-debug-session` / `d2-event-kind-split` / `model-event-classifier` | 9 文件合计 191 例通过；分类器单文件 69 例通过（含新增 stats 写入 1 例） |
| `pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/af322-tcheck-full.tsbuildinfo` | exit 0；与 CI Typecheck 同口径 |
| `pnpm lint` | exit 0；0 error / 0 warning（含 scripts 配置二次 lint） |
| `pnpm test` | 287 文件通过 / 1 跳过（288）；4429 例通过 / 4 跳过（4433）；21.20s（含新增 stats 写入 1 例） |
| `node scripts/orchestration/cli.mjs events verify` | 回执摄入后执行，以 CLI 输出为准 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 回执归档后执行，以 CLI 输出为准 |

## 3. 范围核对（scopeCheck）

- 结论：`in-scope`。
- 决策层：`src/engine-core/cognition/alliance-config.ts`、`intention-planner.ts`、`state-transition.ts`、`src/engine-core/domain/engine-session.types.ts`。
- 跨会话衰减：`src/engine-core/cognition/session-decay.ts`、`src/engine-adapters/wiring/session-decay.config.ts`。
- 装配与留痕：`src/engine-adapters/wiring/alliance-config.ts`、`engine-stream-backend.adapter.ts`、`src/admin-debug/trace-recorder.service.ts`、`debug-session.service.ts`、`src/engine-adapters/cognition/model-classifier-observation.ts`。
- 配置与测试：`.env.example`、`test/engine-core/af322-bdi-residual-closure.spec.ts`、`test/engine-adapters/af322-bdi-residual-closure-adapter.spec.ts`、`test/admin-debug/af322-trace-projection.spec.ts`、`wp36-session-decay.spec.ts`、`wp42-alliance-config.spec.ts`、`wp25-env-example-coverage.spec.ts`、`s1-open-depth-threshold.spec.ts`、`d2-event-kind-split.spec.ts`、`wp58-debug-session.spec.ts`、`model-event-classifier.spec.ts`。
- `src/engine-core/**` 有改动：由任务单 §2.1–§2.3 明确授权，属于本单核心目标，不是越界；`git diff --stat HEAD -- src/engine-core` 为 5 文件 / +206 / -37，全部落在授权范围。
- 未改：模型轨 prompt 与判定口径、生产来访者模型、管理台成本字段。
- 未纳入提交：`data/phase25-exit/*` 四个历史取证目录、`docs/worklog/records/.../AF-321/`。

## 4. 契约核对（contractChecks）

| 契约项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | AF-322 经 CLI 登记、promote、run-once 领单；分支名与提交标题只含一个任务号 |
| state-write | pass | 状态索引、事件链、快照均经 CLI 生成，未手改 `task-state-index.json` / `journal.jsonl` |
| scope | pass | 所有源码、测试、配置、记录文件在任务单声明的文件域内 |
| engine-core-auth | pass | 纯层改动由任务单明确授权，仅覆盖决策门槛、在场 delta、移情衰减三类确定性问题 |
| mirror-contract | pass | `OpenEngineSessionInput['allianceThresholds']` 与 `AllianceThresholds` 保持 1:1，`s1-open-depth-threshold` 镜像断言同步 |
| trace-compat | pass | `TurnTrace` 只追加可选字段；`VoiceCatchUpBdiSnapshot` 五字段契约不变，补漏帧不携带新字段 |
| privacy | pass | 分类器统计只写计数与模型标识；trace 不新增原文、命中词或心理内容 |
| classifier-observability | pass | 详情返回模式/模型/计数；Redis 读失败回零；observer 写失败只 warn |
| env-coverage | pass | `.env.example` 新增 3 键，`wp25-env-example-coverage` 27 同盟键 / 4 衰减键断言通过 |
| clinical-boundary | pass | 所有门槛与 delta 均为工程种子值；未宣称临床有效性；真人督导标定独立排期 |

## 5. 偏差表（deviationTable）

| 任务单说 | 实际做法 | 理由 |
| --- | --- | --- |
| 分类器摘要只需返回模式、降级计数、模型标识 | 额外返回 `totalCount`，并在 observer 增加会话级 Redis 计数键 | 只有降级数没有总轮数无法算降级率；灰度核对需要分母 |
| `holding_present` delta 为 safety/bond/verbal 三项 | 同时补 valence +0.004 / arousal -0.002 | 在场状态若只动安全与联结、不动情绪，20 轮后仍会被判“情绪未缓和”；幅度仍低于 cap |
| `cold_absent` delta 为 trust/safety/bond 三项 | 同时补 verbal/depth/style/valence/negative | 冷落在真实会话里表现为表达收缩与负性上升；只降信任无法覆盖 |
| `pnpm typecheck` 作为闸门 | 本地跑 CI 同口径 `tsc --noEmit -p tsconfig.json`，并记录 `pnpm typecheck` 只覆盖 src 的现状 | 避免 AF-320 同类 TS18048 漏到远端；脚本口径由 AF-323 统一 |
| 只要求分类器摘要读取投影 | 追加 observer 写入计数的单测 | 只测读不测写会留下“键永远为空”的盲区 |
| 任务单未列 `wp58` / `d2` / `model-event-classifier` | 纳入定向回归 | 三处分别覆盖分类器摘要、事件 delta、observer 统计，属于本单直接面 |

## 6. 遗留登记（backlogItems）

1. `AF322-B1`：移情半衰期 90 天、`insight` 第 8 轮、`plan` 第 12 轮、`control >= 0.55`、`observed confidence >= 0.6`、holding/cold delta 幅度均为工程种子值，需真人咨询师督导复核后才能称为临床标定。
2. `AF322-B2`：真实语料影子审计尚未执行；`ENGINE_MODEL_CLASSIFIER_*` 未在本地 `.env` 配置；审计脚本归 AF-323。
3. `AF322-B3`：真实语料一致性口径是规则轨 vs 模型轨，不是人工金标准；必须同时看 Jaccard、核心标签重合、neutral 率与 degraded 率，不能只看 exact 一致率。
4. `AF322-B4`：`TurnTrace.intention.rationale` 尚无长度上限与空串约束；当前由 planner 产出固定短语，后续接自由文本时需要裁剪。
5. `AF322-B5`：管理台成本 `totalCost` / `totalCostCny` 兼容仍为既有技术债，与本单无关。
6. `AF322-B6`：`typings/global.d.ts` 的 env 声明、`package.json` typecheck 全量口径、分支名任务号护栏归 AF-323。

## 7. 验收结论（reviewVerdict）

`passed`。决策层、在场状态、跨会话移情、生产 trace 与分类器可观测性五条链路均有确定性用例覆盖；定向 191 例、全量 4429 例、lint、CI 同口径 typecheck 全绿。所有临床门槛明确标注为工程种子，未宣称疗效；真人督导复核与真实语料审计作为非阻塞遗留进入 AF-323 与后续临床排期。

## 8. 提交信息

`feat(af322): 闭合 BDI 决策、在场事件、移情衰减与生产留痕`

实现提交 SHA 由回执 `changedFiles.commits` 记录。
