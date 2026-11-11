# 本地闸门提速治本方案（vitest / tsc / eslint 全链路）

> 状态：方案待批准（2026-11-11）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 `4eda25a`
> 适用范围：后端 NestJS 本地开发与验收闸门链路；`admin-dashboard/` 与 Flutter 客户端不纳入本方案。
> 目标：一次性把"每个任务全量跑一遍、验收又全量复跑"造成的 ~30 分钟闸门耗时治本化解耦，本地内循环与验收回到分钟级，全量套件退回 CI / 里程碑底线。

---

## 1. 问题陈述与实测基线

### 1.1 现象

- 单个任务从改完到交付，本地闸门经常跑到 30 分钟量级；项目文件数增长后耗时超线性上升。
- 体感归因为"全量 eslint + 全量 vitest + 项目变大 + 任务单闸门条件过多"。本方案以仓库日志与配置实测为准，区分主因与次因。

### 1.2 实测证据（来源标注于 §1.3）

| 指标                                                  | 实测值                                                                                                                                                                                           | 说明                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 源码规模                                              | src 1098 个 `.ts`；spec 176 个；vitest 口径 185 文件 / 2991 例（2987 passed + 4 skipped，0 failed）                                                                                              | 现场计数                                               |
| **全量 vitest（2026-11-12 00:19 实测定稿）**          | **140.29 s（墙钟 148.3 s）**，186 文件 / 3008 例（3004 passed + 4 skipped，0 failed）                                                                                                            | 本机 8 CPU 实测；日志 `%TEMP%\full-test-baseline.log`  |
| 全量 vitest（历史日志，**不再作为基线**）             | 1129.94 s（185 文件 / 2991 例）· 681.07 s（142 文件 / 2338 例）                                                                                                                                  | 旧日志；与实测差约 8 倍，属当时机器负载 / 运行状态差异 |
| **全量 tsc**（`tsc -p tsconfig.build.json --noEmit`） | **38.2 s**，exit 0                                                                                                                                                                               | 2026-11-12 实测                                        |
| **全量 eslint 冷跑**（无 `.eslintcache`）             | **394.9 s ≈ 6.6 min**，exit 0                                                                                                                                                                    | 2026-11-12 实测，**全链路最大单腿**                    |
| **全量 eslint 热跑**（缓存全命中）                    | **69.3 s**，exit 0；cache 607 KB                                                                                                                                                                 | 2026-11-12 实测                                        |
| 耗时构成（实测）                                      | **import 74% / tests 14% / transform 10% / worker 1%**                                                                                                                                           | 本次实测尾部                                           |
| worker 启动开销（实测）                               | `186 workers spawned · ~1.10 s startup each`；Vitest 提示 `isolate: false` 至少再快 **28.10 s**                                                                                                  | 本次实测尾部                                           |
| 规格 / 环境                                           | 8 CPU；Node v22.23.2；pnpm 9.15.0；Vitest 5.0.5                                                                                                                                                  | 现场                                                   |
| Vitest 磁盘模块缓存                                   | 当前无 `.vitest` / `node_modules/.vitest` 缓存目录                                                                                                                                               | 现场                                                   |
| tsc 增量                                              | `tsconfig.json`、`tsconfig.build.json` 均未设 `incremental` / `tsBuildInfoFile`；无 `.tsbuildinfo`                                                                                               | 现场                                                   |
| eslint 缓存                                           | 脚本带 `--cache`；`.eslintcache` 在 `.gitignore`；**缓存文件已于 2026-11-11 22:58:58 生成，但 00:24 的全量 lint 仍耗 394.9 s（说明存在大面积失效/未填满）**；紧随其后的热跑 69.3 s、cache 607 KB | 现场 + 2026-11-12 实测                                 |
| CI 闸门                                               | `.github/workflows/ci.yml`：push/PR 已跑全量 lint + tsc + 全量 unit + e2e + build                                                                                                                | 现场                                                   |

### 1.3 证据来源

- `vitest-run.log`（旧全量，142 文件 / 2338 例，681.07s）
- `vitest-stats.log`（单 spec 16.75s，import 97% / transform 2%）
- `vitest.config.mts`、`tsconfig.json`、`tsconfig.build.json`、`eslint.config.mjs`、`package.json`
- `node_modules/vitest/dist/chunks/config.d.QBNYCgFU.d.ts`（选项类型核实）
- `.github/workflows/ci.yml`

### 1.4 归因结论（主因 / 次因 / 流程因）

1. **最大单腿：eslint 全量 394.9 s（6.6 min），不是 vitest。** 此前"eslint 不是大头"的判断只成立于缓存完全命中（69.3 s）。关键异常：`.eslintcache` 22:58 就已生成，00:24 再跑仍要 394.9 s——**缓存存在却大面积失效**，说明 `--cache` 在当前配置下的命中稳定性本身有问题（可能被 config/tsconfig 变更、`projectService` 程序重建或多工作树切换反复打穿）。→ **L4 升为第一优先**，且第零步必须先定位"缓存为什么白建",再谈换工具。
2. **次腿：全量 vitest 140.29 s，内部仍是 import 74%（约 104 s）。** 每个 spec 独立 fork 重载整张 NestJS DI + langchain + typeorm + qdrant 依赖图，再加 `~1.10 s` worker 启动 × 186。绝对量已远小于历史日志，但结构上的可压缩空间仍在（官方提示 `isolate: false` 至少省 28.10 s）。
3. **固定腿：tsc 38.2 s，无 `incremental`，每次全图重编。** 38 s 绝对量可控，增量化的主要价值是高频内循环，不是收尾闸门。
4. **流程因，放大系数 ≈ 2：全量闸门被跑两遍。** 执行方收尾一遍 + 验收方按同一套复跑一遍 → 冷态 `581 s × 2 ≈ 19 min`，热态 `255 s × 2 ≈ 8.5 min`。用户"干一个活动 30 分钟不动"的体感，由「冷 lint 6.6 min + 全量 test 2.4 min + tsc 38 s + 双跑 + 真实 LLM 批次等待」叠加而成。
5. **"18.8 分钟全量 test"这一前提不成立。** 实测既非 1129.94 s，也非交付记录所称 80.42 s，而是 140.29 s。本方案此后所有收益口径一律以本表实测值为唯一基线，A/B 只认本机实测。

> 说明：原"tsc 与 eslint 未单独计时、量级判断留待回填"的注记已作废——2026-11-12 已完成三条腿实测（38.2 s / 394.9 s 冷 · 69.3 s 热 / 140.29 s）。

### 1.5 环境纯净度：闸门数字必须标注机器状态（2026-11-12 新发现）

同一仓库、同一代码、同一依赖版本，全量 vitest 在两种机器状态下差 **10 倍**：

