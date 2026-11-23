# AF-426 交付记录：在场 delta 标定台账 v1.0

- 日期：2026-11-24
- 任务：AF-426（documentation / orchestrator，承接 AF-425）
- 基线：`0441514b86326629a27457b26e4c466a9784cc8c`（AF-424 合并点）
- 分支：`task/AF-426-presence-calibration-ledger`
- 新增：`docs/architecture/presence-delta-calibration-ledger-v1.0.md`

## 1. 做了什么

把 AF-418（在场投影同源校准）、AF-420（env 覆写通道）、AF-421（幅度扫描）、AF-422（cap 感知重放）四单的结论收成一页台账，内容分六块：

1. **现状一张表**：内核种子（holding: safety +0.004 / bond +0.002 / verbal −0.002 / valence +0.004 / arousal −0.002；cold: trust −0.004 / safety −0.002 / bond −0.002）、种子性质（工程值非临床标定）、env 覆写键（`ENGINE_DELTA_HOLDING_PRESENT` / `ENGINE_DELTA_COLD_ABSENT`）、覆写粒度（逐维覆盖、未写维度回种子）、13 键 / 11 维装配、cap 边界。
2. **幅度实测表**：0× / 1× / 2× / 4× / 8× 的平均 safety、bond 增益与触顶场次；1× 批次总计 +0.4660 / +0.2320；达 +0.05 需 2×、达 +0.10 需 4×；8× 仍线性、0 触顶。
3. **cap 有效性**：0×–8× 五档 cap 损失轮次全 0、损失增量 0.000000 → **cap 不是瓶颈**。
4. **结构事实**：规则轨词表刻意不扩 → 两类 kind 只能由模型轨产出；模型轨没开就是 0 命中，八维照旧不动。这条把 zero_motion 审计里 R2 的「没有任何一条轨能产出」翻译成可执行判断。
5. **证据缺口**：cold 仅 1 轮（冷缺席方向无批次证据）、真人度未评分（幅度上调的体感风险无指标把关）、A′ 真实精确率未标定（AF-415 抽样待人工标注）。
6. **后续三件事**：按 117:1 之外的均衡取样、2×/4× 档跑 R4/R6、两个临床口径交督导拍板。

## 2. 设计取舍

- **不写实施步骤之外的代码改动**：本单是台账，不是改种子。台账只给「要多少倍」「瓶颈在哪」「还缺什么证据」，避免把文档变成隐性的行为变更。
- **每个数字带出处任务**：所有增益数字都能回查到 AF-418/421/422 的交付记录与脚本，台账本身不制造新数字。
- **把结构事实放在第 3 节而不是附录**：这是后续标定最容易踩的坑——只调 seed 不开模型轨，批次里永远看到 0 增益。

## 3. 闸门数字

| 闸门              | 命令                                                         | 结果                                                                                        |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| strict 记录包校验 | `node scripts/orchestration/cli.mjs worklog verify --strict` | 交付记录落盘前 FAIL（仅本单自身「交付记录缺文件」一条）；落盘后 PASS，继承孤儿 10/10 不报错 |
| lint              | `pnpm lint`                                                  | 0 error                                                                                     |
| typecheck         | `pnpm typecheck`                                             | 0 error                                                                                     |
| 内核边界          | `git diff --stat HEAD -- src/engine-core`                    | 空输出                                                                                      |

## 4. 遗留

- `src/engine-adapters/deliberation/deliberation-types.ts` 第 101 行「两类的 delta 种子是 ZERO」是第三处过期注释（AF-322 起已是非零种子）。本条属 `src/` 改动，orchestrator 资源域外，未在本单处理，登记 backlog 交 executor。
- 台账 v1.0 只覆盖「在场类」事件；11 个行为算子的幅度标定尚未成台账，后续可依同样格式扩成 v2.0。

## 5. 编号变更（AF-425 → AF-426）

AF-425 任务单 scope 写了 `src/engine-adapters/deliberation/`，越过 orchestrator Agent Card 的 `resources` 资源域，`run-once` 判 `scope-domain-conflict` 拒绝派发。AF-425 已 `task cancel` 并归档，文档部分重登 AF-426（scope 只留 `docs/architecture/`、`docs/worklog/completed/phase2.5/`、记录包）。
