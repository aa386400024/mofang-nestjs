# Phase2.5 / Phase3-P0 提交分组方案与 commit message 草稿（2026-11-12）

> 状态：📝 分组预案，**未执行任何 `git add` / `commit` / `push`**；按仓库纪律由大炮手动提交。
> 基线：分支 `integrate`；`git diff --stat HEAD -- src/engine-core` 当前为空（红线满足）。
> 证据：`data/quality/verify-17-22-slice-2026-11-12.txt`（本地证据，不入库，见 §4）。

## 1. 当前未提交清单归类（`git status --short` 实测）

### 组 A · P0 度量层代码与归档文档（MiniMax Code 产物；主控验收已通过）

修改（6 代码/测试 + 1 蓝图）：

- `src/auto-practice/metrics/batch-metrics.compute.ts`
- `src/auto-practice/metrics/batch-metrics.service.ts`
- `src/auto-practice/metrics/metric-dictionary.ts`
- `test/auto-practice/wp-k-batch-compute.spec.ts`
- `test/auto-practice/wp-k-metric-dictionary.spec.ts`
- `test/auto-practice/wp-k-regression-evaluator.spec.ts`
- `docs/worklog/pending/phase3-text-disfluency-humanization-plan-2026-11-11.md`（P0 落地状态小节回写，+35/-1，纯新增）

新增（3 代码/测试 + 2 归档文档）：

- `src/auto-practice/metrics/disfluency-analyzer.ts`
- `src/auto-practice/metrics/disfluency-lexicon.ts`
- `test/auto-practice/metrics/disfluency-analyzer.spec.ts`
- `docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-2026-11-12.md`（任务单，已归档，状态 ✅）
- `docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-implementation-2026-11-12.md`（交付记录）
- `docs/worklog/pending/archive/relay-response-20261112-1622.md`（MiniMax 回复原文存档，随历史 relay 惯例入库）

> pending 下 P0 任务单原件已由 MiniMax 移走（`Test-Path` = False），completed 下两份为正式归档，无重复副本。

### 组 B · Phase2.5 主控复核文档与只读脚本

修改（1）：

- `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-17 / I-21 / I-22 / I-23 复核结论回写）

新增（3 文档 + 1 脚本）：

- `docs/worklog/completed/phase2.5/phase2.5-audit-96-batch-six-dimension-rerun-2026-11-12.md`（A 备忘）
- `docs/worklog/completed/phase2.5/phase2.5-i23-safety-delta-attribution-2026-11-12.md`（B 备忘）
- `docs/worklog/pending/phase3-disfluency-p1-audit-baseline-draft-2026-11-12.md`（P1 预研草案，非待开工单）
- `scripts/ops/quality/phase25-verify-17-22-2026-11-12.ts`（只读复算脚本；建议入库——`scripts/ops/quality/` 既有 audit / lexicon 均入库，脚本只输出 id / 计数 / 标签 / 比率，无对话原文。已过 `eslint` 0 error、`tsx` exit 0，复算输出 102 行与拆分前一致）

## 2. 建议暂存顺序（手动执行，分组不混提）

```powershell
# 组 A：P0 代码 + 归档文档 + 蓝图回写（验收已通过）
git add src/auto-practice/metrics/disfluency-analyzer.ts `
        src/auto-practice/metrics/disfluency-lexicon.ts `
        src/auto-practice/metrics/metric-dictionary.ts `
        src/auto-practice/metrics/batch-metrics.compute.ts `
        src/auto-practice/metrics/batch-metrics.service.ts `
        test/auto-practice/metrics/disfluency-analyzer.spec.ts `
        test/auto-practice/wp-k-metric-dictionary.spec.ts `
        test/auto-practice/wp-k-batch-compute.spec.ts `
        test/auto-practice/wp-k-regression-evaluator.spec.ts `
        docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-2026-11-12.md `
        docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-implementation-2026-11-12.md `
        docs/worklog/pending/archive/relay-response-20261112-1622.md `
        docs/worklog/pending/phase3-text-disfluency-humanization-plan-2026-11-11.md