| 机器状态                           | 全量 vitest 墙钟 | import 占比 |
| ---------------------------------- | ---------------- | ----------- |
| 干净（00:19 基线）                 | 148.3 s          | 74%         |
| 有长驻开发进程（01:20–02:10 复测） | 1265–1512 s      | 93–96%      |

现场取证：单跑一个 spec，**vitest 内部耗时 1.77 s，墙钟 36 s**——差距全在进程启动被 CPU/IO 抢占；`Get-CimInstance` 显示 `nest start --watch`（pid 27392，**从 11-10 11:59 连续运行 2 天，累计 7306 s CPU、887 MB 常驻**）＋ `admin-dashboard` 的 vite dev ＋ 一个 `dist/app` 服务同时在跑，CPU 负载 68%。

**结论与纪律**：

1. 闸门计时必须在干净机器上做：跑前确认没有 `nest start --watch` / `vite dev` / `dist/app` 在跑；否则测出来的是"抢资源的结果"，不是配置的性能。
2. 这条同时解释了历史日志 1129.94 s 与交付记录 80.42 s 的巨大分歧——**它们大概率不是同一机器状态下测的**。
3. 对用户体感"干一个活动 30 分钟不动"的直接含义：**关掉 watch 再跑闸门，是零成本的第一提速手段**，比任何配置项都立竿见影。

---

## 2. 目标态与量化指标

### 2.1 目标态职责分层

闸门按四个阶段区分职责，全量套件只出现在合并底线（CI）与阶段里程碑，不再作为本地每单验收动作。

| 阶段                        | 类型            | tsc                                        | eslint                   | vitest                                             | 目标耗时             |
| --------------------------- | --------------- | ------------------------------------------ | ------------------------ | -------------------------------------------------- | -------------------- |
| 内循环（改动中，高频）      | 定向            | 触碰文件                                   | 触碰文件（走缓存）       | 单文件 / `test:changed` / `test:related`           | 秒 ~ 分钟级          |
| 执行方收尾（交付前一次）    | 全量            | 全量 `tsc -p tsconfig.build.json --noEmit` | 全量 `pnpm lint`（缓存） | 全量 `pnpm test`                                   | 运行时优化后实测回填 |
| 验收方回收（本方案新增）    | 抽跑 + 范围核对 | 触碰文件                                   | 触碰文件                 | `related` / `changed` + 关键路径抽跑；**不跑全量** | ≤ 2–3 分钟           |
| CI（push / PR，既有，不动） | 全量            | `tsc --noEmit -p tsconfig.json`            | `npm run lint`           | 全量 unit + e2e                                    | CI 环境              |
| 里程碑 / 阶段冻结           | 全量            | 全量                                       | 全量                     | 全量 + e2e                                         | 每阶段一次           |

### 2.2 量化目标（以 §1.2 实测基数为准，A/B 实测回填）

- **单次全量闸门（热缓存）**：基线 `38.2 s（tsc）+ 69.3 s（lint）+ 148.3 s（test 墙钟）≈ 4.3 min`；**冷缓存** 基线 `≈ 9.7 min`。
- **第一优先目标：eslint 冷跑 394.9 s → ≤ 120 s**（定向 + 缓存治理 + 必要的工具替换；这是全链路最大单腿，收益最大）。
- **全量 vitest**：基线 140.29 s；`isolate: false` 官方提示省 28.10 s，叠加 `fsModuleCache` / `deps.optimizer` 后目标 `≤ 90 s`（import 段占比从 74% 降下来）。
- **验收环节本地耗时**：从"跑一遍全量"（冷 9.7 min / 热 4.3 min）降到 **≤ 2–3 分钟定向**（流程层确定性收益，不依赖调参）。
- **重复 tsc 检查**：基线 38.2 s；开 `incremental` 后第二次起只编译改动子图（实测回填）。
- **正确性零回退**：全量套件 0 failed；`src/engine-core` 的 `git diff` 为空；`boundary.spec.ts` 未改；type-aware lint 规则不整体降级。

---

## 3. 治本方案（分层，按落地风险从低到高）

### 3A. 外部调研结论与来源（官方文档 / 大神分享 / GitHub）

本轮在官方文档、社区 benchmark 与 GitHub 资料上交叉核实，结论与新增杠杆如下：

| 来源                                                                               | 关键结论                                                                                                                             | 对本方案的影响                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Vitest 官方《Improving Performance》                                               | forks 默认兼容但略慢；`isolate:false` 复用 worker；`fsModuleCache` 持久化转换缓存；`--shard` 面向多机；Node 编译缓存可复用 V8 字节码 | 支撑 L2-a / L2-b / L2-d；分片不进本地           |
| Vitest 官方《Profiling Test Performance》                                          | `experimental.importDurations` 定位最慢 import；`deps.optimizer.ssr` 用 esbuild 把深依赖树打成单文件                                 | 新增 L2-c，先诊断再决定 include                 |
| Vitest 配置参考 `deps` / `fsmodulecache`                                           | node 环境走 `optimizer.ssr`；只打包 include 内包；缓存默认在 node_modules，重装失效                                                  | 确认 L2-c 语法与失效语义                        |
| Mergify《isolate:false 30% speed and a class of flake》（2026-05）                 | 实测约 30% 提速；模块级单例跨文件泄漏无法 grep；治本是去单例 / 类注入 / setup 统一 reset                                             | 量化 L2-a 收益并强化审计与回滚条件              |
| VS Code 官方《Iterating faster with TypeScript 7》（2026-06）                      | TS 7（原生 Go / tsgo）同口径类型检查约 7x，错误一致                                                                                  | 新增 L3 长期评估轨（当前为 TS 6.0.3）           |
| Oxlint 官方与 DEV/jsmanifest benchmark（2026）                                     | Oxlint 基于 tsgo，支持 type-aware，实测约 16x，规则覆盖接近 tseslint；Biome 自实现类型推断覆盖仍在补                                 | 新增 L4 双轨试点选项，不一次性替换 ESLint       |
| Vitest 官方《Per-File Isolation》《Test Projects》                                 | 内联 project 默认继承根配置；用 `projects` 只对纯单元关隔离、集成保持隔离；`--shuffle` 验证顺序依赖                                  | L2-a 改为 projects 分层，替代全局 isolate:false |
| TypeScript 官方《Project References》《assumeChangesOnlyAffectDirectDependencies》 | 项目引用 + `--build` 可显著改善构建；fast & loose 选项仅适合 watch、需全量兜底                                                       | L3 增量之外登记 watch 可选项，不进闸门          |
| NestJS 官方 Testing / Devtools                                                     | 用 `overrideProvider` / `useMocker` 避免全量 DI；重 bootstrap 可被 Devtools 定位                                                     | 支撑 L5 测试结构减重                            |

