# Phase3 文字层真人度 · P1 审计基线（草案 · 待 P0 收口后复核派发）

> 状态：📝 预研草案（2026-11-12），**不是待开工任务单**；须等 P0 度量层验收闭环后，主控复核锚点与闸门数字再派。
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`
> 唯一事实源：`docs/worklog/pending/phase3-text-disfluency-humanization-plan-2026-11-11.md`（下称「蓝图」）§5.2、§6 P1。
>
> 本单只覆盖蓝图 §6 **P1 · 审计基线**；P0 度量层（进行中）、P2 Prompt 与开关、P3 角色配置与灰度准出均不在本单。

---

## 1. 范围与边界

### 1.1 P1 要做（仍零行为变化）

1. **审计脚本口径收敛同源**：`scripts/ops/quality/visitor-quality-audit.ts` 废弃脚本内私有 `FILLERS`（:134）与私有 `normalize`（:266-268），改为从 P0 纯模块 `src/auto-practice/metrics/disfluency-analyzer.ts` / `disfluency-lexicon.ts` import；这是 P0 锚点表第 11 行「归一化口径偏差」的收尾。
2. **audit 新增 D7 段**：六类不流利分布（`events_per_turn` / `event_turn_rate` / `density_per100` / 六类 `*_per_turn`），输出与 `humanization-v1` 种子区间并列对照（蓝图 §5.2.4）；**只观测对照，不改判据阈值**。
3. **D7 输出快照测试**：覆盖六类计数、聚合口径、无原文泄漏护栏；落点 `test/quality/`（与 `p1d-visitor-quality-lexicon.spec.ts` 同目录）或 `test/auto-practice/metrics/`，实现方在交付记录注明选择。
4. **跑两个离线批次出基线**：env 默认 audit；跑 ≥2 个离线批次（含既有 8 角色），基线产物 `data/quality/disfluency-baseline-<batchId>.json`（只含数字与批次 id，无原文）；基线文档给种子词表/区间的校准建议，**不直接改判据**。

### 1.2 明确排除

- **P2**：`disfluency-profile.ts` / `disfluency-instruction.ts`、档位解析、4 个 env 键、`.env.example`、output guard 超限重生成、off 模式 prompt 逐字快照——全部不做。
- **P3**：character 实体两列、手写 migration、ormconfig 双登记、ResolvedCharacter 侧通道透传、A/B 灰度、人工读感准出、`humanization-v1` 判据正式生效——全部不做。
- **engine-core 纯层一行不动**；不新增内核导出/文件；不碰 prompt 模板；不加表、不加 env 键。

## 2. 现状锚点（P0 收口后需逐条复核）

| #   | 核对项       | 现状锚点                                                                                                                                              | P1 动作                                                                  |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | P0 纯模块    | `src/auto-practice/metrics/disfluency-analyzer.ts`、`disfluency-lexicon.ts`（P0 产物）；`analyzeDisfluency` / `aggregateDisfluency` 签名见蓝图 §5.2.1 | audit 从这里 import，不再私有词表                                        |
| 2   | 字典 8 键    | `metric-dictionary.ts` 的 `text.disfluency.*`（dict-v2，P0 产物）                                                                                     | D7 读数口径与字典 id 一一对应，不另造字段                                |
| 3   | audit 脚本   | `deriveTextSignals` :374-398、`FILLERS` :134、`normalize` :266-268、`reportD4` :800-808、`--dir` 离线用法 :847-857                                    | 迁移填充词/归一化口径；新增 `reportD7`；保留离线目录用法                 |
| 4   | 现有单测     | `test/quality/p1d-visitor-quality-lexicon.spec.ts`；`test/auto-practice/metrics/disfluency-analyzer.spec.ts`（P0）                                    | D7 快照测试就近落 quality 或 metrics 目录                                |
| 5   | 基线产物路径 | `data/quality/`（本地证据，按既往惯例不入库；`anchor-sample-30.csv` 为既有入库例外）                                                                  | `disfluency-baseline-<batchId>.json` + 基线备忘                          |
| 6   | 判据版本     | `acceptance-thresholds.ts`：`INTAKE_EXPECTATIONS`（基线档）、`INTAKE_EXPECTATIONS_COLD`（cold 候选档）；`humanization-v1` 区间在蓝图 §5.2.4           | P1 **只追加对照展示**，不把 `humanization-v1` 接进门禁求值（属 P3 准出） |

## 3. 闸门（草案，P0 收口后按 delivery-gating-commits 复核）

- `pnpm exec tsc -p tsconfig.build.json --noEmit` 0 错
- `pnpm lint` 0 error
- 定向 vitest：`pnpm exec vitest run test/quality test/auto-practice/metrics` 全绿
- audit 脚本实跑：`pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir <离线目录>` exit 0；人工核对输出结构、确认无对话原文
- `git diff --stat HEAD -- src/engine-core` 为空

## 4. 交付记录（固定路径，派发时填）

`docs/worklog/completed/phase2.5/phase3-disfluency-p1-audit-baseline-implementation-2026-11-12.md`：改动文件清单、口径迁移前后对照、两批次基线数字、区间校准建议（区分「观测事实」与「建议调参」）、闸门真实数字与机器状态、遗留登记。

## 5. 待 P0 验收时确认的开放项

- P0 实际落地的模块导出名与字段形状（以代码为准，蓝图签名仅参考）。
- audit 脚本是否需要一并读取服务层已投影的 `disfluency` 数值（复用快照），还是脚本内对 visitor 文本直调 analyzer——二选一，口径必须与 P0 快照一致。
- 基线第二批离线批次选哪个目录（既有归档批次 `data/archives/` 下候选）。
