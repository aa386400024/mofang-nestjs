# WP-E 交付回复：自动评测 + 参数调优流水线

> **实际完成时间**：2026-11-09 14:10（本地）
> **本文件**：完整回复内容（与对话回复一致）

WP-E 已完成：一条**可重复、可对比、可追溯**的评测流水线落在 `src/engine-adapters/eval/`——
数据加载 → 四道清洗门槛 → 批量跑（离线读历史 / 全量重跑）→ 跟 ground truth 比 → 算指标
（触发质量 P/R/F1 + 建议质量六维方向 macro F1 / 幅度 MAE + 纯规则基线对比）→ 出结构化 JSON 报告 → 落 `eval_reports` 表，
并提供一条命令就能跑完的 CLI，**零基础设施依赖**（不起 MySQL / Redis / 不调模型做裁判）。

---

## 一、闸门数字（全部实测）

| 验收项 | 命令 | 结果 |
|---|---|---|
| tsc 0 错 | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 错** |
| eslint 0 error | `npx eslint src/engine-adapters/eval/ test/engine-adapters/eval/` | ✅ **0 error / 0 warning** |
| 单测全绿 | `npx vitest run test/engine-adapters/eval/` | ✅ **3 文件 / 44 例全绿** |
| engine-core 零改动 | `git diff --stat HEAD -- src/engine-core` | ✅ **空** |
| CLI 能跑 | `npx tsx scripts/eval-runner.ts --mode offline` | ✅ **出报告**（见 §四） |
| 报告字段完整 | 任务单 §4.4 全字段 | ✅ 齐（13 个顶层字段） |
| 数据清洗生效 | 同上 | ✅ 总 8 / 有效 4 / 丢弃 4（四类原因各 1） |

**全量回归**：`npx vitest run --exclude "**/e2e/**/*.ts"` → **146 文件（145 通过 / 1 跳过）/ 2475 例（2471 通过 / 4 跳过）/ 0 失败**。

---

## 二、交付了什么

```
src/engine-adapters/eval/
  ├── eval.types.ts              ← 类型契约 (纯 TS, 零 @nestjs / 零 IO)
  ├── eval.dataset.ts            ← 数据层: 加载 (IO) + 清洗 (纯判定) + 督导案例解析
  ├── eval.ground-truth.ts       ← 真值层: A 方案 (规则差异) / B 方案 (督导标注)
  ├── eval.metrics.ts            ← 计算层: 纯函数指标 (零 IO / 零 env)
  ├── eval.runner.ts             ← 执行层: 批量跑, 只收集预测 (不算指标)
  ├── eval.report.ts             ← 报告层: 装配 + 跨版本对比 + 仓储端口
  ├── eval.service.ts            ← 入口层: 串链路 + 兜异常 (+ Nest 服务类)
  ├── eval.module.ts             ← NestJS 模块
  ├── eval-report.entity.ts      ← eval_reports 表实体
  └── eval-report.repository.ts  ← eval_reports 仓储 (TypeORM)

scripts/eval-runner.ts                        ← CLI (不起 Nest 容器 / 不连库)
src/migration/1714900000036-CreateEvalReports.ts  ← 手写 DDL (ADR-0003)
test/engine-adapters/eval/{eval.metrics,eval.dataset,eval.runner}.spec.ts  ← 18 + 14 + 12 = 44 例
data/eval-datasets/synthetic-{supervisor,train}-v1/dataset.json  ← 合成种子集
```

另外改了 3 个文件：`bin/ormconfig.ts` + `src/migration/index.ts`（migration **严格 1:1 登记**，漏登记 = 静默不建表）、
`.gitignore`（真实数据集与报告不出境，只放行合成种子集）。

---

## 三、关键设计决策（为什么这么做）

1. **四层分工沿用 WP-C 的治本思路：判定只有一份。**
   数据层管清洗、真值层管"该不该跑"、计算层**纯函数**算指标、执行层只收集预测、入口层串链路兜异常。
   计算层零 IO 是硬要求——报告的数字要能**复现**，而"跟上一版比"完全依赖可复现。

