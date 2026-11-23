# AF-349 · BDI 决策链语义与状态机制修复批次 · 交付记录

- 任务：`AF-349`（`phase2.5-orchestration-closed-loop`）
- 分支：`task/AF-349-bdi-semantic`（自 `integrate` `3e3b98c7` 切出）
- 基线：`b7ce8628e599c6c5367e3240bfd3c6b19a22c07e`（AF-345 合并）
- 类型：implementation
- 交付日期：2026-11-23
- 环境：Windows / PowerShell 7.6.4 / node v26.13.1 / pnpm 9.15.0

## 1. 交付摘要

本批次把 BDI 决策链中**能由代码与现有语料闭环**的四块结构缺口一次落地，并保留旧口径的逐字回退能力：

1. 规则事件分类器语义 v2：否定抑制、长词遮盖消歧、强度折算；生产装配缺省 v2，legacy 逐字保留。
2. 愿望演化与情境愿望：事件信号驱动的底层愿望缓慢更新，以及带 TTL 的情境愿望。
3. 跨轮意图锁：锁策略跨轮复现，保护性策略当轮覆盖并清锁，到期自动失效。
4. 时序权重三条曲线：`linear_decay` / `recency` / `window`，临时快照与落库快照同口径折损。

明确不做：临床幅度标定、100 场审议质量验收、`llm_active` 全量切换、MindGuard 临床层、漂移/版本/成本治理。理由分别是缺真实咨询师逐轮标注、缺批量审议数据、缺质量证据、当前只是 `connected:false` 占位、属 Phase3。

## 2. 实际改动文件

### 2.1 实现

- `src/engine-core/cognition/rule-based-classifier.ts`：新增 `semantics: 'legacy' | 'v2'`；v2 否定作用域、反问/双重否定例外、长词遮盖、强度 `0.6`；legacy 路径逐字保留。
- `src/engine-core/domain/desires.ts`：新增 `DesireEvolutionConfig`（缺省关闭）、`evolveDesires` 纯函数、事件→愿望信号表、情境愿望 TTL；复用 `domain/emotion.ts` 的唯一 `clamp01`。
- `src/engine-core/domain/intention.ts`：新增 `IntentionLock` 类型；修正头部过期注释。
- `src/engine-core/domain/bdi-snapshot.ts`：`BdiSnapshot` 可选 `intentionLock`；clone 与 applyDelta 显式带过，避免每轮落库清锁。
- `src/engine-core/cognition/intention-planner.ts`：新增锁配置、`resolveActiveIntentionLock`、`nextIntentionLock`；保护性策略覆盖并清锁；到期失效。
- `src/engine-core/cognition/state-transition.ts`：`resolveTimingWeight` 三条曲线；导出 `resolveTimingWeight` / `scaleDeltaVector`；cap 后折损。
- `src/engine-core/in-memory/in-memory-engine-session.ts`：愿望/锁构造选项；临时快照与落库快照各演化一次；落库路径在 cap 后按同一权重折损；落库锁写入。
- `src/engine-adapters/wiring/engine.providers.ts`：生产端口缺省注入 `RuleBasedClassifier({ semantics: 'v2' })`；显式 `tuning.classifier` 优先；注释同步。
- `src/engine-adapters/cognition/model-event-classifier.ts`：`SHARED_RULE_TRACK` 改为 v2，保证审议兜底与模型轨回落同源。

### 2.2 测试与取证

- `test/engine-core/af349-bdi-decision-chain.spec.ts`（新增，19 例）：legacy 双计、v2 遮盖/否定/反问/双重否定/强度、愿望开关与 TTL、锁 TTL 与保护性覆盖、三条曲线、`transitionState` 折损。
- `test/engine-adapters/af349-rule-classifier-v2.spec.ts`（新增，4 例）：共享轨 v2、生产端口缺省 v2、显式 legacy 覆盖、开启愿望/锁后落库快照带情境愿望与锁。
- `test/quality/af349-event-classifier-v2-replay.spec.ts`（新增，3 例）：只统计 counselor 轮、翻转计数、strength 变化单独计数、neutral 率按 legacy 口径。
- `test/engine-core/d3-timing-weight-port.spec.ts`（修改，13 例）：旧“非 none 回退等权”骨架断言改为三条曲线真实折损；会话层断言曲线真实进入落库路径。
- `bin/af347-event-classifier-v2-replay.ts`（新增）：旧 vs v2 同语料对照，只输出会话 id / 轮次 / kind / strength / 统计，不输出原文。

### 2.3 文档

- `docs/worklog/completed/phase2.5/af349-event-classifier-v2-replay-report-2026-11-23.md`：11 场 / 176 轮真实回放报告。
- `docs/worklog/completed/phase2.5/af349-bdi-decision-chain-semantic-hardening-2026-11-23.md`：本交付记录。

## 3. 关键设计决策

### 3.1 legacy 与 v2 双档，而不是直接替换

`RuleBasedClassifier` 保留 `semantics: 'legacy'` 缺省，v2 由生产装配路径注入。这样：