**调研后的总体判断**：本方案 L1 流程拆分 + L2 运行时复用/优化的方向与官方及大神实践一致，没有发现"一键银弹"可以替代分层治理；真正的增量是补上 **L2-c 依赖优化器、L2-d Node 编译缓存、L2 的 doctor 诊断前置**，以及把 **TS 7 / Oxlint 作为独立评估轨**而非本轮硬切。

### 3B. 版本升级评估（严格对齐当前已装插件版本）

通过 npm registry 与本地 `node_modules` 实测的版本对照（2026-11-11）：

| 包                                 | 已装   | 最新           | 升级性质              | 结论                               |
| ---------------------------------- | ------ | -------------- | --------------------- | ---------------------------------- |
| `vitest`                           | 5.0.5  | 5.1.0          | 同大版本 minor        | **建议本轮升级**（见下）           |
| `@vitest/coverage-v8`              | 5.0.5  | 5.1.0          | 同大版本 minor        | 随 vitest 一起升级                 |
| `vite`                             | 8.3.5  | 8.3.8          | patch                 | 可顺手升级，零风险                 |
| `@typescript-eslint/eslint-plugin` | 8.71.2 | 8.72.2         | minor                 | 可顺手升级，规则兼容               |
| `@vitest/eslint-plugin`            | 1.6.28 | 1.6.28         | 已最新                | 不动                               |
| `typescript`                       | 6.0.3  | 7.0.2          | 跨大版本（tsgo 原生） | 走 L3 评估轨，本轮不硬切           |
| `eslint`                           | 9.39.5 | 10.14.0        | 跨大版本              | **本轮不升级**（见下）             |
| `neostandard`                      | 0.13.0 | 0.14.1         | minor                 | 仅在 ESLint 升级时才需要，本轮不动 |
| `oxlint` / `@biomejs/biome`        | 未装   | 1.93.0 / 2.6.6 | 新工具                | 走 L4 / L5 评估轨                  |

**建议本轮升级：Vitest 5.0.5 → 5.1.0（同大版本，低风险，直接放大 L2）** —— **已被实测否决（2026-11-12）**

> **实测结论（推翻本节判断）**：升到 5.1.0 后全量 **1082.33s（墙钟 1125.2s）**，import 占 95%，比 5.0.5 的 140.29s 慢 **7.7 倍**，并引入 2 文件 3 例失败（`wp12-memory-closeout.spec.ts` 2 例、`wp38-debug-session-resume.spec.ts` 1 例，均为 60s/30s 超时类）。已回滚到 5.0.5。
> 同批另一个更隐蔽的凶手是 **vite 8.3.5 → 8.3.8**：即使 vitest 回滚，只要 vite 是 8.3.8，全量仍是 1289s。**已将 vite 精确锁 `8.3.5`**。两者叠加说明"顺手升 patch 零风险"在构建工具链上不成立——**任何 vite/vitest 版本变动都必须以全量绿跑 + 墙钟数字为验收，不看 changelog 结论**。

官方 5.1 发布说明（2026-11-02）声称的收益与适配点（仅存档，本仓不适用）：

- `isolate:false` 下 worker 缓存 setup 文件解析与 mock，不再对每个文件重复请求 warm modules 快照；800 文件基准上解析缓存约省 10%、共享大模块树场景 warm modules 最多省 18%——与本仓 185 文件、共享 langchain/typeorm 重依赖图的形态吻合。
- 新增实验性 `--since-last-run`：不依赖 Git，按每个测试上次运行后依赖文件的 mtime 只跑受影响用例，官方明确面向 AI coding agent 的内循环；另有 `--last-failed` 只复跑失败项。
- `fsModuleCache` 在 5.1 转为默认开启（5.0.5 默认关闭，故本方案显式写 `true`；升级后该行可保留作显式声明，语义不变）。
- 5.1 的破坏性变更集中在 Browser Mode（trace 视图、import map mock、默认端口），本仓为 node 环境测试且未启用 browser，不受影响；`fakeNodeBuiltins` 为 opt-in，不改变现状。
- 配套：`@vitest/coverage-v8` 同步到 5.1.0；`@vitest/eslint-plugin` 1.6.28 已兼容，无需动。

**本轮不升级：ESLint 9.39.5 → 10.x（生态未齐，且 ESLint 非瓶颈）**

- 实测 peer 依赖：`eslint-plugin-import` 最新仍为 2.32.0、peer 上限仅到 `^9`，无 ESLint 10 兼容版本，构成硬阻塞；当前 `neostandard 0.13.0` peer 也只到 `^9`（0.14.1 才支持 `^10`）。
- 其余插件已具备 10 兼容（sonarjs 4.2.2 含 `^10`、unicorn `>=9.38`、prettier `>=8`、@vitest/eslint-plugin `>=8.57`）。
- ESLint 10 本身要求 Node >=20.19（本机 22.23.2 满足），flat config 已在用；但 ESLint 在总耗时中占比小，不值得为它协调替换 import 插件，登记为后续独立评估项，待 import 插件发布兼容版本再统一升级。

**运行时（Node / pnpm）**：Node 22.23.2 已支持本方案全部缓存能力（含 Node 编译缓存），无需为提速升级；`engines.node >=26` 的 engineStrict 警告是独立事项，不在本方案处理。pnpm 9.15.0 满足全部脚本与 workspace 需求，不随本方案变更。

### L1. 流程闸门治理（零代码，先落地，收益最大）

**问题**：任务模板 §5.2 把全量 tsc + lint + test 写成每个交付的收尾闸门；执行方照跑，验收再全量复跑。验收清单（ai-handoff-acceptance）原本要求的就是关键路径抽跑复现，并未强制全量套件。

**改动**：

1. 任务模板 `docs/team/wp-task-template.md` §5 新增「5.4 验收闸门（回收方，定向 + 范围核对）」：
   - 验收方不重跑全量 vitest；执行方交付记录中的全量证据与 CI 结果作为合并底线。
   - 验收动作固定为：
     - `pnpm test:related -- <本次触碰的 src 文件>` 或 `pnpm test:changed`；
     - 关键路径 1–2 条 spec 单文件抽跑复现；
     - 触碰文件 tsc / eslint 定向复查；
     - `git diff --stat HEAD -- src/engine-core` 为空核对；
     - 改动文件清单与并行进程产物分组核对（沿用 §7 提交分组纪律）。
   - 仅当出现以下情形才升级为全量复跑：交付记录闸门数字存疑、并行产物混入、抽跑发现确定性失败、里程碑 / 冻结节点。
