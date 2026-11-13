# TD-10 测试结构减重专项（P-DEBT-6 / L5）已交付

> 说明：本回复完成时钟时间为 **2026-11-14 00:22**（自 2026-11-13 开工跨零点）。文件名前缀沿用任务单指定的 `20261113`（工作日），HHMM 取实际完成时间（24 小时制）。

**交付记录**：`docs/worklog/completed/phase2.5/td10-test-structure-debt-reduction-implementation-2026-11-13.md`（388 行，§一~§七 + 附录 A 全 183 个非 e2e spec 逐行加载图对比）
**任务单**：`docs/worklog/completed/phase2.5/td10-test-structure-debt-reduction-task-2026-11-13.md`（已归档，顶部状态行已改 ✅ 并链接交付记录）

## 一句话总结

把 183 个非 e2e spec 的 **import 阶段加载图**整体收窄：82 个 spec 在 SDK 包边界加 `vi.mock`（真实 ioredis / bullmq / qdrant / langchain 不再进 import 阶段）、12 个 spec 的 engine-core barrel 整树导入改深路径、4 个非 e2e 集成 spec 逐一定性并抽出共享 User 替身工厂。断言期望、用例数、mock 语义、隔离语义逐字未变；engine-core 与生产 `src/` 零 diff。

## 闸门真实数字（本机实测，全部走 pnpm，未用裸 npx）

| 闸门         | 命令                                                                    | exit | 数字                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0    | **0 error**                                                                                                                                   |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0    | **0 error**                                                                                                                                   |
| Lint（权威） | `pnpm lint`                                                             | 0    | **0 error / 1 warning**                                                                                                                       |
| oxlint fast  | `pnpm lint:fast`                                                        | 0    | **0 warning / 0 error**                                                                                                                       |
| oxlint deep  | `pnpm lint:deep`                                                        | 0    | **0 warning / 0 error**                                                                                                                       |
| 测试         | `pnpm test`                                                             | 0    | **194 文件 / 3252 例 = 3248 passed + 4 skipped**（与基线逐字一致）；Duration **61.80 s**（import 81% / tests 15% / transform 3% / worker 2%） |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | 0    | **空**                                                                                                                                        |
| 生产 src     | `git diff --name-only HEAD -- src`                                      | 0    | **空**                                                                                                                                        |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0    | **12 passed**                                                                                                                                 |
| 盘读前置     | `pnpm doctor:fs`                                                        | 0    | 合格（均值 **0.13 ms/文件**、slow=0）                                                                                                         |

两条必须说明的：

- 唯一 warning 是 `test/e2e/v2-user-flow.spec.ts:1` 的既有 unused eslint-disable directive —— 基线既有、在 e2e 范围外于本单授权范围，**未修**（`pnpm lint:fix` 的越界改动已 `git checkout` 回退）。
- 墙钟 **61.80 s 与基线 132 s 不可直接比较**：机器不干净（`nest start --watch` PID 14612、`dist/app` PID 16608、admin-dashboard vite dev PID 7860 在跑，我**没有擅自杀你的进程**），且闸门性能 §1.5 已记录同一份代码 80 s ↔ 1100 s 的波动。任务单 §3.1 本就不以墙钟为验收指标。

## 结构收益（183 个非 e2e spec，同一分析器两次运行）

| 指标                     | 改前   | 改后   | 变化          |
| ------------------------ | ------ | ------ | ------------- |
| 本地模块加载总量         | 8013   | 7986   | **−27**       |
| 其中生产 `src/` 模块     | 7787   | 7753   | **−34**       |
| 包引用数                 | 766    | 673    | **−93**       |
| **触达重型 SDK 的 spec** | **98** | **58** | **−40**       |
| 触达 Nest 框架的 spec    | 118    | 118    | 0（遗留 L-6） |

取证材料：`data/quality/td10-import-graph-before.txt` / `-after.txt`（自写 TypeScript 编译器 API 分析器，区分运行时值导入 / type-only 擦除 / 动态 import）+ `td10-audit-table.txt`，均被 gitignore 排除、不入库。

## 三个子项的实际处置

**T-1（4 个非 e2e 集成 spec）** —— 审计结论与任务单预设不同：**4 个 spec 本来就不是全量装配**（都是「单控制器最小 TestingModule + 端口级替身」，不拉 `app.module`、不连 DB / Redis），**没有一个需要收窄**；`wp22-voice-concurrency-budget` 更不可收窄（它断言的对象就是 DI token 注册本身）。本子项的实际收益是：① 两份同构 User 替身收敛为共享 `test/helpers/user-stub.ts`；② SDK 包边界 mock；③ 真 Redis spec（`deliberation-stats-redis.integration`）改动态导入，未设 `TEST_REDIS_URL` 时 ioredis 不进 import 阶段。

**T-2（82 个 spec 加 SDK 包级 `vi.mock`）** —— 替身集中到 `test/helpers/sdk-stubs.ts`（ioredis / bullmq / qdrant / langchain），**数据面方法一律 throw**（防假绿：mock 后若仍触碰真实 SDK 数据面，用例当场炸），生命周期方法惰性 no-op。**3 个 spec 保留真实 SDK** 并登记为例外：`minimax-provider` / `wp9c-token-fields` / `wp45-qdrant-sdk-contract` —— 它们的断言对象就是真 SDK 行为，mock 掉等于替换断言对象。