2. **闸门重算走 WP-C 的 `evaluateGate`，评测里不重写判定。**
   全量重跑用当前策略**重算**每一轮决策（纯函数、确定性）；再写一份阈值逻辑 = 两份迟早漂移，
   而"评测说闸门变了"可能只是评测自己变了。

3. **不用规则 delta 冒充人类真值。**
   A 方案（训练集）只有"该不该跑"的真值（规则 vs 参考审议差异），**没有**"该调多少"的真值 →
   建议质量字段保留但标 `available=false` 并写明原因，而不是给 0 分（0 分会被读成"审议全错"）。

4. **两道防"退化解"的护栏。**
   方向准确率用每维**三分类 macro F1**（命中率在"几乎全是平稳轮"的数据集上恒等于 1，全押"平稳"就满分）；
   且只有**有信号**的维度（真值出现过非平稳）计入 macro 平均与幅度 MAE。

5. **审议重跑做成窄端口 `EvalDeliberationExecutorPort`。**
   装配了就真重跑（花钱、几十秒），没装配就只重算闸门，并在报告 notes 里写明"未装配审议执行器"——
   **不静默假装重跑过了**。

6. **报告里保留纯规则基线，是回归保护。**
   纯规则方向准确率一跌 > 0.03，报告自动标红："先修回归，再谈调参"。

7. **未新增任何 env 键。** 闸门阈值全部取自 WP-C 配置层常量或请求参数，不触碰 WP25 的 env 双向守卫。

---

## 四、CLI 实测输出

```
报告已写入: data/eval-reports/eval-20261109-140439-bbfc9e15.json
  触发质量: P=0.615 R=0.667 F1=0.640 (TP=8 FP=5 FN=4 TN=15)
  建议质量: macro F1=0.833 幅度 MAE=0.006 (对比轮次 9)
  基线对比: 0.762 → 0.833 (+0.071)
  数据质量: 总 8 / 有效 4 / 丢弃 4 (tooShort=1 errors=1 bdiAnomaly=1 noTrace=1)
  运行 1 次 (F1 标准差 0.0000) / 耗时 0.00s / token 10243
  ⚠ 数据集为合成数据: 指标只验证链路可用, 不能作为验收结论
```

A 方案（训练集）实测：触发质量照常可算（F1=0.478），**建议质量正确标记为不可算并写明原因**——红线在真实链路上生效。

---

## 五、偏差说明（跟任务单不一样的地方）

1. **CLI 命令：任务单写 `npx ts-node`，实际用 `npx tsx`。**
   实测 `npx ts-node scripts/eval-runner.ts --mode offline` 在本仓跑不起来：仓库是 ESM（`type=module`）+ NodeNext，
   相对 import 必须带 `.js` 扩展名，而 ts-node 的 ESM loader 不做 `.js→.ts` 映射 → `ERR_MODULE_NOT_FOUND`。
   已试 CJS 模式 / `--esm` / `preferTsExts` 三种配置，均失败。本仓所有脚本（`bin/seed-*.ts`、migration）本来就用 tsx，故统一走 tsx。
   脚本本身是纯 ESM + `.js` 扩展名写法，**两种 loader 完全兼容**，将来 ts-node 支持该映射即可直接用。
   （为试这条命令临时加过 `tsconfig.json` 的 `ts-node` 段，已回退，不留无关改动。）

2. **后端文件 8 → 10 个**（+ `eval-report.entity.ts` + `eval-report.repository.ts`）：
   `eval_reports` 要落库，而 ORM 依赖不能混进纯文件（CLI 要零依赖跑）。沿用 `turn-delta-audit` 先例。

