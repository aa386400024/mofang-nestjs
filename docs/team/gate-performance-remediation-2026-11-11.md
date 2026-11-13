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

### 1.5 环境层税：长驻进程 + 存储读取拦截（2026-11-12 实测，全案最重要的一节）

闸门耗时**有一大半不在仓库里**，而在机器上。两个独立的税，必须先缴清再谈配置优化。

#### 税 1：长驻开发进程

| 机器状态                                  | 全量 vitest 墙钟       | import 占比 |
| ----------------------------------------- | ---------------------- | ----------- |
| 无 watch / dev server（04:19 实测）       | 1102.6 s（仍叠加税 2） | 96%         |
| 有 `nest start --watch` + vite + dist/app | 1265–1512 s            | 93–96%      |

停机前取证：`nest start --watch`（pid 27392）从 11-10 11:59 连续运行 2 天，**累计 7709 s CPU、1527 MB 常驻**；另有 `admin-dashboard` 的 vite dev（pid 17896）与 `dist/app`（pid 15452）。全部停止后 node 进程数归 0，CPU 从 100% 落到 26%。**纪律：跑闸门前确认机器干净**（已写入 `wp-task-template` §5.0）。

#### 税 2：安全软件 minifilter 按**文件身份（inode）**逐次收税（已定位到机制并归零，2026-11-12）

第一轮对照（同一批 `node_modules/@nestjs/common` 下 202 个 `.js`，同一段 Node 读取代码）：

| 位置                                                 | 读 200 个文件                    | 单文件均值 |
| ---------------------------------------------------- | -------------------------------- | ---------- |
| `E:\Work\Project\backend\mofang-nestjs\node_modules` | **16.2 s**（复测 16.2 / 18.9 s） | 81–95 ms   |
| `C:\Temp` 同文件副本                                 | **67 ms**                        | 0.34 ms    |
| `D:\Temp` 同文件副本                                 | **56 ms**                        | 0.28 ms    |
| `E:\Temp` 同文件副本（**同一个 E 盘**）              | **55 ms**                        | 0.28 ms    |

第二轮逐层排除（全部在同机、同盘、同进程内完成）：

| 对照项                                                  | 结果                                           | 排除了什么                       |
| ------------------------------------------------------- | ---------------------------------------------- | -------------------------------- |
| 目录遍历耗时（walk 202 文件）                           | 24 ms                                          | 目录枚举慢                       |
| `src/**/*.ts` 读 200 个                                 | 66 ms                                          | 整个 repo 路径被收税             |
| `docs/**/*.md` 读 200 个                                | 60 ms                                          | 同上                             |
| repo 内**新拷入**的同名文件副本                         | 47–135 ms                                      | 路径规则命中原文件               |
| pnpm store（`E:\.pnpm-store\v3`）                       | 200 文件 223 ms                                | store 整体慢                     |
| 逐文件打点                                              | **71/202 个文件 >5 ms**，其中 11 个 210–260 ms | "整体慢"的误判；实为少数文件极慢 |
| 同一慢文件用 `New-Item -ItemType HardLink` 链到别的目录 | **243–323 ms**（同一 inode）                   | 目录/路径因素                    |
| 同内容 `Copy-Item` 到别处                               | 0.3 ms                                         | 内容本身/磁盘块                  |
| 原样重写（同内容 `WriteAllBytes`）后重测                | 209–211 ms（无改善）                           | 文件"变新"可自愈                 |
| node 新建 200 个 .js 再读                               | 写 615 ms / 读 134 ms / 复读 87 ms             | 新落盘文件被收税                 |

**结论（按证据收敛）**：税不是"整盘慢"，也不是"目录规则"，而是**一组既有文件的读取被逐次拦截**——约 35% 的 `node_modules` 文件每次读稳定 200–260 ms，重复读不复用缓存，同一 inode 换个目录（硬链）仍慢，而**同样字节的一份拷贝 0.3 ms**。

- `stat` 300 个文件仅 12 ms（元数据不慢，只有**读内容**慢）→ 不是磁盘吞吐问题；
- 文件属性普通 `Archive`、非云占位符；两块盘 `HealthStatus=Healthy`；
- Windows Defender 查询报 0x800106ba（被第三方接管），进程里有 `HipsDaemon` / `HipsTray`（火绒 HIPS）；
- 直接后果：`require('@nestjs/core')` 冷加载 **16.5 s**、`require('@nestjs/common')` **14.0 s**（对照 `typeorm` 仅 1.1 s）。

**机制推论**：读权限请求按文件身份（inode/文件 ID）命中某个安全过滤层，每次读内容都付一次固定代价（~200 ms），且该路径不参与 OS 缓存。Node 模块加载 = 成百上千次小文件读取，于是每个 vitest worker 仅 import 就要 15–19 s——这正是"186 workers × import 96%"的来源，也是"停掉 watch 后仍需 1081.94 s"的根因。

##### 1.5.1 机制闭环：三轮对照把因果链钉死（2026-11-12）

