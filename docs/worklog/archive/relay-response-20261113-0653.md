# Relay Response · D-3 时序权重端口骨架（I-19 / S-3 · 仅 `none` 形态 · 零行为变化）· 2026-11-13 06:53

> 执行方：MiniMax Code · 仓库 `E:\Work\Project\backend\mofang-nestjs` · 分支 `integrate` · 基线 HEAD `960adbc`
> 任务单已归档：`docs/worklog/completed/phase2.5/phase2.5-d3-timing-weight-port-implementation-task-2026-11-13.md`（状态行 ✅，§8.2 checklist 7 项全勾）
> 交付记录：`docs/worklog/completed/phase2.5/phase2.5-d3-timing-weight-port-implementation-2026-11-13.md`
> 前置：D-3 复核备忘（protocol-review-2026-11-13）· D-2 交付记录（事件拆分，`cold_absent` 已进 core 联合 → P3 满足）

## 结论

**D-3 时序权重端口骨架已落地，§7 十项闸门全绿，工作区未 commit / 未 push。**

`TransitionStateOptions` 扩两个**可选**字段（`timingWeight?` / `turnIndex?`），`state-transition.ts` 内新增两个**模块私有纯函数**（`resolveTimingWeight` / `scaleDeltaVector`），两处管道在 `capTurnDelta` **之后**接入折损点（P5 口径：cap 后折损，权重不得绕过最后那道尺子）；会话层透传 `runtime.turnIndex + 1` 与构造注入的 `timingWeightConfig`；适配层 `engine.providers.ts` 透传同款端口（**不接 env**，`engine.module.ts` 一字未动）。

本单**只落地 `none` 形态**：`linear_decay / recency / window` 三形态曲线与临床斜率留标定批次单。**缺省与非 `none` 一律回退等权 1.0** → 落库 delta 与改造前**逐字相同**（不是「结果一样」，是「根本没走那条路」）。

## 红线逐条守

| 红线                                                   | 落地                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core 仅例外声明的 **2 个既有文件**                     | ✅ `git diff --stat HEAD -- src/engine-core` = **恰好 2 文件 / +111 / −4**（`state-transition.ts` +94/−4、`in-memory-engine-session.ts` +21），与例外批准表**逐条对应** |
| **不新增文件 / 具名导出**                              | ✅ 无新增 core 文件；`TIMING_WEIGHT_EQUAL` 是**模块私有常量**（未 export）；配置类型走**已导出**接口的**可选字段** + 内联结构 → `index.ts` 公开面**零变化**             |
| `boundary.spec.ts` **不改**                            | ✅ 未改；**12 例全绿**（断言⑥⑦⑩ 未触发）                                                                                                                                |
| **零 env / globalThis**                                | ✅ 内核零 `process.env`（配置走注入端口）；`delta-table.config.ts` 与 `engine.module.ts` 均**一字未动**                                                                 |
| module **不接 env**                                    | ✅ `engine.module.ts` 未改 → 装配项不传 → 内核走缺省 `none`                                                                                                             |
| 不动 `SessionEvent` / 词表 / `DELTA_TABLE` / DB / 前端 | ✅ 四者**零改动**；`git diff --stat HEAD -- src/admin-dashboard` = **空**；零 DDL                                                                                       |
| pnpm，**禁裸 npx**                                     | ✅ 全部走 `pnpm exec` / `pnpm lint` / `pnpm test`                                                                                                                       |
| 不自行 commit / push                                   | ✅ 未 commit、未 push，只给 commit message 草稿                                                                                                                         |

## 闸门实测（10/10 过）