# 组 B：主控文档 + 复核脚本
git add docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md `
        docs/worklog/completed/phase2.5/phase2.5-audit-96-batch-six-dimension-rerun-2026-11-12.md `
        docs/worklog/completed/phase2.5/phase2.5-i23-safety-delta-attribution-2026-11-12.md `
        docs/worklog/completed/phase2.5/phase2.5-commit-grouping-2026-11-12.md `
        docs/worklog/pending/phase3-disfluency-p1-audit-baseline-draft-2026-11-12.md `
        scripts/ops/quality/phase25-verify-17-22-2026-11-12.ts
```

> 组 A 与组 B 必须分开提交：A 是下游 AI 的代码交付（走验收五类核对），B 是主控文档与证据脚本。`wp-k-regression-evaluator.spec.ts` 的 3 行改动已核对：`TraceInput` 新增必填字段所致夹具补值，属 P0 配套，未放宽既有断言。

## 3. commit message 草稿（一行式，沿用仓库 conventional 前缀）

- 组 A（沿用交付记录草稿）：`feat(auto-practice): 新增 Phase3 P0 文字层不流利度量层 (dict-v2 + 8 个 text.disfluency.* 指标)`
- 组 B（文档 + 脚本）：`docs(phase2.5): I-17/I-22/I-23 复核结论回写台账、P1 审计基线草案与只读复算脚本`
  - 若脚本单列：`chore(quality): 新增 Phase2.5 I-17/I-22/safety 切片只读复算脚本`

## 4. 不入库产物（`git add` 时显式排除）

- `data/quality/verify-17-22-slice-2026-11-12.txt` —— 本轮复核输出（本地证据）。
- `data/quality/safety-slice-96-2026-11-12.txt`、`safety-reconcile-96-2026-11-12.txt`、`char-label-map.txt` —— I-23 本地证据。
- `data/quality/*.log`（`audit-96-rerun-2026-11-12.log`、`audit-rerun-verify-2026-11-12.log`、`verify-run-2026-11-12.log`）—— 已被 gitignore。
- 例外：`data/quality/anchor-sample-30.csv` 为既有入库样本，保持不动。

## 5. 归档核对结论（2026-11-12 验收时已核对）

- completed 下 `phase3-disfluency-p0-metrics-2026-11-12.md` 是 **MiniMax 正式归档的任务单**（状态行已改 ✅ 并链接交付记录），`implementation-2026-11-12.md` 是正式交付记录；pending 原件已删，**无重复副本、无待清理异常**。
- 交付记录 §10 已把本单 12 文件与并行进程（组 B）9 文件分列，与本备忘分组一致。

## 6. 组 A 闸门核对结果（主控验收实测 / 抽跑复现）

| 闸门                                            | 交付记录数字                                          | 主控复核                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsc -p tsconfig.build.json --noEmit` | 0 error                                               | 未重跑，信任交付记录（定向 vitest 通过佐证类型链路）                                                                             |
| `pnpm lint`                                     | 0 error / 0 warning                                   | 未重跑，信任交付记录                                                                                                             |
| `pnpm exec vitest run test/auto-practice`       | 19 文件 / 293 例全过，8.21s                           | 抽跑 3 文件 47 例全绿（analyzer 21 + 字典 14 + compute 12），exit 0                                                              |
| `pnpm test` 全量                                | 3058 passed / 4 skipped / 0 failed（基线 3029 → +29） | 未重跑全量，信任交付记录                                                                                                         |
| `git diff --stat HEAD -- src/engine-core`       | 空                                                    | 复核为空；`schema.ts` / `.env.example` / migration / entity 均未改                                                               |
| 边界 grep                                       | analyzer import 仅 service                            | 复核：`analyzeDisfluency` import/调用只在 `batch-metrics.service.ts:25,65`；compute 层无 analyzer import、无 `text: string` 形参 |

**验收结论：通过**。非阻塞人工复核项（交付记录 §8，留待后续）：① 抽 3–5 轮真实 visitor 台词人工核对六类归类；② 核对含 `messages` 既有批次 8 指标量级；③ 核对无 `messages` 老批次 8 指标全 0 且其余指标未变。