**第一轮：进程完整性级别**。管理员权限 node 跑同一探针 **37 ms / 200 文件（0 慢）**，普通权限 node 同一时刻 **16.5 s（71 慢）**。差异不在文件、不在磁盘，而在**进程完整性级别**——安全软件只对非提权进程的读请求收费。提权 `fltmc filters` 证实：`sysdiag`（火绒驱动）以 altitude 324600 挂在 E:，共 6 实例。

**第二轮：税源随卸载迁移**。用户卸载火绒后（`HipsDaemon`/`sysdiag`/`hrdevmon`/`hrwfpdrv`/`HRWSCCtrl` 全部 `1060 服务不存在`），探针 16.5 s → **5.1–5.9 s**；提权 `fltmc instances -v E:` 显示 `sysdiag` 消失、**`WdFilter`（Defender，altitude 328010，7 实例）接手**，`MsMpEng` 启动时间正是卸载时刻。写入 Defender 排除路径（`E:\Work\Project`、`E:\.pnpm-store`）后：**提权 node 35 ms 归零，普通 node 仍 3583/4757 ms**——路径排除对非提权进程未命中该现象。

**第三轮：inode 判别（决定性）**。取一个 11 字节慢文件做五组对照：

| 组                                     | 单次读耗时            | 结论   |
| -------------------------------------- | --------------------- | ------ |
| 原文件（既有 inode）                   | 31.7 / 30.7 / 32.3 ms | 收税   |
| `Copy-Item` 副本（**新 inode**）       | 0.2 / 0.2 / 0.2 ms    | 免税   |
| 硬链接到 repo 内新路径（**同 inode**） | 34.1 / 33.6 / 39.2 ms | 仍收税 |
| 硬链接到 `E:\Temp`（同 inode、跨目录） | 33.3 / 32.8 / 32.6 ms | 仍收税 |
| **同路径删除后写回同内容（换 inode）** | 0.4 / 0.3 / 0.3 ms    | 免税   |

→ 税按 **inode 身份**收取，与路径、目录、磁盘均无关；同路径换 inode 即归零。另两条候选判据被逐一否证：**硬链接计数**（给快文件加硬链后原路径仍 0.3 ms）、**链接类型**（`@nestjs/common` 前 202 个 `.js` 中 201 个都是 HardLink，快慢两组同构），真正的分组特征是 `size < 50B` 的 73 个文件里含 71 个慢文件——即"**小文件 + 从 store 链接来的旧 inode**"这一组合才被收费。

##### 1.5.2 治本动作：把 node_modules 从 hardlink 改为独立文件（唯一真正归零的动作）

三条原设想的治本动作在本轮实测中全部被推翻：① 火绒信任区/白名单——加了两条目录信任区，探针无变化，且火绒驱动仍在收税；② store 迁盘——inode 判别已证明与盘无关；③ 仓库迁盘——同上，且 `E:\Temp`/`C:\Temp`/`D:\Temp` 同样 55–67 ms 不达标。

**有效动作**：pnpm 默认以 hardlink 复用 store 里的 inode，于是"旧 inode"被整包继承。用 copy 装法重装，让每个文件拿到全新独立 inode：

```powershell
pnpm install --force --config.package-import-method=copy
```

实测：**12 min 19 s、exit 0、1282 包全部从 store 复用（0 新增下载）**；`@nestjs/common` 前 202 个 `.js` 的 LinkType 全部变为 `(none)`。复验（普通权限、无 watch 进程）：

| 指标                           | 改造前（2026-11-12 08:4x） | 改造后                                 | 倍数             |
| ------------------------------ | -------------------------- | -------------------------------------- | ---------------- |
| 读 200 个 `.js`                | 16.5 s（71 慢）            | **63 / 81 ms（0 慢）**                 | **~230×**        |
| 单文件 `abstract.interface.js` | 189–510 ms                 | **0.4 / 0.3 / 0.5 ms**                 | **~500×**        |
| 全量 vitest 墙钟               | 1102.6 s                   | **132 s**                              | **8.3×**         |
| 全量 vitest Duration           | 1081.94 s（import 96%）    | **127.72 s（import 83%）**             | 8.5×             |
| 全量结果                       | 3003 passed / 1 failed     | **3004 passed / 0 failed / 4 skipped** | 转绿             |
| `tsc -b`（热）                 | 2.0–2.7 s                  | **1.8 s**                              | —                |
| `lint:fast`（全仓 1295 文件）  | 2.1 s                      | **1.0 s**                              | 2×               |
| `pnpm lint`（ESLint 权威）     | 热 69.3 s / 冷 394.9 s     | **49.3 s（0 error / 0 warning）**      | 1.4×（热态口径） |

**纪律**：此动作只对本机生效，不进仓库配置（不改 `.npmrc`），因为 copy 装法会增加安装耗时与磁盘占用（`node_modules` 1.46 GB 全部转为实占）；他人与 CI 不应继承该代价。任何 `pnpm install` 若回落到默认 hardlink 装法，税会回来——**复验用 `pnpm doctor:fs`**（本仓新增体检脚本 `scripts/fs-latency-check.mjs`，判据为"均值 <1 ms/文件 且 慢文件占比 <5%"，避开并发负载抖动误判；不合格 exit 1 并直接给出重装命令）。