2. 验收侧 skill 清单（`ai-handoff-acceptance`）同步：证据核对 = 抽跑复现 + 范围核对；全量套件归 CI / 里程碑，不在验收阶段扩大改动或补跑全量。
3. §5.2 保留执行方收尾全量一次（改动由执行方引入，其全量证据有意义），但明确"每任务只跑一次，不在验收侧重复"。

**红线保留**：不删除全量套件；CI 全量门禁不动；engine-core 边界与 `boundary.spec.ts` 不动。

### L2. Vitest 运行时复用、依赖优化与缓存（配置改动，可独立回滚）

**依据**：

- 本地类型核实（`config.d.QBNYCgFU.d.ts`）：`poolOptions` 已在 v4 移除，`isolate` 为顶层 `test.isolate`；顶层另有 `test.pool`、`test.fsModuleCache`、`test.maxWorkers`、`test.minWorkers`。
- 官方《Improving Performance》《Profiling Test Performance》及配置参考（见 §3A）确认：forks 兼容但略慢于 threads；`deps.optimizer` 可把多模块外部依赖打成单文件；`fsModuleCache` 在 5.0.5 默认关闭、5.1 起默认开启。本配置片段在 5.0.5 与 5.1 上语义一致（显式写 `true` 不依赖默认值）。
- 版本前提：本片段所有键（顶层 `isolate`、`fsModuleCache`、`deps.optimizer.ssr`）均为 Vitest 5.x 支持的写法，升级到 5.1.0 后无需改配置；5.1 另提供 `--since-last-run` / `--last-failed` 内循环命令（见 §7）。
- 第三方数据（Mergify Test Insights）：`isolate: false` 实测约 30% 提速，但会暴露模块级单例跨文件泄漏这一类无法 grep 的 flake。

#### L2 已落地（2026-11-12 实测，与设想有重大出入）

**先修正两个前提（实测推翻文档假设）**

| 假设                     | 实测                                                                                           | 结论                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 升到 Vitest 5.1.0 会更快 | 全量 **1082.33s / 1125.2s 墙钟**（import 95%），2 文件 3 例失败，比 5.0.5 的 140.29s 慢 7.7 倍 | **5.1.0 在本仓不可用**，已回滚 5.0.5；§3B 的"建议升级"结论作废             |
| 慢是 vitest 版本问题     | 回滚后仍 1289s；根因是升级顺带把 **vite 8.3.5 → 8.3.8**                                        | 已把 vite **精确锁 8.3.5**（`"vite": "8.3.5"`，无 caret），vitest 走 5.0.5 |
| 140s 是可复现的基线      | 同一仓库同一代码，**机器上有长驻进程时**全量 1467s                                             | 闸门测量必须在干净机器上做，见 §1.5 环境纯净度                             |

**已落地改动**

1. `vitest.config.mts`：新增 `deps.optimizer.ssr`（`@langchain/core` / `@langchain/openai` / `typeorm` / `@qdrant/js-client-rest` / `bullmq` / `ioredis`），只做外部包预构建，不改隔离语义。
2. `vitest.fast.config.mts`（新增）＋ `pnpm test:fast`：`isolate: false` 的内循环专用配置，供"要信号但不想等"的场景使用。
3. **权威闸门 `pnpm test` 保持 `isolate: true`**（默认值不动）。

**`isolate: false` 的实测收益与硬伤**

| 配置                         | 墙钟       | Duration              | 结果                           |
| ---------------------------- | ---------- | --------------------- | ------------------------------ |
| `isolate: true`（带负载）    | 1467.2s    | 1467.32s              | 4 failed（且为负载相关 flake） |
| `isolate: false`（同一时段） | **238.2s** | 206.19s（import 70%） | **10 failed / 3 文件**         |

收益：**7 倍**（1467s → 206s），足够大，但 10 例失败全部是 `process.env` 跨文件泄漏造成的假失败（同 worker 共享 `process.env`，而 `isolate:true` 每文件新进程天然隔离）：

- `test/engine-adapters/wp66-deliberation-retry.spec.ts`（6 例）：`ENGINE_DELIBERATION_MAX_RETRIES` 默认值 / 非法值回退 / `attempts` 断言；
- `test/engine-core/i12-session-alliance-config.spec.ts`（2 例）："无覆盖 → 消费点拿实例级配置"；
- `test/engine-adapters/wp12-memory-closeout.spec.ts`（2 例）：逐字稿覆盖写语义。

这三类都是"读 env 默认值"的 spec，被其他文件改过的 env 污染。**因此 `isolate:false` 不能直接做权威闸门**，除非先把 spec 之间的 env 泄漏清理干净（登记为 backlog：`测试间 process.env 泄漏清理 → 之后可把 isolate:false 提升为权威闸门`）。清理完成后，权威闸门还能再省一次 ~70% 的 import 开销。

**原始方案设想（保留对照，实际以上方"已落地"为准）**：

**改动文件**：`vitest.config.mts`，在 `test` 块内新增（L2-b / L2-c 先落地，L2-a 用 projects 分层隔离，按 importDurations 证据再定 include）：

```ts
test: {
  globals: true,
  root: './',
  testTimeout: 30_000,
  env: { NODE_ENV: 'test' },
  // L2-b: 模块磁盘缓存，重复运行复用已转换模块；顶层配置，两个 project 都继承。
  fsModuleCache: true,
  // L2-c: 依赖优化器，把深 import 树的外部包用 esbuild 打成单文件，直接压缩 import 段。
  // node 环境走 ssr；include 列表由 experimental.importDurations 实测的最慢模块决定，先保守只放重依赖。
  deps: {
    optimizer: {
      ssr: {
        enabled: true,
        include: [
          '@langchain/core',
          '@langchain/openai',
          'typeorm',
          '@qdrant/js-client-rest',
          'bullmq',
          'ioredis',
        ],
      },
    },
  },
  // L2-a: 用 projects 做分层隔离——纯单元 project 关隔离，集成 project 保持隔离。
  // 内联 project 默认 extends:true，继承顶层 env/globals/deps/fsModuleCache/插件。
  projects: [
    {
      test: {
        name: 'unit',
        isolate: false,
        // 排除 5 个起 TestingModule/NestFactory 的非 e2e 集成 spec（e2e 已在全局 exclude）。
        exclude: [
          '**/e2e/**',
          'test/base/auth-reset-password.spec.ts',
          'test/user/set-password-first-set.spec.ts',
          'test/counselor/wp21-report-sse-endpoint.spec.ts',
          'test/voice/wp22-voice-concurrency-budget.spec.ts',
          'test/good-state-diary.e2e-spec.ts',
        ],
      },
    },
    {
      test: {
        name: 'integration',
        isolate: true,
        include: [
          'test/base/auth-reset-password.spec.ts',
          'test/user/set-password-first-set.spec.ts',
          'test/counselor/wp21-report-sse-endpoint.spec.ts',
          'test/voice/wp22-voice-concurrency-budget.spec.ts',
          'test/good-state-diary.e2e-spec.ts',
        ],
      },
    },
  ],
  coverage: {
    include: ['src/**/*.ts'],
    exclude: ['src/entity/**'],
  },
},
```

