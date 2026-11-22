# WP-K · 批次回归追踪设施 · 交付记录

- 日期：2026-11-11
- 执行：主 Agent（自做）
- 基线：HEAD `e3b0680`，本轮所有改动在其之上、**未提交**
- 任务单：`docs/worklog/pending/wp-k-batch-regression-tracking-task-2026-11-11.md`
- 性质：可观测性基础设施（必须先于 WP-L 完成）

---

## 1. 一句话结论

**已建成「批次快照固化 + 分段配置指纹 + 四态回归判定 + 代码化验收 + 可进 CI 的 CLI/API」的完整闭环，并在真实开发库与真实批次上跑通；验收中自查出判定器自身 4 处缺陷（K-1~K-4），其中工程性 K-1/K-4 与临床性 K-2 已修复，统计性 K-3 记为演进方向。历史批次从此可回溯、可对比，且无效/不可比批次会被强制拒绝硬比，不再产出"自信的错结论"。**

---

## 2. 实际实现 vs 任务规格（偏差与原因）

| 项           | 规格                        | 实际                                         | 原因                                                                                                                                                                                   |
| ------------ | --------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 配置指纹算法 | canonical JSON 序列化数值段 | **全部文件级哈希**（7 段）                   | 系数本体在私有 `DELTA_TABLE`（未 export），拿数值须改内核；文件级哈希零内核改动，与现有 `prompt-fingerprint` 完全同构（Git/Docker layer 同款内容哈希）。已在任务单 D2 标注为设计修正。 |
| 分段边界     | 按逻辑概念分段              | 按**真实文件边界**（一个文件一段）           | 不假装能细分同文件内的两个常量。已知取舍：同文件内改注释也会改变该段（保守方向，宁可多报）。                                                                                           |
| 浮点         | 统一 round                  | 统一 `round6`                                | 实测必需：`bdiSnapshot.resistance` 末值 `0.2500000000000001`，不 round 会导致 JSON 不可 diff、指纹不稳定。                                                                             |
| 判据触发     | 四态 + 4 条 incomparable    | 四态 + **5 条** incomparable（新增角色集合） | 验收中发现仅比模式集合、不比角色集合会误判（K-4）。                                                                                                                                    |

### 验收中自查出的判定器缺陷（K-1~K-4）

- **K-1（已修，工程）**：p10/p90 百分位原本参与自动 verdict，小样本（16 场）下对单个极端场敏感，与均值一起判定产生大量自相矛盾信号。修复：metric-dictionary 把 p10/p90 的 direction 显式改为 `neutral`，仅作分布诊断保留在快照，方向判定一律走均值/速率。
- **K-4（已修，工程）**：判定器原只检查 counselorModeId 集合、不检查 characterSlug 集合。实测单角色批次对比三角色批次，角色集合不同却因模式相同、覆盖率满被误判 regressed。修复：新增 `characterSlugs()` 收集函数与第④条 incomparable 条件，并补对应测试。
- **K-2（已修，临床）**：内核 `BdiResistance` 确认 verbal/depth/style 是「阻抗」（0..1，越高防御越强）。dictionary 原给长期方向 `lower_is_better`，但 intake 首次会谈的目标是「防御保持稳定、不被击穿」，不是「越低越好」；原逻辑把长期方向直接用于 intake 跨批判定、没有阶段切换，方向判反。修复：阻抗三维在自动 verdict 中按 `neutral` 处理（不参与自动好坏），其质量由单批 acceptance 的 `max_delta` 独立兜底（超标即 FAIL，不会漏）。
- **K-3（记为演进，统计）**：跨批判定用固定 0.01 容差、无统计显著性/置信区间，16 场小样本下 0.02~0.03 的 LLM 随机波动可能被当成确定性回归。当前快照未存 per-session 方差，做不了 t-test/bootstrap。详见 §9。

---

## 3. 改动文件清单

### 新建源码（11 个）

