# AF-359 · BDI 复审 follow-up（浮点主导判定、否定辖域、跨重启展开）· 交付记录

- 任务：AF-359（`phase2.5-orchestration-closed-loop`）
- 类型：fix
- 基线：`b867102dd7cf10f0d30c6b96b21f684a24478d4f`（AF-358 归档提交）
- 分支：`task/AF-359-bdi-review-followup`
- 交付日期：2026-11-23
- 输入：MiniMax Code 对 AF-358 的只读复审（`docs/worklog/pending/relay-response-AF358-review-20261123-1300.md`）

## 1. 交付摘要

本单只处理复审新发现的 3 条 P1 与可在当前 scope 内闭合的 P2；不改 12 个决策阈值数值、愿望演化 5 参数、锁 TTL、时序斜率，不宣称临床有效性，不开启 `ENGINE_BELIEF_FORMATION_ENABLED`。

1. **P1-1 浮点主导判定**：`avoidanceDelta = avoid_pain - max(understood, accepted)`，`avoidanceDominant = avoidanceDelta > avoidanceMargin + 1e-9`。念安 `0.68 - 0.58 = 0.10000000000000009` 不再越线；惊尘 `0.72`、内置回避依恋 `0.45` 仍为 dominant。审计使用同一差值定义与同一容差，新增 `avoidanceDelta` 列并统一四位小数。
2. **P1-2 否定辖域**：新增 `NEGATED_REFLECTION_VERB`，后缀只排除“否定词 + 可选再 + 觉察动词”这一种辖域；`我意识到没有人真正关心我`、`我意识到并不需要别人认可` 恢复保留；`我似乎没有意识到…`、`我似乎并不觉得自己被排斥` 仍排除。
3. **P1-3 跨重启展开**：删除展开分支的 `seq <= lastSeq` 守卫。复读不强化已是唯一防线，守卫只剩“持久化旧序号大于本地新序号时静默丢弃合法展开”的副作用；保留复读分支不动。
4. **P2-1 注释语义**：`evidenceCount` 改为“被展开次数”；`lastObservedAtVisitorSeq` 改为“只用于审计 / 观察痕迹，不作门槛”。
5. **P2-3 重复 id**：`createFormedBelief` 后若同 id 已存在，只刷新 `lastObservedAtTurn` / `lastObservedAtVisitorSeq`，不再 push 第二条。
6. **P2-5 上限同分**：`capTemporaryBeliefs` 排序键改为 `(confidence desc, lastObservedAtTurn desc)`，同分保留较新观察。
7. **P2-6 / P2-7 来源 1:1 与赢家置首**：映射合并改为按 `(key,label)` 对去重，`sourceKeys` / `sourceLabels` 强制等长；赢家标签移到首位，消费方可假定 `sourceLabels[0] === label`。`provenancePairs` 在种子未带来源时以种子原键回退，避免把内核键 `accepted` 覆盖掉原始角色键 `authenticity`。
8. **审计版本**：`AUDIT_VERSION` 升级为 `af359-bdi-readiness-1.3.0`。

## 2. 关键决策

- **容差只改比较语义，不改阈值数值**。`avoidanceMargin` 仍为 `0.1`，新增 `1e-9` 仅吸收 IEEE-754 表示误差；审计与内核共用同一差值定义，避免“审计说否、运行时说真”。
- **否定辖域按“否定标记动词”而不是“否定任何后缀”**。只收紧到“没有 / 没 / 未 / 不 / 并不 / 并没 / 从没 / 从未 / 从来没有 + 再 + 意识到 / 发现 / 觉察到 / 注意到”。hedge 型标记（`我似乎 / 我好像 / 原来我`）仍沿用既有前缀判定，未按复审建议扩大为“无觉察动词即排除”，因为那会改变 `我好像一直在讨好` 等既有保留口径，属督导标定决策。
- **跨重启不做序号空间升级**。复审给出“删除守卫”和“序号跨重启单调”两个选项，本单选前者：成本最低、不引入新状态面，且复读分支已在语义层阻断膨胀。序号跨重启单调列入 backlog。
- **同 id 去重只刷新观察痕迹**。不把“展开后回说原句”当成第二次形成，也不改 `statement`；`id` 仍约定为首次形态哈希，`statement` 可随展开更新，该契约写入 backlog 待督导视图确认。
- **不扩 barrel 公开面**。`boundary.spec.ts` 未改，不新增 public export。