**Defender 排除已撤销（2026-11-12 收尾）**：卸载火绒后 Defender 接管期间追加的 `ExclusionPath = {E:\Work\Project, E:\.pnpm-store}` 已全部移除（`Get-MpPreference` 回读为空）。理由是它对普通权限 node 从未命中该现象（提权归零、普通仍 45 ms），属**无收益地降低安全面**。撤销后复验：首轮 3106 ms（Defender 重建扫描缓存的一次性成本）、次轮 **88 ms（0 慢文件）**、单文件 0.4 ms——读税未回归，因为税按 inode 收取，而 copy 装法已把 inode 换干净。

##### 1.5.3 连带结论：`isolate:false` 的收益已被读税清零抵消（原判断作废）

税 2 存在时，`isolate:false` 实测 206.19 s vs `isolate:true` 1081–1467 s，**7 倍**——那个收益的本质是"少交 read 税"的镜像，不是 worker 复用本身。读税归零后重测（2026-11-12 09:30，同机同版本）：

| 配置                                | 墙钟        | Duration | import 占比 | 结果                                  |
| ----------------------------------- | ----------- | -------- | ----------- | ------------------------------------- |
| `isolate:true`（权威 `pnpm test`）  | **132 s**   | 127.72 s | 83%         | 3004 passed / 0 failed                |
| `isolate:false`（`pnpm test:fast`） | **179.2 s** | 147.14 s | 51%         | 2977 passed / **27 failed（5 文件）** |

`isolate:false` 把 import 从 83% 压到 51%，但 **transform 涨到 32%**，且共享模块单例让 5 个 spec 互相污染：`wp65-deliberation-mutex-revision`（10 例）、`wp67-deliberation-circuit-breaker`（12 例）因 `vi.mock('bullmq')` 与 Redis 假替身跨文件残留而红；`wp12-memory-closeout` 被前序 spec 的假 DB 状态拖到 **80.5 s 超时**（隔离模式下该文件是秒级）；另有 `i12-session-alliance-config` 2 例、`good-state-diary.service.spec` 1 例。

**结论**：`isolate:false` 在本仓已不是提速手段，而是"更慢 + 不可信"。`P-DEBT-1`（清 env 泄漏）优先级由最高降为 P2——即使清干净，理论收益也只有约 19%（132 s → ~106 s），代价是跨 5 个 spec 的共享状态治理（mock 替身、Redis/DB 假状态、模块级单例），风险高于收益。`vitest.fast.config.mts` / `pnpm test:fast` 保留为快速冒烟用途，**不作为交付证据，也不再作为提速目标**。

**取证环境副作用（重要）**：本轮执行会话的 `PATH` 被沙盒替换、未继承系统 `PATH`，导致 `git` 不在搜索路径（本机 git 在 `D:\Apps\Git\cmd`）。全量跑批因此出现 1 例 `spawnSync git ENOENT` 假失败（`wp-h-wave2-3-batch-observability.spec.ts`），补齐 PATH 后 25/25 全绿。**凡依赖外部命令（git 等）的用例，取证前先补 PATH，否则会把环境缺陷误判成回归**。

**基线口径更正**：§1.2 的"干净环境 140.29 s"已不可复现（04:19 同机同版本同配置为 1081.94 s）。差异不来自代码，来自上述环境税。**对外引用闸门耗时必须同时标注机器状态与读取延迟**，否则数字没有意义。现在本机读取延迟已归零，**132 s 成为本机的新基线**（import 仍占 83%，是 `isolate:true` 下 186 个 worker × ~1.00 s 启动的固有成本）。

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

### 2.2 量化目标与达成情况（A/B 实测回填，2026-11-12 收口）

| 指标                 | 原始目标                           | 实测达成（本机、无 watch、读取延迟已归零）                                                                                            | 判定                                                                                    |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 全量 vitest          | 140.29 s 基线 → `≤ 90 s`           | **132 s 墙钟 / 127.72 s Duration（import 83%）**                                                                                      | 部分达标：`isolate:false` 已证伪（更慢且 27 例污染），见 §1.5.3；余量在 worker 启动结构 |
| eslint 冷跑          | 394.9 s → `≤ 120 s`                | `lint:fast`（oxlint 全仓 1295 文件）**1.0 s**；权威 `pnpm lint`（ESLint type-aware）**49.3 s / 0 error / 0 warning**（原热态 69.3 s） | 达成（分层 + 读税归零）                                                                 |
| 重复 tsc             | 38.2 s → 增量                      | `tsc -b`（热）**1.8 s**，冷 87.4 s                                                                                                    | 达成                                                                                    |
| 验收环节本地耗时     | 全量双跑 → `≤ 2–3 min` 定向        | `test:related` / `test:changed` + `lint:fast` + `typecheck`，见 §5.4                                                                  | 达成（流程层）                                                                          |
| 正确性零回退         | 全量 0 failed、engine-core 空 diff | **3004 passed / 0 failed / 4 skipped**；engine-core diff 为空；`boundary.spec.ts` 未改                                                | 达成                                                                                    |
| 读取延迟（根因指标） | 200 文件 `< 100 ms`                | **63–81 ms（0 慢文件）**，单文件 0.4 ms                                                                                               | 达成                                                                                    |
| 全量闸门总时长       | 冷 9.7 min / 热 4.3 min            | **132 s（约 2.2 min）**                                                                                                               | 达成                                                                                    |

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

