# AF-580 交付记录：改进台账历史条目清理

- 任务：AF-580
- 上下文：phase2.5-orchestration-closed-loop
- 类型：documentation
- 日期：2026-11-27
- 分支：task/AF-580-improvement-ledger-cleanup

## 1. 口径

只关闭两类条目：

1. **done**：后续任务已经真实实现该条建议，当前仓库可核实，写 `linkedTask` 与证据 note。
2. **wontfix**：已有明确决策不再做，或属于运行环境选择而非仓库缺陷，写理由。

没有落地证据、仍需新批次或真人资源的条目保持 `candidate / queued`，不为了清零台账而关闭。

## 2. 关闭清单（done，15 条）

| 条目 | 结论依据 | linkedTask |
| --- | --- | --- |
| IM-055 长会话咨询师空输出未计数 | AF-102 落地 `judgeVisibleOutput`，剥离推理块后为空即计空输出并重试；AF-095 审计 CLI 输出 `emptyCounselorTurns` | AF-102 |
| IM-056 来访者角色缺失导致批次失败 | AF-103 入队与单场启动前校验 `characterSlug` 可解析，不再把缺失角色推进队列 | AF-103 |
| IM-059 审计 CLI 不再能识别空输出 | `counselor-quality-audit.cli.ts` 读逐字稿计算 `emptyCounselorTurns`，`empty_output_high` 可再次触发 | AF-095 |
| IM-060 审计与生成侧两份推理块剥离口径 | `counselor/policy/visible-output.ts` 直接转出 `shared/llm/reasoning-text.ts` 的 `stripReasoningBlocks`，两侧共用同一函数 | AF-102 |
| IM-061 batch 复跑尚无真实证据 | AF-140 跑完 16 场 long/50 轮真实批次（693 轮，15 completed + 1 crisis_ended） | AF-140 |
| IM-066 长会话开场框架与收束缺失 | AF-129 新增开场知情框架（保密/边界/时长/暂停拒答/录音）；AF-140 补最终收束三件套与 `natural_close` | AF-129 |
| IM-068 forcedClose 需升级为 runner 级硬约束 | AF-140 改为 `maxTurns +1/+2` 收束窗，三件套不齐挡回继续，齐全才 `natural_close` | AF-140 |
| IM-069 跨模型评分 κ 口径校准未落地 | AF-147 落地 kappa 赛道同方法、同锚点顺序、±1 仲裁；κ 0.365854 仍 <0.40，质量门未通过由 IM-073 继续跟踪 | AF-147 |
| IM-070 pack 只保留 completed 漏 crisis_ended | AF-140 让 `selectBalancedSessions` 同时纳入 `completed` 与 `crisis_ended` | AF-140 |
| IM-071 风险收束缺内容级强制校验 | AF-140 新增风险五组内容门与 `crisis_safety_incomplete`，缺项先追加修复轮 | AF-140 |
| IM-072 long-session-acceptance 只取 completed | AF-140 同步把 pack 过滤与取样条件纳入 `crisis_ended` | AF-140 |
| IM-075 任务单模板 baselineRef 标“可空” | `docs/team/wp-task-template.md` 当前写的是必填示例值 `2b03756`，不再与 promote 强校验冲突 | AF-075 |
| IM-079 `scripts/ops/quality/*.ts` 不在 lint 覆盖面 | 当前 `package.json` lint 已含 `scripts/ops/quality/**/*.ts` 与 `scripts/**/*.{mjs,cjs}`，本次 `pnpm lint` exit 0 | 当前仓库事实 |
| IM-081 候选改进只活在回执 backlogItems | AF-017 回执正文解析通道 `extractFromReceiptDoc` 已落地，候选可从回执进入台账 | AF-017 |
| IM-082 本地执行与 GUI 派发租约语义冲突 | `docs/team/agent-orchestration/README.md` 与 closed-loop runbook 已明确“回执先 freeze、再 run-once”为标准收口动作 | 当前仓库文档 |

## 3. 关闭清单（wontfix，3 条）

| 条目 | 不采纳理由 |
| --- | --- |
| IM-054 WP-K 0.01 边界按二进制差值判 movement | AF-067 已锁定保守判定；十进制 0.01 恰好越界属于预期，不引入 epsilon 掩盖真实边界回归 |
| IM-063 逐字稿不再保留咨询师推理块 | AF-102 起有意不保留推理块，避免隐私内容与泄漏风险；跨批次比对标注口径即可 |
| IM-083 本机 node v22 低于仓库要求 >=26 | 仓库 `engines` 已声明 `>=26`，CI 使用 node 26；本机 v22 属运行环境选择，不作为仓库代码缺陷修复 |

## 4. 保留清单（8 条）

| 条目 | 保留原因 |
| --- | --- |
| IM-057 来访者角色库覆盖不足 | 角色扩充与 1000 场数据积累仍需独立任务，当前无完成证据 |
| IM-058 批次有效性门禁不读咨询师侧降级计数 | `BatchMetrics` 虽聚合 `counselorDegradedTurns`，`evaluateBatchHealth` 仍未把它纳入判定 |
| IM-062 空输出重试使失败轮次调用量翻倍 | 需要按真实批次统计重试率后再调预算，当前无标定数据 |
| IM-064 standard/重试预算未标定 | 需要 long 批次真实数据回校预算，当前没有明确标定值 |
| IM-065 long 50 轮批次缺少匹配临床验收口径 | 仍需 100–200 轮人工复核试点，12 轮 intake 口径不能直接套 50 轮 |
| IM-073 临床级 AI 评分门缺真人双标与仲裁 | Phase2.5 出口④的真实战略阻塞，仍排队等待真人督导师资源 |
| IM-074 两类模型轨跨轮事件仍零语料 | 当前只有剧本语料覆盖，真实链路仍无观测，需要专门评测批次 |
| IM-078 历史语料全早于 AF-442 无 kernelRef | `none` 桶是历史语料结构属性；新语料 kernelRef 门槛仍需另行确认 |

## 5. 台账数字

| 时点 | 候选 | 排队 | 实现中 | 已完成 | 不采纳 | 活跃 | 总 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 清理前 | 25 | 1 | 0 | 56 | 3 | 26 | 85 |
| 清理后 | 7 | 1 | 0 | 71 | 6 | 8 | 85 |

## 6. 闸门

| 命令 | 退出码 | 数字 | 定性 |
| --- | --- | --- | --- |
| `node scripts/orchestration/cli.mjs improvements --summary` | 0 | 候选=7 排队=1 已完成=71 不采纳=6；活跃=8 / 总=85 | 台账收敛，保留项均有原因 |
| `node scripts/orchestration/cli.mjs worklog verify --strict --state-free` | 0 | 归档=516 记录包=536 inbox=0；AF-580 交付指针在收尾前提示待补 | 结构与历史豁免 PASS |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 2414 条事件；schema / 哈希链 / 索引投影一致 | PASS |
| `node scripts/orchestration/cli.mjs validate` | 0 | 全 PASS | 状态面与回执 schema 一致 |
| `git diff --check` | 0 | 无空白错误 | PASS |

## 7. 改动与偏差

- 仅改 `docs/team/agent-orchestration/improvement-log.json`（经 CLI 流转）、快照与看板数据；未改代码、框架契约、engine-core 或业务逻辑。
- 无偏差。AF-580 聚焦台账历史清理，不实现保留项本身。

## 8. 遗留

- 保留 8 条，其中 IM-073 是 Phase2.5 出口④的真人双标 + 仲裁阻塞；其余 7 条需要新批次、角色扩充或预算标定，不能在本单凭空关闭。