**T-3（12 个 spec / 14 处导入语句）** —— engine-core **运行时值** barrel 导入改深路径；type-only barrel 导入（69 个 spec）**保持不动**（编译期即擦除、运行时成本为 0，且 `src/engine-core/index.ts` 是内核唯一公开 barrel）。另有 4 处 barrel **明确不拆**并写明现场理由：`wp6-llm-render` 断言的就是 barrel 出口面本身、`wp58-debug-session` 的 user barrel 传递可达零收益、trajectory barrel 文件头明写「单测也从这里 import」、string-utils 是 TD-9 共享纯函数出口。

## 与任务单的偏差（9 条，交付记录 §二 逐条登记）

最需要你过目的两条：**D-1** 替身挡在 **SDK 包边界**而非适配层（适配层本身是被测对象，改它等于改 mock 语义）；**D-5** T-1 的 4 个集成 spec 审计后判定无需收窄 —— 任务单预设的「可收窄为端口级替身」在本仓不存在对应项，这是**审计结论**而非未执行项。其余 7 条：3 例外保留真 SDK、替身数据面 throw、type-only barrel 不动、`user-stub` 不进 barrel 出口（进 barrel 会把 typeorm 拖进 5 个 spec、模块数 +200）、8 处 `toBe(x.length)` → `toHaveLength(x)`（**期望值逐字未变**，因新增 vitest 导入让 sonarjs `prefer-specific-assertions` 生效）、e2e 既有 warning 不修、墙钟不作指标。

## §7 回写清单：8 / 8 已做

| 项                                                                         | 状态                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 交付记录写到 §6 固定路径                                                   | ✅ 388 行                                                                                                                                               |
| 任务单 `pending/` → `completed/phase2.5/` + 顶部状态行改 ✅ + 链交付记录   | ✅                                                                                                                                                      |
| `phase2.5-wp-list-2026-11-08.md` §四 TD-10 行改完成 + 补交付记录链接       | ✅                                                                                                                                                      |
| `phase2.5-README.md` §3.0 TD-10 行改完成                                   | ✅                                                                                                                                                      |
| `gate-performance-remediation-2026-11-11.md` §9 P-DEBT-6 行回填处置结论    | ✅                                                                                                                                                      |
| `git diff --stat HEAD -- src/engine-core` 为空；生产 `src/` 非 spec 零改动 | ✅ 实测 0 行 / 0 文件                                                                                                                                   |
| 提交分组已核对                                                             | ✅ 本单工作区改动仅 `test/`（91 改 + 2 新）与 `docs/`（3 索引 + 2 新档）；`data/quality/td10-*.txt` 被 gitignore 排除；**未 stage、未 commit、未 push** |
| 一行 commit message 草稿                                                   | ✅（见末）                                                                                                                                              |

回写后已跑链接核验：任务单 / 交付记录 / wp-list / README / 闸门性能 5 份文档共 **188 条相对链接全部可达，0 断链**。

**一处需你知情**：那 3 份 docs 文件你此前已加过 TD-10 行（未提交），本次回写是在**同一批行**上改状态与结论，所以最终 diff 仍是 `3 files changed, 4 insertions(+), 1 deletion(-)` —— 你的行新增与我的回写已合流，不存在两处重复。

## 遗留与另案（6 项，交付记录 §七）

- **L-1（最大残留）typeorm / `@nestjs/typeorm`**：改后仍有 45 个 spec 触达 typeorm、43 个触达 `@nestjs/typeorm`。根因在**生产 src 侧**（entity 装饰器 + `import { Repository } from 'typeorm'` 的值导入形态），治本要改生产代码，超出本单授权（§2 明令「测试缺端口只登记另案」）→ **建议主控单独立项**。
- L-2 3 个 spec 保留真实 SDK（要收需先引入可注入端口，属 src 侧改动）。
- L-3 `test/e2e/v2-user-flow.spec.ts:1` 既有 lint warning，随 e2e 专项清理。
- L-4 墙钟不可比（机器不干净 + 读税波动），待 P-DEBT-7 隔离环境就绪后重测。
- L-5 断言 Module 元数据（`Reflect.getMetadata('imports', ...)`）的 spec 无法收窄 Module 类加载。
- L-6 Nest 框架触达 spec **118 → 118 未变**（`@nestjs/testing` 是 TestingModule 必需依赖）；下一轮方向：DI 冒烟用例与纯单元用例分离，本轮未做以免改动面外溢。

## commit message 草稿（未 commit / 未 push，等你指令）

```
test(td10): 测试结构减重 — 82 spec SDK 包级 mock + 12 处 barrel 深路径拆分 + 4 集成 spec 收敛
```

---

_全程未动 `src/`、未动 engine-core、未改 `vitest.config.mts` / `vitest.fast.config.mts` / `package.json` / tsconfig / Docker / CI、未新增第三方依赖、未自动 commit / push。_