- D-1 基线 spec 继续锁定旧口径，旧快照可复现；
- 生产端口拿到修正后的语义；
- 回放可以在同一进程内逐轮对照，不需要两套代码。

直接替换会让所有旧快照与基线测试同时漂移，无法区分“语义修正”与“回归”。双档是这次能安全交付的前提。

### 3.2 否定抑制不跨标点、不误伤反问和补语

首版按“命中词前 6 字”判定，真实语料回放暴露三类误伤：

- 跨标点：`他没接住，对你来说…` 被 `没` 抑制；
- 反问：`会不会让你觉得…` 被 `不会` 抑制；
- 补语：`停不下来，可能是想…` 被 `不` 抑制。

最终规则：

- 只看当前分句，否定作用域不跨 `。！？；：，`；
- `会不会 / 能不能 / 是否 / 是不是 / 要不要 / 有没有` 结尾不算否定；
- 裸 `不` 只有后接谓词词素（理/觉/想/愿/会/能/需/要/用/必/是/在/该/应/敢/好/对/太/够/知/说/做/来/去/给/让/评/接/关/喜/共/适/习）才按否定；
- 双重否定 `不是不理解你` 不抑制；
- 长词遮盖：短词被更长命中词完全包含时丢弃，`open_probe` 单独保留；
- 强度：命中词前 4 字出现 `有点/稍微/有些/可能/也许/大概/似乎/算是` 时 `strength=0.6`，下游按 `clamp01(strength)` 缩放。

### 3.3 规则轨不读取来访原文（与任务单的偏差）

任务单 successCriteria 写了“上一轮来访话语上下文”。实现时确认内核边界是**事件分类只消费咨询师本轮文本**；把来访原文塞进规则分类器会破坏隐私最小化与纯层边界。

最终选择：

- 规则轨 v2 只做本轮咨询师文本的语义修正；
- `holding_present` / `cold_absent` 的跨轮语义仍由模型轨通过 `recordVisitorTurn` 承担；
- 任务单这一条按偏差登记，不伪装成已实现。

### 3.4 愿望演化与意图锁缺省关闭

两者都是新机制，临床幅度未标定。缺省 `enabled:false`，关闭时逐字返回入参、不写新字段。开启后：

- 每轮单愿望最大变化 `0.02`，基线回拉 `0.01`；
- 情境愿望 TTL `3` 轮、激活阈值 `0.4`；
- 锁 TTL `3` 轮，只覆盖非保护性策略；`resistance / simple_response / request` 当轮覆盖并清锁。

这些数值是工程种子，不是临床标定结果。

### 3.5 时序曲线在临时快照与落库快照同口径

首版只在 `transitionState`（临时快照）接折损，全量测试的会话层护栏暴露落库快照仍等权。修复为：

- `resolveTimingWeight` 与 `scaleDeltaVector` 导出；
- 落库路径在 `applyDeliberationHook` 与 cap 之后，对 `finalDelta` 按同一权重折损；
- cap 报告仍按 `raw → capped` 构造，折损不改变砍幅结论。

这样“意图规划看到的临时状态”与“真正落库的状态”不会漂。

## 4. gateResults

### 4.1 静态闸门

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint` | 0 | 0 error / 0 warning |

### 4.2 定向测试

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm exec vitest run test/engine-core/af349-bdi-decision-chain.spec.ts test/engine-adapters/af349-rule-classifier-v2.spec.ts test/quality/af349-event-classifier-v2-replay.spec.ts test/engine-core/d3-timing-weight-port.spec.ts test/engine-core/boundary.spec.ts` | 0 | 5 文件 / 51 例通过 |
| `pnpm exec vitest run test/quality/d1-event-classifier-evidence.spec.ts` | 0 | 1 文件 / 39 例通过（legacy 基线） |
| `pnpm exec vitest run test/engine-core/kernel-internal-clamp-unify.spec.ts` | 0 | 4 例通过（单一 `clamp01` 守卫） |

### 4.3 全量测试

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm test` | 0 | 301 文件：300 通过 / 1 跳过；4582 例：4578 通过 / 4 跳过 |

首次全量跑出 2 个旧护栏文件 4 例失败，均已按真实语义修复，不是放宽断言：

- `d3-timing-weight-port.spec.ts`：旧断言要求“非 none 形态回退等权”，与本单落地的曲线冲突；改为断言 `linear_decay` / `window` 的零权重路径与 `recency` 的 `1/(1+slope*age)` 折损。
- `kernel-internal-clamp-unify.spec.ts`：机器守卫发现 `domain/desires.ts` 新增第二份 `clamp01`；改为从 `domain/emotion.ts` 导入唯一实现，守卫继续生效。

### 4.4 边界

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/engine-core/boundary.spec.ts` | 12 例通过 |
| `git diff --stat HEAD -- src/engine-core` | 非空；任务单 scope 明列 `src/engine-core/cognition/`、`domain/`、`in-memory/`，属于本单批准例外；`boundary.spec.ts` 11 条断言全部通过 |

