# Relay Response · D-1 第二段 · 模型轨事件分类器实现单（2026-11-12 22:15）

> 执行方：MiniMax Code · 仓库 `E:\Work\Project\backend\mofang-nestjs` · 分支 `integrate` · 基线 HEAD `7b80615`
> 任务单已归档：`docs/worklog/completed/phase2.5/phase2.5-d1-model-classifier-implementation-task-2026-11-12.md`
> 交付记录：`docs/worklog/completed/phase2.5/phase2.5-d1-model-classifier-implementation-2026-11-12.md`

## 结论

**模型轨事件分类器以中间态落地，9 项闸门全绿，工作区未 commit / 未 push。**

core 只加两个**可选**契约（`EventClassifier.classifyAsync?` / `ClassifyContext.sessionId?`，恰好 2 个 core 文件，不新增文件 / 不新增导出名 / 不改 `CounselorEventKind` 联合）；adapter 新增 `src/engine-adapters/cognition/` 四个文件实现「三态模式 + 标签映射 + 跨轮状态 + 旁路观测」。

## 红线逐条守

| 红线                                                              | 落地                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| core 仅例外改 2 个文件                                            | ✅ `git diff --stat HEAD -- src/engine-core` = **2 文件 / +38 / −4**；`boundary.spec.ts` 未改                |
| 不接 `llm_active`                                                 | ✅ core 接口层预留 `classifyAsync`，但装配**只注入 shadow**；配 `llm_active` 时启动日志打 warn「本单未接线」 |
| `exam` 恒 `rule_only`                                             | ✅ 判定链第一条，**不接受任何配置 / 名单覆盖**；场景查不到也保守 `rule_only`                                 |
| `strength` 恒 1                                                   | ✅ 置信度**只进观测**，不参与任何 delta                                                                      |
| 回落逐字等价规则轨                                                | ✅ 模型轨内部持规则轨实例，回落**代码只有一处**（共用 `SHARED_RULE_TRACK`）                                  |
| 不能先跑同步再跑异步                                              | ✅ 两分支**互斥**（`classifyAsync ? await : classify`）                                                      |
| 跨轮分桶键用业务 `sessionId`                                      | ✅ **禁用 `handleId`**；core 缺省不出该字段 → 回落模块级单例（与现状逐字一致）                               |
| 观测禁含原文 / `matchedTerms` / 解释文本 / `kernelState` / 展示名 | ✅ 字段白名单 + 测试断言                                                                                     |
| 审计停止自行分类                                                  | ✅ C3 已执行（本地 `RuleBasedClassifier` 已删，只吃内核事件）                                                |
| pnpm 禁裸 npx                                                     | ✅ 全部走 `pnpm exec` / `pnpm lint` / `pnpm test`                                                            |
| 不碰前端 / DB migration                                           | ✅ `git diff --stat HEAD -- src/admin-dashboard` = **空**；零 DDL                                            |
| 不自动 commit / push                                              | ✅ 未 commit、未 push；只给 commit message 草稿                                                              |

## 闸门实测（9/9 过）

| 闸门  | 命令                                                                      | exit | 结果                                                      |
| ----- | ------------------------------------------------------------------------- | ---- | --------------------------------------------------------- |
| GATE1 | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | 0    | 0 错                                                      |
| GATE2 | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | 2    | 396 错 / 86 文件，与既有基线**逐一致**；本单相关 **0 错** |
| GATE3 | `pnpm lint`                                                               | 0    | **0 error / 0 warning**                                   |
| GATE4 | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | 0    | **12 例全绿**                                             |
| GATE5 | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | 0    | **100 文件 / 1839 例**（基线 99/1779）                    |
| GATE6 | `pnpm test`                                                               | 0    | **3171 passed + 4 skipped（3175 例，191 文件）**          |
| GATE7 | `git diff --stat HEAD -- src/engine-core`                                 | 0    | 恰好 2 文件                                               |
| GATE8 | `git diff --stat HEAD -- src/engine-adapters`                             | 0    | 7 改 + 4 新                                               |
| GATE9 | `git diff --stat HEAD -- src/admin-dashboard`                             | 0    | 空                                                        |

机器状态：Node **v26.13.0** / pnpm **9.15.0** / 8 核 / 15.9 GB 总 5.8 GB 空闲 / 2 个 node 常驻（78.9 MB / 34.1 MB），无 watch。

> 口径：台账 §7.3 记历史交付记录的 Node 版本为 v22.23.2，本单**本会话实测 v26.13.0**，两者都是各自会话 `node -v` 实测值；历史交付记录**不回改**，本单按实测记录。

## 已登记偏差

1. **审计 `matchedTerms` 归零**：内核出参 `EngineTurnOutput.events` 只带 kind 不带 matchedTerms，core 扩第 3 个文件被禁止 → 审计事件由内核事件构造，matchedTerms 恒 `[]`。wp58 两条既有断言按任务单 §3.1-13 授权调整（`strength` 断言保留不变、matchedTerms 断言改 `toEqual([])`），并新增「审计事件集合 == 内核事件集合」断言。恢复需扩内核出参 → D-2 或另开例外。
2. **超出 §3.1 清单**：`model-classifier-observation.ts`（新增，承载 §4.4 观测字段）与 `turn-delta-audit.port.ts`（改动，C3 输入形状必然变更）。
3. **任务单内部口径**：写「11 类 + neutral」实为 11 类总（10 行为 + neutral）；写「adapter 7 个文件含 2 个新文件」，实到 **7 改 + 4 新**。
4. **工程取舍**：低置信阈值取代码常量 `0.6`（不设 env）；场景查不到按考核红线保守 `rule_only`；未新增 LLM profile（复用 `liveTurnAnalysis`）；模型轨**不重试**；装配用类 token 而非新增 Symbol token。

## 已回写（4 处）

- 台账 `phase2.5-p1d-known-issues-2026-11-11.md`：I-01 / I-02 / I-18 三行状态列 + 新增 **§7.4**（模型轨落地 / 观测口径 / 回落统计口径 / 已知偏差 / Node 口径）。
- 结构债草案 `phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`：§3 总表 I-01 / I-02 / I-18 现状列 + §4.2 「D-1 第二段进度」（三点结构性不可达已跨过哪两条）。
- 活清单 `phase2.5-wp-list-2026-11-08.md`：§四 独立单表追加一行（独立单 23 → **24 行**）。
- 总览 `phase2.5-README.md`：§3 当前有什么活追加一行。

## 遗留（D-2 待派）

- `llm_active` 生效轨接线（core 接口已预留）。
- 事件拆分：`holding_present` / `cold_absent` 进 `CounselorEventKind` 联合 + `DELTA_TABLE` 两行 + 中文标签 + 指标字典 + 审议白名单（改动面 **4 个文件**，含 2 处穷尽 `Record`）。
- 缺席连续轮数阈值、delta 方向与数值、低置信临床口径（0.6 为工程缺省，非临床口径）。
- 审计 `matchedTerms` 恢复（需扩内核出参）。

## 提交

```text
feat(wp-d1-2): 模型轨事件分类器中间态落地（core 两个可选契约 + adapter 三态模式 + 旁路观测）
```

**未 commit / 未 push**，请手动提交。本单文件不与并行产物混入。
