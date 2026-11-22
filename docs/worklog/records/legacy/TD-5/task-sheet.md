# TD-5 · 根 tsconfig 类型债分批清零（spec / e2e / bin 类型修复 · 零运行时变化）

> 状态：✅ 已交付（2026-11-13）→ 交付记录：`docs/worklog/completed/phase2.5/td5-type-debt-clearing-implementation-2026-11-13.md`（根 tsc 401 条 / 87 文件 → **0 条 / 0 文件**，exit 0；零运行时变化）
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`，上游 `origin/integrate`
> 唯一事实源：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §TD-5 行 + 本单 §1 基线实测与附录清单
> 任务性质：既有技术债清理（纯类型层），**零行为变化**；改动仅落在 `test/**/*.spec.ts`、`src/**/*.spec.ts`、`bin/*.ts` 与 docs 回写。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\AGENTS.md` —— 仓库入口与 engine-core 红线
2. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线、16 条硬约束、交付格式
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\wp-task-template.md` —— 任务单结构与交付回写清单
4. 阶段入口：`docs/worklog/pending/phase2.5-README.md` §2 与 `phase2.5-wp-list-2026-11-08.md` §TD-5 行
5. 本任务单（你在读的这份）

---

## 1. 背景与基线实测（主控 2026-11-13 HEAD `2e27bf1` 现场复核）

### 1.1 基线数字

复算命令（根 tsconfig 全量，含 src / test / bin / typings）：

```
pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"
```

实测：**exit 2，401 条错误 / 87 文件**。这是 Phase2.5 各单一路沿用的既有类型债基线；既往各功能单均做到「本单相关文件 0 新增」，未就地清理。本单即 TD-5 闭环单：分批把该基线清到 **0 error / 0 文件**。

### 1.2 分布画像（实测，别当新问题）

| 顶层目录 | 条数 | 说明                                                                                      |
| -------- | ---- | ----------------------------------------------------------------------------------------- |
| `test/`  | 386  | 单测 / e2e spec，类型标注与夹具断言对齐问题                                               |
| `src/`   | 9    | **全部在 `*.spec.ts`**（good_state_diary 8、practice 1）；生产代码（src 非 spec）零类型债 |
| `bin/`   | 6    | 运维脚本：reference 类型指令 4、unreachable 1、类型转换 1                                 |

build 口径 `pnpm exec tsc -p tsconfig.build.json --noEmit` 保持 **0 error**（该配置排除 spec / test / bin）；类型债只在根 tsconfig 全量检查暴露。

### 1.3 错误码分布（401 条）

| 条数 | 错误码                                                                           | 性质与修法方向                                                                           |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 155  | TS4111                                                                           | index signature 点访问 → `obj['key']` 方括号访问（`noPropertyAccessFromIndexSignature`） |
| 44   | TS2554                                                                           | 调用 / mock 参数个数与生产签名不符 → spec 调用对齐生产签名                               |
| 41   | TS2345                                                                           | 实参类型不可赋给形参 → 夹具 / 断言对象对齐生产类型                                       |
| 23   | TS6133                                                                           | 未使用局部变量 / 参数 / import → 删除或 `_` 前缀豁免                                     |
| 20   | TS2349                                                                           | 调用参数个数 / 类型不符（同上对齐生产签名）                                              |
| 17   | TS2322                                                                           | 类型不可赋值 → 标注 / 断言对齐                                                           |
| 17   | TS2339                                                                           | 属性不存在 → spec 对齐生产现字段名，不新增生产字段                                       |
| 13   | TS2503                                                                           | `vi` 命名空间类型位置找不到 → 显式 `import type` from `vitest`                           |
| 12   | TS2352                                                                           | as 转换重叠不足 → `as unknown as T` 中转或补全夹具形状                                   |
| 10   | TS18048                                                                          | 可能 null / undefined → spec 内补收窄守卫                                                |
| 10   | TS2307                                                                           | 模块解析失败 → 修正相对路径 / 扩展名，核实模块存在                                       |
| 5    | TS7006                                                                           | 隐式 any → 补显式类型标注                                                                |
| 4    | TS2688                                                                           | `reference types` 相对路径无效 → 改 `reference path`                                     |
| 4    | TS2493                                                                           | 元组 / 数组解构长度不符 → 对齐元组形状                                                   |
| 3    | TS2724                                                                           | 泛型参数约束不符 → 对齐夹具类型参数                                                      |
| 3    | TS2741                                                                           | 属性缺失（对象字面量）→ 补全或收窄断言类型                                               |
| 3    | TS2739                                                                           | 缺少必需属性 → 补全夹具字段                                                              |
| 3    | TS2344                                                                           | 泛型约束不满足 → 对齐类型参数                                                            |
| 3    | TS2459                                                                           | 索引签名上取属性 → 同 TS4111 方向                                                        |
| 2    | TS2540                                                                           | 构造参数 / 类型引用问题                                                                  |
| 1×9  | TS2769 / TS6196 / TS18046 / TS2488 / TS2353 / TS2305 / TS18047 / TS2420 / TS7027 | 杂项，逐处最小修复（TS7027 = 不可达代码）                                                |

### 1.4 区域条数（test/ 386 条分布）

engine-adapters 127 · admin-debug 81 · shared 59 · e2e 31 · auto-practice 28 · good-state-diary.e2e 28 · counselor 19 · voice 5 · engine-core(spec) 4 · base 2 · quality 1 · user 1。

### 1.5 开放项裁定（主控已定，实现方不再二选一）

1. **修法分层**：根因在生产类型设计、无法在 spec / bin 层最小修复的条目，**不改生产代码**，逐条登记 backlog 保留，交付记录列原因；本单目标是「可在测试层收敛的全部清零，保留项显式挂账」，不是为清零去动生产契约。
2. **配置不放宽**：不靠改 `tsconfig.json` 的 strict / types / exclude、不靠删断言消错；TS2503 逐文件显式 type import 解决。
3. **不改用例语义**：本单不新增 / 删除测试用例，不改断言期望值与 mock 返回值；类型修复前后用例通过结果必须一致。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- `test/**/*.spec.ts`、`src/**/*.spec.ts`、`bin/*.ts` 的类型标注、as 断言、访问写法、未使用标识符、import 路径 / 类型导入修正；
- docs 回写：交付记录、任务单归档、WP 登记表与阶段入口索引、保留条目 backlog 登记。

**明确不在范围内（禁止顺手做）：**

- `src/` 下**非 spec 的生产文件零改动**；`src/engine-core/**` 源码 diff 必须为空（`test/engine-core/*.spec.ts` 可改类型标注，但 `boundary.spec.ts` 一行不许动）。
- 不改生产签名、生产类型、模块导出；不改 mock 数据语义、断言条件、用例逻辑；不新增第三方依赖。
- 不动 `.env.example`、migration、实体表结构、prompt 模板、判据数组与阈值常量。
- 不改任何 tsconfig / vitest 配置文件；不放宽 strict、不调 exclude、不删测试断言消错。
- 不重构相邻代码、不做无关格式重排；import 顺序由 ESLint 既有规则管，不顺手扩写。
- 提交分组隔离：工作区若有并行进程未提交产物，只暂存本单文件，不混入并行产物。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

---

## 3. 分批方案（A → B → C，每批结束跑根 tsc 记录剩余条数 / 文件数）

### 3.1 批次 A · 基础设施根因（29 条 / 8 文件）

**A1 · `bin/` 6 条（5 文件）**

| 文件                         | 条数 | 修法                                                                         |
| ---------------------------- | ---- | ---------------------------------------------------------------------------- |
| `bin/batch-report.ts`        | 2    | TS2688 :11；TS7027 :100 不可达代码（删死代码或修控制流，不改运行时语义）     |
| `bin/entity.ts`              | 1    | TS2688 :1                                                                    |
| `bin/ormconfig.ts`           | 1    | TS2688 :1                                                                    |
| `bin/seed-visitors-jsonl.ts` | 1    | TS2352 :123（`as unknown as VisitorFullPersonaScript` 中转，或补全对象形状） |
| `bin/synchronize.ts`         | 1    | TS2688 :1                                                                    |

TS2688 修法统一：`/// <reference types="../typings/global" />` → `/// <reference path="../typings/global.d.ts" />`（`types=` 只认 typeRoots 包名，相对路径必须用 `path=`）。

**A2 · TS2503 `vi` 命名空间（13 条 / 4 文件）**

- `src/good_state_diary/providers/good-state-diary.service.spec.ts`（8）
- `src/practice/providers/growth-tool-complete.service.spec.ts`（1）
- `test/e2e/privacy-guard.e2e-spec.ts`（2）
- `test/engine-adapters/wp8-wiring.spec.ts`（3）

修法：文件已 `import { vi } from 'vitest'` 的，类型注解位置的 `vi.Mock` / `vi.ReturnType` 等命名空间引用改为显式 `import type { Mock, ... } from 'vitest'` 后引用具名类型；运行时 `vi.fn()` / `vi.mock()` / `vi.spyOn()` 保留不动。未 import 的文件先补值导入。

**A3 · TS2307 模块解析（10 条 / 1 文件）**

- `test/e2e/knowledge-search.e2e-spec.ts` :26–35。目标源码文件多数存在；对照同目录其他可正常解析的 e2e spec 的相对路径 / 扩展名写法修正。已知：`../src/shared/infra/observability.js` 目标实际为 `src/shared/infra/index.ts`（聚合导出，`src/shared/infra/` 下无 `observability.ts`）；逐行核实每个 import 的模块存在性，路径 / 扩展名以 NodeNext 解析为准。

### 3.2 批次 B · TS4111 索引签名访问（155 条）

规则：仅对报错行，把 index signature 对象的点访问 `obj.identifier` 改为方括号 `obj['identifier']`；具名属性点访问不动；不改值、不改对象形状。

区域顺序：admin-debug（81 条内的 TS4111）→ shared / sentry-redaction → engine-adapters → auto-practice → counselor → e2e / 其余。

### 3.3 批次 C · 业务类型对齐（217 条）

按错误簇处理，区域顺序：engine-adapters → admin-debug → shared → auto-practice → counselor → e2e / good-state-diary.e2e → voice / base / quality / user / engine-core spec → bin 复查。

| 错误簇                                                                                                                | 修法纪律                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| TS2554 ×44 / TS2349 ×20                                                                                               | mock 工厂与调用参数个数对齐**生产签名**；以生产为准，**禁止反向改生产签名迁就 mock**；缺省参数核对是否生产侧已有默认值 |
| TS2345 ×41 / TS2322 ×17 / TS2741 ×3 / TS2739 ×3 / TS2353 ×1 / TS2420 ×1                                               | 夹具对象 / 断言对象对齐生产当前类型：补全缺失字段、收窄字面量类型；不新增生产字段                                      |
| TS2339 ×17                                                                                                            | spec 引用的字段在生产已改名 / 删除 → spec 对齐现字段名；确属生产缺失的登记 backlog，不新增生产字段                     |
| TS2352 ×12                                                                                                            | 断言转换重叠不足：`as unknown as T` 中转，或补全夹具形状使其可直接断言；元组 / 数组按生产元组形状对齐                  |
| TS18048 ×10 / TS18046 ×1 / TS18047 ×1                                                                                 | spec 内补 null / undefined 收窄守卫（可选链、判空分支）；非空断言只在类型已收窄可信时使用                              |
| TS6133 ×23                                                                                                            | 删除未使用的局部变量 / import；未使用形参按既有豁免规则改 `_name` 前缀；不删被注释代码以外的实际逻辑                   |
| TS7006 ×5 / TS2724 ×3 / TS2344 ×3 / TS2540 ×2 / TS2305 ×1 / TS2488 ×1 / TS2493 ×4 / TS2459 ×3 / TS6196 ×1 / TS2769 ×1 | 逐处补显式类型 / 对齐泛型约束 / 元组解构长度；最小改动                                                                 |

### 3.4 批次复核节点

- A 完成：根 tsc 剩余 ≈ 372 条；B 完成：剩余 ≈ 217 条（数字以实跑为准，附录基线 401/87 为起点）。
- 每批结束记录：错误条数、文件数、涉及文件清单；交付记录 §闸门表逐批对照。

---

## 4. 红线（违反即返工）

1. **零运行时变化**：diff 只能是类型层。mock 返回值、断言条件、用例通过 / 失败结果前后必须一致；交付记录附「测试用例逻辑零变化」核对说明。
2. **生产契约为准**：spec 过时（字段改名、签名演进、类型收窄）→ spec 对齐生产现状；发现生产类型确有设计缺陷 → 登记 backlog，不在本单改生产。
3. **配置不放宽**：不改 tsconfig / vitest 配置；不删断言、不注释报错行来消错。
4. **隐私**：spec 夹具不引入真实逐字稿、心理对话原文；只保留构造句。
5. **既有债与新增分开**：交付记录写明清零前 401/87 → 清零后实测；保留条目逐条列文件、行号、错误码、根因与为什么测试层不能收敛。
6. **engine-core 边界**：`git diff --stat HEAD -- src/engine-core` 为空；`test/engine-core/` 下只改 spec 类型标注，`boundary.spec.ts` 禁止动。
7. **命令规范**：一律 pnpm，禁止裸 npx；跑闸门前确认无 `nest start --watch` / `vite dev` 长驻进程；Windows 本机 git 在 `D:\Apps\Git\cmd`，依赖 git 的 spec 先补 PATH。

---

## 5. 闸门（真实命令 / exit code / 数字写进交付记录）

| #   | 命令                                                                    | 通过标准                                                                                                    |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0 error、exit 0**（目标）；分批过程中记录每批剩余条数 / 文件数                                            |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 保持 0 error（生产口径不退化）                                                                              |
| 3   | `pnpm lint`                                                             | 0 error；warning 基线如实记录，不新增                                                                       |
| 4   | `pnpm exec vitest run test/engine-core`                                 | boundary 12 例全绿                                                                                          |
| 5   | 收尾 `pnpm test` 一次（仅交付前；`pnpm test:fast` 冒烟不作证据）        | 0 failed；记录测试文件数 / 用例数 / skipped / 墙钟与机器状态（Node 版本、长驻进程、盘读取状态），数字可复现 |
| 6   | e2e spec 类型改动若涉及 `pnpm test:e2e`                                 | 无 DB / 服务环境跑不起来须写明原因，不 silently skip；环境可达时跑对应 e2e 配置                             |
| 7   | `git diff --stat HEAD -- src/engine-core`                               | 为空                                                                                                        |
| 8   | `git diff --name-only HEAD`                                             | 逐条对照本单 §2 范围：仅 spec / bin / docs，无生产 src 非 spec 文件、无并行产物                             |

既有基准（HEAD `2e27bf1`）：全量 3248 passed + 4 skipped（3252 例，194 文件）；本单不改用例数量。类型债清零后根 tsc 应为 exit 0；若有保留条目，其条数 / 文件数与 backlog 登记一一对应。

---

## 6. 交付物与固定路径

1. 交付记录：`docs/worklog/completed/phase2.5/td5-type-debt-clearing-implementation-2026-11-13.md`，含：
   - 改动文件清单（spec / bin / docs 分组，区分新增 / 修改 / 删除；本单预计无新增文件）；
   - A / B / C 三批清理条数对照（起点 401/87 → 各批后剩余 → 终态实测）；
   - 闸门表：实际命令、exit code、error / warning 数、测试文件 / 用例数、墙钟与机器状态；
   - 保留条目清单（文件、行号、错误码、根因、为何测试层不能收敛、建议后续处置）；
   - 回归说明：未改 mock 语义 / 断言期望 / 用例逻辑，全量测试结果与基准一致。
2. 任务单归档：验收通过后本单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链接交付记录。
3. 索引回写：`phase2.5-wp-list-2026-11-08.md` TD-5 行改已交付 + 交付记录链接；`phase2.5-README.md` §2 对应行同步；保留条目登记进 backlog（既有台账或本单交付记录 §遗留，按仓库现有 backlog 归属落位）。
4. commit 草稿（一个提交一个意图；spec / bin 一组，docs 一组；不跳过 `--no-verify`）：
   - `refactor(test): 清零根 tsconfig 既有类型债（spec/e2e/bin 类型对齐，零运行时变化）`
   - `docs(worklog): TD-5 类型债清零任务单 / 交付记录与索引回写`

---

## 7. DoD 核对清单

- [x] 根 tsc 0 error / 0 文件；build tsc 0 error；lint 0 error；`pnpm test` 全绿；boundary 12 绿
- [x] `git diff --name-only HEAD` 仅含 spec / bin / docs；生产 src 非 spec 零改动；engine-core diff 为空
- [x] 保留条目全部登记 backlog（文件 / 行号 / 错误码 / 根因 / 处置建议），无强改生产契约 —— **本单保留条目 0 条**（401 条全部在测试层收敛），7 个生产契约演进点作为观察项列在交付记录 §五
- [x] 未新增 / 删除测试用例；未改断言期望与 mock 语义；全量用例数与基准一致（3252 例 / 194 文件）
- [x] 交付记录、任务单归档、wp-list / README 索引一致，无断链

---

## 附录 A · 87 文件区域清单（起点基线，2026-11-13 HEAD `2e27bf1`）

> 完整逐条清单以根 tsc 实跑输出为准；下表为区域聚合与 Top 文件。

**bin（5 文件 / 6 条）**：batch-report.ts 2 · entity.ts 1 · ormconfig.ts 1 · seed-visitors-jsonl.ts 1 · synchronize.ts 1。

**src spec（2 文件 / 9 条）**：good-state-diary.service.spec.ts 8 · growth-tool-complete.service.spec.ts 1。

**test/admin-debug（8 文件 / 81 条）**：deliberation-stats.spec.ts 64 · deliberation-stats-redis.integration.spec.ts 6 · gate-decisions.spec.ts 3 · wp26-admin-role-guard.spec.ts 2 · wp38-debug-event-tags.spec.ts 2 · wp58-debug-session.spec.ts 2 · wp30-admin-real-api.spec.ts 1 · wp31-cost-board.spec.ts 1。

**test/shared（1 文件 / 59 条）**：sentry-redaction.spec.ts 59。

**test/engine-adapters（38 文件 / 127 条，Top）**：wp7-turn-render.spec.ts 32 · wp65-deliberation-queue.spec.ts 10 · wp66-deliberation-retry.spec.ts 8 · i12-session-threshold-plumbing.spec.ts 5 · model-event-classifier.spec.ts 5 · wp14-student-risk-disposal.spec.ts 5 · wp38-character-version-semver.spec.ts 4 · wp-j-p2-verbal-voice-wiring.spec.ts 4 · wp65-deliberation-mutex-revision.spec.ts 3 · wp8-wiring.spec.ts 3 · r9-deliberation-hook.spec.ts 3 · r9-deliberation-mode-config.spec.ts 3 · wp12-memory-closeout.spec.ts 3 · wp67-deliberation-circuit-breaker.spec.ts 3；其余 24 文件各 1–2 条（清单由实跑 tsc 输出展开）。

**test/auto-practice（8 文件 / 28 条）**：wp-h-wave2-3-batch-observability.spec.ts 8 · counselor-agent.spec.ts 6 · intake-v2-mode-stratified-acceptance.spec.ts 5 · practice-runner.spec.ts 3 · wp-k-config-fingerprint.spec.ts 3 · crisis-metrics-persist.spec.ts 2 · practice-runner-cost.spec.ts 1。

**test/counselor（7 文件 / 19 条）**：wp44-growth-archive.spec.ts 8 · voice-catalog.spec.ts 3 · session-degraded.spec.ts 2 · supervision-failure.spec.ts 2 · practice-engine.spec.ts 1 · session-material.spec.ts 1 · supervision-alternatives.spec.ts 1 · vpt-config.spec.ts 1。

**test/e2e（3 文件 / 31 条）**：knowledge-search.e2e-spec.ts 13 · sentry-redaction.spec.ts 16 · privacy-guard.e2e-spec.ts 2。

**test/good-state-diary.e2e-spec.ts（1 文件 / 28 条）**。

**test/engine-core（3 文件 / 4 条）**：kernel-internal-clamp-unify.spec.ts 1 · wp3-trajectory.spec.ts 2 · wp5-rendering.spec.ts 1（spec 文件，非 engine-core 源码）。

**其余**：voice 3 文件 5 条 · base 2 文件 2 条 · quality 1 文件 1 条 · user 1 文件 1 条。