## 3. gateResults

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm exec vitest run` 定向 10 文件 | 0 | 10 files / 149 tests passed；过滤器全部真实命中 |
| `pnpm test` | 0 | 310 files passed / 1 skipped（311）；4726 tests passed / 4 skipped（4730）；29.04s |
| `pnpm exec tsx bin/bdi-readiness-audit.ts --out .tmp/af359-audit --strict` | 0 | 阻断项 0；`af359-bdi-readiness-1.3.0`；念安 `avoidanceDelta=0.1000 / dominant=否`，惊尘 `0.7200 / 是`，回避依恋 L1 `0.4500 / 是` |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 0 | 见回执实测输出 |
| `git diff --stat HEAD -- src/engine-core` | — | 仅 3 个授权文件：`intention-planner.ts`、`state-transition.ts`、`domain/beliefs.ts` |

机器状态：Windows / PowerShell 7.6.4 / Node v22.23.2 / pnpm 9.15.0；全量测试期间无 `nest start --watch` / `vite dev` 长驻进程。

定向 10 文件：

- `test/engine-core/af357-bdi-belief-formation.spec.ts`（31）
- `test/engine-core/af358-belief-extraction-matrix.spec.ts`（32）
- `test/engine-core/af358-belief-degraded-regression.spec.ts`（5）
- `test/engine-core/af359-bdi-review-followup.spec.ts`（8）
- `test/engine-adapters/af357-character-desire-mapping.spec.ts`（27）
- `test/engine-adapters/af358-character-desire-provenance.spec.ts`（4）
- `test/engine-adapters/af359-character-desire-pairing.spec.ts`（4）
- `test/engine-adapters/af357-bdi-runtime-config.spec.ts`（14）
- `test/engine-core/boundary.spec.ts`（12）
- `test/config/wp25-env-example-coverage.spec.ts`（12）

## 4. scopeCheck

`in-scope`：

- `src/engine-core/cognition/intention-planner.ts`
- `src/engine-core/cognition/state-transition.ts`
- `src/engine-core/domain/beliefs.ts`
- `src/engine-adapters/wiring/character/character-desire-mapping.ts`
- `bin/bdi-readiness-audit.ts`
- `test/engine-core/af359-bdi-review-followup.spec.ts`（新增）
- `test/engine-adapters/af359-character-desire-pairing.spec.ts`（新增）
- `docs/worklog/completed/`、`docs/worklog/records/`
- 编排状态面（由 CLI 写入）：`docs/team/agent-orchestration/{task-state-index.json,orchestration-snapshot.json,state/journal.jsonl}`、`web/orchestration/data.js`

`out-of-scope` 未触碰：12 个决策阈值数值、愿望演化 5 参数、锁 TTL、时序斜率、`boundary.spec.ts`、`admin-dashboard/`、Flutter、migration / 表结构、`.env` 运行值、`data/handoff/`、`data/phase25-exit/`。

## 5. contractChecks

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | AF-359 经 CLI register / run-once；`dependsOn=[AF-358]` 已归档 |
| state-write | pass | 状态面由 CLI 生成，未手改索引或事件链 |
| engine-core-auth | pass | 仅 3 个授权文件；`boundary.spec.ts` 12/12；未新增 public export |
| default-off-zero-regression | pass | `formationEnabled=false` 不生成、不裁剪；不传序号时行为逐字不变 |
| float-tolerance | pass | 内核与审计共用 `1e-9`；念安恢复非 dominant，惊尘 / 内置回避型不变 |
| negation-scope | pass | 否定辖域只排除否定标记动词；新增两条反向断言 |
| restart-expansion | pass | 旧序号 12 → 新序号 1 的合法展开仍强化；同序号复读仍不强化 |
| temporary-cap | pass | 40 条上限同分保留较新；同 id 不重复 push |
| provenance-1to1 | pass | `(key,label)` 对去重；赢家置首；二次映射逐字幂等；种子原键不被内核键覆盖 |
| clinical-numeric-integrity | pass | 未改任何阈值数值与角色权重；未宣称临床有效性 |
| privacy | pass | 审计 / 日志 / 报告无对话原文；`statement` 边界仍按 AF-358 B4 管理 |
| artifact-pointer | pass | taskSheet / deliveryRecord / reply 均落文件；worklog strict PASS |

## 6. backlogItems

1. **AF359-B1 复读计数**：复读信号当前完全丢弃（P2-2）；建议新增“被观察次数”字段，只增计数、不改置信度，供督导视图看见“反复回到同一主题但从未展开”。
2. **AF359-B2 `insight` 口径**：一次陈述 + 一次展开即过 `reflectiveBeliefGate=0.60`（P1-4）；督导纪要须写明“`insight` = 来访把一条觉察展开了”，是否要求“展开次数 ≥ 2”属标定决策。
3. **AF359-B3 序号跨重启单调**：本单删除守卫；若未来需要审计可比，仍可把来访序号升级为会话级持久化单调计数器。
4. **AF359-B4 信念 id 与 statement 同源**：`id` 为首次形态哈希、`statement` 可随展开更新（P2-4）；需督导视图确认是否接受，或改 id 派生规则（会破坏稳定性）。
5. **AF359-B5 会话级 gate 告警**：`allianceThresholds.reflectiveBeliefGate` 可逐场覆盖，装配期耦合告警只校验全局门槛（P2-8）；需在覆盖生效处补一次校验。
6. **AF359-B6 admin 来源字段往返**：`sourceKeys` / `sourceLabels` 为新增可选字段，Admin 保存若不保留未知字段会抹掉来源信息（P2-9）；跨文件域，需 Admin 单协调。
7. **AF359-B7 否定 hedge 口径**：`我好像一直在讨好` 等 hedge 型标记仍保留；是否收紧为“无觉察动词即排除”需督导签字。
8. **AF359-B8 映射语义标定**：`safe_grief→understood`、`belonging→accepted`、`continuity/rest→avoid_pain` 仍需真实咨询师逐轮标注（承接 AF-358 B1）。
9. **AF359-B9 生产开启顺序**：`ENGINE_BELIEF_FORMATION_ENABLED` 仍缺省 false；本单只把复审新 P1 修到可开启候选，不代表已批准开启。

## 7. deviationTable

| 任务单写法 | 实际情况 | 处理 | 理由 |
| --- | --- | --- | --- |
| 成功标准“点名三个 dominant 角色” | 修复后念安恢复非 dominant，真实 dominant 只有 2 个 | 审计表点名三个被复核角色（念安 0.1000 否 / 惊尘 0.7200 是 / 回避依恋 0.4500 是），摘要写“2 个 dominant” | 不为了凑验收伪造第三个 dominant；披露完整优先 |
| P1-2 复审建议“hedge 型标记无觉察动词即排除” | 会改变 `我好像一直在讨好` 等既有保留口径 | 只收紧否定辖域，hedge 仍按既有前缀判定；列入 AF359-B7 | 属临床标定决策，不在实现侧单方面扩大 |
| P1-3 复审推荐“删除守卫”，备选“序号跨重启单调” | 删除守卫后跨重启展开恢复；序号仍为进程内单调 | 选删除守卫；序号升级列入 AF359-B3 | 成本最低、无新状态面；复读不强化已阻断膨胀 |
| P2-2 建议保留复读计数 | 任务单明确不做“复读计数”字段 | 未实现，登记 AF359-B1 | 临床口径未拍板，避免擅自加字段 |
| P2-4 建议约定 id = 首次形态哈希并写注释 | 本单未改 id 派生规则 | 只在记录中明确契约，登记 AF359-B4 | 改 id 会破坏稳定性；注释需督导视图确认 |
| P2-8 会话级 gate 覆盖告警 | 本单未改覆盖路径 | 登记 AF359-B5 | 需设计覆盖生效处的校验位置，超出本单 scope |
| P2-9 admin 来源字段往返 | Admin 属另一文件域 | 登记 AF359-B6 | 不越界改 `admin-dashboard/` |
| 定向闸门命令 | 首次运行 3 例失败：`provenancePairs` 回退键用内核键，丢了 `authenticity` | 改为以种子原键回退，三处调用同步；重跑 149/149 | 来源保全的 1:1 契约必须逐字可追溯 |

## 8. reviewVerdict

`passed`（主控自检）。3 条 P1 均已实现并有定向回归；P2-1 / P2-3 / P2-5 / P2-6 / P2-7 已闭合；P2-2 / P2-4 / P2-8 / P2-9 按 scope 与临床标定边界登记 backlog。`pnpm typecheck` 0、`pnpm lint` 0/0、定向 10 文件 149 例全绿、全量 311 文件 4730 例（4726 通过 / 4 跳过）、审计 strict 阻断 0。未改任何临床数值，未开启未标定机制。MiniMax Code 的 AF-358 复审意见已作为本单输入逐条闭环，未把“评审已提”当作“已修复”证据。