这三类都是"读 env 默认值"的 spec，被其他文件改过的 env 污染。**因此 `isolate:false` 不能直接做权威闸门**，除非先把 spec 之间的 env 泄漏清理干净（登记为 backlog：`测试间 process.env 泄漏清理 → 之后可把 isolate:false 提升为权威闸门`）。

> **2026-11-12 复核：上表"7 倍收益"已作废。** 该收益是读税（§1.5）的镜像而非 worker 复用本身；读税归零后重测，`isolate:false` 为 **179.2 s / 147.14 s Duration**，**慢于** `isolate:true` 的 **132 s / 127.72 s**，且污染面扩大到 **5 文件 27 例**（含 `wp65` 10 例、`wp67` 12 例、`wp12` 被拖到 80.5 s 超时）。结论：`isolate:false` 在本仓不再具备提速价值，`P-DEBT-1` 降为 P2；`pnpm test:fast` 仅保留为冒烟。详见 §1.5.3。

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

| 步  | 内容                                          | 状态                                                                                                                                                                                     |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | 基线校准：三腿实测 + 缓存异常定位             | 已完成（§1.2 / §1.4）                                                                                                                                                                    |
| 1   | **L4 lint 分层（oxlint 快检 + ESLint 权威）** | **已完成**：`lint:fast` 1.0 s / `lint:deep` 26.8 s / 权威 ESLint 不动（49.3 s，缓存命中态）                                                                                              |
| 2   | **L3 类型闸门 `tsc -b` 缓存**                 | **已完成**：38.2 s → **1.8 s（热）**，冷 87.4 s                                                                                                                                          |
| 3   | 版本升级（vitest 5.1 / vite 8.3.8）           | **已试并回滚**：5.1.0 慢 7.7 倍、vite 8.3.8 慢 9 倍；已锁 `vite 8.3.5`                                                                                                                   |
| 4   | L2 vitest 运行时                              | **已完成并证伪主项**：`deps.optimizer.ssr` 已回退；`isolate:false` 税态下 7 倍收益经复核为读税镜像，归零后 **179.2 s 慢于 132 s** 且 27 例污染 → 降为 P2，`test:fast` 仅作冒烟（§1.5.3） |
| 5   | L2 遗留项                                     | `fsModuleCache` / `NODE_COMPILE_CACHE` / `projects` 分层未落；在 `isolate:false` 证伪后优先级下调（理论收益仅 ~19%）                                                                     |
| 6   | L1 流程（验收不重复全量）                     | **已落**：`wp-task-template.md` §5 三层命令表 + §5.4 验收不重跑全量 + §5.0 机器纯净度纪律                                                                                                |
| 7   | L5 测试结构减重                               | 另开 backlog                                                                                                                                                                             |

**最终结论（2026-11-12 收口）**：真正把"一次活动 30 分钟"劈开的是**机器侧读税归零**（§1.5.2，全量 1102.6 s → 132 s，8.3 倍），代码侧三层（lint 分层 1.0 s、`tsc -b` 热 1.8 s、L1 验收流程）在此基础上把每次收尾压到 **约 2.2 分钟**。`isolate:false` 不是答案（§1.5.3）。下一步余量只剩 worker 启动结构（import 仍占 82–83%），按 backlog 另开单。

> 下列文字为 2026-11-12 当时的过程结论，保留作对照，**已被上段取代**：~~lint 从"每次 100s 起步"降到 2s；类型闸门 38s → 2.5s；`isolate:false` 值 7 倍；全量仍在 1100 s；下一步 ① 机器侧免疫 → ② 清 env 泄漏提 `isolate:false` → ③ L1 不重跑全量~~。其中 ① 已由 inode 判别改写（不是免疫而是换 inode）、② 已证伪、③ 已落地。

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

# 读取延迟体检（闸门数字可信度前置；也用于 pnpm install 后复验读税是否回归）
pnpm doctor:fs                       # → 合格：均值 <1ms/文件、慢文件 <5%（当前 0.5–0.8ms、0 个慢文件）

# L2-a projects 落地核对：确认文件归属无遗漏 + 两次 shuffle 暴露顺序依赖
$env:DEBUG = "vitest:projects"
pnpm exec vitest run
pnpm exec vitest --shuffle --run --project unit
pnpm exec vitest --shuffle --run --project unit

# 基线（改动前，含读税，仅作对照；当前基线见 §2.2 与 §1.5.2）——三条腿分别计时，日志写 %TEMP% 再读回
pnpm test 2>&1 | Tee-Object -FilePath "$env:TEMP\vitest-baseline.log"
#   → 改动前实测 140.29 s / 186 文件 / 3008 例 / import 74%（含税态曾恶化为 1102.6 s）
pnpm exec tsc -p tsconfig.build.json --noEmit      # → 改动前实测 38.2 s；现用 pnpm typecheck（`tsc -b`）热 1.8 s
pnpm lint                                           # → 改动前冷 394.9 s / 热 69.3 s；现 49.3 s（缓存命中态，0 error / 0 warning）
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

