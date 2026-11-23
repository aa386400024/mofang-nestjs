# AF-358 · BDI 评审返修（信念生成 P0 语义 + 映射信息保全）· 交付记录

- 任务：AF-358（`phase2.5-orchestration-closed-loop`）
- 类型：fix
- 基线：`c365be2bbb9a`（AF-357 归档提交）
- 分支：`task/AF-358-bdi-review-remediation`
- 交付日期：2026-11-23

## 1. 交付摘要

承接 MiniMax Code 对 AF-357 的独立评审，修掉三条 P0 与四条 P1；未开启未标定机制，未改任何决策阈值。

1. **P0-1 同一句原话重复计分**：渲染门面为真实来访腿分配会话内单调序号（降级轮不占号），内核 `priorVisitorSeq` / `lastObservedAtVisitorSeq` 只在序号严格变大时承认新观察。同一句被连续降级轮重复读到，不再累加置信度与证据数；不传序号时既有行为逐字不变。
2. **P0-2 否定式锚点**：从“标记前 3 字窗口”改为“否定词紧邻标记（前缀 endsWith / 后缀 startsWith）”。`我似乎没有意识到我很容易焦虑`、`我好像没发现自己很生气` 被正确排除；`我发现我并不开心` 这类否定宾语保留。
3. **P0-3 问句与第三人称**：问句双判（句尾语气词 + 句中疑问结构 `是不是/有没有/会不会/能不能/该不该/算不算/为什么/怎么办/好不好`）；第三人称改“第三方主体 + 0–4 字 + 言语动词”，覆盖 `我朋友说`，同时保留 `我发现她总是这样` 这类来访对第三方的观察。
4. **P1-1 复读 vs 展开**：逐字复读只刷新 `lastObservedAtTurn` / `lastObservedAtVisitorSeq`，置信度与证据计数不动；只有新句包含旧句且更长才视为展开，增量按 `reinforcement / max(1, evidenceCount)` 递减。
5. **P1-2 映射信息保全**：同一内核键合并时累积 `sourceKeys` / `sourceLabels`；已带来源的映射结果再次映射原样继承（幂等），不把次级诉求从快照与 DB 种子负载中抹掉。
6. **P1-3 配置耦合**：新增 `describeBeliefGateCoupling`，装配期用实际 `reflectiveBeliefGate` 校验 `base >= gate` 与 `base + reinforcement <= gate`，只告警、不静默改策略。
7. **P1-4 假绿**：定向闸门改为真实存在的 9 个文件，过滤器全部命中；新增 32 例中文句式矩阵与 5 例降级轮回归。
8. **P1-5 条数上限**：生成开启时 `temporaryBeliefs` 最多保留 40 条，按 confidence 保留高价值条目；关闭时不裁剪。
9. **审计与文档**：审计升级 `af358-bdi-readiness-1.2.0`，输出 `avoidanceDominant` 与策略收窄事实；`.env.example` 修正“连续复述”“insight 最早轮次”的事实错误。

## 2. 关键决策

- **复读不强化，展开才强化**。这是对 AF-357 §4“规范化后相同 → 置信度递增”的语义变更：临床上逐字复读更可能指向“尚未整合/防御性复述”，把它当作整合证据会让系统替来访宣布领悟。该语义变更已登记偏差，是否作为正式临床标定口径需督导拍板。
- **不调阈值让惊尘达标**。映射让 `avoid_pain` 首次可计算，惊尘 `avoid_pain=0.72 / control=0.50 → avoidanceDominant=true`，探索与后段分支被否决，恒为 `recounting`。审计只陈述静态事实，不把它解释成临床结论，也不通过调数值强行进入计划讨论。
- **隐私边界**。信念仍只进 BDI 会话快照；审计 / 日志 / 报告只输出键名、数值、布尔与计数。`statement` 作为来访原话仍保存在会话快照中供决策与追溯，不新增第二个存储面；admin 调试接口的原文暴露问题列入 backlog。
- **不扩 barrel 公开面**。`boundary.spec.ts` 不改，不新增公开导出；适配层只从既有 barrel 取值。

