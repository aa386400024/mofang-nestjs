# AF-245 交付记录 · V5 逐 persona 差异审计工具与过拟合检查（2026-11-22）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-245/task-sheet.md`
- 分支：`task/AF-245-af245-persona-delta`
- 基线：`c2baed2ddc386cc0ab4aa1496782b4c4f6046243`
- 类型：implementation
- 结论：**V5 的增益没有集中在少数 persona；三轮合并后 12 个 persona×难度单元全部不回落，7 个改善、5 个持平。** 主要增益来自关系在场，不是自然度。当前证据不支持“V5 靠少数 persona 拉总均分”的过拟合判断，但每单元仅 3 场×2 评分员，仍不足以证明跨 persona 稳定。

## 变更清单

| 文件 | 变更 |
| --- | --- |
| `bin/visitor-sim-persona-delta.ts` | 新增逐 persona×难度审计 CLI + 纯函数 `auditPersonaDeltas`；支持单文件与 `--files a,b,c` 多轮合并；按 delta 升序输出 Markdown |
| `test/auto-practice/af245-persona-delta.spec.ts` | 新增 2 例：聚合与维度 delta、赢/平/输计数；候选样本缺失时按实际场次计数、不把缺失当 0 分 |

实现要点：

- 会话 persona 从 `af232_${arm}_${personaId}_${difficulty}` 剥离前后缀，避免 personaId 内的下划线被误切。
- 每场先对所有评分员取 overall / 五维均值，再按 `personaId|difficulty` 聚合，避免评分员数量不同导致权重偏移。
- 改善阈值 `> +0.05`、回落阈值 `< -0.05`，其余算持平。
- CLI 只读 `scores.json`、只打印，不写报告文件；不调用模型、不改 prompt、不改主候选。

## 三轮合并审计结果（AF-243，E=V2，H=V5）

命令：

```text
pnpm exec tsx bin/visitor-sim-persona-delta.ts \
  --files data/phase25-exit/af243-seed-v5/r1/scores.json,data/phase25-exit/af243-seed-v5/r2/scores.json,data/phase25-exit/af243-seed-v5/r3/scores.json \
  --baseline E --candidate H
```

计数：**改善 7 / 持平 5 / 回落 0**（12 个 persona×难度单元）。

| persona | 难度 | E | H | delta | 自然度 | 情绪连续 | 话轮形态 | 场景一致 | 关系在场 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| vpt_grief_avoidance_l1 | L2 | 4.167 | 4.167 | 0.000 | 0.000 | 0.167 | 0.000 | 0.000 | 0.000 |
| vpt_grief_avoidance_l1 | L3 | 4.000 | 4.000 | 0.000 | -0.167 | 0.000 | 0.167 | 0.000 | 0.167 |
| vpt_parenting_projection_l1 | L1 | 3.833 | 3.833 | 0.000 | 0.000 | 0.000 | 0.000 | 0.167 | -0.167 |
| vpt_self_worth_intellectualization_l1 | L1 | 4.167 | 4.167 | 0.000 | 0.000 | -0.167 | 0.500 | 0.167 | 0.333 |
| vpt_self_worth_intellectualization_l1 | L3 | 3.833 | 3.833 | 0.000 | 0.000 | 0.000 | -0.333 | 0.167 | 0.500 |
| vpt_grief_avoidance_l1 | L1 | 4.167 | 4.333 | 0.167 | 0.500 | 0.167 | 0.167 | 0.167 | 0.333 |
| vpt_parenting_projection_l1 | L2 | 3.833 | 4.000 | 0.167 | 0.167 | 0.000 | 0.167 | -0.167 | 0.167 |
| vpt_intimate_avoidance_l1 | L1 | 4.000 | 4.167 | 0.167 | 0.000 | 0.167 | 0.500 | 0.167 | 0.500 |
| vpt_intimate_avoidance_l1 | L2 | 3.667 | 4.000 | 0.333 | 0.167 | 0.167 | 0.500 | 0.333 | 0.167 |
| vpt_parenting_projection_l1 | L3 | 3.500 | 3.833 | 0.333 | 0.333 | 0.333 | 0.167 | 0.167 | 0.500 |
| vpt_self_worth_intellectualization_l1 | L2 | 3.833 | 4.167 | 0.333 | 0.333 | 0.167 | 0.333 | 0.000 | 0.667 |
| vpt_intimate_avoidance_l1 | L3 | 3.667 | 4.167 | 0.500 | 0.500 | 0.333 | 0.000 | -0.167 | 0.667 |

