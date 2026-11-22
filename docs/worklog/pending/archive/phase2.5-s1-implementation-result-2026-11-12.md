# S-1 探索深度门槛端口化 · 实施结果回执

**日期**：2026-11-12　|　**执行**：MiniMax Code
**开工单**：`docs/worklog/pending/phase2.5-s1-open-depth-threshold-port-task-2026-11-12.md`（已归档至 `docs/worklog/completed/phase2.5/`）
**方案事实源**：`docs/worklog/pending/phase2.5-s1-open-depth-threshold-port-2026-11-12.md`（已归档至 `docs/worklog/completed/phase2.5/`）

## 1. 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-implementation-2026-11-12.md`

## 2. 改动文件清单

### 2.1 源码（core 3 文件 + adapter 1 文件）

| 文件                                             | 改动                                                                                                                                                                                                                                                                                                               | 行数                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `src/engine-core/cognition/alliance-config.ts`   | `AllianceThresholds` 加 `readonly openDepth?: number`；新增模块私有常量 `DEFAULT_OPEN_DEPTH = 0.35`；种子加 `openDepth`；`resolveAllianceThresholds` **早退分支 + 正常分支都补全** `openDepth`；`resolveSessionAllianceConfig` 的 `merged` 加 `override.openDepth ?? baseThresholds.openDepth`；返回类型改内联交叉 | 43 行                                                 |
| `src/engine-core/cognition/intention-planner.ts` | **删局部常量 `LOW_DEPTH = 0.35`**；判定改 `depth < thresholds.openDepth`；文件头补 S-1 说明                                                                                                                                                                                                                        | 16 行                                                 |
| `src/engine-core/domain/engine-session.types.ts` | 镜像 `allianceThresholds` 加 `readonly openDepth?: number`；注释「三字段严格 1:1」改「四字段严格 1:1」；仍不 import cognition 类型                                                                                                                                                                                 | 4 行                                                  |
| **core 合计**                                    |                                                                                                                                                                                                                                                                                                                    | **3 files changed, 56 insertions(+), 7 deletions(-)** |
| `src/engine-adapters/wiring/alliance-config.ts`  | 门槛组装补一行 `openDepth: seed.openDepth`（**种子透传，不读 env**）                                                                                                                                                                                                                                               | 3 行                                                  |
| **adapter 合计**                                 |                                                                                                                                                                                                                                                                                                                    | **1 file changed, 3 insertions(+)**                   |

### 2.2 测试