> 落地约束：`coverage` / `reporters` 等只能在根配置，不能下沉到 project；两个 project 必须共同覆盖全部非 e2e 文件，落地后用 `DEBUG=vitest:projects` 核对文件归属，防止有 spec 漏配。若 projects 改造在当前结构上验证成本过高，可先用顶层单行 `isolate: false`（对全部非 e2e 文件生效，flake 面更大）作为过渡，再择期切 projects。

**选项取舍与风险**：

- 分层隔离（L2-a，首选 `projects`）：把约 170 个纯单元 spec 放进 `unit` project 关隔离，把 5 个起 TestingModule/NestFactory 的集成 spec 放进 `integration` project 保持隔离；e2e 已在全局排除。这样只在确定无模块级可变状态的纯单元上共享模块注册表，规避全局 `isolate:false` 把集成 spec 也纳入的风险。Mergify 数据显示关隔离约 30% 提速，但模块级单例（模块作用域 `let` 缓存、注册表、连接池）跨文件串测时，失败用例与肇事用例不在同一文件、无法 grep。**缓解**：开启前先跑 `vitest doctor`；落地后对 unit project 跑两次 `vitest --shuffle --run --project unit` 暴露顺序依赖，再跑全量确认全绿；对无法重构的模块级缓存，集中到 `vitest/setup.ts` 的 `beforeEach` 统一 reset；若仍出现跨文件 flake，把 unit project 的 `isolate` 还原 `true`（保留 L2-b、L2-c），其余不变。
- `fsModuleCache: true`（L2-b）：保留隔离语义，仅复用转换产物，优先落地；缓存默认在 `node_modules`，重装依赖自动失效，可用 `fsModuleCachePath` 改位置。
- `deps.optimizer.ssr`（L2-c）：只打包 `include` 内外部包（已是编译产物，不含本仓装饰器源码），不碰 NestJS 自身，规避装饰器元数据风险；打包后无法在 node_modules 内插桩调试，需 `force` 重新打包。先按 `importDurations` 实测名单保守启用，A/B 验证后再扩。
- Node 编译缓存（L2-d，零配置代码）：设环境变量 `NODE_COMPILE_CACHE=node_modules/.cache/node-compile-cache`，Vitest 把自身模块与外部依赖的 V8 字节码落盘，跨次复用，自动传播到每个 worker。注意 v8 coverage 开启时该缓存自动停用；首跑为空只付序列化成本，目录需跨次保留才划算。
- `pool: 'threads'` + `isolate: false`：官方称 threads 在大项目上通常更快，是最快组合；但与 native addon / worker 线程兼容性需实测，作为 `vitest doctor` 第二阶段实验项，不进默认配置。
- `maxWorkers` / `minWorkers`：8 核保持默认；仅当基准显示 worker 饥饿（大量文件排队）时再调，不预先硬编码。
- 分片 `--shard`：面向多机 CI 与高核数机器（单 Vite 主线程成为瓶颈时）；8 核单机收益有限，不在本地启用，CI 侧如未来需要再评估。
- 诊断先行：先跑 `vitest doctor` 与 `--experimental.importDurations.print`，拿到最慢 import 名单与各候选配置实测，再决定 L2-a / L2-c 的最终取舍，不凭估计直接全开。

### L3. TypeScript 类型闸门改用 build 模式缓存（**已落地实施**，2026-11-12）

**实测结论**

| 方案                                            | 冷跑            | 热跑                   | 改一个文件后 | 判定                                                          |
| ----------------------------------------------- | --------------- | ---------------------- | ------------ | ------------------------------------------------------------- |
| `tsc -p tsconfig.build.json --noEmit`（原闸门） | 38.2s           | 38.2s                  | 38.2s        | 每次全量，无复用                                              |
| `incremental: true` + `--noEmit`                | 73.6s           | 38.5s                  | —            | **无收益**：`--noEmit` 不复用 buildinfo，首跑还多 35s，已回退 |
| **`tsc -b tsconfig.check.json`**                | 87.4s（建缓存） | **2.7s / 2.4s / 2.0s** | 2.9s         | **落地**：重复闸门 38.2s → ~2.5s                              |

**落地改动**

1. 新增 `tsconfig.check.json`：`extends ./tsconfig.build.json`（口径与闸门完全一致：src 全量、排除 spec/test/bin），加 `composite: true` + `outDir node_modules/.tmp/tcheck` + `tsBuildInfoFile node_modules/.tmp/tcheck.tsbuildinfo`。产物落 git 忽略目录，不污染 `dist`。
2. `package.json` 新增：
   - `typecheck` = `tsc -b tsconfig.check.json`（**收尾闸门，走缓存**）
   - `typecheck:full` = `tsc -p tsconfig.build.json --noEmit`（无缓存全量，CI / 怀疑缓存失真时用）
   - `typecheck:build` 保留（向后兼容既有文档与脚本）
3. **缓存不会掩盖错误**：注入 `const x: number = 'str'` 后 `pnpm typecheck` 36.9s、exit 1，准确报 `TS2322`；删除后恢复 exit 0。

**代价与边界**：新增/删除源文件后需要一次重建（实测 31.7s），冷启动 87.4s（高于原 38.2s 一次）；日常"改代码再验证"从 38s 降到 ~3s，是净赚。CI 仍可用 `typecheck:full` 做无缓存权威检查。

**长期评估轨：TypeScript 7 / tsgo（原生 Go，不在本轮硬切）**

- 现场实测当前 TypeScript 为 6.0.3（JS 实现线）；TS 7 为原生 Go 重写（tsgo），官方 VS Code 数据显示同口径类型检查约 7x、错误一致，是 tsc 耗时的终极解。
- 迁移属大版本跳跃，需独立 spike 验证：`experimentalDecorators` + `emitDecoratorMetadata`（NestJS DI 依赖）在 TS 7 的支持、与 `tsconfig.build.json` 发射产物、Vitest / ESLint 工具链兼容。
- 落地路径：先在 CI 增加一个非阻塞 tsgo 试跑 job 对比错误集，确认零差异后再切换主类型闸门；本轮只做 L3 增量，不升级主编译器。

### L4. lint 分层：oxlint 快检 + ESLint 权威闸门（**已落地实施**，2026-11-12）

**实测结论（决定策略的关键证据）**