按 persona 汇合（三轮×三难度均值）：

| persona | E 均值 | H 均值 | 平均 delta | 判断 |
| --- | --- | --- | --- | --- |
| vpt_intimate_avoidance_l1 | 3.778 | 4.111 | +0.333 | 增益最大，三档全正 |
| vpt_parenting_projection_l1 | 3.722 | 3.889 | +0.167 | 两档正、一档平 |
| vpt_self_worth_intellectualization_l1 | 3.944 | 4.056 | +0.111 | 一档正、两档平 |
| vpt_grief_avoidance_l1 | 4.111 | 4.167 | +0.056 | 基本持平 |

整体平均 delta `+0.167`，与 AF-243 总均分差一致；说明总均分差不是靠某个离群单元放大出来的。

## 逐轮明细与波动

| 轮 | 改善 | 持平 | 回落 | 回落单元 |
| --- | --- | --- | --- | --- |
| r1 | 5 | 4 | 3 | self-worth 的 L1/L2/L3 各 -0.5 |
| r2 | 5 | 3 | 4 | parenting L1 -1.0；grief L3、intimate L1、parenting L2 各 -0.5 |
| r3 | 4 | 7 | 1 | intimate L2 -0.5 |

单轮会出现 ±0.5 的整档摆动，因为每单元每轮只有 1 场×2 评分员；但三轮合并后没有单元仍为负。r1 的 self-worth 三档同时 -0.5、r2 的 parenting L1 -1.0 更像该轮评分员整体偏严，而不是 V5 的系统性缺陷。审计以三轮合并为准，单轮表保留用于追踪波动。

## 结论

1. **增益不集中**：4 个 persona 的平均 delta 全部为非负；最大的 intimate avoidance 也只有 `+0.333`，不足以单独解释 `+0.167` 的整体增益。
2. **没有明显回落**：任务单定义的 `delta < -0.25` 在三轮合并后为 0 个单元；单轮出现过 -0.5/-1.0，但都被后续轮次抵消。
3. **增益主要来自关系在场**：改善单元的关系在场 delta 多为 `+0.333 ~ +0.667`；自然度只有 grief L1 `+0.5`、intimate L3 `+0.5` 两处明显提升，其余多为 0 或小幅正。这与 V5 的设计假设一致——V5 修的是“回应咨询师这个人”，不是“写得更自然”。
4. **过拟合判断**：不支持“V5 只对少数 persona 有效”。但 12 个单元×3 场的样本量只能排除“明显系统性回落”，不能证明每个 persona 都稳定提升；下一步若要上生产，应优先补 grief 与 parenting 的更多场次，而不是继续调 prompt。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| 定向单测 `pnpm exec vitest run test/auto-practice/af245-persona-delta.spec.ts` | 2/2 passed |
| `pnpm lint` | exit 0，0 error |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 253 passed / 1 skipped（文件）；4222 passed / 4 skipped（用例） |
| `git diff --stat HEAD -- src/engine-core` | 空 |

lint 首轮失败 8 error：`unicorn/no-exports-in-scripts`（纯函数导出）、`prefer-switch`、`sonarjs/different-types-comparison`、3 处 prettier。处理：按 `bin/long-session-acceptance.ts` 先例加 `eslint-disable unicorn/no-exports-in-scripts`（纯函数需被单测导入，主流程有 isDirectRun 守卫）；参数解析改 `switch`；`argv[index+1]` 先 `?? ''` 再判空；`eslint --fix` 收敛格式。复跑 lint 0 error。

## 偏差与遗留

- 任务单要求“输出 Markdown 表与 delta”，CLI 只打印、不落文件；交付记录保存三轮合并表，CLI 保持无副作用。这是有意偏差：审计结果应跟随任务记录，而不是在 `data/` 下散落报告。
- CLI 增加了 `--files` 多轮合并能力，超出任务单最小要求，但避免为“三轮合并”再写一个一次性脚本。
- 仍未解决：每单元样本量小（3 场×2 评分员）；`four-rate` 仍低于 E；`[emotion:anxious]` 仍待生产投影层处理；生产 visitor 路由尚未建任务。
- 下一步建议：AF-246 生产 visitor provider 路由/feature flag（默认关闭）+ 未知 emotion 投影归一化；这两项落地后再谈 V5 进灰度。