### 7.3 DoD（2026-11-12 收口核对）

- [x] 全量套件 0 failed：**3004 passed / 0 failed / 4 skipped（186 文件，1 skipped 文件）**，用例总数与基线 3008 一致。
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 未出现在改动清单。
- [x] A/B 数字回填：全量 vitest 1102.6 s → 132 s（import 96% → 83%）；`tsc -b` 热 1.8 s；`lint:fast` 1.0 s；读取延迟 16.5 s → 63–81 ms。
- [x] CI 既有全量门禁未改动；未新增必须本地全量复跑的环节（验收走 §5.4 定向闸门）。
- [x] 权威绿跑取证口径记录：执行会话需先补 `PATH`（git 在 `D:\Apps\Git\cmd`），否则 `wp-h-wave2-3-batch-observability.spec.ts` 会报 `spawnSync git ENOENT` 假失败。

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
| **P-DEBT-1** | **spec 文件之间 `process.env` / mock 单例泄漏**（`isolate:false` 读数：税清零后 5 文件 27 例红，`wp12` 被拖到 80.5 s 超时） | 等级下调：**该配置已证伪为提速手段**（179.2 s 慢于 132 s），只影响 `test:fast` 冒烟可信度 | 🟡 **部分落地（2026-11-13，TD-9）**：残留**清理**已交付 —— 4 个非 e2e spec 补统一重置钩子（共享 `test/helpers/isolation.ts`：`resetTestDoubles` = 还原 spy + `mockReset` 复位一次性实现；4 文件现场复核**零** `process.env` 读写），断言期望与用例数逐字未变；**`isolate:false` 的提速方向仍不重启**（已证伪），`vitest.fast.config.mts` / `pnpm test:fast` 仅保留冒烟 → [交付记录](../worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md) |
| **P-DEBT-2** | `.eslintcache` 存在却大面积失效（22:58 生成，00:24 全量仍 394.9s） | ESLint 冷跑成本无法稳定压到热跑的 69.3s | ✅ **已落地（2026-11-13，TD-9）**：对照实验定位失效变量 = **解析后配置对象的内容**（改规则 → 189.9 s 整体失效；只改配置注释 → 5.6 s 不失效）+ ESLint / Node 版本 + 文件 mtime/size；**tsconfig 内容不在键里**（改 tsconfig → 8.2 s 仍命中 → 旧缓存会给出过期 type-aware 结论）。统一口径 `eslint-<os>-<hash(eslint 配置 + tsconfig 指纹)>`、**不带 restore-keys**；CI lint job 新增 ESLint 缓存步骤（冷 183.6 s → 热 5.8 s，31.8×）；**并修掉 TD-8 遗留的 4 个失效缓存键**（单 @@ → @@{{ }}）。本机纪律：改 tsconfig 或升 eslint / 插件版本后必须删 `.eslintcache`（未自动化） → [交付记录](../worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md) |
| **P-DEBT-3** | oxlint 4 条既有 warning（2×`no-unsafe-optional-chaining`、2×`oxc/erasing-op`）；类型感知模式另 53 条风格项 | 只是噪声，不阻塞 | ✅ **已清零（2026-11-13，TD-9）**：fast **4 → 0**、deep **57 → 0**（0 error / 0 warning）。定性：22 条 `no-misused-spread` 规则层豁免（DTO / row 字段拷贝；权威 ESLint 闸门用 `recommendedTypeChecked` 本就不含该规则）、17 条 `unbound-method` 在 `.oxlintrc.json` 的 test / bin 段豁免（取路由元数据 / 挂 spy 的标准写法）、10 条 `no-base-to-string` 走新共享纯函数 `safeString` / `toUtf8Text`、8 条真问题最小修正（可选链补 `?.`、恒等零项化简、去多余 `await`、模板串窄化）→ [交付记录](../worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md) |
| **P-DEBT-4** | 构建工具链版本升级无验收纪律（vite 8.3.8 / vitest 5.1 各自带来 9 倍 / 7.7 倍回归） | 任何"顺手升 patch"都可能把闸门时间打回 20 分钟 | 规则：vite/vitest 版本变动必须附全量绿跑 + 墙钟数字，且已钉死 `vite 8.3.5` |
| **P-DEBT-5** | CI 缓存与分片未做（`actions/cache` + shard 矩阵、CI 侧 pnpm 统一） | CI 每次全量冷跑 | 🟡 **部分落地（2026-11-13，TD-8）**：**CI 缓存 + CI 侧 pnpm 统一**两项已交付 —— `.github/workflows/ci.yml` 三个 job 改 corepack + `pnpm install --frozen-lockfile` + 脚本名逐字对应 package.json，新增 pnpm store 缓存（key 含 `pnpm-lock.yaml` 哈希）与 vitest 转换缓存（`node_modules/.vite/vitest`），未缓存 `node_modules` 本体；**分片（shard 矩阵）已交付（2026-11-14，TD-11）** —— `ci.yml` 原 `test` job 拆成 `unit`（matrix **2 片**，`pnpm run test -- --shard=N/2`，仅 unit、**e2e 不进矩阵**）+ `e2e` + 独立 `coverage` job，`build` 的 `needs` 改 `[unit, e2e]`；前置核查通过（单测不连真实 MySQL：`test/` 下 `DataSource` / `TypeOrmModule.forRoot` **0 命中**；无固定端口占用）；本机实跑两片 **97 + 97 = 194 文件、1608 + 1644 = 3252 例**，与基线逐字一致，两片 exit 0；收益仅在 CI 多 runner 并行成立（**CI job run 净增 2**）→ [TD-11 任务单](../worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-task-2026-11-14.md) · [交付记录](../worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md) · [TD-8 交付记录](../worklog/completed/phase2.5/td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md) |
| **P-DEBT-6** | 测试结构减重（L5）：集成 spec 收敛、外部 SDK 端口层 mock、barrel 瘦身 | import 74% 的结构性根因 | ✅ **已处置（2026-11-13，TD-10 已交付）**：L5 三条方向全部落地 —— T-1 四个非 e2e 集成 spec 逐一定性（**本就不是全量装配、无可收窄**；改替身去重 + SDK 包边界 mock + 真 Redis spec 改动态导入）、T-2 **82 个** spec 在 SDK 包边界 `vi.mock`（真实 ioredis / bullmq / qdrant / langchain 不进 import 阶段；替身集中 `test/helpers/sdk-stubs.ts`，数据面 throw 防假绿；3 个真需真包的 spec 保留真 SDK 登记例外）、T-3 **12 个** spec 的 engine-core barrel 整树导入改深路径。结构口径（183 非 e2e spec）：触达重型 SDK 的 spec **98 → 58**、包引用 **766 → 673**、本地模块 **8013 → 7986**；engine-core / 生产 src 零 diff、断言期望与用例数逐字未变（3248 passed + 4 skipped / 3252 例 / 194 文件）。分片矩阵（P-DEBT-5）、双锁 / coverage 采集 / audit 容错已立项 TD-11；typeorm 根因 T-B 类型导入收窄立项 TD-11，L-1b 仓储端口抽象另案 → [任务单](../worklog/completed/phase2.5/td10-test-structure-debt-reduction-task-2026-11-13.md) · [交付记录](../worklog/completed/phase2.5/td10-test-structure-debt-reduction-implementation-2026-11-13.md) |
| **P-DEBT-7** | 本机长驻开发进程污染闸门测量（`nest start --watch` 跑 2 天 7709s CPU / 1527 MB） | 同一份代码实测 1102.6 s（停机后）vs 1512 s（带 watch） | 已写入 `wp-task-template` §5.0 纪律：跑闸门前确认无 watch / dev server |
| **P-DEBT-8** | ~~E: 盘每次文件内容读取 ~90 ms~~ | — | **已解除（2026-11-12）**：根因为 minifilter 按 inode 收税；以 `pnpm install --force --config.package-import-method=copy` 让 `node_modules` 脱离 store 的旧 inode 后归零（200 文件 63–81 ms）。复验方法见 §1.5.2 与 §7.2 |
| **P-DEBT-9** | 依赖外部命令的 spec 无环境前置（`wp-h-wave2-3-batch-observability.spec.ts` 直接 `execFileSync('git')`） | 取证会话 PATH 不继承系统 PATH 时（本机 git 在 `D:\Apps\Git\cmd`）报 `spawnSync git ENOENT`，会被误判成回归 | ✅ **已落地（2026-11-13，TD-9）**：新增共享探测 `test/helpers/git-probe.ts`（`GIT_BIN` 注入优先 → 回退 PATH 的 `git` → 跑 `--version`）；三处 `execFileSync` 统一走解析后的路径；不可用时该用例 `it.skipIf` 跳过（跳过条件取"注入路径与 PATH 同时可用"，因 src 侧 `gitDescribeDirty()` 硬编码走 PATH）；短期纪律"跑全量前补齐 PATH"仍然有效 → [交付记录](../worklog/completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md) |
| **P-DEBT-10** | `node_modules` 若回落到 pnpm 默认 hardlink 装法，读税会复发 | 一次 `pnpm install` 就能把 132 s 打回 1100 s | 已落地自动化：`pnpm doctor:fs`（`scripts/fs-latency-check.mjs`）判定"均值 <1 ms/文件 且 慢文件 <5%"，不合格 exit 1 并给重装命令；仍不写进仓库 `.npmrc`（避免把磁盘与安装耗时代价带给他人/CI） |
| **P-DEBT-11** | typeorm 结构债（L-1）：src **48** 文件 `Repository` 值导入；spec 侧 **45 / 43** 文件经 TestingModule 装配真实 `forFeature` 触达 typeorm / `@nestjs/typeorm` | service / controller import 加载图带入 typeorm 运行时边；spec 替身不足 | 🟡 **L-1a 已交付（2026-11-14，TD-11）**：附录 A **48 文件全部**逐文件复核通过（`Repository` 仅作泛型类型标注，**0** 值位置使用、**0** 个需保留原样），全部改为 `import type { Repository } from 'typeorm'`；`InjectRepository` 值导入、entity 装饰器、module 装配未动。**实测收益边界**：改前 / 改后 import 图**逐字相同**（本地模块 7986 → 7986、包引用 673 → 673、触达重型 SDK 的 spec 58 → 58、**逐 spec 差异 0**）—— 48 文件的 typeorm 顶层值导入边虽消除，但同域 **entity 装饰器**仍把 typeorm 拉进 spec 闭包。**L-1b 仓储端口抽象试点已交付（2026-11-14，TD-13 · analytics 域首个业务域）**：`src/analytics/` 落地端口（`AnalyticsEventRepository` interface + `ANALYTICS_EVENT_REPOSITORY` Symbol token，方法面只收 record / countByType / findCreatedAtBetween 三条）+ TypeORM 实现收进 `data/` + module provider 接线，两个 service 改依赖端口，新增 `test/analytics/` 端口替身 spec（11 例）；**typeorm 值符号外泄复核：端口 / 两个 service / 新 spec 0 命中**（仅实现文件落点）；业务语义零漂移（KPI 数值 / 分母为 0 保护 / trend 分桶 / tracker 静默 catch + warn 逐字一致）；闸门：根 tsc / build tsc 0 error、lint 0 error 1 warning（e2e 既有）、lint:fast/deep 0/0、boundary 12 绿、全量 **3259 passed + 4 skipped（3263 例 / 195 文件）**（基线 3252 例 / 194 文件 → 净增 +11 例 / +1 文件 = 本单新增）、engine-core 零 diff、运行时 DI 验证（node dist/app /health 200）；**实测边界**：service 的 typeorm **直接**导入边归零，但枚举 `AnalyticsEventType` 仍在 entity 文件（本单明确「entity 文件一字不改」），故**传递**闭包仍有 typeorm 一条边 —— 加载图收益要等 entity 装饰器运行时依赖消除（另案 H）才可能显现，**本单不承诺加载图收益**；entity 装饰器运行时依赖消除 + spec 层 typeorm 替身仍另案 H；另发现附录 A 之外 **23 个混合形态**文件（`import { Between, Repository }`）改 inline `type` **零运行时收益**，本单有意不动；**另案登记（TD-13 交付记录 §七）**：G 其余 117 个 service 分批推广（counselor 33 文件 / 63 处优先）· H entity 装饰器运行时依赖消除（本单实测定位为加载图根因）· I 端口内存实现是否补 · J 混合形态 typeorm import 统一形态（可读性向、零运行时收益）→ [TD-11 任务单](../worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-task-2026-11-14.md) · [TD-11 交付记录](../worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md) · [TD-13 任务单](../worklog/completed/phase2.5/td13-repository-port-analytics-pilot-task-2026-11-14.md) · [TD-13 交付记录](../worklog/completed/phase2.5/td13-repository-port-analytics-pilot-implementation-2026-11-14.md) |
| **P-DEBT-12** | CI 工具链三项遗留决策项：npm 锁双轨（D-a）/ coverage 采集（D-b）/ audit registry 容错 | 版本控制存两份锁文件真相源；coverage 无采集口径（TD-8 已移除无效上传步骤）；registry 网络故障被误判成漏洞阻断 | ✅ **已处置（2026-11-14，TD-11 已交付）**：① **D-a 锁文件单轨** —— 根目录 `package-lock.json`（659 714 B）**已删**，版本控制只留 `pnpm-lock.yaml`；被删锁打断的 4 处 `npm ci` 活路径（README 快速开始 / `bin/dev-up.ps1` / `bin/check-dev-env.sh` / `docs/runbooks/local-setup.md`）经主控拍板一并改口 `pnpm install --frozen-lockfile`；`deploy-tested.cjs` 上传清单 + README scp 清单同步 `pnpm-lock.yaml`；`docker-deploy.md` 的 npm 时代口径**只标注不改写**（部署文档历史债另案）。② **D-b coverage 采集接通** —— `vitest.config.mts` 补 `provider: 'v8'` / `reporter: ['text','lcov']` / `reportsDirectory: './coverage'`；CI 新增独立 `coverage` job（**单进程全量**：分片报告不完整，不可作阈值依据），本地 `pnpm test` 不插桩；**不设 thresholds**（另案）。③ **audit registry 容错** —— `pnpm audit --audit-level=high --prod --ignore-registry-errors`（registry 网络 / 服务故障放行，**真实 high 及以上 advisory 仍阻断**）。**coverage 阈值门禁已落地（2026-11-14，TD-12 已交付）** —— `vitest.config.mts` 的 `coverage.thresholds` 立全局聚合四指标下限（stmts 44 / branch 43 / funcs 40 / lines 44，`perFile: false`），低于阈值即采集命令 exit 非 0、CI coverage job 转红；复跑实测 stmts **46.92%**（12 393 / 26 408）/ branch **45.67%**（6 725 / 14 724）/ funcs **42.48%**（2 149 / 5 058）/ lines **46.69%**（11 323 / 24 251），四指标全部达标（缓冲 +2.48 ~ +2.92 pp）、相对首轮基线偏差 ≤0.01 pp；**反向验证**小样本采集四指标全部 `does not meet global threshold` → exit 1（证明门禁真会转红）；**阈值唯一真相源 = `vitest.config.mts`**（别处不另抄数字）；观察期**不阻断 build**（`build` 的 `needs` 未改）；仅 1 个配置文件变更，`src` / `test` 零改动；分层 / 逐文件阈值、阻断链、entities exclude 口径、低覆盖补测、复核机制另案 A–F → [TD-11 任务单](../worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-task-2026-11-14.md) · [TD-11 交付记录](../worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md) · [TD-12 任务单](../worklog/completed/phase2.5/td12-coverage-threshold-gate-task-2026-11-14.md) · [TD-12 交付记录](../worklog/completed/phase2.5/td12-coverage-threshold-gate-implementation-2026-11-14.md) |