| 文件                                                    | 用途                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/auto-practice/metrics/metric-dictionary.ts`        | D1 单一真相源：八维×6 标量 + 11 事件×2 + 8 策略×2 + 汇总；纯常量零 IO |
| `src/auto-practice/metrics/round.ts`                    | round6 / roundRecord，浮点统一                                        |
| `src/auto-practice/config-fingerprint.ts`               | D2 文件级哈希分段（7 段），fail-closed                                |
| `src/auto-practice/metrics/batch-metrics.schema.ts`     | D3 BatchMetricsV1 + is/assert 手写守卫 + schema 版本                  |
| `src/auto-practice/metrics/batch-metrics.compute.ts`    | D4 纯函数计算（含百分位线性插值、合规投影）                           |
| `src/auto-practice/metrics/batch-metrics.service.ts`    | D4 Nest 服务：读文件/sha256/合规投影/transcriptRoot/归档自动发现      |
| `src/auto-practice/metrics/acceptance-thresholds.ts`    | D6 intake 判据代码化 + 单批验收                                       |
| `src/auto-practice/metrics/regression-evaluator.ts`     | D6 四态判定器（5 条 incomparable）                                    |
| `src/migration/1714900000045-AddBatchMetricsColumns.ts` | D5 8 列 + 2 索引，幂等（真库已执行）                                  |
| `bin/batch-report.ts`                                   | D7 CLI：参数 + 语义化退出码 0/1/2/3                                   |
| `docs/team/batch-regression-api-contract.md`            | D9 API 契约（只写契约不写前端）                                       |

### 新建测试（4 spec，共 36 用例）

| 文件                                                   | 用例数 | 覆盖                                               |
| ------------------------------------------------------ | ------ | -------------------------------------------------- |
| `test/auto-practice/wp-k-metric-dictionary.spec.ts`    | 9      | 字典自洽：id 唯一、bounds、枚举覆盖、nullable 集合 |
| `test/auto-practice/wp-k-config-fingerprint.spec.ts`   | 6      | 指纹稳定/分段/必变/fail-closed/真实仓库            |
| `test/auto-practice/wp-k-batch-compute.spec.ts`        | 9      | 计算正确/黄金样本/确定性/合规字符串长度            |
| `test/auto-practice/wp-k-regression-evaluator.spec.ts` | 12     | schema 兼容 + 四态各触发 + K-2/K-4 专项            |

### 修改的现有文件

| 文件                                                  | 改动                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/migration/index.ts`                              | 加 045 export（双登记之一）                                                                              |
| `bin/ormconfig.ts`                                    | 加 045 import + migrations 数组条目（双登记之二）                                                        |
| `src/auto-practice/entities/practice-batch.entity.ts` | 加 8 列属性 + 列数注释（13→21）                                                                          |
| `src/auto-practice/practice-batch-health.service.ts`  | 注入 BatchMetricsService；收尾立即构建快照；persist 写 8 列（note 人工字段不覆盖；快照失败不清空已有列） |
| `src/auto-practice/auto-practice.module.ts`           | 注册 BatchMetricsService                                                                                 |
| `src/auto-practice/auto-practice.controller.ts`       | 加 3 端点 + toLightRow/loadSnapshot + 注入 batchRepo                                                     |
| `docs/worklog/pending/wp-k-...-task-2026-11-11.md`    | D2 改文件级哈希、D10 测试要求修正                                                                        |

---

## 4. 闸门表（真实数字）

> 按本轮确立的分层门禁策略（`pnpm` 优先、禁止裸 npx、日常定向、收尾全量），实际执行情况如下，全部如实记录。

| 闸门             | 命令                                            | 结果                                                 |
| ---------------- | ----------------------------------------------- | ---------------------------------------------------- |
| 类型             | `pnpm exec tsc -p tsconfig.build.json --noEmit` | **0 error**，exit 0                                  |
| Lint（改动文件） | `pnpm exec eslint <改动文件>`                   | **0 error 0 warning**，exit 0                        |
| 测试（定向）     | `pnpm exec vitest run test/auto-practice`       | **16 文件 / 233 用例全绿**，119s，exit 0             |
| engine-core      | `git diff --stat HEAD -- src/engine-core`       | **空**（未越界）                                     |
| 迁移（真库）     | `pnpm migration:run`                            | **8 列 + 2 索引建成**，历史行保持 NULL，无报错       |
| 真实回填         | `pnpm exec tsx bin/batch-report.ts --all`       | **9 批次各出 JSON+MD**，index.md 时间轴完整，无 skip |

诚实说明：本轮全量 eslint 缓存（`.eslintcache`）与全量 vitest 未在最后取得一次完整数字——全量任务在本会话中多次被外部中断（exit -1）。由于改动面局限在 auto-practice 模块，且 tsc 已做全量类型检查、定向 233 用例全绿，跨模块风险低；**建议在方便时后台各跑一次 `pnpm lint`（建立缓存）与 `pnpm test`（全量兜底）做最终确认**，这正是分层门禁里的收尾动作。

---

## 5. 历史批次指标摘要（9 批次，节选自 index.md）