## 5. 真实语料回放

- 语料：`data/debug-sessions/` 11 个真实 debug 会话，176 条 counselor 轮。
- legacy `neutral` 107 / 176 = 60.80%；v2 `neutral` 110 / 176 = 62.50%。
- 翻转 4 轮 / 176 = 2.27%；强度变化 0 轮；事件总数 184 → 183。
- 移除 `minimizing` 3、`empathy` 1；新增 `neutral` 3；其中 1 轮 `empathy + minimizing → empathy`。
- 人工复核：3 个 `minimizing` 都在“不会 / 不想 / 不需要”否定作用域；1 个 `empathy` 是“不需要你反复解释”里的 `你反复`。抑制正确。
- 机读结果在 `data/phase25-exit/af349-event-classifier-replay/report.json`，目录未跟踪，不作为仓库交付物。

工程数字只证明语义修正命中面，不证明临床有效性。

## 6. scopeCheck

**结论：`in-scope`。**

改动落在任务单 scope 的以下目录：

- `src/engine-core/cognition/`、`src/engine-core/domain/`、`src/engine-core/in-memory/`
- `src/engine-adapters/cognition/`、`src/engine-adapters/wiring/`
- `test/engine-core/`、`test/engine-adapters/`、`test/quality/`
- `bin/`
- `docs/worklog/completed/`

未改：

- `admin-dashboard/`、Flutter 客户端、`scripts/`
- `.env` / 部署配置 / migration / seed
- `src/engine-core` 之外的业务红线

未暂存 `data/phase25-exit/*`、`data/af349-*.log` 等临时证据。

## 7. contractChecks

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | AF-349 经 CLI register / promote / run-once，状态 `submitted` |
| state-write | pass | 状态面只由 CLI 写；未手改状态索引/事件链 |
| index-schema | pass | 登记与提级由 CLI 完成 |
| engine-core-auth | pass | 任务单 scope 明列 engine-core 三个子目录，boundary 12 例通过 |
| privacy | pass | 回放只输出会话 id / 轮次 / kind / strength / 统计，不输出原文 |
| clinical-boundary | pass | 未宣称临床有效性；愿望/锁/曲线参数标注为工程种子 |
| zero-regression | pass | legacy 缺省、愿望/锁缺省关闭、时序缺省 `none` 均逐字保持旧口径 |

## 8. backlogItems

- `AF349-B1`：规则轨 `holding_present` / `cold_absent` 的跨轮语义仍未实现，需在守住隐私边界的前提下单独设计；当前由模型轨承担。
- `AF349-B2`：愿望演化 `0.02 / 0.01 / TTL 3 / 阈值 0.4` 与锁 TTL 3 均为工程种子，需真实咨询师逐轮标注后标定。
- `AF349-B3`：时序权重 `linear_decay slope 0.1`、`recency slope 0.25`、`window 6` 未做临床斜率标定。
- `AF349-B4`：规则 v2 只在 11 场 / 176 轮 debug 语料回放，尚未在 D-1 96 场 / 1112 轮样本复评。
- `AF349-B5`：审议 100 场质量验收、`llm_active` 灰度切换、MindGuard 临床层未做。
- `AF349-B6`：愿望演化 / 意图锁 / 时序曲线是否在生产默认开启，仍待批次决策；当前全部关闭或 `none`。

## 9. deviationTable

| 任务单写法 | 实际情况 | 处理 | 理由 |
| --- | --- | --- | --- |
| v2 覆盖“上一轮来访话语上下文” | 内核边界规定事件分类只消费咨询师本轮文本 | 规则轨 v2 不引入来访原文；跨轮语义由模型轨承担 | 守住隐私最小化与纯层边界；不把来访原文塞进规则分类器 |
| 时序曲线只要求“三形态纯函数落地” | 首版只接了临时快照，落库快照仍等权 | 落库路径在 cap 后按同一权重折损 | 临时状态与落库状态必须同口径，否则意图规划与落库漂移 |
| 回放脚本放 `bin/`，任务单 artifact 名为 `bin/af347-event-classifier-v2-replay.ts` | 文件名沿用 AF-347 前缀 | 保持任务单路径 | 避免 scope 越域；文件名不影响证据 |

## 10. reviewVerdict

**`passed`。**

- 四条可闭环问题均有实现、单测与真实语料取证；
- legacy / 关闭态 / `none` 三条回退路径逐字保持；
- 静态闸门 0 error / 0 warning，全量 4578 例通过；
- 偏差已登记，未把工程种子包装成临床标定；
- 未完成项已进 backlog，不伪装成已完成。

## 11. 已知限制与风险

- 176 轮回放不是 1112 轮 D-1 样本，2.27% 不能外推成全库翻转率。
- 回放只对照事件集合与 strength，不评估翻转是否让来访状态轨迹更“对”。
- 愿望演化 / 意图锁 / 时序曲线当前默认关闭；生产行为变化仅来自规则 v2 的分类语义。
- `data/phase25-exit/*` 是未跟踪调试产物，不应误入库。