---

_更新记录：2026-11-12 —— L4 落地（oxlint 分层）、L3 落地（`tsc -b` 缓存）、L2 部分落地（`deps.optimizer.ssr` + `test:fast`）；版本升级两项实测回滚；§1.5 升级为机制级结论（minifilter 按 inode 收税 → `package-import-method=copy` 归零，全量 1102.6 s → 132 s，3004 passed / 0 failed）；§2.2 改为达成情况表；§9 新增 P-DEBT-9 / P-DEBT-10。_
_更新记录：2026-11-13 —— TD-9 落地：P-DEBT-1 残留清理（4 spec 统一重置钩子，隔离语义不变）、P-DEBT-2 缓存失效变量定位 + 本机/CI key 口径统一（含修掉 TD-8 遗留的 4 个失效缓存键）、P-DEBT-3 oxlint 告警清零（fast 4 → 0、deep 57 → 0）、P-DEBT-9 git 依赖 spec 环境前置。_
_更新记录：2026-11-14 —— TD-11 立项：P-DEBT-5 分片矩阵纳入本单（T-E）；新增 P-DEBT-11 typeorm 结构债（L-1a type-only 收窄 T-B 立项，L-1b 端口抽象另案）；D-a 锁文件单轨 / D-b coverage 采集接通 / audit registry 容错同单处置，coverage 阈值门禁另案。_
_更新记录：2026-11-14 —— TD-11 落地：D-a 锁文件单轨（删 `package-lock.json`，4 处 `npm ci` 活路径改口 pnpm）、D-b coverage 采集接通（v8 + text/lcov，CI 单进程全量采集、本地不插桩、**阈值门禁另案**）、audit registry 容错（`--ignore-registry-errors`，真实 high+ 仍阻断）、P-DEBT-5 分片矩阵（matrix 2 片 `--shard`，仅 unit；实跑 97 + 97 = 194 文件 / 3252 例与基线一致）、L-1a typeorm 类型导入收窄（48 文件全通过，**测试侧加载图收益为 0**）；新增 P-DEBT-12 行登记上述三项决策项的处置结论。CI 侧结果待主控 push 后在 Actions 复核。_
_更新记录：2026-11-14 —— TD-12 立项：coverage 阈值门禁（全局聚合四指标，`perFile: false`，观察期不阻断 build）；分层 / 逐文件阈值、阻断链、entities exclude 口径列为另案。_
_更新记录：2026-11-14 —— TD-12 落地：P-DEBT-12 的 **D-b 阈值门禁**已闭合 —— `vitest.config.mts` 立全局聚合四指标阈值（stmts 44 / branch 43 / funcs 40 / lines 44，`perFile: false`），低于阈值即采集命令 exit 非 0、CI coverage job 转红；复跑 46.92% / 45.67% / 42.48% / 46.69% 全部达标（缓冲 +2.48 ~ +2.92 pp），反向验证 exit 1 证明门禁生效；仅 1 个配置文件变更，src / test 零改动，观察期不阻断 build；分层 / 逐文件阈值、阻断链、entities exclude 口径等另案 A–F。_
_更新记录：2026-11-14 —— TD-13 立项：P-DEBT-11 的 **L-1b 仓储端口抽象**首个业务域试点（analytics 域），service 依赖仓储 interface + DI token、TypeORM 实现收进 `data/`、spec 端口替身；仅 analytics 域，其余 117 个 service 分批推广、entity 装饰器运行时解耦、内存实现、混合形态 import 统一列为另案 G–J。_
_更新记录：2026-11-14 —— TD-13 落地：P-DEBT-11 的 **L-1b 仓储端口抽象**首个业务域试点（analytics 域）已交付 —— 端口（interface + Symbol token，3 方法）+ TypeORM 实现收进 `data/` + module provider 接线 + 端口替身 spec（11 例）；**typeorm 值符号外泄 0 命中**（端口 / 两个 service / 新 spec，仅实现文件落点），业务语义零漂移（KPI / 分母为 0 保护 / trend 分桶 / tracker 静默 catch + warn 逐字一致）；闸门：根 tsc / build tsc 0 error、lint 0 error 1 warning（e2e 既有，范围外未修）、lint:fast/deep 0/0、boundary 12 绿、全量 **3259 passed + 4 skipped（3263 例 / 195 文件）**（基线 3252 例 / 194 文件 → 净增 +11 例 / +1 文件 = 本单新增）、engine-core **零 diff**、运行时 DI 验证通过（node dist/app /health 200）；实测确认 entity 装饰器是加载图根因（另案 H），其余域推广登记为另案 G。_
```