| 观测                               | 数字                                                                              | 含义                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| ESLint 全量冷跑                    | 394.9 s                                                                           | 缓存无效时的真实成本                                   |
| ESLint 全量热跑                    | 69.3 s                                                                            | 缓存全命中仍有 ~70 s 固定成本                          |
| **ESLint 单文件**                  | **99.3 s**                                                                        | 与文件数无关 → **定向 lint 完全救不了 lint**           |
| 单文件规则执行耗时（`TIMING=1`）   | 合计 ≈ 1.95 s（prettier 693 ms、sonarjs/deprecation 227 ms、import/order 97 ms…） | **97% 是启动**：加载插件 + `projectService` 建 TS 程序 |
| oxlint 全仓（1295 文件）           | **0.42 s**（墙钟 2.1 s），0 error / 4 warning                                     | 无类型程序，快 940x                                    |
| oxlint `--type-aware`（1295 文件） | **24.0 s**（墙钟 26.8 s），0 error / 57 warning                                   | 有类型信息仍快于 ESLint 冷跑 16x / 热跑 3x             |

**落地改动**

1. 新增 `.oxlintrc.json`：`categories: { correctness: warn }`，关掉 `no-unused-vars`（类型未使用由 tsc `noUnusedLocals` 兜）、`no-undef`、`typescript/no-this-alias`、`unicorn/no-useless-spread`；忽略 `dist/**`、`src/entity/**`、`admin-dashboard/**`。
2. `package.json` 新增 4 个脚本：`lint:fast`（oxlint，0.4 s）、`lint:fast:fix`、`lint:deep`（oxlint `--type-aware`，24 s）、`typecheck:build`（`tsc -p tsconfig.build.json --noEmit`）。
3. `lint-staged` 的 `eslint --fix` 换成 `oxlint --fix`，`prettier --write` 保留 → 提交钩子从 ~100 s 降到秒级。
4. `.husky/pre-commit` 的裸 `npx lint-staged` 改为 `pnpm exec lint-staged`（统一包管理器规范）。
5. **`pnpm lint`（ESLint type-aware）保持原样，不降级、不删除**，仍是任务收尾权威闸门与 CI 门禁。

**分层后的用法**

| 场景                        | 命令                                | 耗时              |
| --------------------------- | ----------------------------------- | ----------------- |
| 内循环（改一行就查）        | `pnpm lint:fast`                    | 2 s               |
| 提交钩子                    | 自动（`oxlint --fix` + `prettier`） | 秒级              |
| 任务收尾（权威）            | `pnpm lint`                         | ~70–100 s（一次） |
| 需要类型感知但不想等 ESLint | `pnpm lint:deep`                    | 27 s              |
| CI / 里程碑                 | 不变（`npm run lint`）              | CI 环境           |

**既有债（登记，不在本单修）**：oxlint 全仓 4 条 warning 均为提交前既有——`test/engine-adapters/wp68-deliberation-intention-lock.spec.ts:284`、`test/engine-adapters/wp64-deliberation-shadow.spec.ts:625`（`no-unsafe-optional-chaining`），`test/engine-core/wp3-trajectory.spec.ts:243,245`（`oxc/erasing-op`，`0.6 * 0.6 + 0.4 * 0` 恒为 0.36）。类型感知模式另多出 53 条，多为 `no-array-sort` / `consistent-function-scoping` 类风格项，**不作门禁**。

**为什么不能直接把 ESLint 换成 oxlint**：本仓 ESLint 叠加 sonarjs / neostandard / unicorn / prettier / import 多插件（含 `import/order`、`complexity`、`prettier/prettier` 等 oxlint 不复刻或语义不同的规则）。替换属规则等价性工程，需逐规则核对 + 双跑差异归零，**另开任务单评审**；本轮只做分层，不动权威闸门。

### L5. 测试结构减重（长期 backlog，不进本轮配置改动）

**现状**：13 个 spec 实例化 Nest TestingModule / NestFactory（含 e2e）；其余为单元 / 纯函数 spec。重型依赖图（langchain、qdrant、redis、LLM provider）在每个相关 spec 的 import 阶段被加载。

**方向（另开任务单跟踪）**：

- 全应用集成 spec 收敛为少量聚焦场景；单元 spec 只在端口 / 适配层 mock 外部 SDK，缩小每文件加载图。
- 避免 barrel 文件把整棵引擎树拉进单个 spec；按模块拆分 import。
- 纯决策逻辑保持在 `engine-core` 纯层，不通过测试结构把 IO 依赖反向引入内核。

**边界**：L5 只调整测试组织与 mock 位置，不改业务行为、不动 engine-core 分层归属。

### 3C. 覆盖率与 CI 缓存现状（核实结论，本轮只记录不改 CI）

- **覆盖率非常驻成本**：`vitest.config.mts` 仅有 coverage 配置块、未设 `enabled:true`，日常 `pnpm test` 不插桩、不产生 coverage 开销；覆盖率保持按需 `vitest --coverage` 触发，不要在闸门默认开启。CI 里 `Upload coverage` 步骤指向 `coverage/`，但 `npm test` 未带 `--coverage`，该目录实际不会生成，属遗留无效步骤，登记技术债、本轮不动。
- **CI 包管理器与本地不一致**：`.github/workflows/ci.yml` 用 `npm ci` / `npm` / `npx` 与 `cache:'npm'`，而本地与 `packageManager` 是 pnpm；这是独立技术债，不在本方案处理，避免提速改动与工具链切换混在一起。
- **CI 未持久化 Vitest 缓存**：CI 每个 job 全新 runner，只缓存 npm 下载缓存，`fsModuleCache`、`deps.optimizer` 产物、`NODE_COMPILE_CACHE` 均未跨 job 保留，因此这些缓存当前只对本地重复运行生效。未来若要在 CI 侧复用，需用 `actions/cache` 持久化 `node_modules/.vite`、`node_modules/.cache` 等目录并配合 `--shard` 矩阵，单独立项评估，本轮不改 ci.yml。

---

## 4. 改动清单（落地时按此分组提交）

