# TD-7 · TD-6 复核新发现契约漂移残留 3 条（共享 builder 收尾复用 · wp-list 表格列数 · e2e 失效 disable 清理 · core 零改动）

> 状态：✅ **已交付**（2026-11-13）→ [交付记录](td7-contract-drift-remediation-implementation-2026-11-13.md)
> 执行方：MiniMax Code（主控派单 · 按本开工任务单执行；只读复核 + 最小对齐，范围小、边界清晰）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`，上游 `origin/integrate`
> 唯一事实源：[契约漂移 backlog](../../pending/phase2.5-contract-drift-backlog-2026-11-13.md)（B-1/B-2/B-3 取证明细）+ 主控 2026-11-13 HEAD `a51c684` 现场复核（扫描备查 `data/quality/td7-scan-1.txt`，gitignore 不入库）
> 收尾结论：B-1 / B-2 / B-3 **三条全部处置完毕**，lint 由基线 2 warning 清到 **0 warning**，engine-core 零 diff，全量 3252 例与基线逐字一致 → [交付记录](td7-contract-drift-remediation-implementation-2026-11-13.md)
> 任务性质：既有技术债清理（夹具复用收尾 + 文档表格对齐 + 失效 lint 注释清理），**零运行时行为变化**；改动仅落在 3 个 `test/engine-adapters/*.spec.ts`、2 个 `test/e2e/*.e2e-spec.ts`、1 个 docs md 与 docs 索引回写。
> 上一单：[TD-6 交付记录](td6-contract-evolution-review-implementation-2026-11-13.md)（七项观察项已闭环；本单三条为其复核中发现、任务单未覆盖的残留）。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\AGENTS.md` —— 仓库入口与 engine-core 红线
2. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线、16 条硬约束、交付格式
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\wp-task-template.md` —— 任务单结构与交付回写清单
4. 阶段入口：`docs/worklog/pending/phase2.5-README.md` §3 与 `phase2.5-wp-list-2026-11-08.md` §四 TD-7 行
5. backlog：[契约漂移 backlog](../../pending/phase2.5-contract-drift-backlog-2026-11-13.md)（三条取证证据、逐列零影响论证、竖线数取证命令）
6. 共享夹具现状：`test/engine-adapters/character-profile-fixtures.ts`（`buildCharacterProfileRow(overrides)`，TD-6 #3 已建）
7. 本任务单（你在读的这份）

---

## 1. 背景（方向别错）

### 1.1 来源

TD-6 把七项生产契约演进观察项核对闭环（4 处角色 row builder + 2 处标注 row builder 已收敛到共享夹具）。复核中另发现 3 条**任务单范围外**的残留，登记进 backlog、TD-6 未顺手修：

- **B-1**：另有 3 处角色行构造（命名 `makeRow` 或内联对象）未纳入共享 builder，仍带 `as CharacterProfileEntity` 断言、缺若干后加列；行为零影响（逐列论证见 backlog B-1 详述），但断言掩盖类型检查，实体再加列时会静默漂移。
- **B-2**：wp-list §四 表头为 3 列，TD-5 / L-2 / G-4 三行写成 5 列；Markdown 按表头丢弃多出单元格，TD-5 行的完整交付态在表里不可见。同小节引言行数声明（「25 行」）早于现状过期。
- **B-3**：2 处 e2e 文件行首 `eslint-disable` 里的 `prettier/prettier` 规则已失效，`pnpm lint` 报 2 warning（HEAD 既存基线，非 TD-6 回归；`--no-cache` 可复现）。

### 1.2 主控现场复核结论（2026-11-13，HEAD `a51c684`；行号以现场 Grep 为准，可能漂移）

| #   | 残留项                               | 现状（已核实）                                                                                                                                                                                                    | 处置归类                                                                                                                                          | 边界归属                                                  |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| B-1 | 3 处局部角色行构造未纳入共享 builder | `wp10a`（it 内联对象 + `as CharacterProfileEntity`）、`wp49`（`makeRow()` + 断言）、`wp51`（`makeRow()` + 断言）；缺列清单见 §3.1                                                                                 | 复用 `buildCharacterProfileRow()`，去 `as` 断言；本用例覆盖列走 overrides                                                                         | test spec；**非 core**；生产实体不动                      |
| B-2 | wp-list §四 三行超列 + 引言行数过期  | 表头/分隔行 3 列（`独立单 / 一句话描述 / 状态`）；TD-5 / L-2 / G-4 三行 5 列；引言行 64 写「现有 25 行」，实测数据行 35                                                                                           | **方向 A（默认）**：三行折叠回 3 列（优先级/额外说明并入描述列，交付态并入状态列），表头不动；引言行数改为现场实测值                              | docs md；无代码                                           |
| B-3 | 2 处失效 `prettier/prettier` disable | `test/e2e/knowledge-search.e2e-spec.ts:1`（`/* eslint-disable prettier/prettier, import/order */`）、`test/e2e/privacy-guard.e2e-spec.ts:1`（`/* eslint-disable prettier/prettier */`）；lint 0 error / 2 warning | 先核 warning 实际规则名与文案：unused directive 则移除失效规则名；若暴露真实 prettier 违规则 prettier --write 格式化后再移除；目标 lint 0 warning | test e2e 文件头注释（+ 必要格式化）；**不改 eslint 配置** |

### 1.3 改动面预判（执行时以实际 diff 为准）

- **生产 `src/`：0 改动**；`src/engine-core/**` diff 为空。
- **test**：`wp10a` / `wp49` / `wp51` 3 个 engine-adapters spec；`knowledge-search` / `privacy-guard` 2 个 e2e 文件。
- **docs**：`phase2.5-wp-list-2026-11-08.md`（B-2）；交付记录、任务单归档、wp-list 与 README 索引回写。
- 不改断言期望语义、不改 mock 返回值、不增删测试用例数量（沿用 TD-5/TD-6 零运行时纪律）。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- B-1：3 处角色行构造迁移到共享 `buildCharacterProfileRow()`，消除行构造处的 `as CharacterProfileEntity`；
- B-2：§四 TD-5 / L-2 / G-4 三行折叠为 3 列；引言行数声明更新为现场实测数据行数；
- B-3：两处 e2e 文件头失效 `prettier/prettier` disable 清理（含移除后必要的 prettier 格式化）；
- docs 回写：交付记录、任务单归档、wp-list 与 README 索引。

**明确不在范围内（禁止顺手做）：**

- `src/engine-core/**` 源码 diff 必须为空；`test/engine-core/` 与 `boundary.spec.ts` 一行不许动。
- 不改表结构 / 不加 migration / 不改实体列定义、resolver、module 装配、任何生产业务代码。
- 不改 mock 数据语义、断言条件、用例通过/失败结果；不新增/删除测试用例；不新增第三方依赖。
- 不改 tsconfig / vitest / eslint 配置文件；不删断言、不注释报错行消错。
- **B-1 排除项**：`wp38-character-version-semver.spec.ts:61` 与 `wp9b-character-admin.spec.ts:57` 的 `StubRepo.create()` 返回 `{ ...entity } as CharacterProfileEntity` —— 这是仓储 Stub 的 `Partial<Entity> → Entity` 签名适配惯用法，**不是行夹具漂移源**，保持现状；在交付记录 §遗留作为观察项列出即可。
- **B-3 边界**：只处理这两处文件头 directive；WP-M 清单内其余工具链债（husky / scripts lint 等）不在本单；若复核发现 warning 成因并非 `prettier/prettier` directive 失效（而是其他规则问题），停手登记 backlog，不在本单扩大。
- 不重构相邻代码、不做无关格式重排；B-1 三处不抽新 helper（直接复用既有 `character-profile-fixtures.ts`）。
- 提交分组隔离：工作区若有并行进程未提交产物，只暂存本单文件，不混入并行产物。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

---

## 3. 逐项处置（先复核定性，再最小改动）

> 通用纪律：每项动手前先 Grep 复核锚点文件与行号；改完该项跑定向 spec 确认通过；夹具口径对齐生产现状，**不反向改生产迁就 spec**。

### 3.1 B-1 · 3 处局部角色行构造迁移共享 builder

**共享夹具**：`test/engine-adapters/character-profile-fixtures.ts` 导出
`buildCharacterProfileRow(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity`，默认值工厂 + overrides 合并；默认列口径与 `character-profile.entity.ts` 列定义对齐（`personalityTraits` / `verbalVoice` 默认 `null`；`versionMajor=1 / Minor=0 / Patch=0`；`baselineSafety=0.5 / baselineBond=0`；集合列默认 `[]`；fivePs 五段默认空串）。

| 文件                                                                                         | 现状构造                                                              | 相对实体口径缺列（backlog B-1）                                                                                            |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `wp10a-character-expression-fields.spec.ts`（it 内联对象，锚点 `as CharacterProfileEntity`） | 内联在 ⑬ 用例中，从 `VISITOR_POOL_TEMPLATE_SEEDS[0]` 取 seed 字段拼装 | `versionMajor` / `versionMinor` / `versionPatch` / `personalityTraits` / `verbalVoice` / `baselineSafety` / `baselineBond` |
| `wp49-character-five-factor-personality.spec.ts`（`makeRow(overrides)`）                     | 局部函数 + `as CharacterProfileEntity`                                | `versionMajor` / `versionMinor` / `versionPatch` / `verbalVoice`                                                           |
| `wp51-character-seed-alliance-baseline.spec.ts`（`makeRow(overrides)`）                      | 局部函数 + `as CharacterProfileEntity`                                | `versionMajor` / `versionMinor` / `versionPatch` / `personalityTraits` / `verbalVoice`                                     |

**处置**：

1. 三处追加 `import { buildCharacterProfileRow } from './character-profile-fixtures.js'`（import 顺序参照同目录 `wp41-expression-style-rendering.spec.ts:24` 既有写法）；既有 `CharacterProfileEntity` import 形态保持不变。
2. 局部构造改为：
   - `wp49` / `wp51`：`return buildCharacterProfileRow({ /* 仅传与夹具默认不同的本用例覆盖列 */, ...overrides });`
   - `wp10a`：参照 `wp41` / `wp9b-db-character-resolver` 的局部 `buildRow` 形态抽出局部构造（或在 it 内直接调用夹具），覆盖列来自 `seed` 的映射保持原样；去掉行对象末尾的 `as CharacterProfileEntity`。
3. **覆盖列取舍纪律**：与夹具默认值相同的列（空集合、空串 fivePs、`null` 可空列等）不重复铺陈，只传本用例真实覆盖的列；覆盖值逐字沿用原对象字面量，不改任何数值与枚举。
4. **保留不动**：`wp10a` 紧随其后的 `toCharacterSeed(row) as unknown as Record<string, unknown>` 是对**映射输出**的断言（非行构造），不在 B-1 范围，保持原样。
5. 迁移后若夹具默认值与某用例原字面量存在口径差异（如 `auditStatus` 原 `'approved'`、夹具默认 `'draft'`），该列必须作为 overrides 显式传入，不得让默认值漂移进用例语义；交付记录逐项列明各 spec 传入了哪些覆盖列。
6. 不新增 fixture options；若夹具可调项覆盖不了用例需要的口径，优先在交付记录登记，不在 spec 内回退手搓。

**不改** 生产 `character-profile.entity.ts`；缺列由夹具默认补齐，resolver 消费路径（`personalityTraits == null` / `verbalVoice ? ... : {}` 等 falsy 分支）行为与原 `undefined` 同分支（backlog B-1 已逐列论证零影响）。

### 3.2 B-2 · wp-list §四 表格列数与引言行数

**复核点（动手前先读）**：§四 表头（3 列）、分隔行、TD-5 / L-2 / G-4 三行原 5 列内容；现场重数 §四 数据行总数（剔除表头与分隔行）。

**处置（方向 A，表头保持 3 列）**：

1. **TD-5 行**：原第 4 列优先级（`⚪ P3`）并入第 2 列描述前缀；原第 5 列交付态（闸门摘要 + 任务单/交付记录链接）整体并入第 3 列状态；第 1 列保留 `**TD-5**`。
2. **L-2 行**：原第 4 列优先级（`⚪ 依赖批次`）并入第 2 列；原第 5 列前置说明并入第 3 列状态；第 1 列保留 `**L-2**`。
3. **G-4 行**：原第 4 列优先级（`⚪ P3`）并入第 2 列；原第 5 列交付态并入第 3 列状态；第 1 列保留 `**G-4**`。
4. 折叠后三行竖线数必须为 `4`（3 列），与表内其余 32 行一致；链接相对路径逐字保留、不断链。
5. 引言行（§四 开头 blockquote）：「Phase2.5 独立单表现有 25 行」改为现场实测数据行数（执行时用 backlog B-2 取证命令重数；口径 = §四 表格行剔除表头 1 行 + 分隔 1 行）。
6. **方向 B 不采用**：不扩表头为 5 列、不给其余 32 行补列；若复核中发现某行交付态信息无法在 3 列内不丢失地表达，停下回报主控，不自行改表头。

**不改** §一 WP 清单、§三 出口条件、§五 Phase3 阻塞表等其他小节表格；不改 README 中对应行的 2 列形态。

### 3.3 B-3 · 两处 e2e 失效 `prettier/prettier` disable 清理

**复核点（先跑 lint 拿真实 warning 文案，再动手）**：

1. 跑 `pnpm lint`（或按 `package.json` 既有 lint 脚本；禁止裸 npx），记录两条 warning 的文件、行号、规则名与完整文案。
2. 判别成因：
   - **分支 1 · unused directive**（warning 为「未使用的 eslint-disable 指令 / `prettier/prettier` 未报告问题」一类）：
     - `knowledge-search.e2e-spec.ts:1`：`/* eslint-disable prettier/prettier, import/order */` → 保留仍被使用的 `import/order`，移除 `prettier/prettier`，改为 `/* eslint-disable import/order */`。
     - `privacy-guard.e2e-spec.ts:1`：`/* eslint-disable prettier/prettier */` → 整行注释删除（该行无其他规则）。
   - **分支 2 · 移除 directive 后暴露真实 prettier 违规**：先对该文件跑项目既有 prettier 格式化（`pnpm exec prettier --write <file>`，或 lint 脚本自带 fix），确认格式问题消除后再按分支 1 移除 directive。
3. 处置后复跑 `pnpm lint`：目标 **0 error / 0 warning**；若两条 warning 清不掉、或暴露出 directive 之外的真实违规需要改动逻辑/配置，停手登记 backlog，不在本单扩大。
4. **不改** `eslint.config.mjs` 或任何 lint 配置；不动 e2e 用例逻辑、断言、mock；不跑 e2e（依赖 DB/Qdrant，不在本单闸门内）。

### 3.4 B-1 排除项复核记录

`wp38-character-version-semver.spec.ts:61`、`wp9b-character-admin.spec.ts:57` 的 `create(entity: Partial<CharacterProfileEntity>): CharacterProfileEntity { return { ...entity } as CharacterProfileEntity; }`：仓储 Stub 签名适配，保持现状。交付记录 §遗留注明「StubRepo.create 断言未纳入 B-1；若后续重构 Stub 类型签名可一并消除」。

---

## 4. 红线（违反即返工）

1. **零运行时变化**：diff 只允许夹具复用与字段覆盖、文档表格折叠、文件头注释清理与必要格式化；mock 返回值、断言条件、用例通过/失败结果前后一致；用例数量不增不减。
2. **生产契约为准**：spec 过时 → spec 对齐生产现状；发现生产类型确有设计缺陷 → 登记 backlog，不在本单顺手改。
3. **engine-core 边界**：`git diff --stat HEAD -- src/engine-core` 为空；`boundary.spec.ts` 禁止动。
4. **配置不放宽**：不改 tsconfig / vitest / eslint 配置；不删断言、不注释报错行消错。
5. **隐私**：spec 夹具不引入真实逐字稿、心理对话原文；只保留构造句。
6. **命令规范**：一律 pnpm，禁止裸 npx；跑闸门前确认无 `nest start --watch` / `vite dev` 长驻进程；Windows 本机 git 在 `D:\Apps\Git\cmd`，依赖 git 的 spec 先补 PATH。
7. **既有债与新增分开**：交付记录写清本单改动文件清单；WP-M 既有工具链债不混入本单；复核中若发现新的契约缺陷，另开 backlog 登记。

---

## 5. 闸门（真实命令 / exit code / 数字写进交付记录）

| #   | 命令                                                                                                                                                                                                                                   | 通过标准                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                                                                                                                                                | **0 error、exit 0**（TD-5 已清零，本单不得回退）                                                                              |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                                                                                        | 保持 0 error（生产口径不退化）                                                                                                |
| 3   | `pnpm lint`                                                                                                                                                                                                                            | 0 error；**warning 由基线 2 清到 0**（B-3 目标）；若未达 0 须在交付记录写明成因与遗留                                         |
| 4   | `pnpm exec vitest run test/engine-core`                                                                                                                                                                                                | boundary 12 例全绿                                                                                                            |
| 5   | 定向复跑：`pnpm exec vitest run test/engine-adapters/wp10a-character-expression-fields.spec.ts test/engine-adapters/wp49-character-five-factor-personality.spec.ts test/engine-adapters/wp51-character-seed-alliance-baseline.spec.ts` | 3 文件全绿，用例数与改动前一致                                                                                                |
| 6   | 收尾 `pnpm test` 一次（仅交付前；`pnpm test:fast` 冒烟不作证据）                                                                                                                                                                       | 0 failed；记录测试文件数 / 用例数 / skipped / 墙钟与机器状态（Node 版本、长驻进程、盘读取状态），数字可复现                   |
| 7   | `git diff --stat HEAD -- src/engine-core`                                                                                                                                                                                              | 为空                                                                                                                          |
| 8   | `git diff --name-only HEAD`                                                                                                                                                                                                            | 逐条对照本单 §2 范围：仅 3 个 engine-adapters spec + 2 个 e2e 文件 + 1 个 wp-list md + docs 回写，无生产 src 文件、无并行产物 |

既有基准（HEAD `a51c684`，TD-6 回执口径）：全量 **3248 passed + 4 skipped（3252 例，194 文件）**；lint **0 error / 2 warning**（B-3 待清）；boundary **12 例全绿**；本单不改用例数量。

---

## 6. 交付物与固定路径

1. 交付记录：`docs/worklog/completed/phase2.5/td7-contract-drift-remediation-implementation-2026-11-13.md`，含：
   - B-1：三处各自迁移后传入的覆盖列清单、消除的断言位置；缺列由夹具默认补齐的逐条对照；
   - B-2：三行折叠前后列数对照、现场实测数据行数；
   - B-3：两条 warning 原始文案、判别分支（1 / 2）、移除的 directive、是否触发格式化；
   - 改动文件清单（spec / e2e / docs 分组，区分新增 / 修改 / 删除）；
   - 闸门表：实际命令、exit code、error / warning 数、测试文件 / 用例数、墙钟与机器状态；
   - 回归说明：未改 mock 语义 / 断言期望 / 用例逻辑，全量测试结果与基准一致；
   - 遗留项：§3.4 StubRepo.create 观察项；复核中发现但本单未处理的新问题（若有）登记 backlog。
2. 任务单归档：验收通过后本单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链接交付记录。
3. 索引回写：
   - `phase2.5-wp-list-2026-11-08.md` §四 TD-7 行（待开工 → 完成态 + 交付记录链接，3 列形态）；
   - `phase2.5-README.md` §3 TD-7 行同步完成态；
   - backlog `phase2.5-contract-drift-backlog-2026-11-13.md` 三条标记处置结论（或归档时按索引纪律处理）。
4. commit 草稿（一个提交一个意图；不跳过 `--no-verify`）：
   - `refactor(test,docs): TD-7 收尾契约漂移残留（3 处角色行复用共享 builder · wp-list 表格列数对齐 · e2e 失效 disable 清理，零运行时变化）`
   - `docs(worklog): TD-7 任务单 / 交付记录与索引回写`

---

## 7. DoD 核对清单

- [x] B-1 三处均改调 `buildCharacterProfileRow()`，行构造处 `as CharacterProfileEntity` 已消除；覆盖列逐字沿用原值，夹具默认补齐缺列；§3.4 两处 StubRepo.create 断言保持现状并已记录
- [x] B-2 三行折叠为 3 列（竖线数 4），链接不断链；引言行数为现场实测值；其余小节表格未动
- [x] B-3 两处 directive 按复核分支清理；lint 0 error / 0 warning（或未达项成因与遗留已写明）；eslint 配置未改
- [x] 根 tsc 0 error；build tsc 0 error；boundary 12 绿；定向 3 spec 全绿且用例数不变；`pnpm test` 全绿；engine-core diff 为空
- [x] `git diff --name-only HEAD` 仅含 §2 范围文件；生产 src 零改动；无并行产物混入
- [x] 未新增 / 删除测试用例；未改断言期望与 mock 语义；全量用例数与基准一致（3252 例 / 194 文件）
- [x] 交付记录、任务单归档、wp-list / README 索引一致，无断链

---

## 附录 A · 锚点清单（主控扫描备查，行号现场复核）

| #        | 生产 / 共享锚点                                                                                                                                                | spec / 文档锚点                                                                                                                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1      | `src/engine-adapters/wiring/character/character-profile.entity.ts`；共享夹具 `test/engine-adapters/character-profile-fixtures.ts` `buildCharacterProfileRow()` | `test/engine-adapters/wp10a-character-expression-fields.spec.ts`（it 内联对象 + `as`）、`test/engine-adapters/wp49-character-five-factor-personality.spec.ts`（`makeRow`）、`test/engine-adapters/wp51-character-seed-alliance-baseline.spec.ts`（`makeRow`）；复用参照 `wp41-expression-style-rendering.spec.ts`、`wp9b-db-character-resolver.spec.ts` |
| B-1 排除 | —                                                                                                                                                              | `test/engine-adapters/wp38-character-version-semver.spec.ts`（StubRepo.create）、`test/engine-adapters/wp9b-character-admin.spec.ts`（StubRepo.create）                                                                                                                                                                                                 |
| B-2      | —                                                                                                                                                              | `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四（表头 / 分隔行 + TD-5 / L-2 / G-4 三行 + 引言行）                                                                                                                                                                                                                                             |
| B-3      | `eslint.config.mjs`（只读核对，不改）                                                                                                                          | `test/e2e/knowledge-search.e2e-spec.ts:1`、`test/e2e/privacy-guard.e2e-spec.ts:1`                                                                                                                                                                                                                                                                       |

## 附录 B · 既有基准数字（HEAD `a51c684`）

- 根 tsc：0 error；build tsc：0 error；lint：0 error / 2 warning；boundary：12 绿；全量：3248 passed + 4 skipped（3252 例，194 文件）。
- 闸门命令与复跑方式见 §5；机器状态（Node 版本、长驻进程、盘读取）须在交付记录闸门表注明。
