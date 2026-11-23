# AF-357 · BDI 临床语义补齐（角色愿望映射 + 短期信念生成）· 交付记录

- 任务：AF-357（`phase2.5-orchestration-closed-loop`）
- 类型：implementation
- 基线：`cb3cb868d5b27c134862a333a32f9bd76d6bd9af`
- 分支：`task/AF-357-bdi-desire-belief`
- 交付日期：2026-11-23

## 1. 交付摘要

补上 BDI 决策链的两条临床语义缺口，不打开未标定机制、不改既有阈值。

1. **角色愿望映射**：新增 `character-desire-mapping.ts`，把 8 个真实角色与 2 个内置种子的 15 个角色级愿望键显式映射到内核四键 `understood / accepted / avoid_pain / control`；内存种子、A/B 类种子、DB 解析全部走同一函数。同一内核键取最大基线，不求和；未知键原样保留并计入 `unmapped`。
2. **短期信念生成**：`state-transition.ts` 新增确定性纯函数 `applyBeliefFormation` 与 `extractReflectiveStatements`；只从来访上一轮原话提取第一人称自我觉察，`source=observed`；重复陈述按规范化文本去重、递增 `evidenceCount` 与置信度；单轮上限 2 条，新条目生成轮不衰减。
3. **回灌入口**：`EngineTurnInput.priorVisitorText` 可选入参；渲染门面从 history 取最近一条真实来访发言，降级兜底句不进入。
4. **运行时通道**：`ENGINE_BELIEF_FORMATION_*` 6 个键解析、生产装配与 `.env.example` 声明；缺省 `false`，未开启时内核逐字零回归。
5. **审计**：`bdi-readiness-audit.ts` 升级到 `af357-bdi-readiness-1.1.0`，输出映射前后键、覆盖矩阵、`discussing_plans` / `insight` 可达性与机制开关；10 个角色全部落表。

## 2. 关键决策

- **映射只改键、不改数值**。惊尘 `control=0.50 < controlPlanGate 0.55` 保持不达标：创伤解组状态不适合进入计划讨论，不通过调数值强行达标；审计显式标注。
- **信念生成缺省关闭**。代码路径已补齐（同一条自我觉察重复两次 → `0.65 ≥ reflectiveBeliefGate 0.6` → `turnNumber >= 12` 时 `insight` 可判），但生产默认不开启，避免未标定机制直接改变线上轨迹。
- **危机内容不生成信念**。危机/自伤/伤人词命中的句子被排除，原文本继续走既有 safety 链路，不复制到第二个存储面。
- **不扩 barrel 公开面**。`boundary.spec.ts` 的白名单不允许新增公开符号；适配层复用已公开的 `DEFAULT_BELIEF_OPERATOR_CONFIG` 作为形成字段种子，测试从内核内部模块直读新算子，保持边界断言零改动。
- **AF-356 只补取消指针**。AF-356 因 scope 含 `docs/worklog/inbox/` 越出 executor 资源域被取消，未执行实现；其 `artifacts` 指针用取消说明落文件，不冒充交付。