3. **BDI 异常门槛改写**：任务单写"突然跳到 100 或 0"，实际实现为**越界 / 单轮跳变 ≥ 0.5 / 连续 3 轮全维度不变**。
   内核对信任类维度做了 clamp，**0 与 1 都是合法端点值**，把"等于 0/1"判成脏会误杀极端但真实的会话；
   真正该抓的"突变"由"单轮跳变"兜住。判定边界加了 1e-9 浮点容差（否则 `0.95-0.45 = 0.49999999999999994` 会漏判——这是实测踩出来的）。

4. **离线数据源从"读已有对练数据"改成文件型数据集（JSON 目录）**：
   本机 Redis(6379)/MySQL(3306) 均未运行、`data/debug-sessions/` 为空，按原方案**在本机根本跑不起来**。
   文件型数据集让 CLI 零依赖可跑，且**生产路径同格式**（读 Redis 审议 trace + 闸门 trace 后转成同一份 JSON 即可接入）。

5. **`eval_reports` 6 列 → 9 列**（+ `dataset_version` + `mode` + `report_json`）：
   前两列用于"同数据集版本内取上一版"（回归对比）；`report_json` 存整份快照——
   跨版本对比要的是"当时那一版"的完整事实（阈值 / 告警 / 数据集版本），只存汇总列复现不了当时的结论。

6. **督导案例验收集 → 合成种子集 + 解析器**：任务单 §5.3 提到的一万份逐字稿 + 督导解析**不在仓库内**，
   无法产出真实验收集。交付合成种子集（明确标 `synthetic: true`，报告强制告警）+ 按任务单格式实现的 `parseSupervisorCases()` 解析器，
   真实验收集留外部接入口。解析时**丢弃逐字稿**，原文不进数据集 / 报告 / 日志。

---

## 六、本机环境限制（写明以免误判）

- 本机 **Redis / MySQL 均未运行** → `eval_reports` 落库链路与"全量重跑 + 真调模型"的审议重跑路径**未做端到端验证**；
  已用端口抽象（内存实现 + 假执行端口 + 单测）覆盖替代。大炮在有库环境跑 `pnpm migration:run` 后即可用（模块已装配、entity 已 `forFeature` 注册）。
- **真实督导语料不在仓库内** → 出口条件④"准确率 ≥ 80%"需要真实语料才能最终判定；本单交付的是仪器。

---

## 七、回写清单

| 文档 | 改动 |
|---|---|
| `docs/worklog/completed/phase2.5/phase2.5-wp-e-auto-evaluation-tuning.md` | 任务单从 `pending/` 迁到 `completed/phase2.5/`，状态行改 ✅ 已交付 + 指向交付记录 |
| `docs/worklog/completed/phase2.5/phase2.5-wp-e-auto-evaluation-implementation-2026-11-09.md` | 交付记录（方案 / 12 条偏差 / 闸门数字 / 交付物 / 限制 / 回写） |
| `docs/worklog/pending/phase2.5-README.md` | WP-E → ✅ 已完成；"当前有什么活"改为五 WP 全交付 + 下一步是喂真实督导语料 |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` | WP-E → ✅ 已交付；出口条件④补状态说明 |
| `.gitignore` | 真实评测数据集 / 报告不进版本库，只放行 `synthetic-*` 种子集 |

**红线核对**：`git diff --stat HEAD -- src/engine-core` = **空** ✅；未改任何前端 / Flutter 客户端；
工作树里 `admin-dashboard/**`、`src/auto-practice/practice-queue.service.ts` 的改动是**另一个 AI 的**，不是本单产物，未触碰。

---

## 八、commit message 草稿

```
feat(wp-e): 自动评测流水线——触发质量P/R/F1+建议质量六维macroF1/幅度MAE+纯规则基线对比+清洗门槛+报告落库
```

**下一步（不是写代码，是喂数据）**：把外部督导案例喂给 `parseSupervisorCases()` 造 B 方案验收集 →
跑一轮评测 → 看哪个维度差 → 手改 WP-C 的 env 阈值 → 再跑一轮。
红线：**调参阶段不许看验收集**，调完才跑一次最终验收。