## 3. gateResults

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm exec vitest run` 定向 9 文件 | 0 | 9 files / 140 tests passed |
| `pnpm test` | 0 | 308 files passed / 1 skipped（309）；4714 tests passed / 4 skipped（4718）；27.86s |
| `pnpm exec tsx bin/bdi-readiness-audit.ts --out .tmp/af358-audit --strict` | 0 | 阻断项 0；10 角色覆盖；3 个角色 `avoidanceDominant=true` |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | 0 | 见回执实测输出 |
| `git diff --stat HEAD -- src/engine-core` | — | 仅 7 个授权文件 |

机器状态：Windows / PowerShell 7.6.4 / Node v22.23.2 / pnpm 9.15.0；全量测试期间无 `nest start --watch` / `vite dev` 长驻进程，正常盘读取。

## 4. scopeCheck

`in-scope`：

- `src/engine-core/cognition/state-transition.ts`
- `src/engine-core/domain/{beliefs,engine-session.types,character-profile,desires,bootstrap}.ts`
- `src/engine-core/in-memory/in-memory-engine-session.ts`
- `src/engine-adapters/rendering/turn-render-orchestrator.ts`
- `src/engine-adapters/wiring/{bdi-runtime.config,engine.module}.ts`
- `src/engine-adapters/wiring/character/character-desire-mapping.ts`
- `bin/bdi-readiness-audit.ts`、`.env.example`
- `test/engine-core/`、`test/engine-adapters/`、`test/config/`
- `docs/worklog/completed/`、`docs/worklog/records/`

`out-of-scope` 未触碰：12 个决策阈值、愿望演化 5 参数、锁 TTL、时序斜率、`boundary.spec.ts`、`admin-dashboard/`、Flutter、`scripts/`、`typings/`、migration / 表结构。

## 5. contractChecks

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| engine-core-purity | pass | 纯层无 env / IO / prompt / `@nestjs`；boundary 12/12 |
| engine-core-diff | pass | 仅 7 个授权文件；`boundary.spec.ts` 未改 |
| default-off-zero-regression | pass | `formationEnabled=false` 不生成、不裁剪；不传序号时行为逐字不变 |
| seq-monotonic | pass | 降级轮不占来访序号；`restoreHistory` 重建；`forgetSession` 清理 |
| mapping-provenance | pass | 合并保留 `sourceKeys/sourceLabels`；二次映射幂等；未知键保留 |
| clinical-numeric-integrity | pass | 未改任何既有权重与阈值；惊尘 `control=0.50` 不强行达标 |
| privacy | pass | 审计 / 日志 / 报告无对话原文；会话快照原文边界见 backlog B6 |
| task-state-write | pass | 登记 / 提级 / 回执 / 归档经 CLI，未手改索引与事件链 |

## 6. backlogItems

1. **B1 临床标定**：角色愿望映射语义（`safe_grief→understood`、`belonging→accepted`、`continuity/rest→avoid_pain` 等）需真实咨询师逐轮标注；建议单列督导纪要。
2. **B2 信念参数标定**：base 0.55、reinforcement 0.10、单轮 2 条、长度 6–80 字、40 条上限均为工程种子；复读/展开的临床阈值需督导确认。
3. **B3 生产开启顺序**：`ENGINE_BELIEF_FORMATION_ENABLED` 缺省 false；建议先完成映射语义复核，再按灰度批次开启信念生成，并同步观察 `insight` 轮次分布。
4. **B4 admin 调试原文暴露**：`statement` 仍会进入 BDI 快照 JSON 与 admin 调试接口；需产品 / 隐私负责人决定是否在调试响应中做掩码或按权限分级。
5. **B5 映射合并的标签去重**：`sourceLabels` 用 Set 去重，两个不同来源键若标签同名会合并成一个标签；当前数据面未出现，保留为后续督导视图优化。
6. **B6 信念 id 会话盐**：`belief-observed-<hash>` 仍只按规范化文本生成；跨会话同句会得到同 id，但临时信念不跨会话持久化，当前不影响隔离；若未来持久化需加会话盐。
7. **B7 审计数据源**：审计仍读静态种子与 env，不读 DB 活数据；DB 与种子漂移时以运行时为准，审计只作静态就绪度检查。
8. **B8 introduced→observed 升级门槛**：当前“来访原话展开即升级”未区分 introduced 的初始来源，若未来放开咨询师引入信念需单独安全评审。

## 7. deviationTable

| 任务单写法 | 实际情况 | 处理 | 理由 |
| --- | --- | --- | --- |
| §3.3 “规范化后相同 → 置信度递增”（AF-357 口径） | 临床语义上复读不等于整合 | 逐字复读只刷新观察时间；展开才强化 | 防止一句原话在降级轮里堆出“整合领悟”；语义变更需复核 |
| §3.2 “切句符补充逗号” | 无条件按逗号切会把“我意识到…，怕被抛弃”切断，展开语义收不到输入 | 改为“后半句含新自我觉察标记才拆”，纯续写并入同条 | 保守实现；并列觉察仍拆分，展开仍保留 |
| P1-1 建议 `max(existing, base)+0.10` | 与任务单“递增”不完全一致，且连续展开会过快 | 保留 `max(existing, base)` 语义，但增量改为 `reinforcement / max(1, evidenceCount)` 递减 | 避免连续展开把置信度堆到 1.0；仍高于单纯复读 |
| 定向闸门原写 9 文件 | 初版 AF-357 任务单闸门残留 `af356-*` 假绿 | 改为真实存在的 9 个文件并实测 140 例 | vitest 对不存在过滤器静默忽略，必须让过滤器真实命中 |
| 成功标准“审计输出策略收窄事实” | 审计只读种子，不读 DB 活数据 | 输出 `avoidanceDominant` 与 `recounting` 静态事实，不冒充运行时结论 | 保持审计只读、可复现；DB 漂移列入 backlog |
| P1-5 隐私上限 | `statement` 原文仍进 BDI 快照 / admin 调试接口 | 只做 40 条上限；原文暴露列 backlog B4 | 会话快照是决策必需数据面，是否掩码需隐私负责人拍板 |
| `.env.example` 旧注释“连续复述” | 实际语义已改为“同一条被展开” | 同步修正，并注明 `insightMinTurn=8` 不是 12 | 文档事实必须与代码一致 |

## 8. reviewVerdict

`passed`（主控自检）。三条 P0 与四条 P1 均有实现、定向回归与全量证据；缺省关闭保证线上零回归；未改任何临床数值；审计 strict 阻断 0；定向 9 文件 140 例全绿，全量 4714 例通过。MiniMax Code 的独立评审意见已作为本单输入逐条闭环，未把“评审已提”当作“已修复”证据。