## 3. gateResults

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm exec vitest run test/engine-core/af357-bdi-belief-formation.spec.ts test/engine-adapters/af357-character-desire-mapping.spec.ts test/engine-adapters/af357-bdi-runtime-config.spec.ts test/engine-adapters/af106-character-pool.spec.ts test/engine-core/boundary.spec.ts test/config/wp25-env-example-coverage.spec.ts` | 0 | 6 files / 88 tests passed |
| `pnpm test` | 0 | 305 files passed / 1 skipped；4662 tests passed / 4 skipped；29.94s |
| `pnpm exec tsx bin/bdi-readiness-audit.ts --out <tmp> --strict` | 0 | 阻断项 0；10 角色全部覆盖 |
| `git diff --stat HEAD -- src/engine-core` | — | 仅 `state-transition.ts` / `beliefs.ts` / `engine-session.types.ts` / `in-memory-engine-session.ts` 四个授权文件 |

机器状态：全量测试期间无 `nest start --watch` / `vite dev` 长驻进程；MiniMax Code 在做只读评审（未跑全量测试）。全量 wall clock 29.94s，state **正常盘读取**，非冷盘/重负载场景。

## 4. scopeCheck

`in-scope`：

- `src/engine-adapters/wiring/character/`：映射表与四条装配路径
- `src/engine-core/{cognition,domain,in-memory}/`：仅任务单授权四文件
- `src/engine-adapters/rendering/turn-render-orchestrator.ts`、`bdi-runtime.config.ts`、`engine.module.ts`
- `bin/bdi-readiness-audit.ts`、`.env.example`
- `test/engine-core/`、`test/engine-adapters/`
- `docs/worklog/completed/`、`docs/worklog/records/`

`out-of-scope` 未触碰：`admin-dashboard/`、Flutter、`scripts/`、`typings/`、12 个阈值数值、愿望演化 5 参数、锁 TTL、时序斜率、`boundary.spec.ts`。

## 5. contractChecks

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| engine-core-purity | pass | 纯层无 env / IO / prompt / `@nestjs`；`boundary.spec.ts` 12/12 通过 |
| engine-core-diff | pass | 仅四个授权文件 |
| default-off-zero-regression | pass | 不配 `ENGINE_BELIEF_FORMATION_*` → `beliefConfig` 不注入；未开启时返回入参引用 |
| mapping-idempotent | pass | 10 个角色二次映射键值不变；未知键保留 |
| privacy | pass | 信念只进 BDI 快照；审计只输出键名、数值、布尔与计数 |
| clinical-numeric-integrity | pass | 未改任何既有权重；惊尘 control 0.50 不强行达标 |
| task-state-write | pass | 任务登记/提级/重签发由 CLI 写入，未手改状态索引 |

## 6. backlogItems

1. **临床标定**：角色愿望映射语义（acceptance→accepted、recognition→understood、autonomy/competence/self_reliability→control、stability/continuity/rest/safety/security→avoid_pain）是工程种子，需真实咨询师逐轮标注校准。
2. **信念参数标定**：首次置信度 0.55、重复增量 0.10、单轮 2 条、长度 6–80 字均为工程种子；需督导标注决定“一句重复是否足以进入整合领悟”。
3. **否定式过滤规则复核**：`extractReflectiveStatements` 目前用标记前 3 字判断否定；常见“我没发现…”本身不含标记“我发现”，靠“无标记”被排除，而不是靠否定规则。是否要增加独立否定词表，交临床/产品决策。
4. **生产开启策略**：`ENGINE_BELIEF_FORMATION_ENABLED` 缺省 false；灰度环境是否开启、按哪个批次开启，需用户/临床负责人决定。
5. **`introduced` 信念**：仍不从来访原文或咨询师解释生成；若未来允许咨询师引入信念，需单独临床决策与安全评审。

## 7. deviationTable

| 任务单写法 | 实际情况 | 处理 | 理由 |
| --- | --- | --- | --- |
| 定向闸门文件名 `af356-*` | 任务已重签发为 AF-357 | 使用 `af357-*` 三个测试文件，并跑同等的 boundary / env 门 | 任务单是重签发副本，文件名残留 AF-356；测试内容与范围一致 |
| 成功标准未要求扩 barrel | 新增算子最初从 `index.ts` 导出，触发 boundary ⑥ 多导出 | 收回 barrel，仅复用已公开 `DEFAULT_BELIEF_OPERATOR_CONFIG`；测试直读内核模块 | `boundary.spec.ts` 不改是硬红线，不能为方便扩公开面 |
| 审计“insight 可达性” | 机制代码已实现但缺省关闭 | 审计标为“不可达（运行时缺省关闭）+ 生成算子已实现，开启后可判” | 不把“代码可达”冒充“线上已开启”，也不再把缺口说成结构性不可达 |
| AF-356 交付记录路径 | 任务取消、无实现 | 写取消指针 `af356-bdi-desire-belief-2026-11-23.md` | 既不阻断 `worklog verify --strict`，也不冒充实现 |
| 任务单未要求改已有测试 | 全量测试暴露 `af106-character-pool.spec.ts` 断言“装配后 desires 至少 2 条” | 改为“原始池至少 2 条 + 规范形至少 1 条” | 安然 `acceptance + authenticity` 合法合并到同一内核键 `accepted`，原断言把映射合并误判成数据缺失；不削弱内容池契约 |
| MiniMax Code 独立评审 | 评审为异步，交付记录落笔时可能未回 | 单独登记 relay job AF-357，回复文件 `docs/worklog/pending/relay-response-AF357-review-20261123-1200.md`；回件后按 P0/P1 处理 | 不阻塞主交付，同时把评审结论纳入后续修复 |

## 8. reviewVerdict

`passed`（主控自检）：两条临床语义链均有实现、单测、审计与运行时通道；缺省关闭保证零回归；临床数值未被篡改；AF-356 取消指针已落文件。MiniMax Code 独立评审为异步第二意见，不替代主控验收。