| 闸门   | 命令                                                                      | exit | 真实结果                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE1  | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | 0    | 0 错                                                                                                                                                                       |
| GATE2  | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | 2    | **401 错 / 87 文件**，与 HEAD `960adbc` **实测基线逐字一致**（stash 差分法现场重测），本单相关 **0 错**                                                                    |
| GATE3  | `pnpm lint`                                                               | 0    | **0 error / 0 warning**                                                                                                                                                    |
| GATE4  | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | 0    | **12 例全绿**                                                                                                                                                              |
| GATE5  | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | 0    | **102 文件 / 1881 例**，Duration **27.74s**（基线 101/1866 → +1 文件 / +15 例）                                                                                            |
| GATE6  | `pnpm test`                                                               | 0    | **192 passed + 1 skipped（193 文件）/ 3216 passed + 4 skipped（3220 例）**，Duration **68.63s**，**墙钟 70.37s**（基线 191+1/192 文件、3201+4/3205 例 → +1 文件 / +15 例） |
| GATE7  | `git diff --stat HEAD -- src/engine-core`                                 | 0    | **恰好 2 文件**（+111 / −4）                                                                                                                                               |
| GATE8  | `git diff --stat HEAD -- src/engine-adapters`                             | 0    | **恰好 1 文件**（`engine.providers.ts`，+14）                                                                                                                              |
| GATE9  | `git diff --stat HEAD -- src/admin-dashboard`                             | 0    | 空                                                                                                                                                                         |
| GATE10 | 隐私自检（人工过新增 spec / 算子注释 / 观测面）                           | —    | 无原话、无 prompt 全文、无 `kernelState`、无展示名、无新增日志面、无新增 env 键                                                                                            |

机器状态：Node **v26.13.0** / pnpm **9.15.0** / 8 核 / 15.9 GB 总 5.8 GB 空闲 / 2 个 node 常驻（78.8 MB / 34.2 MB，无 watch）/ Windows 11 Home China 10.0.26300 / PowerShell 5.1。

> 类型债基线是**现场重测**的：任务单沿用的 401/87 出自 HEAD `2bf32f0`，本单基线已到 `960adbc`。测法（stash 差分，可复算）写在交付记录 §4.1 —— 其中一条经验：**新增 spec 必须先移出编译范围再量基线**，否则基线里会混进新 API 的报错。

## 口径逐条守

| 口径                                       | 落地                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **仅 `none` 骨架**                         | `kind` 联合位留 `none / linear_decay / recency / window`，但**只有 `none` 落地**；非 `none` 一律回退等权        |
| 缺省 / `none` / `turnIndex` 缺省 → **1.0** | ✅ `resolveTimingWeight` 四条分支全回等权（`TIMING_WEIGHT_EQUAL`）                                              |
| 非 `none` → **回退 1.0**                   | ✅ 骨架护栏：未实现形态**不得改变行为**（三形态在 spec 里用 `it.each` 逐个证伪）                                |
| 顺序 **聚合 → 人格 → cap → 折损 → apply**  | ✅ 两处管道一致；`buildDeltaCapReport(raw, capped, ...)` 第二参用**折损前**的 `capped` → **折损不改变砍幅结论** |
| `turnIndex = runtime.turnIndex + 1`        | ✅ 会话层临时快照路径传入（1 起，同 `MatchContext` 口径）                                                       |
| 落库路径 `:447-448` **本单不接入折损**     | ✅ 未接入；接入点与口径（cap 后、`turnIndex + 1`、与临时快照**同一算子**）在交付记录 §6 R2 + 代码注释登记       |

## 已登记偏差（6 条）

1. **配置类型一律「反推」，不手抄内联结构**：core 会话层写 `TransitionStateOptions['timingWeight']`，适配层写 `EngineSessionOptions['timingWeightConfig']`。理由：手抄 = 两份真相，内核改形状时适配层不跟而且**类型系统查不出来**；反推让三处形状恒等，且**不新增任何 core 具名导出**（任务单 §4.1 本就点了 `ConstructorParameters` 反推这条口径）。
2. **等权系数提为模块私有常量 `TIMING_WEIGHT_EQUAL`**：`sonarjs/no-invariant-returns` 会把「所有分支返回同一值」的函数判为 smell 并打回 lint；本单**不用 disable 压味道**（仓库纪律），而是把「等权」提为唯一语义来源的命名常量。
3. **cap 结果变量改名 `delta` → `capped`**：加权后的才叫 `delta`（任务单 §3.1 A.3 示意代码即此命名）；cap 报告口径因此**不变**。
4. **不硬编码跨轮快照基线**：改用「缺省 vs 注入」整快照 `toEqual` 对照（证明的是**与改造前相同**，强于「与某组手写数字相同」）；只复用既有 `turnIndex` 递增基线（1 → 2）。
5. **wp-list 不回写**：按任务单 §8.2，`phase2.5-wp-list-2026-11-08.md` 是**冻结快照**，只登记 `phase2.5-README.md`。注意 D-2 那一单是回写了 wp-list 的 —— 两单差异在此显式登记，不静默。
6. **spec 15 例**（任务单 §3.1 D.1~D.6 六条展开为五条断言组，`it.each` 覆盖三形态）。

