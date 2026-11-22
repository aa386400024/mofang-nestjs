# AF-342 交付记录 · 真人度签名判据 v1 与零调用回验

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-342/task-sheet.md`
- 基线：`e91497412a3f0c6d1245f49ef206e4df75229b47`
- 日期：2026-11-23

## 1. 改了哪些文件

| 文件 | 变更 |
| --- | --- |
| `src/shared/realism/realism-humanization-judge.ts` | 新增纯函数判据 `realism-signature-judge-v1`：人设签名 + 密度过载三态；含逐样本与分组汇总 |
| `bin/visitor-realism-humanization-judge.ts` | 新增回验 CLI：只读 rep 文件、零模型调用、支持按臂传入目录 |
| `test/shared/realism/realism-humanization-judge.spec.ts` | 新增 16 例单测 |
| `docs/worklog/completed/phase2.5/af342-...-report-2026-11-23.md` | 回验报告 |
| `docs/worklog/completed/phase2.5/af342-...-2026-11-23.md` | 本交付记录 |
| `docs/worklog/records/.../AF-342/` | 任务单、manifest、回执 |

## 2. 判据契约

```text
输入: persona, turns, densityPer100, counts{filler,pause,repetition,repair,trailoff,elongation}
输出: verdict ∈ {off-like, humanized, overloaded}
      signaturePassed, signatureScore, signatureRule, densityCapPer100, reasons[]

规则:
  anxious  signature = repair/turn >= 0.05
  guarded  signature = pause/turn >= 0.9 或 trailoff/turn >= 0.15
  签名不保留 -> off-like
  签名保留 + density <= 4.943817 -> humanized
  签名保留 + density >  4.943817 -> overloaded
```

常量全部集中在模块顶部，带来源注释；替换阈值不影响调用方。

## 3. 回验（零调用）

命令：

```powershell
pnpm exec tsx bin/visitor-realism-humanization-judge.ts `
  --samples "off=data/phase25-exit/af336-realism-off-baseline-extension/reps,full=...,minimal=...,typed=...,typed-noshape=...,shape-capped=...,tightened=..." `
  --out data/phase25-exit/af342-realism-signature-judge/report.json
```

结果：

- 112 个样本，0 模型调用。
- off 误报 `0/16`；full 签名覆盖 `16/16`。
- minimal 与 typed-noshape `32/32` 判 off-like。
- 焦虑 tightened `8/8 humanized`；回避 tightened `8/8 off-like`。
- 焦虑 typed 3 humanized / 5 overloaded；焦虑 shape-capped 3 / 5；回避 shape-capped 1 off-like / 1 humanized / 6 overloaded。

## 4. 设计决策与偏离

| 决策 | 理由 |
| --- | --- |
| 不用训练型分类器 | 样本 112、特征 10，训练必然过拟合；规则判据可解释、可审计、可零调用复跑 |
| 用签名轴而不是密度轴做“真人化”判断 | AF-341 已证明密度与 off 可分离性互斥；签名轴绕开该冲突 |
| 焦虑阈值取 0.05、回避取 0.9 / 0.15 | 都从 off 16 上界外留余量，且 full 16 全部通过 |
| 密度上限沿用 4.943817 | 与 AF-335/337 的 full-only 报警线一致，避免再造第二套口径 |
| 不改生产块 / 不替换 humanization-v1 | 本单是影子判据；是否上线由大炮决定 |

无任务单范围外改动。

## 5. 闸门数字

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 297 文件通过 / 1 跳过（298）；4554 例通过 / 4 跳过（4558） |
| 定向单测 | 16/16 通过 |
| `git diff --stat HEAD -- src/engine-core` | 输出为空 |
| `pnpm orchestration:preflight` | PASS files=7（提交 7d1d200c 时执行） |
| 验收状态 | 机读 rejected（缺六组标记 / 任务单指针指向 transport），由 AF-344 返修 |

## 6. 已知限制

- 单模型、合成人设、12 轮；阈值基于 16 个 off 样本，样本量小。
- 焦虑“一次改口”阈值偏宽，可能接受偶发噪声。
- 判据不评价语言质量或临床适当性。
- 密度上限是报警线，不是产品验收线。

## 7. commit message

`feat(af342): 真人度签名判据 v1 与零调用回验`
