# AF-104 修复后 long 批次真实回归验证与出口④判定回写

- 任务号：AF-104
- 分支：`task/AF-104-postfix-long-batch`
- 基线 HEAD：`d7b477b`（AF-102 长会话咨询师可见输出治本）
- 执行时间：2026-11-18 21:17–21:54（Asia/Shanghai）
- 正式结论：**出口④「质量达标」未通过；AF-102 的「咨询师可见输出为空」修复项达标。**
- 一句话：4 场真实 long 批次全部完成，咨询师空输出 0/173（对照 AF-095 的 36.3%），但 WP-K 对 96 场历史基线为 `incomparable`，候选批 intake 全局 FAIL，且来访者逐字稿 59.0% 轮次泄漏 `<think>` 推理块，不能给“质量达标”结论。

## 1. 批次与运行

| 项 | 值 |
|---|---|
| batchId | `bpCkaFlA3YGI95qlJZ9Yn` |
| 入口 | 生产 `POST /admin/api/auto-practice/batch`，本地 `node dist/app.js`（PORT 3100）+ 远程 MySQL/Redis + 真实 BullMQ worker |
| 参数 | 4 个已审核角色 × `expert` × 1 次重复，`maxTurns=50`，`deliberation_mode=rule_only` |
| 场次 | 4/4 `completed`，0 failed / 0 stagnant / 0 crisis_ended |
| 轮次 | **173**（47 + 50 + 26 + 50） |
| 健康门禁 | `valid=true`，`flags=[]`；`llm_call_turns=173`、`render_fallback_turns=0`、`degraded_turns=0` |
| 指纹 | `combined=e1d4b3118bf55fa2`；`prompt=6c264f4395c53c07`、`character=1.0.0`、`engine=v2026.11.16-6cfb46e-85-gd7b477b-dirty` |

逐场：

| 角色 | 轮次 | 结束原因 | 会话耗时 |
|---|---:|---|---:|
| `vpt_workplace_intellectualization_l1` | 47 | `natural_close` | 439 s |
| `vpt_self_worth_intellectualization_l1` | 50 | `max_turns` | 878 s |
| `vpt_grief_avoidance_l1` | 26 | `crisis_practice_max` | 323 s |
| `vpt_intimate_avoidance_l1` | 50 | `max_turns` | 342 s |

> 轮次 173 低于任务单写的「不少于 180」7 轮。差额来自 grief 场在危机披露后按 `crisis_practice_max` 安全协议收尾（26 轮），不是随机短场；强制拉满 50 轮会违反危机后置练习窗纪律。按安全协议保留真实结束态，在偏差表登记。

## 2. 逐字稿审计（四场全量）

证据目录：`data/debug-sessions/`，debugSessionId 分别为 `debug_jjQoXZPqsaRpKxHE2uEZf`、`debug_vFJUXhnv-4hHPOvC6yVul`、`debug_RbCTfRtjtRzVfjRA1ZsEO`、`debug_itLJYqI_Pipk2mK6BW6ek`。

| 指标 | 值 | 判定 |
|---|---:|---|
| 咨询师消息 | 173 | — |
| **咨询师空输出** | **0/173 = 0.0%** | ✅ 远低于 5% 目标；对照 AF-095 长会话 36.3% |
| 咨询师 `<think>` 泄漏 | 0/173 | ✅ AF-102 剥离有效 |
| 来访者消息 | 173 | — |
| **来访者 `<think>` 泄漏** | **102/173 = 59.0%** | ❌ 逐字稿与后续对话历史被推理块污染 |
| 来访者空输出 | 0/173 | — |
| 咨询师平均字数 | 68.9–91.6 字/场 | 可读，无空壳 |

来访者推理块分布：workplace 17/47、self_worth **50/50**、grief 8/26、intimate 27/50。self_worth 场每一轮都带推理块，说明不是单次上游抖动，而是来访者渲染链路未对 `<think>` 做最终剥离；推理块同时进入 `history.push({role:'visitor'})`，会被下一轮咨询师上下文读到。

## 3. WP-K 正式四态判定

命令（真实 CLI，非手算）：

```text
corepack pnpm exec tsx bin/batch-report.ts \
  --batch bpCkaFlA3YGI95qlJZ9Yn \
  --baseline-snapshot data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json \
  --format both --fail-on-incomparable
```

结果：`EXIT=2`

```text
[bpCkaFlA3YGI95qlJZ9Yn] incomparable — 两批验收判据 (acceptance) 不同;
两批 counselorModeId 集合不同; 两批 characterSlug 集合不同
```