## 零回归证据

| 证据             | 断言                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| 基线数值         | 不传端口 → 旧模型算术逐字成立（trust 0.3 / safety 0.5 / bond 0 + 共情 → 0.4 / 0.52 / 0.01）       |
| 整快照对照       | 显式 `none` vs 缺省 → `toEqual` 逐字相同                                                          |
| 非 `none` 三形态 | `linear_decay` / `recency` / `window`（带 `slope` + `windowTurns`）+ `turnIndex` → 与缺省逐字相同 |
| cap 报告         | 折损前后报告对象逐字相同；砍幅明细仍是 cap 结论（trust `0.3 → 0.2`），**不是折损后的值**          |
| 两出口           | `transitionState` 与 `transitionStateDetailed` 快照逐字相同                                       |
| 会话层           | 缺省 / `none` / `recency` 三种配置的**落库快照序列**逐字相同（2 轮）                              |
| 轮次号           | 缺省下 `turnIndex` 递增 **1 → 2**（同既有基线）                                                   |

> **读法提醒**：交付后状态演化**仍然对轮次位置不敏感** —— 这是**预期**。本单落地的是**端口 + 折损接入点 + 护栏测试**；真正让「第 2 轮接住」与「第 12 轮才接住」产生差异的是**形态曲线本身**（留标定批次单）。另：指纹 `stateTransition` 段**会变**（`state-transition.ts` 内容变了）→ 跨批次比较报「配置变了」是**正确归因**。

## 已回写 + 归档

- 台账 `phase2.5-p1d-known-issues-2026-11-11.md`：I-19 行 + 新增 **§7.6**。
- 结构债草案 `phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`：§3 I-19 行 + §4.3 S-3 **D-3 进度**块 + §9 D-3 表行。
- 活清单 `phase2.5-README.md`：§3 新增 D-3 实现单一行。
- 任务单已从 `pending/` 移入 `completed/phase2.5/`，状态行改 ✅ 并链交付记录，§8.2 checklist **7 项全勾**。

## 遗留（留标定批次单）

- `linear_decay / recency / window` 纯函数实现 + `slope` / `windowTurns` 临床标定值 + 权重取值域 `[0, 1]` 约束。
- 权重 **env 覆写通道**（适配层 `resolveTimingWeightConfig` 接 env，同 D-2 L-4 范式）。
- **落库路径**折损接入 + 两路径**同一算子**复用（若需跨文件复用，走 D-6 白名单授权：独立 cognition 文件 + 导出）。
- 非 `none` 形态上线前的**全量批次重跑**与指纹段比对。
- D-2 遗留 L-1~L-10 与 D-4 cold 先验**不在本单范围**。

## 提交

```text
feat(wp-d3): 时序权重端口骨架落地（TransitionStateOptions 扩 timingWeight/turnIndex + cap 后折损点 + none 形态零行为变化）
```

**未 commit / 未 push**，请手动提交。本单文件不与并行产物混入（`data/quality/*.diff` 是 D-2 遗留的未跟踪诊断产物，**不属于本单**）；提交前请确认 `src/engine-core` 恰好 2 文件、`src/engine-adapters` 恰好 1 文件、`src/admin-dashboard` 为空。