| 序号 | 文件                                                           | 改动                                                                                                                                                              | 所属层       | 风险                                                       |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------- |
| 1    | `docs/team/wp-task-template.md`                                | §5 新增 5.4 验收闸门定向矩阵；§5.2 标注执行方全量仅一次                                                                                                           | L1           | 低（文档）                                                 |
| 2    | `.user_skills/ai-handoff-acceptance/` 清单                     | 证据核对明确为抽跑 + 范围核对，全量归 CI / 里程碑                                                                                                                 | L1           | 低（本地 skill）                                           |
| 3    | `package.json`（devDeps）                                      | `vitest`、`@vitest/coverage-v8` 升级 5.0.5→5.1.0；`vite` 8.3.5→8.3.8、`@typescript-eslint` 8.71.2→8.72.2                                                          | 版本升级     | 低（同大版本，全量绿跑验证）                               |
| 4    | `vitest.config.mts`                                            | `projects` 分层隔离（unit `isolate:false` / integration `isolate:true`）、`fsModuleCache: true`、`deps.optimizer.ssr`（先 doctor / importDurations 再定 include） | L2           | 中（共享模块状态，可单项回滚；过渡可用顶层 isolate:false） |
| 5    | 本地环境变量（非仓库文件）                                     | `NODE_COMPILE_CACHE=node_modules/.cache/node-compile-cache` 启用 V8 字节码缓存                                                                                    | L2-d         | 低（coverage 时自动停用）                                  |
| 6    | `tsconfig.build.json`                                          | ~~`incremental` + `tsBuildInfoFile`~~（实测无收益，未落地）                                                                                                       | L3           | —                                                          |
| 7    | `tsconfig.check.json`（新增）+ `tsconfig.json` 不动            | `composite` + `tsc -b` 缓存闸门                                                                                                                                   | L3           | 低                                                         |
| 8    | `.gitignore`                                                   | 确认 `node_modules/.tmp/`、`node_modules/.cache/` 忽略                                                                                                            | L3 / L2-d    | 低                                                         |
| 9    | `package.json`                                                 | `lint:fast` / `lint:fast:fix` / `lint:deep` / `typecheck` / `typecheck:full` / `typecheck:build` / `test:fast` 脚本                                               | L4 / L3 / L2 | 低                                                         |
| 10   | `.oxlintrc.json`（新增）+ `oxlint` / `oxlint-tsgolint` devDeps | oxlint 快检 + 类型感知                                                                                                                                            | L4           | 低                                                         |
| 11   | `vitest.fast.config.mts`（新增）                               | `isolate:false` 内循环专用配置（非权威闸门）                                                                                                                      | L2           | 中（仅内循环，权威闸门不受影响）                           |
| 12   | `vite` 精确锁 `8.3.5`                                          | 规避 8.3.8 的性能回归                                                                                                                                             | L2           | 低（版本钉死）                                             |
| 13   | （独立评估轨，另开单）                                         | TS 7 / tsgo 非阻塞试跑；ESLint 10 待 import 插件兼容                                                                                                              | L3 / L4 长期 | 中，不进本轮                                               |
| 14   | （另开 backlog 单）                                            | 集成 spec 收敛与 SDK mock 瘦身；**spec 间 `process.env` 泄漏清理（做完即可把 `isolate:false` 提升为权威闸门）**                                                   | L5 / L2      | 中，独立任务                                               |

**不动清单**：`.github/workflows/ci.yml`（本轮不改，TS7/Oxlint 试跑是后续独立事项）、`eslint.config.mjs` 规则集、`eslint` 主版本（停 9.39.5）、`engine-core/`、`boundary.spec.ts`、`admin-dashboard/`、Flutter 仓、任何 schema / migration / 业务内容字段。

---

## 5. 风险、隔离与回滚

| 风险                            | 触发条件                                           | 缓解 / 回滚                                                                                                         |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `isolate: false` 跨文件串测     | 共享模块注册表导致后续 spec 看到前序文件改写的状态 | 开启前先跑 doctor；开启后全量套件必跑一次；出现 flake 即把 `isolate` 还原 `true`，保留 `fsModuleCache` 与 optimizer |
| 依赖优化器打包异常              | esbuild 打包外部包后行为差异 / 无法插桩调试        | include 只放重依赖、不碰 NestJS；异常即 `enabled:false` 或 `force` 重打包，单项回滚                                 |
| 编译缓存陈旧 / 与 coverage 冲突 | 字节码缓存与源码不一致                             | 缓存按内容哈希失效，删目录即冷启动；coverage 开启时自动停用，无需手动处理                                           |
| 增量 buildinfo 过期假象         | 源码改动未被增量正确识别，本地绿而 CI 红           | 删除 `node_modules/.tmp/*.tsbuildinfo` 冷启动；CI 干净环境不受影响                                                  |
| 缓存产物入库                    | `.eslintcache` / buildinfo / 编译缓存误提交        | 已 gitignore；提交前 `git status` 核对，按 §4 分组 stage                                                            |
| 并行产物混入                    | MiniMax 等进程同时改动仓库                         | 配置改动在并行任务交付验收、工作树干净后再落；提交分组核对，不混提                                                  |
| 规则被顺手降级                  | 提速压力下关闭 type-aware / 严格类型开关           | 红线：L4 只加定向脚本，不改规则；L3 不动 strict 开关                                                                |
| 评估轨被误当既成切换            | TS7 / Oxlint 双轨结果被直接当主链路                | 本轮只做非阻塞试跑，替换必须另开单评审，不在本方案内合并                                                            |

**回滚粒度**：L2、L3、L4 各自落在独立文件 / 脚本，可单项还原而不影响其他层；L1 为文档改动，独立提交。

---

## 6. 实施顺序与排期建议（含 2026-11-12 实际执行结果）

| 步  | 内容                                          | 状态                                                                                                                                        |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | 基线校准：三腿实测 + 缓存异常定位             | 已完成（§1.2 / §1.4）                                                                                                                       |
| 1   | **L4 lint 分层（oxlint 快检 + ESLint 权威）** | **已完成**：2.1s / 26.8s / ESLint 不动                                                                                                      |
| 2   | **L3 类型闸门 `tsc -b` 缓存**                 | **已完成**：38.2s → ~2.5s（热）                                                                                                             |
| 3   | 版本升级（vitest 5.1 / vite 8.3.8）           | **已试并回滚**：5.1.0 慢 7.7 倍、vite 8.3.8 慢 9 倍；已锁 vite 8.3.5                                                                        |
| 4   | L2 vitest 运行时                              | 部分完成：`deps.optimizer.ssr` 已落；`isolate:false` 实测 7 倍提速但有 10 例 env 泄漏假失败 → 降级为 `test:fast` 内循环配置；权威闸门仍隔离 |
| 5   | L2 遗留项                                     | `fsModuleCache` / `NODE_COMPILE_CACHE` / `projects` 分层未落；先清 env 泄漏再谈                                                             |
| 6   | L1 流程（验收不重复全量）                     | 未落（见 §L1）                                                                                                                              |
| 7   | L5 测试结构减重                               | 另开 backlog                                                                                                                                |

**当日结论**：lint 从"每次 100s 起步"降到 2s（提交钩子秒级）；类型闸门从 38s 降到 2.5s（热）；vitest 权威闸门未变（140s 干净环境），但拿到了"`isolate:false` 值 7 倍 + 阻塞点在哪"的确定结论。真正把"一次活动 30 分钟"劈开的下一步是 L1（验收不再重复跑全量）与 env 泄漏清理。