- 基线：96 场 / 1112 轮，8 角色 × `expert`+`cold`，acceptance 指纹 `f604fdaca19e87b5`。
- 候选：4 场 / 173 轮，4 角色 × `expert`，acceptance 指纹 `4474dd5be381d905`。
- 环境迁移后库内只剩 4 个已审核角色，旧 8 角色中 4 个已不存在；按 WP-K 纪律不能把不同角色基数的均值硬比，正式结论只能是 `incomparable`，不存在 improved / neutral / regressed。
- 产物：`data/batch-reports/bpCkaFlA3YGI95qlJZ9Yn.json` / `.md`；`index.md` 已更新。

候选批自身 intake（`intake-v1` 阈值）：**全局 FAIL**，唯一未达标项：

- `dim.trust.delta_avg=0.243`：首次会谈信任上升过快，判为“焦虑型快速理想化”风险，高于基线档阈值。
- 参考：`session.zero_motion=0`、`pipeline.llm_call_ratio=1`、`fallback_ratio=0`；但 `exploration.rate=0`、`event.neutral.rate=92.49%`、`strategy.recounting.rate=62.43%`、`strategy.resistance.rate=27.17%`，内容层仍以复述/阻抗/中性为主。

## 4. 定向闸门

| 闸门 | 命令 | 结果 |
|---|---|---|
| WP-K CLI 回归 | `corepack pnpm exec vitest run test/auto-practice/af073-batch-report-cli.spec.ts` | exit 0；1 file / 4 tests passed（7.83 s） |
| 类型检查 | `corepack pnpm exec tsc --noEmit -p tsconfig.json` | exit 0；0 error |
| engine-core 边界 | `git diff --stat HEAD -- src/engine-core` | 输出为空（零 diff） |

> 任务单原写的 spec 路径 `test/auto-practice/batch-report-cli.spec.ts` 不存在；实际文件为 `test/auto-practice/af073-batch-report-cli.spec.ts`，按实际路径执行并在偏差表登记。未跑全量测试，符合本单“只跑定向”的约束。

## 5. 正式判定

**出口④ 仍为「未通过 / 不可判定」，不能写“质量达标”。**

理由按临床验收优先级：

1. **没有可比基线**：WP-K 正式四态为 `incomparable`，不是 improved / neutral；96 场历史批次与迁移后 4 角色语料不是同一类东西。
2. **候选批自身 intake FAIL**：`trust Δ=0.243` 触发“快速理想化”风险；内容层 exploration=0、neutral=92.5%，不足以证明质量提升。
3. **逐字稿不洁**：来访者 102/173 轮带 `<think>`，推理块进入对话历史；临床逐字稿不能带模型内部推理。
4. **仍无真实督导师双人盲标 + 仲裁**：80% 六维准确率依旧没有真值基础，不能用 4 场自动对练替代。

**同时确认 AF-102 修复项达标**：长会话咨询师空输出从 AF-095 的 53/146（36.3%）降到 **0/173（0.0%）**，`llm_call_turns=173`、`fallback=0`，说明预算/截断重试/降级计数链路在真实 long 批次上生效。

## 6. 偏差与遗留

| 项 | 说明 | 处置 |
|---|---|---|
| D-01 | 任务单 spec 路径不存在，实际为 `af073-batch-report-cli.spec.ts` | 按实际文件执行；本记录留痕 |
| D-02 | 总轮次 173 < 180 | grief 场按 `crisis_practice_max` 安全收尾；不强制拉满，保留真实结束态 |
| OI-01 | 来访者 `<think>` 泄漏 102/173；进入逐字稿与 history | 新开 AF-105，P1；修复后重跑小批验证 |
| OI-02 | 环境迁移后仅 4 角色，旧 8 角色不可恢复 | 角色扩充另立任务；在补齐前 WP-K 只能 `incomparable` |
| OI-03 | 候选批 `trust Δ=0.243` 快速理想化 | 质量层问题，非本单修复；纳入督导标注试点复核 |

## 7. 证据清单

- 批次：`bpCkaFlA3YGI95qlJZ9Yn`（4/4，173 轮，valid=true）
- WP-K：`data/batch-reports/bpCkaFlA3YGI95qlJZ9Yn.json` / `.md`（exit 2，incomparable）
- 基线：`data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json`（96/96，1112 轮）
- 逐字稿：上述 4 个 `debug_*.json`
- 闸门日志：`%TEMP%\af104-gate-vitest.log`、`%TEMP%\af104-gate-tsc.log`、`%TEMP%\af104-wpk.log`