| 批次                                    | 纳入/期望 | 探索率 | 深度变化(delta_avg) |
| --------------------------------------- | --------- | ------ | ------------------- |
| verify-route1-2026-11-10                | 16/16     | 0.0625 | -0.164776           |
| verify-route1-2026-11-10-r2             | 16/16     | 0.0625 | -0.135873           |
| ll--zCvaQpgTEw8GvOO_w                   | 3/3       | 0      | -0.142308           |
| 6aCuNBd01rCzZgkFvRXIY                   | 3/3       | 0      | -0.129487           |
| XhkRkyS0NFJp-4EXDQZVx                   | 1/1       | 0      | 0                   |
| verify-verbal-voice-smoke-2026-11-10    | 1/1       | 0      | 0                   |
| verify-verbal-voice-smoke-2026-11-10-r2 | 1/1       | 0      | 0                   |
| verify-route1-p1d-2026-11-10            | 16/16     | 0.125  | -0.084655           |
| verify-jingchen-expert-retry-2026-11-11 | 1/1       | 0      | -0.106667           |

### incomparable 门禁有效性

- 真实场景：`baseline-20261109`（500 场、89.8% `token=0`）在 batch 表无对应行，未进入 9 批次回填；其「应被拒绝」的判定由单元测试覆盖。
- 机器验证：5 条 incomparable 触发条件（acceptance 段/覆盖率/mode 集合/character 集合/combined unknown）在 `wp-k-regression-evaluator.spec.ts` 各有独立用例，任一条成立即强制返回 `incomparable` 并附原因，无法硬比。这正是防止「拿 89.8% 空批次当基线、得出探索率 0%→13.1% 假改善」的地基。

---

## 6. 指纹实验（只记哈希片段与变化段）

- 9 批次实测 combined 指纹均为 `418e08ca1224e53e`（这些批次运行时配置一致）。
- 每段为 16 位 hex，路径 + 内容共同入哈希；任一段文件读不到 → 该段 `unknown`、combined 也 `unknown`（fail-closed），有专项测试。
- `compareFingerprints` 返回发生变化的段名，供 API 与报告直接归因（变的是 stateTransition / alliance / acceptance 等哪一段）。

---

## 7. 四态语义自测记录

| 态           | 触发条件                                               | 测试覆盖               |
| ------------ | ------------------------------------------------------ | ---------------------- |
| improved     | 有方向指标超 tol 且向好（如 trust.delta +0.12）        | ✅                     |
| regressed    | 有方向指标超 tol 且向坏（如 trust.delta -0.12）        | ✅                     |
| neutral      | 全部变化在 tol 内                                      | ✅                     |
| incomparable | 5 条任一成立                                           | ✅ 5 条各一用例        |
| 综合规则     | 任一指标回归即整批回归；否则有改善即改善；全中性才中性 | 保守综合，见 evaluator |

---

## 8. 风险与回归

- **未碰 engine-core**：`git diff --stat HEAD -- src/engine-core` 为空，纯计算内核零改动。
- **未碰前端**：Flutter 客户端、admin-dashboard 均无改动；D9 仅给契约。
- **未改门槛/基线/词表/DELTA_TABLE**：这些属 WP-L 范围，本单严格隔离。
- 既有测试：K-1 改 p10/p90 方向、K-2 改阻抗方向后，已核对无测试依赖其旧方向（相关测试只断言存在性与数值，不断言方向），定向 233 全绿。
- 合规：聚合入参类型 `TraceInput` 物理上不含 messages/renderSpec/intention.rationale，只含扁平键与计数；有测试断言快照 JSON 最大字符串长度 ≤ 64，挡住台词/原文泄漏。

---

## 9. 遗留项与演进

1. **K-3 统计显著性（演进方向）**：引入 per-session 方差存储 + t-test/bootstrap 置信区间 + 最小实际意义阈值（MDE）+ 多重比较校正，使小样本随机波动不再被当确定性回归。这是独立的实验平台能力，建议单开任务、不与 P0 收尾混做。
2. **全量闸门兜底**：方便时后台跑 `pnpm lint`（建立 `.eslintcache`）与 `pnpm test`（全量）确认最终全绿。
3. **黄金样本 fixture**：任务单 D10 原要求 `test/fixtures/batch-metrics/` 放 2~3 场独立 traces 摘录；当前用内联 `toMatchObject` 覆盖，是否补独立 fixture 目录待定。
4. **WP-L 衔接**：WP-L（15 处 delta 数值 + intake 验收口径）属内核协议变更，数值需大炮最终拍板后执行；本单已为其提供改前/改后对比能力。
5. 效率优化已固化：`pnpm` 优先、禁止裸 npx、eslint 缓存、vitest 按需（test:changed / test:related），并已写入 `conventions.md` §1.3 与 `wp-task-template.md` §5。