| 文件                                                           | 改动                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/engine-core/s1-open-depth-threshold.spec.ts`（**新建**） | 14 例，五组：① 缺省回落 4（含「探索分支没被静默关掉」）② 非法值回落 2 ③ 会话级覆盖 4（含「无覆盖仍返回 base 同一引用」）④ planner 边界两侧 3 ⑤ 镜像 1:1（编译期 + 运行时键集合比对）1 |
| `test/engine-adapters/wp42-alliance-config.spec.ts`（改）      | `:75-79` 的 `toEqual` 补 `openDepth: 0.35`（只补键，不放宽不等式）                                                                                                                    |

### 2.3 文档

| 文件                                                                                                 | 改动                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-implementation-2026-11-12.md` | 新增（交付记录）                             |
| `docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-task-2026-11-12.md`           | 开工单归档（pending 原件已删）               |
| `docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-2026-11-12.md`                | 方案单归档（pending 原件已删）               |
| `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`                                       | I-11 节加「处置」段                          |
| `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`                 | §3 I-11 行现状列 + 备注；§4.1 补「落地状态」 |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`                                                | §四 独立单新增 S-1 行                        |
| `docs/worklog/pending/phase2.5-README.md`                                                            | §3 当前活清单新增 S-1 行                     |

**明确未改**：`test/engine-core/boundary.spec.ts`、`src/engine-core/index.ts`（零新增 core 公开导出 / 零新增 core 文件）、`session-decay.ts`（新字段不进破裂判定）、`alliance-threshold-resolver.ts`、`engine-turn.service.ts`、env / `.env.example` / 装配 / resolver / module / migration / DB / prompt / 前端 / Flutter。**未跑批次、未调 LLM、未 commit / push。**

## 3. 闸门（真实命令 / exit code / 真实数字）

> 跑前 PATH 补 `D:\Apps\Git\cmd`（避免 vitest 内部调 git ENOENT 假失败）；全程 pnpm，**未用裸 npx**。

| #   | 闸门            | 命令                                                                    | exit  | 数字                                                                                                                             |
| --- | --------------- | ----------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **开工基线**    | `pnpm exec vitest run test/engine-core test/engine-adapters`            | 0     | Test Files **90 passed (90)**；Tests **1629 passed (1629)**；Duration 26.10s；墙钟 28s                                           |
| 1   | 类型（src）     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0** | **0 error**；墙钟 11.4s                                                                                                          |
| 2   | 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 2     | 全量 **396 条 / 86 个文件**（全部为**既有债**）；**本单相关文件错误数 = 0**；墙钟 18.4s                                          |
| 3   | Lint            | `pnpm lint`                                                             | **0** | **0 error / 0 warning**（eslint 无任何输出）                                                                                     |
| 4   | 定向测试        | `pnpm exec vitest run test/engine-core test/engine-adapters`            | **0** | Test Files **91 passed (91)**；Tests **1643 passed (1643)**；failed 0 / skipped 0；Duration 30.65s；墙钟 34s                     |
| 5   | 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0** | Test Files 1 passed (1)；Tests **12 passed (12)**；Duration 1.87s                                                                |
| 6   | 全量            | `pnpm test`                                                             | **0** | Test Files **188 passed \| 1 skipped (189)**；Tests **3072 passed \| 4 skipped (3076)**；failed **0**；Duration 93.47s；墙钟 96s |
| 7   | core 变更面     | `git diff --stat HEAD -- src/engine-core`                               | 0     | **仅 3 文件**，落在开工单例外批准范围内                                                                                          |
| 8   | adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                           | 0     | **仅 1 文件**（`wiring/alliance-config.ts`），3 insertions                                                                       |
| 9   | test 变更面     | `git status --short -- test`                                            | 0     | `M test/engine-adapters/wp42-alliance-config.spec.ts` + `?? test/engine-core/s1-open-depth-threshold.spec.ts`                    |

**零回归对比**：定向 1629 → **1643**（+14，恰等于新 spec 的 14 个 `it`，零用例被删/改名/跳过）；全量 3058 → **3072**（+14）；boundary 12 → 12。

**机器状态**：Windows 11 Home China 10.0.26300 64-bit；Intel Core i7-8550U @ 1.80GHz；15.9 GB RAM；Node v26.13.0；PowerShell 5.1.26100.9818；pnpm。**无 `nest start --watch` / `vite dev` 常驻进程**。

## 4. 与任务单的偏差（4 处，均为执行期实证）

| #   | 偏差                                                                                                     | 理由                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `resolveAllianceThresholds` 返回类型改**内联交叉** `AllianceThresholds & { readonly openDepth: number }` | `openDepth` 是可选字段但消费方（planner）要比大小，strict 下必须拿到非空 `number`；不改则 planner 要写 `?? 0.35` 兜底 = **第二份种子真相源**。用内联交叉而非新导出类型别名，是为**零新增导出名**（`boundary.spec.ts` 断言⑥ 守 barrel 白名单） |
| 2   | `resolveAllianceThresholds` 的 `config` 形参改**可选** `config?: AllianceConfig`                         | 新 spec 要覆盖「无注入对象」路径，显式传 `undefined` 触发 lint 规则 `unicorn/no-useless-undefined`；改可选后调用语义更准，且与同文件 `resolveSessionAllianceConfig(base?, override?)` 一致。向后兼容                                          |
| 3   | 种子值用模块私有常量 `DEFAULT_OPEN_DEPTH = 0.35`                                                         | 解析口**早退分支必须无条件产出完整 `openDepth`**；若只依赖「种子对象碰巧带这个键」，日后改种子形状会静默漏掉 → `depth < undefined` 恒 false → **探索分支永不触发**且编译不报错。常量与种子共用同一值，真相源仍是一处                          |
| 4   | G2 闸门命令修正为 `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                | 开工单建议的 `tsc -p tsconfig.json --noEmit` 在本仓**必然 exit 2**（根 tsconfig 的 `types:["node"]` 无 vitest globals → 54 个 spec 报 `Cannot find name describe/it/expect`），不可用作闸门。修正后剩 396 条既有债，本单相关文件 **0 错**     |

## 5. 遗留项

| #    | 遗留项                                                                                           | 归属     | 备注                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| S1-1 | 深度门槛的 env 键与按角色解析                                                                    | 标定批次 | 端口已通；接 env 时须同步 `.env.example`，适配层那行改成 `resolveThreshold(env, seed.openDepth)` 即可 |
| S1-2 | I-11 双门槛叠加下的**可达性对账**（语桐 ~50 / 小满 ~125 / 沉舟 ~200 / 惊尘 ~250 轮的估算需复算） | 另案     | 门槛结构复核 + 批次复算                                                                               |
| S1-3 | 「低 depth 作为探索前提」的临床假设是否成立                                                      | 另案     | 若推翻，需改的是门槛结构而非端口                                                                      |
| S1-4 | 根 `tsconfig.json` 全量类型检查的 396 条既有债（86 个文件）                                      | 技术债   | 本单顺带发现；`pnpm typecheck` 至今不覆盖 `test/**`，建议单独排期                                     |
| S1-5 | 预研单与预研结论仍留在 `pending/`                                                                | 主控决策 | 预研单 §4 明确要求结论写到 pending，故按其原指令保留；是否一并归档由主控定                            |

> **本单不解决 I-11 的数学不可达**：门槛值仍是 0.35，12 轮内除安然外仍无一可达。变的只是「深度门槛从不可配变成可配」。

## 6. 提交分组与 commit message 草稿

**本单提交分组（勿与并行产物混提）**：core 3 文件 + adapter 1 文件 + `test/engine-core/s1-open-depth-threshold.spec.ts`（新增）+ `test/engine-adapters/wp42-alliance-config.spec.ts`（改）+ 交付记录 + 两份任务单（移动）+ 台账 / 结构债草案 / wp-list / README（改）。

**并行产物勿混入**：`.gitignore`（并行进程加的 `data/quality/*.txt` 规则）、`docs/worklog/pending/phase2.5-s1-open-depth-research-minimax-2026-11-12.md`、`docs/worklog/pending/phase2.5-s1-research-result-2026-11-12.md`。

**commit message 草稿**：

```
feat(engine-core): 探索深度门槛端口化 (LOW_DEPTH 并入 AllianceThresholds.openDepth, 种子 0.35 不变)
```

**未执行**：`git commit` / `git push`（按红线留待大炮手动提交）。