> 提交纪律：一个提交一个意图；L1 文档、L2 配置、L3 配置、L4 脚本分别成组；不自动 push，commit message 草稿等用户指令。

---

## 7. 验证与 A/B 度量方法

### 7.1 基准记录口径

每次记录：工作树状态、命令、退出码、Test Files 数、Tests passed / skipped / failed、总 Duration、日志中的 `import x% / tests y%`、worker spawn 提示行、耗时（墙钟秒）。

### 7.2 命令

```powershell
# 诊断（第零步）
pnpm exec vitest doctor
pnpm exec vitest run --experimental.importDurations.print

# L2-a projects 落地核对：确认文件归属无遗漏 + 两次 shuffle 暴露顺序依赖
$env:DEBUG = "vitest:projects"
pnpm exec vitest run
pnpm exec vitest --shuffle --run --project unit
pnpm exec vitest --shuffle --run --project unit

# 基线（改动前）——三条腿分别计时，日志写 %TEMP% 再读回（Windows stdout 易吞）
pnpm test 2>&1 | Tee-Object -FilePath "$env:TEMP\vitest-baseline.log"
#   → 实测 140.29 s / 186 文件 / 3008 例 / import 74%
pnpm exec tsc -p tsconfig.build.json --noEmit      # → 实测 38.2 s
pnpm lint                                           # → 冷跑 394.9 s，热跑 69.3 s
# 冷跑复现：删掉 .eslintcache 后再跑一次（只在确认缓存失效原因时做）
```

# L2 后对比（NODE_COMPILE_CACHE 经环境变量注入，PowerShell 单次会话）

$env:NODE_COMPILE_CACHE = "node_modules/.cache/node-compile-cache"
pnpm test 2>&1 | Tee-Object -FilePath vitest-after-vite.log

# 内循环（升级到 5.1 后）：不依赖 Git，只跑上次运行后受影响的用例 / 只复跑失败项

pnpm exec vitest run --since-last-run
pnpm exec vitest run --last-failed

# L3 重复 tsc（第一次冷编，第二次读 buildinfo）

pnpm typecheck:build
pnpm typecheck:build

# 定向验收（L1/L4 落地后）

pnpm test:related -- src/<touched>.ts
pnpm lint:files <touched-files...>

```

### 7.3 DoD

- 全量套件 0 failed，用例总数与基线一致（仅允许既存 skip 数不变）。
- `git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 未出现在改动清单。
- A/B 数字回填到交付记录：全量 vitest 前后耗时与 import 占比、重复 tsc 前后耗时、验收定向命令耗时。
- CI 既有全量门禁保持通过；未新增必须本地全量复跑的环节。

---

## 8. 明确不做（范围外）

- 不删除全量测试套件，不把 CI 全量门禁改成定向。
- 不关闭 type-aware eslint 规则、不放松 TypeScript strict 开关、不改 engine-core 边界与护栏 spec。
- 不在本轮硬切 TS 7 / tsgo 或 Oxlint：先非阻塞双轨对比，确认零差异后再单独评审替换。
- 不在本轮升级 ESLint 10：`eslint-plugin-import` 无兼容版本构成硬阻塞，且 ESLint 非瓶颈；待生态齐备另立单评估。
- 不为提速升级 Node / pnpm：当前 Node 22.23.2、pnpm 9.15.0 已支持全部缓存与脚本能力，版本升级不纳入本方案。
- 不把 `deps.optimizer` 打包范围扩到 NestJS 自身或本仓装饰器源码，避免装饰器元数据风险。
- 不在本轮做测试结构重构（L5 另立 backlog）。
- 不处理 `engines.node >=26` 与本机 Node v22 的 engineStrict 警告（既存观察项，独立事项）。
- 不动 `admin-dashboard/` 前端工程与 Flutter 客户端。

---

## 9. 技术债与 backlog 登记（本轮不修，显式跟踪）

| 编号 | 债务 | 影响 | 解除条件 / 下一步 |
| --- | --- | --- | --- |
| **P-DEBT-1** | **spec 文件之间 `process.env` 泄漏**（`isolate:false` 全量实测 10 例假失败：wp66 6 例、i12 2 例、wp12 2 例） | 权威闸门只能保持 `isolate:true`，`isolate:false` 的 7 倍提速拿不到手 | 逐个补 `afterEach` 还原 env（或统一 setup 快照 + 还原）；全量 `pnpm test:fast` 0 failed 后，把 `isolate:false` 提升为权威闸门配置，预计再省 ~70% import 开销 |
| **P-DEBT-2** | `.eslintcache` 存在却大面积失效（22:58 生成，00:24 全量仍 394.9s） | ESLint 冷跑成本无法稳定压到热跑的 69.3s | 定位触发失效的变量（config/tsconfig 变更、`projectService` 重建、多工作树）；在 CI 与本机统一缓存 key |
| **P-DEBT-3** | oxlint 4 条既有 warning（2×`no-unsafe-optional-chaining`、2×`oxc/erasing-op`）；类型感知模式另 53 条风格项 | 只是噪声，不阻塞 | 独立清理单；`wp3-trajectory.spec.ts:243,245` 的 `0.6*0.6+0.4*0` 恒等 0.36 属测试写法问题，改断言即可 |
| **P-DEBT-4** | 构建工具链版本升级无验收纪律（vite 8.3.8 / vitest 5.1 各自带来 9 倍 / 7.7 倍回归） | 任何"顺手升 patch"都可能把闸门时间打回 20 分钟 | 规则：vite/vitest 版本变动必须附全量绿跑 + 墙钟数字，且已钉死 `vite 8.3.5` |
| **P-DEBT-5** | CI 缓存与分片未做（`actions/cache` + shard 矩阵、CI 侧 pnpm 统一） | CI 每次全量冷跑 | 独立技术债单，不在本方案范围 |
| **P-DEBT-6** | 测试结构减重（L5）：集成 spec 收敛、外部 SDK 端口层 mock、barrel 瘦身 | import 74% 的结构性根因 | 独立任务单 |
| **P-DEBT-7** | 本机长驻开发进程污染闸门测量（`nest start --watch` 跑 2 天 7306s CPU） | 同一份代码实测 148s vs 1512s | 已写入 `wp-task-template` §5.0 纪律：跑闸门前确认无 watch / dev server |

---

_更新记录：2026-11-12 —— L4 落地（oxlint 分层）、L3 落地（`tsc -b` 缓存）、L2 部分落地（`deps.optimizer.ssr` + `test:fast`）；版本升级两项实测回滚；新增 §1.5 环境纯净度与 §9 债务登记。_
```
